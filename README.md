# Suivi des RP - Sweeter Weather

Outil prive de suivi des RP du forum Sweeter Weather.

> **Le depot doit rester PRIVE** : `data/forum.json` contient les titres des
> sujets et les pseudos, y compris ceux de sujets prives.

## Contenu actuel
- `scripts/proto_forum.py` : prototype de lecture du forum (lecture seule), reutilise par la synchro.
- `scripts/check_connexion.py` : test de connexion depuis GitHub Actions.
- `scripts/sync.py` : synchronisation (etape 1).
- `data/forum.json` : donnees lues sur le forum (ecrit par la synchro uniquement).
- `data/manual.json` : VOS corrections (jamais ecrit par la synchro).
- `data/status.json` : etat de la derniere synchro et erreurs.
- `.github/workflows/test-connexion.yml` : lance le test de connexion a la demande.
- `.github/workflows/synchro.yml` : lance la synchro a la demande et enregistre les donnees.

## Identifiants
Les identifiants du compte de lecture ne sont JAMAIS dans le code. Ils sont
stockes dans les Secrets du depot (Settings > Secrets and variables > Actions) :
`FORUM_USER` et `FORUM_PASSWORD`.

## Lancer la synchro
Onglet Actions > « Synchronisation du forum » > Run workflow.
En local : `python scripts/sync.py` (avec `FORUM_USER` / `FORUM_PASSWORD` dans l'environnement).
Options utiles : `--discover oui|non|auto`, `--only 176` (un seul sujet), `--dry-run`.

## Format des donnees
**forum.json** : `members` (comptes des groupes 3 et 4), `forums` (forum -> categorie),
`topics` (par numero de sujet : titre, chemin, forum, `auto_rp`, `characters` = comptes,
`created`, `last_post`, `post_count`, `last_changed`, `flags`), `suggestions` (remplacements proposes).
Dates du forum : heure de Paris ; dates de synchro (suffixe Z) : UTC.

**manual.json** (rempli plus tard depuis la page, modifiable a la main) :
- `characters` : `{compte: {name, player, aliases[], active}}`
- `topics` : `{numero: {include, status (en_cours|termine|archive), characters[], title, path, note}}`
  — `path` + `title` permettent d'ajouter un sujet a la main.
- `forum_rules` : `{numero_de_forum: true|false}` — par exemple `false` pour exclure le forum SMS.
- `replacements` : `{"nouveau>ancien": {decision: accepted|refused}}`

Priorite pour savoir si un sujet est un RP : choix manuel du sujet > regle manuelle du forum > regle automatique.

## Alertes (`flags`)
`auteur_inconnu`, `date_illisible`, `creation_inconnue`, `un_seul_camp` (les personnages ne couvrent
pas les deux joueuses), `erreur_lecture`, `jamais_lu`.
