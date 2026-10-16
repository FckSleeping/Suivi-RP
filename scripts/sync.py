#!/usr/bin/env python3
"""
Synchronisation du suivi des RP de Sweeter Weather (LECTURE SEULE sur le forum).

Ce que fait le script
  1. se connecte avec le compte de lecture (secrets FORUM_USER / FORUM_PASSWORD) ;
  2. lit la liste des membres des groupes 3 et 4 (les personnages) ;
  3. de temps en temps (voir --discover-every), cherche les sujets ou chaque
     personnage a poste et les classe RP / hors RP ;
  4. relit la DERNIERE page de chaque RP suivi : dernier message, auteur, date ;
  5. calcule les alertes (auteur inconnu, un seul camp...) et les suggestions
     de remplacement ;
  6. ecrit data/forum.json et data/status.json.

Garanties
  - Le forum n'est jamais modifie (seule requete POST : la connexion).
  - data/manual.json (vos corrections) n'est JAMAIS ecrit par ce script, seulement lu.
  - Rien n'est jamais supprime de data/forum.json : un sujet qui n'est plus
    retrouve est simplement conserve avec sa derniere lecture connue.
  - Aucun RP n'est archive automatiquement : les remplacements ne sont que des
    suggestions, la decision est notee dans manual.json.
  - Le journal n'affiche aucun titre, pseudo ou texte : uniquement des comptes
    et des numeros de sujets.

Dates : celles du forum sont en heure de Paris, sans fuseau (ex. 2026-10-17T19:47).
Les dates de synchronisation (suffixe Z) sont en UTC.
"""
import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import proto_forum as p  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
SCHEMA = 1
PLAYERS = p.PLAYERS  # groupe -> compte joueuse ("3": chatondelalune, "4": fcksleeping)
UID_RE = re.compile(r"^(?:https?://[^/]+)?/u(\d+)(?:[^\d]|$)")

DEFAULT_MANUAL = {
    "_aide": "Fichier de vos corrections. La synchronisation le lit mais ne l'ecrit jamais.",
    "schema": SCHEMA,
    "characters": {},    # uid ou "manuel-N" -> {name, player, aliases[], active, account_name?}
    "topics": {},        # tid -> {include, status, characters[], title, path, note}
    "forum_rules": {},   # forum_id -> true (c'est du RP) / false (ce n'est pas du RP)
    "replacements": {},  # "nouveau>ancien" -> {decision: accepted|refused, ...}
    "seen": {},          # tid -> post_id deja vu (pour le badge « nouvelle reponse »)
}


# --------------------------------------------------------------------------- #
# Utilitaires
# --------------------------------------------------------------------------- #
class QuietForum(p.Forum):
    """Comme Forum, mais ne sauvegarde pas les pages (sauf si FORUM_DEBUG est defini)."""

    def _save(self, url, text):
        if os.environ.get("FORUM_DEBUG"):
            super()._save(url, text)


def now_utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_utc(s):
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def load_json(path, default):
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return json.loads(json.dumps(default))
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        # On s'arrete plutot que d'ecraser un fichier abime.
        sys.exit(f"X {path.name} n'est pas un JSON valide ({e}). Rien n'a ete modifie.")


def write_json(path, obj):
    """Ecriture atomique ; ne touche pas au fichier s'il n'a pas change. Renvoie True si modifie."""
    text = json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
    return True


def url_path(href):
    """Chemin seul, sans domaine ni ?parametres (ex. '/t12-titre')."""
    return urlparse(href).path or href


def slim_post(post):
    a = post["author"]
    return {
        "post_id": post["post_id"],
        "author": {"uid": a["uid"], "name": a["name"], "group": a["group"]} if a else None,
        "date": post["date"],
    }


# --------------------------------------------------------------------------- #
# Membres
# --------------------------------------------------------------------------- #
def read_members(forum):
    """Tous les membres de /memberlist : {uid: {name, group}} (silencieux)."""
    members, start, step, pages = {}, 0, None, 0
    while pages < 60:
        path = "/memberlist" if start == 0 else f"/memberlist?start={start}"
        r, soup = forum.soup(path)
        if r.status_code != 200:
            raise RuntimeError(f"memberlist_http_{r.status_code}")
        pages += 1
        if pages == 1:
            offs = [int(x) for x in re.findall(r"memberlist\?[^\"'>]*?start=(\d+)", r.text) if int(x) > 0]
            step = min(offs) if offs else None
        new = 0
        for a in soup.find_all("a", href=True):
            m = UID_RE.match(a["href"])
            name = a.get_text(strip=True)
            if not m or not name:
                continue
            uid, group = m.group(1), p.link_group(a)
            if uid not in members:
                members[uid] = {"name": name, "group": group}
                new += 1
            elif not members[uid]["group"]:
                members[uid]["group"] = group
        if new == 0 or not step:
            break
        start += step
    return members


# --------------------------------------------------------------------------- #
# Regles RP (automatique + corrections manuelles)
# --------------------------------------------------------------------------- #
def topic_manual(manual, tid):
    return manual.get("topics", {}).get(str(tid), {})


def is_rp_final(tid, t, manual):
    """Priorite : choix manuel du sujet > regle manuelle du forum > regle automatique."""
    inc = topic_manual(manual, tid).get("include")
    if inc is not None:
        return bool(inc)
    rule = manual.get("forum_rules", {}).get(str(t.get("forum_id")))
    if rule is not None:
        return bool(rule)
    return bool(t.get("auto_rp"))


def status_of(tid, manual):
    return topic_manual(manual, tid).get("status") or "en_cours"


def effective_characters(tid, t, manual):
    forced = topic_manual(manual, tid).get("characters")
    return sorted(forced if forced is not None else t.get("characters", []))


def player_of(uid, store, manual):
    c = manual.get("characters", {}).get(uid) or {}
    if c.get("player"):
        return c["player"]
    return PLAYERS.get((store["members"].get(uid) or {}).get("group"))


# --------------------------------------------------------------------------- #
# Decouverte des sujets
# --------------------------------------------------------------------------- #
def discover(forum, store, manual, delay, log):
    members = store["members"]
    manual_chars = manual.get("characters", {})
    to_search = {}  # uid -> pseudo du compte a chercher
    for uid, m in members.items():
        if m.get("group") in PLAYERS and manual_chars.get(uid, {}).get("active", True):
            to_search[uid] = m["name"]
    for uid, c in manual_chars.items():  # comptes ajoutes a la main
        if uid not in to_search and c.get("active", True) and c.get("account_name"):
            to_search[uid] = c["account_name"]
    if not to_search:
        raise RuntimeError("aucun_personnage_a_chercher")
    log(f"  Decouverte : {len(to_search)} compte(s) a rechercher")

    registry = p.build_forum_registry(forum)
    found = {}
    for i, (uid, name) in enumerate(to_search.items(), 1):
        res = p.search_author(forum, name)
        log(f"   [{i}/{len(to_search)}] compte #{uid} : {len(res)} sujet(s)")
        for tid, t in res.items():
            e = found.setdefault(tid, {**t, "characters": set()})
            e["characters"].add(uid)
        if i < len(to_search):
            time.sleep(delay)

    # Categorie de chaque forum : fil d'Ariane d'un sujet (mis en cache dans store["forums"])
    for t in found.values():
        fid = t["forum_id"]
        if fid and fid not in store["forums"]:
            _, s = forum.soup(t["href"])
            crumb = p.topic_breadcrumb(s)
            cats = [n for k, _, n in crumb if k == "c"]
            fnames = [n for k, _, n in crumb if k == "f"]
            reg = registry.get(fid, {})
            store["forums"][fid] = {
                "name": t["forum_name"] or reg.get("name"),
                "names": fnames or [t["forum_name"]],
                "category": cats[0] if cats else reg.get("cat"),
            }

    now = now_utc()
    for tid, t in found.items():
        cur = store["topics"].setdefault(tid, {"first_seen": now, "characters": []})
        info = store["forums"].get(t["forum_id"]) or {"name": t["forum_name"], "cat": None}
        rp, why = p.is_rp({"cat": info.get("category") or info.get("cat"),
                           "names": info.get("names") or [info.get("name")]})
        cur.update({
            "title": t["title"],
            "path": url_path(t["href"]),
            "forum_id": t["forum_id"],
            "forum": info.get("name"),
            "category": info.get("category") or info.get("cat"),
            "auto_rp": rp,
            "auto_rp_why": why,
            "last_found": now,
        })
        cur["characters"] = sorted(set(cur.get("characters", [])) | t["characters"])
    log(f"  {len(found)} sujet(s) trouve(s) par la recherche")


# --------------------------------------------------------------------------- #
# Lecture d'un sujet
# --------------------------------------------------------------------------- #
def read_topic(forum, tid, t):
    """Lit la derniere page (et la premiere si la creation est inconnue). Modifie t."""
    path = t["path"] if not t.get("created") else (t.get("last_page_path") or t["path"])
    first, retried = None, False
    for _ in range(8):
        r, soup = forum.soup(path)
        if r.status_code != 200:
            if path != t["path"] and not retried:  # l'ancienne « derniere page » n'existe plus
                path, retried = t["path"], True
                continue
            raise RuntimeError(f"http_{r.status_code}")
        posts = p.parse_posts(soup)
        m = re.search(rf"/t{tid}p(\d+)-", path)
        cur = int(m.group(1)) if m else 0
        offs = {}
        for a in soup.find_all("a", href=True):
            mm = re.search(rf"/t{tid}p(\d+)-", a["href"])
            if mm:
                offs[int(mm.group(1))] = url_path(a["href"])
        if cur == 0 and first is None:
            first = posts
        best = max(offs, default=0)
        if best > cur:
            path = offs[best]
            continue
        break
    else:
        raise RuntimeError("pagination_trop_longue")

    if not posts:
        raise RuntimeError("aucun_message_lisible")

    if first and not t.get("created"):
        t["created"] = slim_post(first[0])
    t["last_post"] = slim_post(posts[-1])
    t["post_count"] = cur + len(posts)
    t["last_page_path"] = path
    seen = set(t.get("characters", []))
    for post in posts:
        a = post["author"]
        if a and a["group"] in PLAYERS:
            seen.add(a["uid"])
    t["characters"] = sorted(seen)


def compute_flags(tid, t, store, manual):
    flags = []
    if t.get("last_error"):
        flags.append("erreur_lecture")
    lp = t.get("last_post")
    if not lp:
        flags.append("jamais_lu")
    else:
        if not lp.get("author"):
            flags.append("auteur_inconnu")
        if not lp.get("date"):
            flags.append("date_illisible")
        if not t.get("created") or not (t["created"] or {}).get("date"):
            flags.append("creation_inconnue")
    chars = effective_characters(tid, t, manual)
    camps = {player_of(u, store, manual) for u in chars} - {None}
    if len(camps) < 2:
        flags.append("un_seul_camp")
    return flags


# --------------------------------------------------------------------------- #
# Suggestions de remplacement (jamais appliquees automatiquement)
# --------------------------------------------------------------------------- #
def suggest_replacements(store, manual):
    decided = manual.get("replacements", {})
    replaced = {k.split(">", 1)[1] for k, v in decided.items()
                if v.get("decision") == "accepted" and ">" in k}
    groups = {}
    for tid, t in store["topics"].items():
        if not is_rp_final(tid, t, manual) or status_of(tid, manual) == "archive" or tid in replaced:
            continue
        created = (t.get("created") or {}).get("date")
        chars = frozenset(effective_characters(tid, t, manual))
        if created and len(chars) >= 2:
            groups.setdefault(chars, []).append((created, tid))
    out = []
    for chars, items in groups.items():
        items.sort()
        for (c_old, old), (c_new, new) in zip(items, items[1:]):
            key = f"{new}>{old}"
            if key in decided or c_new == c_old:
                continue
            out.append({"key": key, "new": new, "old": old, "characters": sorted(chars),
                        "reason": "memes_personnages", "created_old": c_old, "created_new": c_new})
    return sorted(out, key=lambda s: s["key"])


# --------------------------------------------------------------------------- #
# Programme principal
# --------------------------------------------------------------------------- #
def run(args, forum, log=print):
    manual = load_json(DATA_DIR / "manual.json", DEFAULT_MANUAL)
    store = load_json(DATA_DIR / "forum.json", {
        "schema": SCHEMA, "meta": {}, "members": {}, "forums": {}, "topics": {}, "suggestions": []})
    for k, v in (("meta", {}), ("members", {}), ("forums", {}), ("topics", {}), ("suggestions", [])):
        store.setdefault(k, v)
    store["schema"] = SCHEMA
    status = {"schema": SCHEMA, "last_run": now_utc(), "ok": True, "errors": [],
              "discovery_ran": False, "topics_total": 0, "topics_rp": 0, "topics_read": 0,
              "topics_with_new_reply": 0}

    def error(where, what):
        status["errors"].append({"where": where, "what": what})
        status["ok"] = False
        log(f"  ! {where} : {what}")

    # -- Membres
    log("\n=== Membres ===")
    try:
        members = read_members(forum)
        kept = {u: m for u, m in members.items() if m["group"] in PLAYERS}
        if not kept:
            raise RuntimeError("aucun_membre_de_groupe_3_ou_4")
        store["members"].update(kept)
        log(f"  {len(members)} membre(s) lu(s), dont {len(kept)} dans les groupes 3 et 4")
    except Exception as e:  # on garde les membres deja connus
        error("membres", f"{type(e).__name__}: {e}")

    # -- Decouverte
    last = parse_utc(store["meta"].get("last_discovery"))
    due = args.discover == "oui" or (
        args.discover == "auto"
        and (last is None or datetime.now(timezone.utc) - last > timedelta(hours=args.discover_every)))
    if due and store["members"]:
        log("\n=== Decouverte des sujets ===")
        try:
            discover(forum, store, manual, args.search_delay, log)
            store["meta"]["last_discovery"] = now_utc()
            status["discovery_ran"] = True
        except Exception as e:
            error("decouverte", f"{type(e).__name__}: {e}")
    else:
        log("\n=== Decouverte des sujets : non necessaire cette fois ===")

    # -- Sujets ajoutes a la main
    for tid, mt in manual.get("topics", {}).items():
        if tid not in store["topics"] and mt.get("path") and mt.get("include") is not False:
            store["topics"][tid] = {"first_seen": now_utc(), "characters": [], "manual_only": True,
                                    "title": mt.get("title") or f"Sujet {tid}", "path": url_path(mt["path"]),
                                    "forum_id": None, "forum": None, "category": None, "auto_rp": False}

    # -- Lecture des RP suivis
    targets = [tid for tid, t in store["topics"].items()
               if is_rp_final(tid, t, manual) and status_of(tid, manual) != "archive"]
    if args.only:
        targets = [t for t in targets if t in args.only]
    log(f"\n=== Lecture de {len(targets)} RP ===")
    for i, tid in enumerate(targets, 1):
        t = store["topics"][tid]
        before = (t.get("last_post") or {}).get("post_id")
        try:
            read_topic(forum, tid, t)
            t["last_read"] = now_utc()
            t.pop("last_error", None)
            status["topics_read"] += 1
            after = t["last_post"]["post_id"]
            if before and after != before:
                t["previous_last_post_id"] = before
                t["last_changed"] = now_utc()
                status["topics_with_new_reply"] += 1
                log(f"   t{tid} : nouvelle reponse")
        except Exception as e:
            t["last_error"] = {"at": now_utc(), "what": f"{type(e).__name__}: {e}"}
            error(f"t{tid}", t["last_error"]["what"])
        if i % 10 == 0:
            log(f"   ... {i}/{len(targets)}")

    # -- Alertes et suggestions
    for tid, t in store["topics"].items():
        t["flags"] = compute_flags(tid, t, store, manual) if is_rp_final(tid, t, manual) else []
    store["suggestions"] = suggest_replacements(store, manual)

    status["topics_total"] = len(store["topics"])
    status["topics_rp"] = sum(1 for tid, t in store["topics"].items() if is_rp_final(tid, t, manual))
    flagged = sum(1 for t in store["topics"].values() if t["flags"])
    log(f"\n=== Bilan : {status['topics_rp']} RP, {status['topics_read']} lu(s), "
        f"{status['topics_with_new_reply']} avec nouvelle reponse, {flagged} a verifier, "
        f"{len(store['suggestions'])} suggestion(s) de remplacement ===")

    if status["topics_read"] == 0 and targets:
        status["ok"] = False
        status["errors"].append({"where": "global", "what": "aucun_sujet_lisible"})
    return store, status


def main():
    ap = argparse.ArgumentParser(description="Synchronisation lecture seule du forum Sweeter Weather")
    ap.add_argument("--base", default=os.environ.get("FORUM_BASE") or "https://sweeter-weather.forumactif.com")
    ap.add_argument("--discover", choices=["auto", "oui", "non"], default="auto",
                    help="auto : seulement si la derniere decouverte est ancienne (defaut)")
    ap.add_argument("--discover-every", type=float, default=6.0, help="heures entre deux decouvertes (mode auto)")
    ap.add_argument("--only", action="append", default=[], help="ne lire que ce numero de sujet (test), repetable")
    ap.add_argument("--delay", type=float, default=1.0, help="pause entre deux pages (secondes)")
    ap.add_argument("--search-delay", type=float, default=6.0, help="pause entre deux recherches (secondes)")
    ap.add_argument("--dry-run", action="store_true", help="ne rien ecrire")
    args = ap.parse_args()
    p.DELAY = args.delay

    user, pwd = os.environ.get("FORUM_USER"), os.environ.get("FORUM_PASSWORD")
    if not user or not pwd:
        sys.exit("X Les secrets FORUM_USER et/ou FORUM_PASSWORD sont absents ou vides.")

    DATA_DIR.mkdir(exist_ok=True)
    forum = QuietForum(args.base)
    if not p.login(forum, user, pwd):
        status = {"schema": SCHEMA, "last_run": now_utc(), "ok": False,
                  "errors": [{"where": "connexion", "what": "refusee_ou_bloquee"}]}
        if not args.dry_run:
            write_json(DATA_DIR / "status.json", status)
        sys.exit("X Connexion impossible : donnees non modifiees.")

    store, status = run(args, forum)
    if args.dry_run:
        print("\n(dry-run : rien n'a ete ecrit)")
    else:
        changed = write_json(DATA_DIR / "forum.json", store)
        write_json(DATA_DIR / "status.json", status)
        print(f"data/forum.json : {'mis a jour' if changed else 'inchange'} ; data/status.json ecrit.")
    sys.exit(0 if status["ok"] or status["topics_read"] else 1)


if __name__ == "__main__":
    main()
