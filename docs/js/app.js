// Demarrage, menu, navigation, barre d'enregistrement.
(function () {
  const RP = window.RP, S = RP.state, h = RP.h;
  const PAGES = [["dashboard", "Tableau de bord", "home"], ["settings", "Paramètres", "settings"]];
  // Anciennes adresses : #/rp -> tableau de bord, #/characters -> Parametres (section Personnages)
  const ALIASES = { rp: "dashboard", characters: "settings" };
  const raw = () => location.hash.replace(/^#\/?/, "").split("?")[0] || "dashboard";
  const current = () => { const k = ALIASES[raw()] || raw(); return PAGES.some((p) => p[0] === k) ? k : "dashboard"; };

  function renderNav() {
    document.getElementById("nav").replaceChildren(...PAGES.map(([k, label, ic]) =>
      h("a", { class: "nav-link" + (k === current() ? " active" : ""), href: `#/${k}` }, RP.icon(ic), h("span", { class: "nav-label" }, label))));
  }

  // Voyant de connexion : dit clairement si vos modifications seront enregistrees
  function renderConn() {
    const el = document.getElementById("conn");
    const on = RP.canSave();
    el.className = "conn " + (on ? "conn-on" : "conn-off");
    el.textContent = on ? "Relié à GitHub" : "Non relié";
    el.title = on ? "Vos modifications s’enregistrent automatiquement." : "Vos modifications ne sont PAS enregistrées : cliquez pour relier la page.";
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
    renderConn();
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
    let content;
    try {
      content = [notice, RP.views[current()]()].flat(Infinity).filter(Boolean);
    } catch (err) {
      console.error(err);
      content = [h("section", { class: "card" }, h("h2", { class: "card-title" }, "Cette page a rencontré une erreur"),
        h("p", { class: "error" }, String((err && err.message) || err)),
        h("pre", { class: "error-detail" }, String((err && err.stack) || "").split("\n").slice(0, 4).join("\n")),
        h("p", { class: "hint" }, "Faites un rechargement forcé (Ctrl+F5). Si l’erreur persiste, recopiez ce message."))];
    }
    root.replaceChildren(...content);
    if (raw() === "characters") setTimeout(() => { const el = document.getElementById("personnages"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 30);
  }

  RP.onChange(() => {
    renderConn();
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
