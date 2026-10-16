#!/usr/bin/env python3
"""
Test de connexion au forum depuis GitHub Actions.

Ce script n'affiche AUCUN contenu prive (ni titre, ni pseudo, ni texte) :
uniquement des comptes et des verdicts, car le journal d'execution
peut etre lisible par d'autres si le depot devient public.

Variables d'environnement (fournies par les Secrets GitHub) :
  FORUM_USER, FORUM_PASSWORD   identifiants du compte de lecture
  TEST_TOPIC (facultatif)      chemin d'un sujet a lire, ex : /t176-mon-sujet
  FORUM_BASE (facultatif)      adresse du forum
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import proto_forum as p  # noqa: E402


def main():
    user = os.environ.get("FORUM_USER")
    pwd = os.environ.get("FORUM_PASSWORD")
    base = os.environ.get("FORUM_BASE") or "https://sweeter-weather.forumactif.com"
    topic = (os.environ.get("TEST_TOPIC") or "").strip()

    if not user or not pwd:
        print("X Les secrets FORUM_USER et/ou FORUM_PASSWORD sont absents ou vides.")
        sys.exit(1)

    forum = p.Forum(base)

    # 1. Connexion
    if not p.login(forum, user, pwd):
        print("\nVERDICT : connexion refusee ou bloquee depuis les serveurs de GitHub.")
        sys.exit(1)

    # 2. Liste des membres (compte uniquement)
    print("\n--- Liste des membres ---")
    r, soup = forum.soup("/memberlist")
    groups = {}
    for a in soup.find_all("a", href=True):
        m = re.match(r"^(?:https?://[^/]+)?/u(\d+)(?:[^\d]|$)", a["href"])
        if m and a.get_text(strip=True):
            groups.setdefault(m.group(1), p.link_group(a))
    n3 = sum(1 for g in groups.values() if g == "3")
    n4 = sum(1 for g in groups.values() if g == "4")
    print(f"HTTP {r.status_code} ; profils sur la 1re page : {len(groups)} (groupe 3 : {n3}, groupe 4 : {n4})")
    hints = p.has_block_hint(r.text)
    if hints:
        print(f"! Indices de blocage detectes : {hints}")

    # 3. Sujet de test (facultatif)
    if topic:
        print("\n--- Lecture d'un sujet ---")
        r, soup = forum.soup(topic)
        posts = p.parse_posts(soup)
        with_author = sum(1 for x in posts if x["author"])
        with_date = sum(1 for x in posts if x["date"])
        print(f"HTTP {r.status_code} ; messages lus : {len(posts)} ; avec auteur : {with_author} ; avec date : {with_date}")
        crumb = p.topic_breadcrumb(soup)
        if crumb:
            cats = [n for k, _, n in crumb if k == "c"]
            fnames = [n for k, _, n in crumb if k == "f"]
            rp, _ = p.is_rp({"cat": cats[0] if cats else None, "names": fnames})
            print(f"Sujet classe comme RP : {'oui' if rp else 'non'}")
        hints = p.has_block_hint(r.text)
        if hints:
            print(f"! Indices de blocage detectes : {hints}")
        if not posts:
            print("\nVERDICT : connexion OK, mais le sujet n'est pas lisible (permissions ou chemin incorrect).")
            sys.exit(1)

    print("\nVERDICT : OK - le forum est lisible depuis GitHub Actions.")


if __name__ == "__main__":
    main()
