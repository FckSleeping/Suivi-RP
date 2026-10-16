# Suivi des RP - Sweeter Weather

Outil prive de suivi des RP du forum Sweeter Weather.

## Contenu actuel
- `scripts/proto_forum.py` : prototype de lecture du forum (lecture seule).
- `scripts/check_connexion.py` : test de connexion depuis GitHub Actions.
- `.github/workflows/test-connexion.yml` : lance ce test a la demande.

## Identifiants
Les identifiants du compte de lecture ne sont JAMAIS dans le code. Ils sont
stockes dans les Secrets du depot (Settings > Secrets and variables > Actions) :
`FORUM_USER` et `FORUM_PASSWORD`.
