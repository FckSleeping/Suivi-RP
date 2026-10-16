#!/usr/bin/env python3
"""
Prototype - Suivi des RP de Sweeter Weather
===========================================
Objectif : verifier que le compte `lurker` peut
  1. se connecter depuis ta machine (puis depuis GitHub Actions),
  2. lire les sujets d'une categorie (y compris privee),
  3. recuperer les identifiants de messages, d'auteurs et les dates,
  4. (optionnel) lister les membres d'un groupe.

SECURITE : ce script est en LECTURE SEULE. Il n'envoie qu'une seule requete
POST : la connexion. Il ne publie, ne modifie et ne supprime rien.
Les identifiants ne sont jamais ecrits dans le code : variables d'environnement
FORUM_USER / FORUM_PASSWORD, sinon saisie au clavier.

Les pages recuperees sont sauvegardees dans ./debug/ pour pouvoir adapter
l'analyse au theme du forum. Ce dossier contient du contenu prive :
ne le publie jamais (il est exclu par .gitignore).
"""

import argparse
import getpass
import json
import os
import re
import sys
import time
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote_plus, urljoin

import requests
from bs4 import BeautifulSoup

DEBUG_DIR = Path("debug")
USER_AGENT = "Mozilla/5.0 (compatible; SweeterWeatherTracker-prototype/0.1; lecture seule)"
DELAY = 1.0  # secondes entre deux requetes, par politesse envers le forum

DATE_RE = re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b|\b\d{1,2}\s+[A-Za-zéèêûôîàç\.]+\s+\d{4}\b")
BLOCK_HINTS = ("captcha", "access denied", "just a moment", "checking your browser", "cf-chl", "attention required")


# --------------------------------------------------------------------------- #
# Session
# --------------------------------------------------------------------------- #
class Forum:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self.s = requests.Session()
        self.s.headers["User-Agent"] = USER_AGENT
        self.last = 0.0
        DEBUG_DIR.mkdir(exist_ok=True)

    def _wait(self):
        gap = time.time() - self.last
        if gap < DELAY:
            time.sleep(DELAY - gap)
        self.last = time.time()

    def _save(self, url, text):
        name = re.sub(r"[^A-Za-z0-9]+", "_", url.replace(self.base, ""))[:80] or "home"
        (DEBUG_DIR / f"{name}.html").write_text(text, encoding="utf-8")

    def get(self, path):
        self._wait()
        url = urljoin(self.base + "/", path)
        r = self.s.get(url, timeout=30)
        self._save(url, r.text)
        return r

    def post(self, path, data):
        self._wait()
        url = urljoin(self.base + "/", path)
        r = self.s.post(url, data=data, timeout=30)
        return r

    def soup(self, path):
        r = self.get(path)
        return r, BeautifulSoup(r.text, "html.parser")


def has_block_hint(text):
    low = text.lower()
    return [h for h in BLOCK_HINTS if h in low]


# --------------------------------------------------------------------------- #
# 1. Connexion
# --------------------------------------------------------------------------- #
def login(forum, username, password):
    print("\n=== 1. CONNEXION ===")
    r, soup = forum.soup("/login")
    print(f"Page de connexion : HTTP {r.status_code}")
    hints = has_block_hint(r.text)
    if hints:
        print(f"  ! Indices de blocage/captcha detectes : {hints}")

    form = None
    for f in soup.find_all("form"):
        if f.find("input", attrs={"name": "password"}):
            form = f
            break
    if not form:
        print("  X Formulaire de connexion introuvable (theme particulier, captcha ou blocage ?).")
        return False

    data = {}
    for inp in form.find_all("input"):
        if inp.get("name") and inp.get("type") in ("hidden", None, "submit"):
            data[inp["name"]] = inp.get("value", "")
    data["username"] = username
    data["password"] = password
    data.setdefault("login", "Connexion")
    action = form.get("action") or "/login"

    r = forum.post(action, data)
    print(f"Envoi du formulaire : HTTP {r.status_code}")

    r, soup = forum.soup("/")
    logged = bool(soup.select_one('a[href*="logout"]'))
    mentions_user = username.lower() in r.text.lower()
    if logged:
        print(f"  OK Connecte (lien de deconnexion present ; pseudo visible : {mentions_user}).")
    else:
        print("  X Connexion non confirmee (pas de lien de deconnexion).")
        print("    Verifie les identifiants, ou un captcha/blocage. Voir debug/ pour la page recue.")
    return logged


# --------------------------------------------------------------------------- #
# 2. Liste des sujets d'une categorie
# --------------------------------------------------------------------------- #
def user_links(node):
    """Liens de profil (/u123) dans un noeud : [(id, pseudo)]."""
    out = []
    for a in node.find_all("a", href=True):
        m = re.match(r"^(?:https?://[^/]+)?/u(\d+)(?:[^\d]|$)", a["href"])
        if m:
            out.append((m.group(1), a.get_text(strip=True)))
    return out


def list_topics(forum, forum_path):
    print(f"\n=== 2. CATEGORIE : {forum_path} ===")
    r, soup = forum.soup(forum_path)
    print(f"HTTP {r.status_code} - titre de page : {soup.title.get_text(strip=True) if soup.title else '?'}")

    topics = {}
    for a in soup.find_all("a", href=True):
        m = re.search(r"/t(\d+)-", a["href"])  # lien de titre (sans pagination : t123-, pas t123p15-)
        text = a.get_text(strip=True)
        if m and text and m.group(1) not in topics:
            row = a.find_parent("tr") or a.find_parent("li") or a.parent
            topics[m.group(1)] = {
                "title": text,
                "href": a["href"],
                "users": user_links(row) if row else [],
            }

    if not topics:
        print("  X Aucun sujet detecte. Categorie vide, privee non lisible, ou theme different.")
        return {}

    print(f"  OK {len(topics)} sujet(s) detecte(s) :")
    for tid, t in topics.items():
        users = ", ".join(f"{n}(#{i})" for i, n in t["users"]) or "aucun profil repere"
        print(f"   - t{tid} : {t['title']}")
        print(f"       profils dans la ligne (auteur / dernier message, ordre du theme) : {users}")
    return topics


# --------------------------------------------------------------------------- #
# 3. Lecture d'un sujet : messages, auteurs, dates
# --------------------------------------------------------------------------- #
MONTHS = {"jan": 1, "fev": 2, "mar": 3, "avr": 4, "mai": 5, "juin": 6, "juil": 7,
          "aou": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}


def forum_now():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Europe/Paris")).replace(tzinfo=None)
    except Exception:
        return datetime.now()


def parse_fr_date(text, now=None):
    """'Ven 20 Juin 2025 - 19:47', "Aujourd'hui à 23:18", 'Hier à 9:05' -> '2025-06-20T19:47' (heure du forum)."""
    if not text:
        return None
    now = now or forum_now()
    t = norm(text)
    m = re.search(r"(aujourd.?hui|hier)\s*a?\s*(\d{1,2}):(\d{2})", t)
    if m:
        day = now.date() - (timedelta(days=1) if m.group(1) == "hier" else timedelta(0))
        return f"{day.isoformat()}T{int(m.group(2)):02d}:{m.group(3)}"
    m = re.search(r"(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})\s*-?\s*(\d{1,2}):(\d{2})", t)
    if m:
        mon = next((v for k, v in MONTHS.items() if m.group(2).startswith(k)), None)
        if mon:
            return f"{int(m.group(3)):04d}-{mon:02d}-{int(m.group(1)):02d}T{int(m.group(4)):02d}:{m.group(5)}"
    return None


def topic_breadcrumb(soup):
    """Fil d'Ariane : [(type, id, nom)], ex. [('c','1','Anamorphose'), ('f','3','Zone Rp')]."""
    chain = soup.select_one(".navigation_chain") or soup
    out = []
    for a in chain.find_all("a", href=True):
        m = re.search(r"/([cf])(\d+)-", a["href"])
        item = (m.group(1), m.group(2), a.get_text(strip=True)) if m else None
        if item and item[2] and item not in out:
            out.append(item)
    return out


def parse_posts(soup):
    """Messages d'une page : id, auteur (compte + groupe), date brute et normalisee."""
    posts = {}
    for el in soup.find_all(id=re.compile(r"^p\d+$")):          # <div id="p123">
        posts.setdefault(el["id"][1:], el)
    for a in soup.find_all("a", attrs={"name": re.compile(r"^\d+$")}):  # theme phpBB2
        posts.setdefault(a["name"], a.find_parent("tr") or a.parent)

    result = []
    for pid, el in posts.items():
        author = None
        for a in el.find_all("a", href=True):
            m = re.match(r"^(?:https?://[^/]+)?/u(\d+)(?:[^\d]|$)", a["href"])
            if m and a.get_text(strip=True):
                author = {"uid": m.group(1), "name": a.get_text(strip=True), "group": link_group(a)}
                break
        t = el.find("time")
        raw = (t.get("datetime") or t.get_text(strip=True)) if t else None
        if not raw:
            m = DATE_RE.search(el.get_text(" ", strip=True))
            raw = m.group(0) if m else None
        iso = raw if raw and re.match(r"\d{4}-\d{2}-\d{2}T", raw) else parse_fr_date(raw)
        result.append({"post_id": pid, "author": author, "date_raw": raw, "date": iso})
    return result


def describe_post(p):
    a = p["author"]
    if a:
        player = PLAYERS.get(a["group"]) or "joueuse inconnue"
        who = f"{a['name']} (compte #{a['uid']}, groupe {a['group']} -> {player})"
    else:
        who = "AUTEUR NON TROUVE"
    return f"message #{p['post_id']} | {who} | {p['date'] or 'DATE NON LUE'} [{p['date_raw']}]"


def read_topic(forum, topic_path):
    print(f"\n=== 3. SUJET : {topic_path} ===")
    r, soup = forum.soup(topic_path)
    print(f"HTTP {r.status_code} - titre de page : {soup.title.get_text(strip=True) if soup.title else '?'}")

    crumb = topic_breadcrumb(soup)
    if crumb:
        cats = [n for k, _, n in crumb if k == "c"]
        fnames = [n for k, _, n in crumb if k == "f"]
        print("  Fil d'Ariane : " + " > ".join(n for _, _, n in crumb))
        rp, why = is_rp({"cat": cats[0] if cats else None, "names": fnames})
        print(f"  Classement : {'RP' if rp else 'hors RP'} ({why or 'aucune regle ne correspond'})")
    else:
        print("  ! Fil d'Ariane introuvable.")

    first_posts = parse_posts(soup)
    m = re.search(r"/t(\d+)", topic_path)
    tid = m.group(1) if m else None

    # Derniere page : plus grand offset de pagination (t123p30-...)
    last_offset = 0
    if tid:
        offsets = [int(x) for x in re.findall(rf"/t{tid}p(\d+)-", r.text)]
        if offsets:
            best = max(offsets)
            last_offset = best
            for a in soup.find_all("a", href=True):
                if re.search(rf"/t{tid}p{best}-", a["href"]):
                    print(f"  Derniere page de pagination detectee : offset {best}")
                    r, soup = forum.soup(a["href"])
                    break

    posts = parse_posts(soup)
    if not posts:
        print("  X Aucun message detecte.")
        low = r.text.lower()
        reason = []
        if "connect" in low and "mot de passe" in low:
            reason.append("la page demande de se connecter")
        if "autoris" in low or "permission" in low:
            reason.append("message d'autorisation/permission")
        print(f"    Indices : {reason or 'aucun - probablement un theme different, voir debug/'}")
        return

    print(f"  OK {len(posts)} message(s) sur la derniere page :")
    for p in posts:
        print("   - " + describe_post(p))
    bad = [p for p in posts if not p["author"] or not p["date"]]
    if bad:
        print(f"  ! {len(bad)} message(s) sans auteur ou sans date lisible : analyseur a adapter (voir debug/).")

    if first_posts:
        print("\n  Resume pour le suivi :")
        print("   Creation          : " + describe_post(first_posts[0]))
        print("   Derniere reponse  : " + describe_post(posts[-1]))
        print(f"   Nombre de messages: {last_offset + len(posts)}")


# --------------------------------------------------------------------------- #
# 4. Membres d'un groupe (optionnel)
# --------------------------------------------------------------------------- #
def read_group(forum, gid):
    print(f"\n=== 4. GROUPE {gid} ===")
    r, soup = forum.soup(f"/g{gid}-")
    print(f"HTTP {r.status_code} - titre de page : {soup.title.get_text(strip=True) if soup.title else '?'}")
    members = {}
    for uid, name in user_links(soup):
        if name:
            members[uid] = name
    if members:
        print(f"  OK {len(members)} profil(s) trouve(s) (peut inclure moderateurs/visiteurs) :")
        for uid, name in members.items():
            print(f"   - {name} (#{uid})")
    else:
        print("  X Aucun membre recupere : la gestion manuelle des groupes restera necessaire.")


# --------------------------------------------------------------------------- #
# --------------------------------------------------------------------------- #
# 5. Liste des membres + classement par couleur de pseudo
# --------------------------------------------------------------------------- #
COLOR_RE = re.compile(r"(?<![-\w])color\s*:\s*([^;\"']+)", re.I)


def norm_color(c):
    c = c.strip().lower()
    m = re.match(r"^#([0-9a-f]{3})$", c)
    if m:
        return "#" + "".join(ch * 2 for ch in m.group(1))
    m = re.match(r"^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$", c)
    if m:
        return "#%02x%02x%02x" % tuple(int(x) for x in m.groups())
    return c


def link_color(a):
    """Couleur du pseudo : style inline sur le lien ou un element a l'interieur."""
    for node in [a] + a.find_all(True):
        m = COLOR_RE.search(node.get("style") or "")
        if m:
            return norm_color(m.group(1))
        if node.name == "font" and node.get("color"):
            return norm_color(node["color"])
    return None


def link_group(a):
    """Numero de groupe lu dans une classe CSS 'group-N' (Forumactif la pose sur le pseudo)."""
    for node in [a] + a.find_all(True):
        for c in node.get("class") or []:
            m = re.match(r"^group-(\d+)$", c)
            if m:
                return m.group(1)
    return None


def read_memberlist(forum, refs):
    """refs : {numero_de_groupe_attendu: morceau de pseudo}, ex {"3": "Cody", "4": "Sadie"}

    Methode : on lit le numero de groupe dans la classe CSS 'group-N' du pseudo.
    Si le theme ne l'expose pas, on se rabat sur la couleur du pseudo.
    """
    print("\n=== 5. LISTE DES MEMBRES (/memberlist) ===")
    members = {}  # uid -> {"name", "color", "group"}
    start, step, pages = 0, None, 0

    while pages < 60:
        path = "/memberlist" if start == 0 else f"/memberlist?start={start}"
        r, soup = forum.soup(path)
        pages += 1
        if pages == 1:
            print(f"HTTP {r.status_code} - titre de page : {soup.title.get_text(strip=True) if soup.title else '?'}")
            offsets = [int(x) for x in re.findall(r"memberlist\?[^\"'>]*?start=(\d+)", r.text) if int(x) > 0]
            step = min(offsets) if offsets else None

        new = 0
        for a in soup.find_all("a", href=True):
            m = re.match(r"^(?:https?://[^/]+)?/u(\d+)(?:[^\d]|$)", a["href"])
            name = a.get_text(strip=True)
            if not m or not name:
                continue
            uid = m.group(1)
            color, group = link_color(a), link_group(a)
            if uid not in members:
                members[uid] = {"name": name, "color": color, "group": group}
                new += 1
            else:
                members[uid]["color"] = members[uid]["color"] or color
                members[uid]["group"] = members[uid]["group"] or group

        if new == 0 or not step:
            break
        start += step

    if not members:
        print("  X Aucun membre trouve : memberlist inaccessible ou theme different (voir debug/).")
        return {}
    print(f"  {len(members)} membre(s) lu(s) sur {pages} page(s).")

    key = "group" if any(m["group"] for m in members.values()) else "color"
    print(f"  Methode de classement : {'numero de groupe (classe CSS group-N)' if key == 'group' else 'couleur du pseudo'}")

    # Pseudos de reference (nom exact d'abord, puis nom contenant le morceau)
    ref_values = {}  # valeur (groupe ou couleur) -> numero de groupe attendu
    for group, ref in refs.items():
        found = [(u, m) for u, m in members.items() if m["name"].lower() == ref.lower()] or \
                [(u, m) for u, m in members.items() if ref.lower() in m["name"].lower()]
        if not found:
            print(f"  X Pseudo de reference '{ref}' (groupe {group}) introuvable.")
            continue
        if len(found) > 1:
            print(f"  ! '{ref}' correspond a plusieurs membres : {[m['name'] for _, m in found]} (le premier est retenu)")
        uid, m = found[0]
        val = m[key]
        print(f"  Reference groupe {group} : {m['name']} (#{uid}) -> {key} {val}")
        if not val:
            print(f"    ! Pas de {key} lisible pour ce membre.")
            continue
        if key == "group" and val != group:
            print(f"    ! Le forum classe ce membre dans le groupe {val}, pas {group} : verifie ton cahier des charges.")
        ref_values[val] = group

    groups = {}
    for uid, m in members.items():
        groups.setdefault(m[key], []).append(m["name"])

    for val, group in ref_values.items():
        names = groups.pop(val, [])
        print(f"\n  Groupe {group} ({key} {val}) : {len(names)} membre(s)")
        for n in names:
            print(f"   - {n}")
    for val, names in groups.items():
        label = val if val else "sans valeur lisible"
        print(f"\n  Autre ({key} {label}) : {len(names)} membre(s) -> {', '.join(names[:6])}{' ...' if len(names) > 6 else ''}")
    return members


# --------------------------------------------------------------------------- #
# 6. Decouverte des RP : recherche des sujets ou les personnages ont poste
# --------------------------------------------------------------------------- #
PLAYERS = {"3": "chatondelalune", "4": "fcksleeping"}  # groupe -> compte joueuse

# Regle "ce sujet est un RP" (a terme : configurable depuis l'interface)
RP_CATEGORY_TITLES = ["zone rp"]
RP_FORUM_NAMES = ["Moyen Âge", "Witchcraft", "Pirates", "Space Opera", "Slice of life",
                  "Academy", "Regency", "Wild West", "Pénitencier"]  # dans cate-c3, sans "Zone RP"


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip()


def build_forum_registry(forum):
    """Lit l'index : forum -> categorie parente (heading /cN- precedant les liens /fN-)."""
    r, soup = forum.soup("/")
    reg, cat = {}, None
    for a in soup.find_all("a", href=True):
        text = a.get_text(strip=True)
        if not text:
            continue
        mc = re.search(r"/c(\d+)-", a["href"])
        mf = re.search(r"/f(\d+)-", a["href"])
        if mc:
            cat = text
        elif mf and mf.group(1) not in reg:
            reg[mf.group(1)] = {"name": text, "cat": cat}
    return reg


def is_rp(info):
    cat = norm(info.get("cat"))
    names = [norm(n) for n in (info.get("names") or [info.get("name")]) if n]
    if any(t in cat for t in RP_CATEGORY_TITLES):
        return True, "categorie 'Zone RP'"
    if any(t in n for n in names for t in RP_CATEGORY_TITLES):
        return True, "forum 'Zone RP'"
    manual = {norm(n) for n in RP_FORUM_NAMES}
    if any(n in manual for n in names):
        return True, "liste manuelle (forums hors Zone RP)"
    return False, ""


def search_author(forum, name):
    """Sujets ou le compte `name` a poste : {tid: {title, forum_id, forum_name}}."""
    path = "/search?search_author=" + quote_plus(name) + "&show_results=topics"
    found, pages, cur, step = {}, 0, 0, None
    while path and pages < 40:
        for _ in range(3):
            r, soup = forum.soup(path)
            has_topics = bool(soup.find("a", href=re.compile(r"/t\d+-")))
            flood = None if has_topics else re.search(r"(\d+)\s*secondes?", r.text)
            if flood:  # limite de frequence des recherches du forum
                wait = int(flood.group(1)) + 2
                print(f"      limite de recherche du forum : attente {wait}s...")
                time.sleep(wait)
                continue
            break
        pages += 1

        for a in soup.find_all("a", href=True):
            m = re.search(r"/t(\d+)-", a["href"])
            text = a.get_text(strip=True)
            if not m or not text or m.group(1) in found:
                continue
            fid = fname = None
            node = a
            for _ in range(5):  # plus proche ancetre contenant un lien de forum /fN-
                node = node.parent
                if node is None:
                    break
                fa = node.find("a", href=re.compile(r"/f\d+-"))
                if fa:
                    fid = re.search(r"/f(\d+)-", fa["href"]).group(1)
                    fname = fa.get_text(strip=True)
                    break
            found[m.group(1)] = {"title": text, "href": a["href"], "forum_id": fid, "forum_name": fname}

        offs = {}
        for a in soup.find_all("a", href=True):
            mm = re.search(r"[?&]start=(\d+)", a["href"])
            if mm and "search" in a["href"]:
                offs[int(mm.group(1))] = a["href"]
        if pages == 1:
            step = min((o for o in offs if o > 0), default=None)
        if not step:
            break
        cur += step
        path = offs.get(cur)
    return found


def discover(forum, members, only, delay):
    print("\n=== 6. DECOUVERTE DES RP (recherche par personnage) ===")
    chars = [(u, m) for u, m in members.items() if m.get("group") in PLAYERS]
    if not chars:
        print("  X Aucun personnage de groupe 3/4 identifie (classement par groupe indisponible).")
        return
    if only:
        chars = [(u, m) for u, m in chars if any(o.lower() in m["name"].lower() for o in only)]
    print(f"  {len(chars)} personnage(s) a rechercher.")

    registry = build_forum_registry(forum)
    cats = {}
    for info in registry.values():
        cats.setdefault(info["cat"] or "(sans categorie)", []).append(info["name"])
    print(f"  Index : {len(registry)} forum(s) repere(s) dans {len(cats)} categorie(s) :")
    for c, names in cats.items():
        print(f"   - {c} : {', '.join(names[:8])}{' ...' if len(names) > 8 else ''}")

    topics = {}
    for i, (uid, m) in enumerate(chars, 1):
        print(f"  [{i}/{len(chars)}] {m['name']} ({PLAYERS[m['group']]})")
        res = search_author(forum, m["name"])
        print(f"      {len(res)} sujet(s) trouve(s)")
        for tid, t in res.items():
            e = topics.setdefault(tid, {**t, "characters": {}})
            e["characters"][m["name"]] = PLAYERS[m["group"]]
        if i < len(chars):
            time.sleep(delay)

    # Categorie de chaque forum : lue dans le fil d'Ariane d'un de ses sujets
    sample = {}
    for t in topics.values():
        if t["forum_id"]:
            sample.setdefault(t["forum_id"], t)
    print(f"\n  Lecture du fil d'Ariane pour {len(sample)} forum(s) (1 sujet par forum)...")
    for fid, t in sample.items():
        _, s = forum.soup(t["href"])
        crumb = topic_breadcrumb(s)
        cats = [n for k, _, n in crumb if k == "c"]
        fnames = [n for k, _, n in crumb if k == "f"]
        registry[fid] = {"name": t["forum_name"], "names": fnames or [t["forum_name"]],
                         "cat": cats[0] if cats else None}

    # Classement RP / hors RP
    per_forum = {}
    for tid, t in topics.items():
        info = dict(registry.get(t["forum_id"]) or {"name": t["forum_name"], "cat": None})
        t["is_rp"], t["why"] = is_rp(info)
        t["forum"], t["category"] = info.get("name"), info.get("cat")
        pf = per_forum.setdefault((t["forum"], t["category"]), [0, t["is_rp"]])
        pf[0] += 1

    no_forum = [t for t in topics.values() if not t["forum_id"]]
    print(f"\n  {len(topics)} sujet(s) distinct(s) au total.")
    if no_forum:
        print(f"  ! {len(no_forum)} sujet(s) dont le forum n'a pas pu etre determine (analyse a adapter, voir debug/).")
    print("\n  Par forum :")
    for (fname, cat), (n, rp) in sorted(per_forum.items(), key=lambda x: str(x[0])):
        print(f"   [{'RP ' if rp else '---'}] {fname} ({cat or 'categorie inconnue'}) : {n} sujet(s)")

    rp_topics = {tid: t for tid, t in topics.items() if t["is_rp"]}
    print(f"\n  => {len(rp_topics)} RP retenu(s) :")
    for tid, t in rp_topics.items():
        who = ", ".join(f"{c} [{p}]" for c, p in t["characters"].items())
        print(f"   - t{tid} : {t['title']} | {t['forum']} | {who}")

    DEBUG_DIR.mkdir(exist_ok=True)
    (DEBUG_DIR / "discovery.json").write_text(json.dumps(topics, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n  Resultat complet sauvegarde dans debug/discovery.json (prive, ne pas publier).")


def main():
    ap = argparse.ArgumentParser(description="Prototype lecture seule du forum Sweeter Weather")
    ap.add_argument("--base", default="https://sweeter-weather.forumactif.com")
    ap.add_argument("--forum", action="append", default=[],
                    help="chemin d'une categorie, ex: /f12-nom-de-la-categorie (repetable)")
    ap.add_argument("--topic", action="append", default=[],
                    help="chemin d'un sujet, ex: /t345-titre (repetable) - mets-en un PRIVE")
    ap.add_argument("--group", action="append", default=[],
                    help="numero d'un groupe, ex: 3 (repetable)")
    ap.add_argument("--memberlist", action="store_true",
                    help="lire /memberlist et classer les membres par couleur de pseudo")
    ap.add_argument("--ref", action="append", default=[],
                    help="pseudo de reference d'un groupe, ex: 3=Cody (defaut : 3=Cody et 4=Sadie)")
    ap.add_argument("--discover", action="store_true",
                    help="chercher tous les sujets ou les personnages des groupes 3 et 4 ont poste")
    ap.add_argument("--only", action="append", default=[],
                    help="avec --discover : ne chercher que ce(s) personnage(s) (morceau de pseudo), pour tester")
    ap.add_argument("--search-delay", type=float, default=6.0,
                    help="pause en secondes entre deux recherches (defaut 6)")
    ap.add_argument("--no-login", action="store_true",
                    help="ne pas se connecter (pour comparer avec la vue visiteur)")
    args = ap.parse_args()

    forum = Forum(args.base)

    if not args.no_login:
        user = os.environ.get("FORUM_USER") or input("Pseudo du compte de lecture : ")
        pwd = os.environ.get("FORUM_PASSWORD") or getpass.getpass("Mot de passe (rien ne s'affiche quand tu tapes, c'est normal) : ")
        if not login(forum, user, pwd):
            print("\nArret : connexion impossible.")
            sys.exit(1)

    for f in args.forum:
        list_topics(forum, f)
    for t in args.topic:
        read_topic(forum, t)
    for g in args.group:
        read_group(forum, g)
    if args.memberlist or args.discover:
        refs = dict(x.split("=", 1) for x in args.ref) if args.ref else {"3": "Cody", "4": "Sadie"}
        members = read_memberlist(forum, refs)
        if args.discover and members:
            discover(forum, members, args.only, args.search_delay)

    print("\nTermine. Pages sauvegardees dans ./debug/ (ne pas publier).")


if __name__ == "__main__":
    main()
