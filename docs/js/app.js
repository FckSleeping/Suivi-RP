// Demarrage, menu, navigation, barre d'enregistrement.
(function () {
  const RP = window.RP, S = RP.state, h = RP.h;
  const PAGES = [
    ["dashboard", "Tableau de bord"], ["rp", "RP"], ["characters", "Personnages"],
    ["settings", "Paramètres"],
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
    const st = S.saveStatus;
    bar.hidden = !(S.dirty || st);
    bar.classList.toggle("save-error", st === "error");
    if (bar.hidden) return;
    if (!RP.canSave()) {
      bar.replaceChildren(
        h("span", {}, `${S.dirty} modification(s) non enregistrée(s) — téléchargez manual.json puis remplacez data/manual.json dans le dépôt, ou reliez la page à GitHub (Paramètres) pour enregistrer automatiquement.`),
        RP.btn("Télécharger manual.json", RP.downloadManual, "btn-primary btn-small"));
    } else if (st === "error") {
      bar.replaceChildren(h("span", {}, `Enregistrement impossible : ${S.saveError}`),
        h("span", { class: "save-actions" }, RP.btn("Réessayer", RP.save, "btn-primary btn-small"), RP.btn("Télécharger manual.json", RP.downloadManual, "btn-small")));
    } else if (st === "saved" && !S.dirty) {
      bar.replaceChildren(h("span", {}, "Enregistré ✓"));
    } else {
      bar.replaceChildren(h("span", {}, st === "saving" ? "Enregistrement…" : "Modifications en attente d’enregistrement…"));
    }
  }

  // Lien d'installation : https://…/#setup=<depot + jeton encodes>
  // Enregistre la configuration dans CE navigateur puis efface le jeton de l'adresse et de l'historique.
  function consumeSetupLink() {
    const m = /^#setup=(.+)$/.exec(location.hash);
    if (!m) return;
    try {
      const bin = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
      const s = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
      if (/^[\w.-]+\/[\w.-]+$/.test(s.repo || "") && typeof s.token === "string" && s.token) {
        RP.saveSettings({ repo: s.repo, branch: s.branch || window.RP_CONFIG.branch, token: s.token });
        RP.notice = "Installation terminée : cet appareil est relié à vos données.";
      } else RP.notice = "Lien d’installation invalide.";
    } catch (e) { RP.notice = "Lien d’installation invalide."; }
    history.replaceState(null, "", location.pathname + location.search + "#/dashboard");
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
    const notice = RP.notice ? h("p", { class: "notice" }, RP.notice) : null;
    RP.notice = "";
    root.replaceChildren(...[notice, RP.views[current()]()].flat(Infinity).filter(Boolean));
  }

  RP.onChange(() => {
    renderBar();
    if (!RP.isSilent()) renderPage();
  });
  window.addEventListener("hashchange", () => {
    if (/^#setup=/.test(location.hash)) { consumeSetupLink(); RP.load(); return; } // lien ouvert dans un onglet deja charge
    renderPage(); window.scrollTo(0, 0);
  });
  window.addEventListener("beforeunload", (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });
  document.getElementById("dialog").addEventListener("click", (e) => { if (e.target.id === "dialog") RP.closeDialog(); });

  consumeSetupLink();
  RP.load();
})();
