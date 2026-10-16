// Reglages de la page (rien de secret ici : ce fichier est public).
window.RP_CONFIG = {
  forumBase: "https://sweeter-weather.forumactif.com",

  // Ou la page va chercher les fichiers data/*.json quand elle est ouverte en local
  // (lancer « python -m http.server » a la racine du depot, puis ouvrir /docs/).
  // En ligne, elle les lit via l'API GitHub avec votre jeton (voir « Parametres »).
  dataPath: "../data",
  branch: "main",

  // Les deux joueuses : « group » = groupe Forumactif des personnages.
  players: [
    { key: "fcksleeping",    group: "4", label: "Ambre" },
    { key: "chatondelalune", group: "3", label: "Chatondelalune" },
  ],

  statuses: { en_cours: "En cours", termine: "Terminé", archive: "Archivé" },
  recentDays: 7,   // « activité récente » = les N derniers jours
};
