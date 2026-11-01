/* effects.js : petites animations « liquid glass » (aucune influence sur le fonctionnement).
   1. Entrée de page : quand on change d'onglet (ou au premier chargement), la classe
      « fx-enter » est posée un court instant sur <html> ; theme.css anime alors les cartes,
      pastilles et lignes du tableau. Les simples enregistrements ne rejouent PAS l'animation.
   2. Reflet qui suit la souris : sur les boutons, pastilles, cartes et l'en-tête,
      les variables --mx / --my donnent la position de la souris (utilisées dans theme.css).
   Pour tout couper : retirez la ligne <script src="js/effects.js"> de index.html. */
(function () {
  "use strict";
  const root = document.documentElement;
  const app = document.getElementById("app");
  if (!app) return;

  // ---------- 1. Entrée de page ----------
  let pending = true; // premier affichage
  let timer = 0;
  function play() {
    root.classList.remove("fx-enter");
    void root.offsetWidth; // relance l'animation si elle était déjà en cours
    root.classList.add("fx-enter");
    clearTimeout(timer);
    timer = setTimeout(() => root.classList.remove("fx-enter"), 1200);
  }
  // Ce fichier est chargé AVANT app.js : ce signal passe donc avant le nouvel affichage.
  window.addEventListener("hashchange", () => { pending = true; });
  new MutationObserver(() => {
    if (!pending || app.querySelector(":scope > .loading")) return;
    pending = false;
    play();
  }).observe(app, { childList: true });

  // ---------- 2. Reflet qui suit la souris ----------
  const SEL = ".btn, .tile, .icon-link, .card, .app-header";
  let last = null, frame = 0;
  document.addEventListener("pointermove", (e) => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    last = e;
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      let el = last.target instanceof Element ? last.target.closest(SEL) : null;
      while (el) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height) {
          // en pourcentage : reste juste même avec le zoom de la page
          el.style.setProperty("--mx", ((last.clientX - r.left) / r.width * 100).toFixed(1) + "%");
          el.style.setProperty("--my", ((last.clientY - r.top) / r.height * 100).toFixed(1) + "%");
        }
        el = el.parentElement ? el.parentElement.closest(SEL) : null;
      }
    });
  }, { passive: true });
})();
