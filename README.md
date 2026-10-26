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
- `scripts/sync.py` : la synchronisation (toutes les 30 min). `scripts/proto_forum.py` : briques de lecture du forum
  (et son mode `--discover`, qui sert a explorer le forum a la main).
- `scripts/check_connexion.py` : test de connexion depuis GitHub Actions.
- `scripts/export_archives.py` : export du texte des RP archives (un fichier par RP, pour une IA qui fera le recap).
- `data/manual.json` : VOTRE liste (personnages, RP, notes). Jamais ecrit par la synchro.
- `data/forum.json`, `data/status.json` : ecrits par la synchro uniquement.
- `data/textes_archives/` : ecrit par l'export des archives uniquement (voir « Exporter les archives pour un recap »).
- `.github/workflows/` : `test-connexion.yml`, `synchro.yml` (declenchee par cron-job.org), `export-archives.yml` (a lancer a la main).

## Identifiants
Les identifiants du compte de lecture ne sont JAMAIS dans le code. Ils sont dans les Secrets du depot
(Settings > Secrets and variables > Actions) : `FORUM_USER` et `FORUM_PASSWORD`.

## Utiliser la page
Quatre onglets : Tableau de bord, Tropes, Archives, Parametres.
- **Tableau de bord** : deux compteurs en haut (« Au tour de Fanny », « Au tour d'Ambre »), puis la liste des RP :
  « Ajouter un RP » = coller le lien du sujet, choisir le personnage de chacune, cocher NSFW si besoin. Le titre est repris
  du lien (modifiable). Un RP sans lien (pas encore commence) est possible. Colonne « Etat » = a qui le tour, toujours deduit de
  l'auteur du dernier message (« - » tant qu'il est inconnu) ; il n'y a rien a regler. L'etiquette « Nouvelle reponse » est posee par la synchro quand le
  dernier message a change, et disparait toute seule a la synchro suivante : rien a valider. L'icone corbeille retire le RP
  de la liste (rien n'est touche sur le forum) ; quand un RP est fini, on modifie simplement le lien/titre pour en suivre
  un autre a la place.
- **Tropes** : votre liste de tropes, sur le modele d'un tableau (Nom, Description courte, Etat, Ship). L'etat (« Utilise »,
  « En attente », ou « - ») se change directement dans le menu de la ligne et s'enregistre tout de suite. La colonne Ship affiche
  le nom du ship sur un **degrade** de la couleur du personnage de Fanny vers celle du personnage d'Ambre, texte blanc.
  « Ajouter un trope » ouvre un formulaire (nom, description, etat, ship : on choisit un ship existant ou un personnage de chacune ;
  choisir un ship passe l'etat sur « Utilise » si rien n'etait choisi). « Ajouter plusieurs » accepte un trope par ligne
  (`Nom | description`, ou deux colonnes collees depuis un tableur). Les en-tetes Nom, Etat et Ship trient la liste.
  **Couleur du texte** : blanc pour tous les ships par defaut (`--trope-ship-text` dans `theme.css`, ainsi que l'ombrage
  `--trope-ship-shadow` et la mise en majuscules dans `.ship-pill`) ; pour un ship precis, champ « Couleur du texte du ship » de
  la fenetre « Modifier ce trope » (ecrit `text_color` dans `ships`). Les etats proposes se definissent dans `tropeStatuses`
  (`docs/js/config.js`) et leurs couleurs dans `theme.css` (`.trope-state[data-state="..."]`).
- **Archiver un RP** (icone d'archive sur sa ligne) : une fenetre propose de le remplacer par le nouveau (lien et titre
  facultatifs ; le nouveau garde les memes personnages et la meme place dans la liste) ou de l'archiver seulement.
- **Archives** : les RP termines, classes par ship (couple « personnage de Fanny + personnage d'Ambre »). Dans chaque bloc,
  du plus ancien au plus recent d'apres la date du dernier message (celle du forum, lue une seule fois par la synchro ;
  ou la « date de fin » saisie a la main, qui l'emporte ; ou la date d'archivage en dernier recours).
  Le crayon du bloc le **personnalise** : nom (par defaut « Nom & Nom », a vous d'inventer le Brangelina), couleur,
  banniere et deux images carrees (gifs, cote a cote avant le nom) — des adresses `https://` d'images deja hebergees ailleurs.
  La banniere se **recadre a la souris** dans la fenetre (glisser l'image, curseur de zoom) ; le rapport largeur/hauteur
  (`aspect-ratio: 7 / 1`) se regle dans `theme.css`, pour `.ship-banner-box` et `.banner-crop` ensemble. Le bouton
  « Ajouter un RP » d'un bloc cree directement un RP termine avec les deux personnages de la ship deja choisis.
  « Ajouter un RP termine » (en haut) ajoute un RP fini sans passer par le tableau de bord ; la fleche courbe remet un RP
  dans le tableau de bord.
- **Creer une ship a l'avance** (bouton « Creer une ship » dans Archives) : on choisit un personnage de chacune (au moins un)
  et, si on veut, un nom. Le bloc existe tout de suite, meme sans RP termine, et garde son nom et son decor quand un RP
  direct sera termine plus tard. Il accueille les RP « hors ship » de ses personnages, au lieu d'un bloc a part au nom d'un
  seul personnage. Un personnage peut avoir plusieurs ships. « Supprimer la ship » (dans le crayon) retire la creation ; le
  bloc ne reste que s'il contient des RP directs.
- **RP « hors ship »** : case a cocher quand on archive ou modifie un RP archive. Un RP entre deux personnages qui ne forment
  pas une ship (ex. Leo x Maeve, alors que Leo est avec Felicy et Maeve avec Wade) apparait dans le bloc de CHACUN de ses
  deux personnages, avec une petite icone de branche ; un personnage sans aucune ship a un bloc a son nom.
- **Parametres** : en premier la section **Personnages** (ajout de plusieurs noms d'un coup, joueuse, couleur de fond et de texte,
  suppression), puis le dernier controle du forum, la connexion a GitHub, le lien d'installation et la copie de `manual.json`.
  Les anciennes adresses `#/rp` et `#/characters` redirigent vers ces deux pages.
- Si le personnage n'est pas choisi dans un RP, la page le reconnait d'apres les comptes qui ont ecrit dans le sujet
  (affiche en italique), a condition que le nom du personnage soit celui du compte.
- `manual.json` modifie a la main : la page tolere les fautes courantes (joueuse ecrite « Fanny » au lieu du nom de compte,
  entrees abimees ignorees). Un personnage dont la joueuse reste inconnue apparait dans « Personnages a rattacher a une joueuse ».
  Si une page plante, elle affiche le message d'erreur au lieu de rester vide.

## Mise a jour de la page
`docs/index.html` ajoute `?v=...` aux fichiers CSS et JS : changez ce numero a chaque mise a jour pour que les navigateurs ne
melangent pas d'anciens et de nouveaux fichiers (GitHub Pages garde les fichiers en cache quelques minutes).

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
Le bouton « Figer les couleurs de texte » (page Personnages) ecrit dans `manual.json` la couleur calculee de chaque
personnage qui n'a pas de `text_color`, pour pouvoir la retoucher a la main ; « Texte en automatique » les efface toutes.

## A qui le tour (colonne « Etat »)
Toujours automatique, sans rien a regler : c'est l'autre joueuse que celle qui a ecrit en dernier. La synchro lit
l'auteur du dernier message ; s'il est illisible, elle deduit par alternance (un RP se joue a deux : chaque nouveau
message est forcement de l'autre joueuse, et a defaut d'etat precedent le premier message est celui du createur).
Il n'y a donc plus d'etiquette « a verifier ». Les erreurs de lecture d'un sujet (lien incorrect, sujet inaccessible)
apparaissent dans Parametres > « Dernier controle du forum ».

Pour le depannage, quand le dernier message d'un sujet n'a ni auteur ni date lisibles, sa fiche dans `data/forum.json`
contient une cle `diag` (nombre d'elements candidats, de messages retenus, balise et classes du dernier ; aucun texte du forum).

## Exporter les archives pour un recap
Onglet Actions > « Export des archives (textes) » > Run workflow. Le script relit chaque RP archive **du premier au dernier
message** et ecrit un fichier par RP dans `data/textes_archives/` (`t176-titre-du-rp.txt`). Chaque fichier contient seulement le
titre, les personnages de votre liste, puis, dans l'ordre, le pseudo du compte et le texte de chaque message :

    [Pseudo]
    Texte du message...

    [AutrePseudo]
    Texte du message...

Ne sont pas gardes : les dates, les signatures, les citations d'un message precedent (`blockquote`), les images et les
notes « Derniere edition par ». Les dialogues colores, eux, sont conserves. Un message qui ne contient qu'une image est saute.
- **Reprise** : un RP deja exporte n'est pas relu (un RP archive est termine). Cochez « force » pour tout refaire, ou indiquez
  un numero de sujet pour n'en refaire qu'un (ce numero peut aussi etre celui d'un RP non archive). Si l'export est interrompu,
  les RP deja lus sont quand meme enregistres, et la fois suivante reprend avec les autres.
- **RP tres long** : au-dela de 300 000 caracteres (environ 80 000 mots), le RP est coupe en `-partie1`, `-partie2`... entre deux
  messages, pour tenir dans une conversation avec une IA. Reglage : `--max-chars` (0 = jamais de coupure).
- **Duree** : environ une seconde par page du forum ; un long RP prend quelques minutes, tous les RP d'un coup peuvent
  prendre une heure ou plus.
- **Recuperer les fichiers** : sur GitHub, dossier `data/textes_archives/`, ouvrir un fichier puis « Download raw file »
  (ou « Code » > « Download ZIP » pour tout le depot).
- **Le texte n'est pas reconnu ?** Le journal de l'execution indique, pour chaque RP, comment le texte a ete lu. Si une ligne
  dit « texte du message non reconnu, lecture de repli », elle est suivie du plan du premier message concerne (balises et
  classes, jamais de texte) : ajoutez le bon selecteur dans `BODY_SELECTORS` en haut de `scripts/export_archives.py`
  (comme `COLOR_SELECTORS` dans `sync.py`). Sans cela, le texte est quand meme lu, mais peut contenir des elements du profil.
- En local : `python scripts/export_archives.py` (avec `FORUM_USER` / `FORUM_PASSWORD` dans l'environnement). Options :
  `--only 176`, `--force`, `--max-chars`, `--dry-run` (liste les RP concernes sans rien lire).
- **Confidentialite** : ces fichiers contiennent le texte de sujets prives, comme `data/forum.json` : le depot doit rester PRIVE.
  Seul `docs/` est publie. Le journal de l'execution n'affiche jamais de titre, de pseudo ni de texte.

## Lancer la synchro
Onglet Actions > « Synchronisation du forum » > Run workflow.
En local : `python scripts/sync.py` (avec `FORUM_USER` / `FORUM_PASSWORD` dans l'environnement).
Options : `--only 176` (un seul sujet), `--dry-run`.

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
- `topics` : `{id: {order, url, title, chars: {compte_joueuse: id_personnage}, nsfw, note, archived, archived_at, side, ended}}`
  (`archived` : RP archive ; `side` : RP « hors ship » ; `ended` : date de fin AAAA-MM-JJ saisie a la main)
- `ships` : `{"id_perso_Fanny|id_perso_Ambre": {name, color, banner, banner_crop (« x,y,zoom »), gif1, gif2, declared, text_color}}`
  (`declared` : ship creee a l'avance ; `text_color` : couleur du texte de la pastille du ship dans l'onglet Tropes) :
  personnalisation des blocs d'archives et des pastilles de tropes
- `tropes` : `{id: {order, name, desc, status, ship}}` (`status` : cle d'un etat de `tropeStatuses`, ex. `used` / `waiting` ;
  `ship` : cle de ship « id_perso_Fanny|id_perso_Ambre », une moitie peut manquer)
