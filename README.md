# Suivi des RP - Sweeter Weather

Outil prive de suivi des RP du forum Sweeter Weather.

> **Le depot doit rester PRIVE** : `data/forum.json` contient des pseudos et des informations
> issues de sujets prives.

## Principe
Vous ajoutez vous-meme vos personnages et vos RP depuis la page. La synchronisation (lecture seule)
relit ensuite uniquement les RP de votre liste pour savoir qui a ecrit en dernier, et donc a qui
est le tour.

## Contenu
- `docs/` : la page web. `index.html`, `js/` (logique), `css/structure.css` (mise en page) et
  `css/theme.css` (VOTRE fichier d'apparence).
- `scripts/sync.py` : la synchronisation. `scripts/proto_forum.py` : briques de lecture du forum
  (et son mode `--discover`, qui sert a explorer le forum a la main).
- `scripts/check_connexion.py` : test de connexion depuis GitHub Actions.
- `data/manual.json` : VOTRE liste (personnages, RP, notes). Jamais ecrit par la synchro.
- `data/forum.json`, `data/status.json` : ecrits par la synchro uniquement.
- `.github/workflows/` : `test-connexion.yml` et `synchro.yml` (lancement a la demande).

## Identifiants
Les identifiants du compte de lecture ne sont JAMAIS dans le code. Ils sont dans les Secrets du depot
(Settings > Secrets and variables > Actions) : `FORUM_USER` et `FORUM_PASSWORD`.

## Utiliser la page
- **Personnages** : ajoutez des noms (plusieurs d'un coup possible), choisissez la joueuse ; chacun
  recoit une couleur modifiable.
- **RP** : « Ajouter un RP » = coller le lien du sujet, choisir le personnage de chacune, cocher NSFW
  si besoin. Le titre est repris du lien (modifiable). Un RP sans lien (pas encore commence) est possible.
  Colonne « Etat » = a qui le tour, deduit de l'auteur du dernier message (modifiable a la main).
  « Supprimer » retire le RP de la liste (rien n'est touche sur le forum). « Termine » le masque par defaut.
- Si le personnage n'est pas choisi, la page le reconnait d'apres les comptes qui ont ecrit dans le sujet
  (affiche en italique), a condition que le nom du personnage soit celui du compte.

## Couleurs des personnages
La synchro releve la couleur des dialogues dans les messages (elements `quote`, `.vrmtart > span`, `.kitto > span`,
hors citations `blockquote`) et la rattache au compte qui a ecrit. Une couleur est donc proposee pour tout
personnage dont le nom est celui de son compte. Choisir une couleur a la main (pastille sur la page Personnages)
l'emporte toujours ; le bouton « Couleur du forum » revient a la couleur relevee. Pour ajouter un autre
repere de couleur, modifier `COLOR_SELECTORS` dans `scripts/sync.py`.

## Couleur du texte des pastilles de personnages
Dans `data/manual.json`, chaque personnage peut avoir un champ `text_color` : la couleur du texte de sa pastille
(les pastilles d'etat « Fanny » / « Ambre » ne sont pas concernees). Exemple :

    "c1": { "name": "Felicy", "player": "chatondelalune", "color": "#f4a1c4", "text_color": "#7a1244" }

Formats acceptes : `#rrggbb` ou `#rgb`. Sans `text_color` (ou si la valeur est invalide), le texte est calcule
automatiquement : meme teinte que le fond, en plus clair ou plus fonce (reglage `pillText` dans `docs/js/config.js` :
`"tone"` ou `"contrast"` pour noir/blanc). On peut aussi la choisir sur la page Personnages (colonne « Texte »).

## Lancer la synchro
Onglet Actions > « Synchronisation du forum » > Run workflow.
En local : `python scripts/sync.py` (avec `FORUM_USER` / `FORUM_PASSWORD` dans l'environnement).
Options : `--only 176` (un seul sujet), `--all` (relire aussi les RP termines), `--dry-run`.

## Publier la page
Seul `docs/` est publie (Settings > Pages > « Deploy from a branch » > `main`, dossier `/docs` ;
ou copie du contenu de `docs/` sur Archive-Host). Les donnees ne sont JAMAIS publiees : la page les lit
dans le depot prive via l'API GitHub, avec un jeton propre a chaque appareil (page « Parametres »).

**Lien d'installation** : Parametres > « Copier le lien d'installation » donne un lien a ouvrir sur un autre
appareil ; il enregistre le depot et le jeton dans ce navigateur puis les efface de l'adresse. Le lien contient le
jeton : l'envoyer en message prive, puis supprimer le message.

Tester en local : a la racine du depot, `python -m http.server`, puis `http://localhost:8000/docs/`.

## Enregistrement
Quand la page est reliee a GitHub (jeton avec « Contents : Read and write »), chaque modification est
enregistree toute seule dans `data/manual.json`, environ 1,5 seconde apres. Si vous (ou votre partenaire)
enregistrez en meme temps depuis deux appareils, les changements sont fusionnes : seul ce que VOUS avez modifie
est applique sur la version du depot. Si l'enregistrement echoue, la barre du haut l'indique et propose de reessayer
ou de telecharger une copie de `manual.json`. Sans jeton, la page garde le mode « telechargement ».
Un nouveau RP recoit son etat (« a qui le tour ») a la prochaine synchro, soit au plus 30 minutes apres.

## Format de manual.json
- `characters` : `{id: {name, player, color, text_color}}` (`player` = compte forum de la joueuse ; `color` facultative :
  sans elle, la couleur est relevee sur le forum, voir ci-dessous)
- `topics` : `{id: {order, url, title, chars: {compte_joueuse: id_personnage}, nsfw, status ("termine"),
  turn (compte, ou "none"), note}}`
- `seen` : `{id_rp: dernier_message_vu}` (pour le badge « Nouveau »)
