// Reglages de la page (rien de secret ici : ce fichier est public).
window.RP_CONFIG = {
  forumBase: "https://sweeter-weather.forumactif.com",

  // Ou la page va chercher les fichiers data/*.json quand elle est ouverte en local
  // (lancer « python -m http.server » a la racine du depot, puis ouvrir /docs/).
  // En ligne, elle les lit via l'API GitHub avec votre jeton (voir « Parametres »).
  dataPath: "../data",
  branch: "main",

  // Les deux joueuses, dans l'ordre des colonnes. « group » = groupe Forumactif des personnages.
  players: [
    { key: "chatondelalune", group: "3", label: "Fanny" },
    { key: "fcksleeping",    group: "4", label: "Ambre" },
  ],

  // Couleurs proposees dans le selecteur (et utilisees quand le forum n'en donne aucune)
  palette: ["#ff6b6b", "#ff8e5e", "#ffb84d", "#f2d043", "#9bdc5f", "#4fd1a1", "#3cc8d9", "#4da3ff",
            "#7a86ff", "#a77bff", "#d46bff", "#ff6bc1", "#f4a1c4", "#c9a27a", "#8d99ae", "#3d3d4e"],
  recentDays: 7,

  // Etats possibles d'un trope (menu deroulant de l'onglet Tropes). « key » est ce qui s'ecrit dans manual.json,
  // « label » ce qui s'affiche. Pour en ajouter un, ajoutez une ligne ici puis (si vous voulez une couleur)
  // une regle  .trope-state[data-state="votre_cle"]  dans theme.css.
  tropeStatuses: [
    { key: "used",    label: "Utilisé" },
    { key: "waiting", label: "En attente" },
  ],
};
