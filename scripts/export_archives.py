#!/usr/bin/env python3
"""
Export des RP archives en fichiers texte (LECTURE SEULE sur le forum), pour les confier a une IA qui en fera le recap.

Pour chaque RP archive de votre liste (data/manual.json, champ « topics »), le script relit le sujet depuis la
premiere page jusqu'a la derniere et ecrit un fichier data/textes_archives/t<numero>-<titre>.txt qui contient,
dans l'ordre, pour chaque message : le pseudo du compte qui l'a poste, puis son texte (rien d'autre : ni date,
ni signature, ni citation d'un message precedent, ni image).

  [Pseudo]
  Texte du message...

  [AutrePseudo]
  Texte du message...

Un RP deja exporte n'est pas relu (un RP archive est termine) : relancez avec --force pour le refaire.
Un RP tres long est coupe en plusieurs fichiers (-partie1, -partie2...), toujours entre deux messages.

Garanties
  - Le forum n'est jamais modifie (seule requete POST : la connexion).
  - data/manual.json et data/forum.json ne sont pas modifies ; seul le dossier data/textes_archives/ est ecrit.
  - Le journal n'affiche aucun titre, pseudo ou texte : uniquement des numeros et des comptes.
  - Le depot doit rester PRIVE : ces fichiers contiennent le texte de sujets prives.
"""
import argparse
import copy
import os
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlparse

from bs4 import Comment, NavigableString, Tag

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sync as s  # noqa: E402  (reutilise connexion, pagination et lecture des messages)

p = s.p
OUT_DIR = s.DATA_DIR / "textes_archives"
MAX_CHARS = 300_000   # au-dela, le RP est coupe en plusieurs fichiers (0 = jamais)
MAX_PAGES = 400       # garde-fou : un sujet de plus de 400 pages n'est pas lu en entier

# Ou se trouve le TEXTE d'un message : on essaie ces selecteurs dans l'ordre, dans chaque message.
# Si le texte n'est pas reconnu (autre theme du forum), le journal l'indique et decrit la structure du message
# (balises et classes, jamais de texte) : ajoutez alors ici le bon selecteur.
BODY_SELECTORS = [".post-content", ".postbody .content", ".post-entry", ".post_content", ".message-content",
                  ".post-message", ".content", ".postbody"]
# Retire du texte retenu : citations d'autres messages (blockquote), signature, scripts...
# (ne pas y mettre « quote » : sur ce forum, ce sont les dialogues colores)
STRIP_SELECTORS = ["blockquote", ".signature", ".sig", ".edit", ".edited", "script", "style", "noscript"]
# Utilise seulement si aucun selecteur ci-dessus ne convient : on prend tout le message moins ces zones
FALLBACK_STRIP = [".postprofile", ".post-profile", ".profile", ".author", ".post-author", ".post-header", ".post-footer",
                  ".post-buttons", ".post-actions", ".post-options", "time", "h3"]

BLOCKS = {"p", "div", "li", "ul", "ol", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "section", "article",
          "center", "dl", "dt", "dd", "pre", "fieldset", "details", "summary"}
SKIP = {"script", "style", "noscript", "img", "svg", "iframe", "video", "audio", "object", "embed", "input", "button",
        "select", "textarea"}
EDIT_NOTE_RE = re.compile(r"(?im)^\s*(?:derni[eè]re\s+(?:[ée]dition|modification)|last\s+edited)\b.*$")


# --------------------------------------------------------------------------- #
# HTML -> texte
# --------------------------------------------------------------------------- #
def _drop(tag, selectors):
    for sel in selectors:
        for n in tag.select(sel):
            try:
                n.decompose()
            except Exception:  # deja supprime avec son parent
                pass


def _walk(node, out):
    def newline():
        if out and not out[-1].endswith("\n"):
            out.append("\n")

    for ch in node.children:
        if isinstance(ch, Comment):
            continue
        if isinstance(ch, NavigableString):
            txt = re.sub(r"[ \t\r\n\f]+", " ", str(ch))
            if txt == " " and (not out or out[-1].endswith("\n")):
                continue
            out.append(txt)
        elif isinstance(ch, Tag):
            if ch.name in SKIP:
                continue
            if ch.name == "br":
                out.append("\n")
            elif ch.name in BLOCKS:
                newline()
                _walk(ch, out)
                newline()
            else:
                _walk(ch, out)


def clean_text(tag, strip):
    """Texte lisible d'un element : retours a la ligne conserves, espaces nettoyes, sans les zones `strip`."""
    tag = copy.copy(tag)
    _drop(tag, strip)
    out = []
    _walk(tag, out)
    text = "".join(out).replace("\xa0", " ").replace("\u200b", "")
    text = EDIT_NOTE_RE.sub("", text)
    lines = [re.sub(r" {2,}", " ", ln).strip() for ln in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def extract_body(el):
    """Renvoie (texte, methode). methode = le selecteur utilise, ou « repli » si aucun ne convenait."""
    for sel in BODY_SELECTORS:
        cands = [m for m in el.select(sel) if not m.find_parent("blockquote")]
        if not cands:
            continue
        # Zone de texte reconnue : on s'y arrete, meme vide (message d'image seule). Passer a un selecteur plus large
        # recopierait l'en-tete du message (titre, date, profil).
        best = max(cands, key=lambda m: len(m.get_text()))
        return clean_text(best, STRIP_SELECTORS), sel
    return clean_text(el, STRIP_SELECTORS + FALLBACK_STRIP), "repli"


def structure(el, limit=40):
    """Plan d'un message pour le depannage : balises, classes et LONGUEUR du texte (jamais le texte lui-meme)."""
    lines = []

    def rec(node, depth):
        for ch in node.children:
            if not isinstance(ch, Tag) or len(lines) >= limit or depth > 5:
                continue
            n = len(ch.get_text(strip=True))
            if n and (ch.get("class") or ch.get("id")):
                lines.append("    " + "  " * depth + ch.name + "".join("." + c for c in (ch.get("class") or [])) + f" ({n} car.)")
            rec(ch, depth + 1)

    rec(el, 0)
    return lines


def author_name(el, info):
    """Pseudo du compte : premier lien de profil du message hors citations."""
    for a in el.find_all("a", href=True):
        if a.find_parent("blockquote"):
            continue
        if re.match(r"^(?:https?://[^/]+)?/u\d+(?:[^\d]|$)", a["href"]) and a.get_text(strip=True):
            return a.get_text(strip=True)
    return (info.get("author") or {}).get("name") or "Inconnu"


# --------------------------------------------------------------------------- #
# Lecture d'un sujet, de la premiere a la derniere page
# --------------------------------------------------------------------------- #
def read_all(forum, tid, path, log):
    """Renvoie [(pseudo, texte)] dans l'ordre du sujet, et le compte des methodes de lecture du texte."""
    posts, seen, methods, warned = [], set(), Counter(), False
    for _ in range(MAX_PAGES):
        r, soup = forum.soup(path)
        if r.status_code != 200:
            raise RuntimeError(f"http_{r.status_code}")
        pairs, _ = s.clean_post_pairs(soup)
        for el, info in pairs:
            if el is None:
                raise RuntimeError("messages_illisibles")
            if info["post_id"] in seen:
                continue
            seen.add(info["post_id"])
            name = author_name(el, info)   # avant tout nettoyage
            text, how = extract_body(el)
            methods[how] += 1
            if how == "repli" and not warned:
                warned = True
                log(f"   t{tid} : texte du message non reconnu, lecture de repli. Structure du premier message concerne :")
                for ln in structure(el):
                    log(ln)
            if text:
                posts.append((name, text))
        m = re.search(rf"/t{tid}p(\d+)-", path)
        cur = int(m.group(1)) if m else 0
        offs = {}
        for a in soup.find_all("a", href=True):
            mm = re.search(rf"/t{tid}p(\d+)-", a["href"])
            if mm:
                offs[int(mm.group(1))] = urlparse(a["href"]).path
        later = [o for o in offs if o > cur]
        if not later:
            return posts, methods
        path = offs[min(later)]
    raise RuntimeError("pagination_trop_longue")


# --------------------------------------------------------------------------- #
# Fichiers
# --------------------------------------------------------------------------- #
def slugify(text, n=50):
    t = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")[:n].strip("-") or "rp"


def title_of(entry):
    if (entry.get("title") or "").strip():
        return entry["title"].strip()
    m = re.search(r"/t\d+(?:p\d+)?-([^/?#]+)", entry.get("url") or "")
    return unquote(m.group(1)).replace("-", " ") if m else "(sans titre)"


def existing_files(tid):
    return sorted(OUT_DIR.glob(f"t{tid}-*.txt")) if OUT_DIR.exists() else []


def split_parts(blocks, max_chars):
    if not max_chars or sum(len(b) for b in blocks) <= max_chars:
        return [blocks]
    parts, cur, size = [], [], 0
    for b in blocks:
        if cur and size + len(b) > max_chars:
            parts.append(cur)
            cur, size = [], 0
        cur.append(b)
        size += len(b)
    return parts + [cur] if cur else parts


def write_files(tid, entry, characters, posts, max_chars):
    names = [characters[c]["name"] for c in (entry.get("chars") or {}).values() if c in characters and characters[c].get("name")]
    blocks = [f"[{name}]\n{text}\n" for name, text in posts]
    parts = split_parts(blocks, max_chars)
    base = f"t{tid}-{slugify(title_of(entry))}"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in existing_files(tid):
        old.unlink()
    written = []
    for i, part in enumerate(parts, 1):
        head = [f"RP : {title_of(entry)}" + (f" (partie {i}/{len(parts)})" if len(parts) > 1 else "")]
        if names:
            head.append("Personnages : " + ", ".join(names))
        head.append(f"Messages : {len(part)}" + (f" (sur {len(posts)} au total)" if len(parts) > 1 else ""))
        name = f"{base}-partie{i}.txt" if len(parts) > 1 else f"{base}.txt"
        (OUT_DIR / name).write_text("\n".join(head) + "\n\n" + "\n".join(part), encoding="utf-8")
        written.append(name)
    return written


# --------------------------------------------------------------------------- #
# Programme
# --------------------------------------------------------------------------- #
def candidates(manual, only):
    seen, out = set(), []
    entries = sorted((manual.get("topics") or {}).values(), key=lambda e: e.get("order") or 0)
    for e in entries:
        tid = s.topic_id(e.get("url"))
        if not tid or tid in seen:
            continue
        if (only and tid in only) or (not only and e.get("archived")):
            seen.add(tid)
            out.append((tid, e))
    return out


def run(args, forum, log=print):
    manual = s.load_json(s.DATA_DIR / "manual.json", {})
    characters = manual.get("characters") or {}
    todo = [(t, e) for t, e in candidates(manual, set(args.only)) if args.force or not existing_files(t)]
    allc = candidates(manual, set(args.only))
    log(f"\n=== Export de {len(todo)} RP ({len(allc) - len(todo)} deja exporte(s), ignore(s)) ===")
    done, errors = 0, 0
    for i, (tid, entry) in enumerate(todo, 1):
        try:
            posts, methods = read_all(forum, tid, s.clean_path(entry["url"]), log)
            if not posts:
                raise RuntimeError("aucun_texte_lu")
            files = write_files(tid, entry, characters, posts, args.max_chars)
            done += 1
            chars = sum(len(t) for _, t in posts)
            log(f"   t{tid} : {len(posts)} messages, {chars} caracteres, {len(files)} fichier(s) "
                f"[lecture : {', '.join(f'{k} x{v}' for k, v in methods.most_common())}]")
        except Exception as e:  # noqa: BLE001
            errors += 1
            log(f"  ! t{tid} : {type(e).__name__}: {e}")
        if i % 5 == 0:
            log(f"   ... {i}/{len(todo)}")
    log(f"\n=== Bilan : {done} exporte(s), {errors} erreur(s) ===")
    return done, errors


def main():
    ap = argparse.ArgumentParser(description="Export des RP archives en fichiers texte (lecture seule)")
    ap.add_argument("--base", default=os.environ.get("FORUM_BASE") or "https://sweeter-weather.forumactif.com")
    ap.add_argument("--only", action="append", default=[], help="n'exporter que ce numero de sujet (meme non archive), repetable")
    ap.add_argument("--force", action="store_true", help="refaire aussi les RP deja exportes")
    ap.add_argument("--max-chars", type=int, default=MAX_CHARS, help="taille maximale d'un fichier avant decoupage (0 = pas de decoupage)")
    ap.add_argument("--delay", type=float, default=1.0, help="pause entre deux pages (secondes)")
    ap.add_argument("--dry-run", action="store_true", help="seulement lister les RP concernes, sans rien lire ni ecrire")
    args = ap.parse_args()
    p.DELAY = args.delay

    if args.dry_run:
        manual = s.load_json(s.DATA_DIR / "manual.json", {})
        for tid, _ in candidates(manual, set(args.only)):
            print(f"t{tid} : {'deja exporte' if existing_files(tid) and not args.force else 'a exporter'}")
        print("\n(dry-run : rien n'a ete lu ni ecrit)")
        return

    user, pwd = os.environ.get("FORUM_USER"), os.environ.get("FORUM_PASSWORD")
    if not user or not pwd:
        sys.exit("X Les secrets FORUM_USER et/ou FORUM_PASSWORD sont absents ou vides.")
    forum = s.QuietForum(args.base)
    if not p.login(forum, user, pwd):
        sys.exit("X Connexion impossible : rien n'a ete exporte.")
    done, errors = run(args, forum)
    sys.exit(1 if errors and not done else 0)


if __name__ == "__main__":
    main()
