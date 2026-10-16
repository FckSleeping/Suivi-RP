// Demarrage, menu, navigation, barre d'enregistrement.
(function () {
  const RP = window.RP, S = RP.state, h = RP.h;
  const PAGES = [
    ["dashboard", "Tableau de bord"], ["rp", "RP"], ["characters", "Personnages"],
    ["categories", "Catégories"], ["archives", "Archives"], ["settings", "Paramètres"],
  ];
  const current = () => {
    const k = (location.hash.replace(/^#\/?/, "") || "dashboard");
    return PAGES.some((p) => p[0] === k) ? k : "dashboard";
  };

  function renderNav() {
    document.getElementById("nav").replaceChildren(...PAGES.map(([k, label]) =>
      h("a", { class: "nav-link" + (k === current() ? " active" : ""), href: `#/${k}` }, label)));
  }

  function renderBar() {
    const bar = document.getElementById("save-bar");
    bar.hidden = !S.dirty;
    if (!S.dirty) return;
    bar.replaceChildren(
      h("span", {}, `${S.dirty} modification(s) non enregistrée(s) — téléchargez manual.json puis remplacez data/manual.json dans le dépôt.`),
      RP.btn("Télécharger manual.json", RP.downloadManual, "btn-primary btn-small"));
  }

  function renderPage() {
    renderNav();
    const root = document.getElementById("app");
    if (!S.forum) {
      root.replaceChildren(
        h("section", { class: "card" }, h("h2", { class: "card-title" }, "Bienvenue"),
          h("p", {}, "Connectez la page aux données de la synchronisation pour commencer.")),
        RP.sourceForm());
      return;
    }
    root.replaceChildren(...[].concat(RP.views[current()]()));
  }

  RP.onChange(() => {
    renderBar();
    if (!RP.isSilent()) renderPage();
  });
  window.addEventListener("hashchange", () => { renderPage(); window.scrollTo(0, 0); });
  window.addEventListener("beforeunload", (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });
  document.getElementById("dialog").addEventListener("click", (e) => { if (e.target.id === "dialog") RP.closeDialog(); });

  RP.load();
})();
