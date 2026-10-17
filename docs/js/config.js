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

  // Couleurs proposees aux nouveaux personnages (modifiables ensuite une par une)
  palette: ["#e57373", "#f4a261", "#e9c46a", "#81c784", "#4db6ac", "#64b5f6", "#7986cb", "#ba68c8", "#f06292", "#a1887f", "#90a4ae", "#ff8a65"],
  recentDays: 7,
};
