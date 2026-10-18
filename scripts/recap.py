#!/usr/bin/env python3
"""
Recapitulatif des RP archives (a lancer une fois par jour, pas toutes les 30 minutes).

Pour chaque RP ARCHIVE de data/manual.json qui a un lien et pas encore de recap :
  1. lit TOUTES les pages du sujet sur le forum (lecture seule) ;
  2. decoupe le texte en blocs et demande a Claude (API Anthropic) un resume de chacun,
     puis un recapitulatif d'ensemble rapide ;
  3. ecrit data/recaps.json.

Un recap n'est refait que si le lien du RP change, ou si vous le demandez depuis la page
(bouton « Refaire le recap »). Les recaps des RP supprimes de la liste sont effaces.

Variables d'environnement (Secrets GitHub) :
  FORUM_USER, FORUM_PASSWORD   compte de lecture du forum
  ANTHROPIC_API_KEY            cle de l'API Anthropic (console.anthropic.com)
  RECAP_MODEL (facultatif)     modele utilise, « claude-haiku-5-5 » par defaut (le moins cher)

CONFIDENTIALITE : le texte des RP est envoye a l'API d'Anthropic pour etre resume.
Le journal d'execution n'affiche aucun titre, pseudo ni texte : uniquement des numeros et des comptes.
"""
import argparse
import copy
import os
import re
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import proto_forum as p  # noqa: E402
import sync as S  # noqa: E402

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-haiku-5-5"
CHUNK_CHARS = 60000      # ~15 000 jetons par bloc envoye a l'API
MAX_CHUNKS = 40          # au-dela, le RP est considere comme trop long pour un recap automatique
MAX_PAGES = 600

SYSTEM = ("Tu resumes des RP (jeux de role ecrits a deux, sur un forum) pour un suivi prive. "
          "Reponds en francais, sans introduction ni conclusion, de facon neutre et factuelle, "
          "sans citer de phrases du texte. Ecris en prose, pas en liste.")

BODY_SELECTORS = [".post-content", ".postbody .content", ".content", ".postbody", ".post_content", ".message-content"]
DROP_SELECTORS = "script, style, blockquote, .signature, .sig, .postsig, .post-signature"


class ApiAuthError(Exception):
    """Cle API refusee : inutile de continuer."""


# --------------------------------------------------------------------------- #
# Utilitaires
# --------------------------------------------------------------------------- #
def parse_iso(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def post_text(el):
    """Texte d'un message, sans citations ni signature (si le theme le permet)."""
    if el is None:
        return ""
    el = copy.copy(el)
    for bad in el.select(DROP_SELECTORS):
        bad.decompose()
    body = None
    for sel in BODY_SELECTORS:
        body = el.select_one(sel)
        if body is not None:
            break
    return re.sub(r"\s+", " ", (body or el).get_text(" ", strip=True)).strip()


def page_path(path, offset):
    """'/t12-titre' + 30 -> '/t12p30-titre'."""
    return re.sub(r"^/t(\d+)(?:p\d+)?", lambda m: f"/t{m.group(1)}" + (f"p{offset}" if offset else ""), path, count=1)


def read_all(forum, tid, path, delay, log):
    """Tous les messages d'un sujet : liste de {id, author, date, text}. Silencieux sur le contenu."""
    posts, seen = [], set()
    offsets_seen = lambda soup: [int(m.group(1)) for a in soup.find_all("a", href=True)
                                 for m in [re.search(rf"/t{tid}p(\d+)-", a["href"])] if m]

    def take(soup):
        pairs, _ = S.clean_post_pairs(soup)
        n = 0
        for el, info in pairs:
            if info["post_id"] in seen:
                continue
            seen.add(info["post_id"])
            a = info["author"]
            posts.append({"id": info["post_id"], "author": a["name"] if a else "?", "date": info["date"], "text": post_text(el)})
            n += 1
        return n

    r, soup = forum.soup(path)
    if r.status_code != 200:
        raise RuntimeError(f"http_{r.status_code}")
    take(soup)
    offs = sorted({o for o in offsets_seen(soup) if o > 0})
    if offs:
        step, last, offset, pages = offs[0], offs[-1], offs[0], 1
        while offset <= last and pages < MAX_PAGES:
            time.sleep(delay)
            r, soup = forum.soup(page_path(path, offset))
            if r.status_code != 200:
                raise RuntimeError(f"http_{r.status_code}")
            take(soup)
            last = max([last] + offsets_seen(soup))
            offset += step
            pages += 1
            if pages % 10 == 0:
                log(f"   ... {pages} pages lues")
    if not posts:
        raise RuntimeError("aucun_message_lisible")
    return posts


def make_chunks(posts, limit=CHUNK_CHARS):
    """Decoupe en blocs de texte « [Auteur] message » d'au plus `limit` caracteres (un message trop long est coupe)."""
    chunks, cur, size = [], [], 0
    for i, post in enumerate(posts, 1):
        line = f"[{post['author']}] {post['text']}"
        if len(line) > limit:
            line = line[:limit]
        if cur and size + len(line) > limit:
            chunks.append(cur)
            cur, size = [], 0
        cur.append((i, line))
        size += len(line)
    if cur:
        chunks.append(cur)
    return chunks


# --------------------------------------------------------------------------- #
# API Anthropic
# --------------------------------------------------------------------------- #
def call_claude(api_key, model, user, max_tokens):
    headers = {"x-api-key": api_key, "anthropic-version": API_VERSION, "content-type": "application/json"}
    body = {"model": model, "max_tokens": max_tokens, "system": SYSTEM, "messages": [{"role": "user", "content": user}]}
    for attempt in range(5):
        r = requests.post(API_URL, headers=headers, json=body, timeout=180)
        if r.status_code in (401, 403):
            raise ApiAuthError(f"cle_api_refusee_http_{r.status_code}")
        if r.status_code in (429, 500, 502, 503, 529):
            time.sleep(5 * 2 ** attempt)
            continue
        if r.status_code != 200:
            try:
                kind = r.json().get("error", {}).get("type", "")
            except ValueError:
                kind = ""
            raise RuntimeError(f"api_http_{r.status_code}_{kind}")
        data = r.json()
        return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()
    raise RuntimeError("api_indisponible")


def summarize(posts, names, api_key, model, chunk_chars, log, call=call_claude):
    """Recap d'ensemble d'un RP. `call` est injectable pour les tests."""
    who = " et ".join(n for n in names if n) or "les deux joueuses"
    chunks = make_chunks(posts, chunk_chars)
    if len(chunks) > MAX_CHUNKS:
        raise RuntimeError("rp_trop_long")
    if len(chunks) == 1:
        text = "\n\n".join(line for _, line in chunks[0])
        prompt = (f"Personnages : {who}.\n\nVoici l'integralite d'un RP ({len(posts)} messages).\n"
                  "Redige un recapitulatif rapide (150 a 250 mots), chronologique : ce qui s'est passe, les moments "
                  "marquants, l'evolution de la relation entre les personnages et la fin du RP.\n\n" + text)
        return call(api_key, model, prompt, 900), 1
    partial = []
    for k, chunk in enumerate(chunks, 1):
        log(f"   bloc {k}/{len(chunks)}")
        text = "\n\n".join(line for _, line in chunk)
        prompt = (f"Personnages : {who}.\n\nVoici les messages {chunk[0][0]} a {chunk[-1][0]} (sur {len(posts)}) d'un RP.\n"
                  "Resume en 120 a 200 mots ce qui s'y passe : evenements, lieux, decisions, evolution de la relation.\n\n" + text)
        partial.append(call(api_key, model, prompt, 600))
    joined = "\n\n".join(f"Partie {i}: {t}" for i, t in enumerate(partial, 1))
    prompt = (f"Personnages : {who}.\n\nVoici les resumes successifs des parties d'un meme RP ({len(posts)} messages).\n"
              "Redige un recapitulatif d'ensemble rapide (150 a 250 mots), chronologique, qui garde les moments "
              "marquants, l'evolution de la relation et la fin du RP.\n\n" + joined)
    return call(api_key, model, prompt, 900), len(chunks)


# --------------------------------------------------------------------------- #
# Programme principal
# --------------------------------------------------------------------------- #
def character_names(manual, entry):
    chars = manual.get("characters") or {}
    out = []
    for player in PLAYER_KEYS:
        cid = (entry.get("chars") or {}).get(player)
        out.append((chars.get(cid) or {}).get("name") if cid else None)
    return out


PLAYER_KEYS = list(p.PLAYERS.values())


def pending(manual, store, force=False, only=None):
    """RP archives a traiter : [(id, tid, chemin, entree)]."""
    out = []
    for rid, e in (manual.get("topics") or {}).items():
        tid = S.topic_id(e.get("url"))
        if not e.get("archived") or not tid or (only and tid not in only):
            continue
        path = S.clean_path(e["url"])
        rec = (store.get("recaps") or {}).get(tid)
        redo = parse_iso(e.get("recap_redo"))
        done = parse_iso(rec.get("generated")) if rec else None
        if force or not rec or rec.get("path") != path or (redo and (not done or redo > done)):
            out.append((rid, tid, path, e))
    return out


def prune(manual, store):
    """Efface les recaps des RP supprimes de la liste ou sortis des archives."""
    keep = {S.topic_id(e.get("url")) for e in (manual.get("topics") or {}).values() if e.get("archived")}
    for key in ("recaps", "failed"):
        store[key] = {t: v for t, v in (store.get(key) or {}).items() if t in keep}


def main():
    ap = argparse.ArgumentParser(description="Recap quotidien des RP archives")
    ap.add_argument("--base", default=os.environ.get("FORUM_BASE") or "https://sweeter-weather.forumactif.com")
    ap.add_argument("--only", action="append", default=[], help="ne traiter que ce numero de sujet (test), repetable")
    ap.add_argument("--max", type=int, default=5, help="nombre maximum de RP traites par passage")
    ap.add_argument("--force", action="store_true", help="refaire aussi les recaps deja faits")
    ap.add_argument("--delay", type=float, default=1.0, help="pause entre deux pages du forum (secondes)")
    ap.add_argument("--chunk-chars", type=int, default=CHUNK_CHARS)
    ap.add_argument("--dry-run", action="store_true", help="ne rien ecrire (la cle API et le forum sont tout de meme utilises)")
    args = ap.parse_args()
    p.DELAY = args.delay

    manual = S.load_json(S.DATA_DIR / "manual.json", {})
    store = S.load_json(S.DATA_DIR / "recaps.json", {"schema": 1, "recaps": {}, "failed": {}})
    store.setdefault("recaps", {}); store.setdefault("failed", {})
    store["schema"] = 1
    prune(manual, store)

    todo = pending(manual, store, args.force, set(args.only) or None)
    print(f"RP archives a traiter : {len(todo)}" + (f" (au plus {args.max} ce jour)" if len(todo) > args.max else ""))
    if not todo:
        if not args.dry_run:
            S.DATA_DIR.mkdir(exist_ok=True)
            S.write_json(S.DATA_DIR / "recaps.json", store)  # prune eventuel
        return 0

    user, pwd, key = os.environ.get("FORUM_USER"), os.environ.get("FORUM_PASSWORD"), os.environ.get("ANTHROPIC_API_KEY")
    if not (user and pwd):
        sys.exit("X Les secrets FORUM_USER et/ou FORUM_PASSWORD sont absents ou vides.")
    if not key:
        sys.exit("X Le secret ANTHROPIC_API_KEY est absent ou vide : impossible de rediger les recaps.")
    model = os.environ.get("RECAP_MODEL") or DEFAULT_MODEL

    forum = S.QuietForum(args.base)
    if not p.login(forum, user, pwd):
        sys.exit("X Connexion au forum impossible : rien n'a ete modifie.")

    done = failed = 0
    for rid, tid, path, entry in todo[: args.max]:
        print(f"\n=== Sujet t{tid} ===")
        try:
            posts = read_all(forum, tid, path, args.delay, print)
            print(f"   {len(posts)} messages lus")
            text, nchunks = summarize(posts, character_names(manual, entry), key, model, args.chunk_chars, print)
            dates = [x["date"] for x in posts if x["date"]]
            store["recaps"][tid] = {
                "text": text, "generated": S.now_utc(), "model": model, "path": path, "posts": len(posts), "blocs": nchunks,
                "created": dates[0] if dates else None, "last": dates[-1] if dates else None,
            }
            store["failed"].pop(tid, None)
            done += 1
        except ApiAuthError as e:
            print(f"X {e} : arret.")
            store["failed"][tid] = {"at": S.now_utc(), "what": str(e)}
            failed += 1
            if not args.dry_run:
                S.write_json(S.DATA_DIR / "recaps.json", store)
            break
        except Exception as e:  # un sujet en erreur n'arrete pas les autres
            print(f"  ! t{tid} : {type(e).__name__}: {e}")
            store["failed"][tid] = {"at": S.now_utc(), "what": f"{type(e).__name__}: {e}"}
            failed += 1
        if not args.dry_run:
            S.write_json(S.DATA_DIR / "recaps.json", store)  # on enregistre au fur et a mesure

    print(f"\n=== Bilan : {done} recap(s) fait(s), {failed} en erreur ===")
    return 0 if done or not failed else 1


if __name__ == "__main__":
    sys.exit(main())
