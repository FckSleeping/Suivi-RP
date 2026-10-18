#!/usr/bin/env python3
"""
Synchronisation du suivi des RP de Sweeter Weather (LECTURE SEULE sur le forum).

Le script ne lit QUE les RP en cours de votre liste (data/manual.json, champ « topics », hors RP archives).
Pour chacun, il relit la derniere page du sujet : dernier message, auteur, date,
nombre de messages, et les comptes qui ont ecrit. Un sujet dont le dernier message a change depuis
le passage precedent recoit « new_reply » ; l'etiquette disparait au passage suivant. Il ecrit data/forum.json et
data/status.json.

Garanties
  - Le forum n'est jamais modifie (seule requete POST : la connexion).
  - data/manual.json n'est JAMAIS ecrit par ce script, seulement lu.
  - Le journal n'affiche aucun titre, pseudo ou texte : uniquement des numeros et des comptes.

Dates : celles du forum sont en heure de Paris, sans fuseau (ex. 2026-10-17T19:47).
Les dates de synchronisation (suffixe Z) sont en UTC.
"""
import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import proto_forum as p  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
SCHEMA = 2
PLAYERS = p.PLAYERS  # groupe -> compte joueuse ("3": chatondelalune, "4": fcksleeping)
KEEP = ("diag", "last_player", "first_seen", "path", "created", "last_post", "post_count", "last_page_path",
        "authors", "last_read", "last_changed", "previous_last_post_id")


class QuietForum(p.Forum):
    """Comme Forum, mais ne sauvegarde pas les pages (sauf si FORUM_DEBUG est defini)."""

    def _save(self, url, text):
        if os.environ.get("FORUM_DEBUG"):
            super()._save(url, text)


def now_utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path, default):
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return json.loads(json.dumps(default))
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
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


STATUS_REFRESH_HOURS = 3  # sans changement, status.json n'est reecrit qu'a cette frequence


def write_status(path, status):
    """Evite un commit a chaque passage : on ne reecrit que si quelque chose a change
    (hors date) ou si la derniere ecriture date de plus de STATUS_REFRESH_HOURS heures."""
    try:
        old = json.loads(path.read_text(encoding="utf-8"))
        same = {k: v for k, v in old.items() if k != "last_run"} == {k: v for k, v in status.items() if k != "last_run"}
        last = datetime.strptime(old["last_run"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        if same and (datetime.now(timezone.utc) - last).total_seconds() < STATUS_REFRESH_HOURS * 3600:
            return False
    except (FileNotFoundError, KeyError, ValueError, json.JSONDecodeError):
        pass
    return write_json(path, status)


# --------------------------------------------------------------------------- #
# Couleurs de paroles (les dialogues sont colores par personnage)
# --------------------------------------------------------------------------- #
COLOR_SELECTORS = ["quote", ".vrmtart > span", ".kitto > span"]
STYLE_COLOR_RE = re.compile(r"(?:^|;)\s*color\s*:\s*([^;!]+)", re.I)
NAMED_COLORS = {
    "black": "#000000", "white": "#ffffff", "red": "#ff0000", "green": "#008000", "blue": "#0000ff",
    "yellow": "#ffff00", "orange": "#ffa500", "purple": "#800080", "pink": "#ffc0cb", "brown": "#a52a2a",
    "gray": "#808080", "grey": "#808080", "silver": "#c0c0c0", "gold": "#ffd700", "cyan": "#00ffff",
    "aqua": "#00ffff", "magenta": "#ff00ff", "fuchsia": "#ff00ff", "lime": "#00ff00", "navy": "#000080",
    "teal": "#008080", "olive": "#808000", "maroon": "#800000", "violet": "#ee82ee", "indigo": "#4b0082",
    "crimson": "#dc143c", "coral": "#ff7f50", "salmon": "#fa8072", "turquoise": "#40e0d0", "lavender": "#e6e6fa",
    "beige": "#f5f5dc", "khaki": "#f0e68c", "tomato": "#ff6347", "orchid": "#da70d6", "plum": "#dda0dd",
    "skyblue": "#87ceeb", "royalblue": "#4169e1", "darkred": "#8b0000", "darkblue": "#00008b",
    "darkgreen": "#006400", "hotpink": "#ff69b4", "deeppink": "#ff1493", "chocolate": "#d2691e",
    "sienna": "#a0522d", "tan": "#d2b48c", "slateblue": "#6a5acd", "seagreen": "#2e8b57",
}


def to_hex(value):
    """'#F0A', 'rgb(1,2,3)' ou 'red' -> '#rrggbb' (None si on ne comprend pas)."""
    v = (value or "").strip().lower()
    m = re.fullmatch(r"#([0-9a-f]{3})", v)
    if m:
        return "#" + "".join(c * 2 for c in m.group(1))
    if re.fullmatch(r"#[0-9a-f]{6}", v):
        return v
    m = re.fullmatch(r"rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/][^)]*)?\)", v)
    if m and all(int(x) <= 255 for x in m.groups()):
        return "#%02x%02x%02x" % tuple(int(x) for x in m.groups())
    return NAMED_COLORS.get(v)


def element_color(el):
    """Couleur d'un element : son style color, ou celle du premier span/font colore a l'interieur."""
    for node in [el] + el.find_all(["span", "font"]):
        m = STYLE_COLOR_RE.search(node.get("style") or "")
        c = to_hex(m.group(1)) if m else to_hex(node.get("color"))
        if c:
            return c
    return None


def post_colors(soup, post_id):
    """Couleurs de paroles trouvees dans un message (hors citations « blockquote » d'autres membres)."""
    box = soup.find(id=f"p{post_id}")
    if box is None:
        return []
    found = []
    for sel in COLOR_SELECTORS:
        for el in box.select(sel):
            if el.find_parent("blockquote"):
                continue
            c = element_color(el)
            if c:
                found.append(c)
    return found


def topic_id(url):
    m = re.search(r"/t(\d+)", url or "")
    return m.group(1) if m else None


def clean_path(url):
    """'https://forum/t12p30-titre?x=1#p5' -> '/t12-titre' (sans domaine, parametres ni pagination)."""
    path = urlparse(url).path or url
    return re.sub(r"/t(\d+)p\d+-", r"/t\1-", path)


def slim_post(post):
    a = post["author"]
    return {
        "post_id": post["post_id"],
        "author": {"uid": a["uid"], "name": a["name"], "group": a["group"]} if a else None,
        "date": post["date"],
    }


def _post_info(pid, el):
    """Auteur et date d'un element « message » (meme logique que le prototype)."""
    author = None
    for a in el.find_all("a", href=True):
        m = re.match(r"^(?:https?://[^/]+)?/u(\d+)(?:[^\d]|$)", a["href"])
        if m and a.get_text(strip=True):
            author = {"uid": m.group(1), "name": a.get_text(strip=True), "group": p.link_group(a)}
            break
    tm = el.find("time")
    raw = (tm.get("datetime") or tm.get_text(strip=True)) if tm else None
    if not raw:
        m = p.DATE_RE.search(el.get_text(" ", strip=True))
        raw = m.group(0) if m else None
    iso = raw if raw and re.match(r"\d{4}-\d{2}-\d{2}T", raw) else p.parse_fr_date(raw)
    return {"post_id": pid, "author": author, "date_raw": raw, "date": iso}


def clean_post_pairs(soup):
    """Messages d'une page (element, infos), sans les faux messages.
    Le prototype prend pour un message tout element dont l'id ressemble a « p123 » : un habillage de RP
    ou un element parasite portant un tel id devenait un faux « dernier message » (sans auteur ni date).
    Ici : on garde les elements les plus exterieurs, puis ceux qui ont un auteur ou une date.
    Renvoie (messages, diagnostic) ; le diagnostic ne contient que des comptes et des noms de balises."""
    cands = soup.find_all(id=re.compile(r"^p\d+$"))
    ids = {id(c) for c in cands}
    outer = [c for c in cands if not any(id(par) in ids for par in c.parents)]
    posts, seen = [], set()
    for el in outer:
        pid = el["id"][1:]
        if pid not in seen:
            seen.add(pid)
            posts.append((el, _post_info(pid, el)))
    if not posts:  # autre theme : repli sur la lecture du prototype
        posts = [(None, x) for x in p.parse_posts(soup)]
    good = [x for x in posts if x[1]["author"] or x[1]["date"]]
    kept = good or posts
    last_el = kept[-1][0] if kept else None
    diag = {"candidats": len(cands), "externes": len(outer), "retenus": len(kept),
            "avec_auteur": sum(1 for _, x in kept if x["author"]), "avec_date": sum(1 for _, x in kept if x["date"])}
    if last_el is not None:
        diag["dernier"] = {"balise": last_el.name, "classes": last_el.get("class") or []}
    return kept, diag


def parse_posts_clean(soup):
    """Comme clean_post_pairs, mais ne renvoie que les infos (auteur, date...) de chaque message."""
    pairs, diag = clean_post_pairs(soup)
    return [x for _, x in pairs], diag


def read_topic(forum, tid, t):
    """Lit la derniere page (et la premiere si la creation est inconnue). Modifie t."""
    path = t["path"] if not t.get("created") else (t.get("last_page_path") or t["path"])
    first, retried = None, False
    authors = {a["uid"]: dict(a) for a in t.get("authors", [])}
    counts = {}  # uid -> couleurs vues dans les pages lues cette fois-ci
    for _ in range(8):
        r, soup = forum.soup(path)
        if r.status_code != 200:
            if path != t["path"] and not retried:  # l'ancienne « derniere page » n'existe plus
                path, retried = t["path"], True
                continue
            raise RuntimeError(f"http_{r.status_code}")
        posts, diag = parse_posts_clean(soup)
        for post in posts:
            a = post["author"]
            if a and a["group"] in PLAYERS:
                entry = authors.setdefault(a["uid"], {})  # conserve la couleur deja connue
                entry.update({"uid": a["uid"], "name": a["name"], "group": a["group"]})
                for c in post_colors(soup, post["post_id"]):
                    counts.setdefault(a["uid"], Counter())[c] += 1
        m = re.search(rf"/t{tid}p(\d+)-", path)
        cur = int(m.group(1)) if m else 0
        offs = {}
        for a in soup.find_all("a", href=True):
            mm = re.search(rf"/t{tid}p(\d+)-", a["href"])
            if mm:
                offs[int(mm.group(1))] = urlparse(a["href"]).path
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
    prev_player, prev_count = t.get("last_player"), t.get("post_count")
    t["last_post"] = slim_post(posts[-1])
    t["post_count"] = cur + len(posts)
    t["last_player"] = deduce_last_player(t, t["last_post"], t["post_count"], prev_player, prev_count)
    if t["last_player"] is None:
        t.pop("last_player")
    if not posts[-1]["author"] or not posts[-1]["date"]:
        t["diag"] = diag  # aide au depannage : ce qui a ete vu sur la page (aucun texte du forum)
    else:
        t.pop("diag", None)
    t["last_page_path"] = path
    for uid, cnt in counts.items():
        authors[uid]["color"] = cnt.most_common(1)[0][0]
    t["authors"] = sorted(authors.values(), key=lambda a: a["uid"])


def other_player(player):
    others = [v for v in PLAYERS.values() if v != player]
    return others[0] if player in PLAYERS.values() and others else None


def player_of(post):
    """Compte joueuse (chatondelalune / fcksleeping) d'un message, d'apres le groupe de son auteur."""
    a = (post or {}).get("author")
    return PLAYERS.get(a["group"]) if a and a.get("group") else None


def deduce_last_player(t, last_post, count, prev_player, prev_count):
    """Qui a ecrit le dernier message ? Dans un RP a deux, les messages alternent :
    1. l'auteur du dernier message, s'il est lisible ;
    2. sinon, le dernier etat connu : chaque nouveau message change de joueuse ;
    3. sinon, la parite : le message n°1 est du createur, le n°2 de l'autre, etc."""
    lp = player_of(last_post)
    if lp:
        return lp
    if prev_player and prev_count is not None and count is not None:
        return prev_player if (count - prev_count) % 2 == 0 else other_player(prev_player)
    creator = player_of(t.get("created"))
    if creator and count:
        return creator if count % 2 == 1 else other_player(creator)
    return None


def is_newer(after, before):
    """Les numeros de messages augmentent avec le temps : « nouvelle reponse » = numero plus grand."""
    try:
        return int(after) > int(before)
    except (TypeError, ValueError):
        return after != before


def compute_flags(t):
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
    return flags


def run(args, forum, log=print):
    manual = load_json(DATA_DIR / "manual.json", {})
    old = load_json(DATA_DIR / "forum.json", {})
    status = {"schema": SCHEMA, "last_run": now_utc(), "ok": True, "errors": [],
              "topics_total": 0, "topics_read": 0, "topics_with_new_reply": 0}

    def error(where, what):
        status["errors"].append({"where": where, "what": what})
        status["ok"] = False
        log(f"  ! {where} : {what}")

    # Les RP de la liste : numero de sujet -> chemin
    paths = {}
    for entry in (manual.get("topics") or {}).values():
        tid = topic_id(entry.get("url"))
        if not tid or entry.get("archived"):
            continue  # RP prevu mais pas encore commence (pas de lien), ou archive (voir recap.py)
        paths[tid] = clean_path(entry["url"])

    # On repart des donnees deja connues (pour ne relire que le necessaire)
    topics = {}
    for tid, path in paths.items():
        prev = {k: v for k, v in (old.get("topics", {}).get(tid) or {}).items() if k in KEEP}
        prev.setdefault("first_seen", now_utc())
        if prev.get("path") != path:  # le lien a change : on repart de zero pour ce sujet
            prev = {"first_seen": prev["first_seen"]}
        prev["path"] = path
        topics[tid] = prev

    targets = [t for t in topics if not args.only or t in args.only]
    log(f"\n=== Lecture de {len(targets)} RP sur {len(topics)} dans la liste ===")
    for i, tid in enumerate(targets, 1):
        t = topics[tid]
        before = (t.get("last_post") or {}).get("post_id")
        before_count = t.get("post_count")
        try:
            read_topic(forum, tid, t)
            t["last_read"] = now_utc()
            t.pop("last_error", None)
            status["topics_read"] += 1
            after = t["last_post"]["post_id"]
            count = t.get("post_count")
            grew = count > before_count if before_count is not None and count is not None else is_newer(after, before)
            if before and grew:
                t["previous_last_post_id"] = before
                t["last_changed"] = now_utc()
                t["new_reply"] = True  # non conserve d'un passage a l'autre : l'etiquette disparait a la synchro suivante
                status["topics_with_new_reply"] += 1
                log(f"   t{tid} : nouvelle reponse")
        except Exception as e:
            t["last_error"] = {"at": now_utc(), "what": f"{type(e).__name__}: {e}"}
            error(f"t{tid}", t["last_error"]["what"])
        if i % 10 == 0:
            log(f"   ... {i}/{len(targets)}")

    for t in topics.values():
        t["flags"] = compute_flags(t)
    status["topics_total"] = len(topics)
    log(f"\n=== Bilan : {status['topics_read']} lu(s), {status['topics_with_new_reply']} avec nouvelle reponse ===")
    if targets and status["topics_read"] == 0:
        status["ok"] = False
        status["errors"].append({"where": "global", "what": "aucun_sujet_lisible"})
    return {"schema": SCHEMA, "topics": topics}, status


def main():
    ap = argparse.ArgumentParser(description="Synchronisation lecture seule du forum Sweeter Weather")
    ap.add_argument("--base", default=os.environ.get("FORUM_BASE") or "https://sweeter-weather.forumactif.com")
    ap.add_argument("--only", action="append", default=[], help="ne lire que ce numero de sujet (test), repetable")
    ap.add_argument("--delay", type=float, default=1.0, help="pause entre deux pages (secondes)")
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
            write_status(DATA_DIR / "status.json", status)
        sys.exit("X Connexion impossible : donnees non modifiees.")

    store, status = run(args, forum)
    if args.dry_run:
        print("\n(dry-run : rien n'a ete ecrit)")
    else:
        changed = write_json(DATA_DIR / "forum.json", store)
        written = write_status(DATA_DIR / "status.json", status)
        print(f"data/forum.json : {'mis a jour' if changed else 'inchange'} ; "
              f"data/status.json : {'ecrit' if written else 'inchange'}.")
    sys.exit(0 if status["ok"] or status["topics_read"] else 1)


if __name__ == "__main__":
    main()
