// Affichage : une fonction par page. Tout le texte venant du forum est insere via textContent (jamais en HTML).
(function () {
  const C = window.RP_CONFIG;
  const RP = window.RP;
  const S = RP.state;
  const norm = RP.norm;

  // ------------------------------------------------------------------ petits outils DOM
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (k === "value") value = v;
      else if (["checked", "disabled", "hidden", "open", "multiple", "required", "selected"].includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    kids.flat(Infinity).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    if (value !== undefined) el.value = value;
    return el;
  }
  // Icones (traits arrondis, couleur = celle du texte). Ajoutez-en ici si besoin.
  const ICONS = {
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>',
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  };
  function icon(name) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "icon"); s.setAttribute("aria-hidden", "true");
    s.innerHTML = ICONS[name] || ""; // textes fixes ci-dessus : aucun contenu du forum
    return s;
  }
  RP.icon = icon;
  const btn = (label, onclick, cls = "", ic = "") => h("button", { type: "button", class: `btn ${cls}`.trim(), onclick }, ic ? icon(ic) : null, ic ? h("span", {}, label) : label);
  const iconBtn = (ic, label, onclick, cls = "") => h("button", { type: "button", class: `btn btn-icon ${cls}`.trim(), onclick, title: label, "aria-label": label }, icon(ic));
  const badge = (text, cls = "", title = "") => h("span", { class: `badge ${cls}`.trim(), title }, text);
  const empty = (text) => h("p", { class: "empty" }, text);
  const section = (title, ...kids) => h("section", { class: "card" }, h("h2", { class: "card-title" }, title), ...kids);
  const goto = (page) => { location.hash = `#/${page}`; };

  const ui = (RP.ui = { rp: { q: "", char: "", turn: "", nsfw: false, done: false, sort: "order", dir: 1 } });

  // ------------------------------------------------------------------ dialogue
  const dlg = () => document.getElementById("dialog");
  function openDialog(title, body) {
    const d = dlg();
    d.replaceChildren(h("h2", { class: "dialog-title" }, title), body);
    if (!d.open) d.showModal();
  }
  const closeDialog = () => { const d = dlg(); if (d.open) d.close(); };
  RP.closeDialog = closeDialog;

  // ------------------------------------------------------------------ composants
  function pill(c) {
    if (!c) return h("span", { class: "pill pill-empty" }, "—");
    const t = pillStyle(c.color || "#999999");
    return h("span", {
      class: "pill pill-char" + (c.auto ? " pill-auto" : ""),
      style: `--pill-a:${t.a};--pill-b:${t.b};--pill-text:${t.text};--pill-shadow:${t.shadow}`,
      title: c.auto ? "Reconnu d’après les messages du sujet" : "",
    }, c.name);
  }
  const turnPill = (key) => (key ? h("span", { class: `pill pill-turn player-${key}` }, RP.playerLabel(key)) : h("span", { class: "pill pill-empty" }, "-"));
  const titleLink = (x) => (x.url ? h("a", { class: "topic-link", href: x.url, target: "_blank", rel: "noopener noreferrer" }, x.title) : h("span", {}, x.title));
  const flagBadges = (x) => x.flags.map((f) => badge("À vérifier", "flag", RP.flagLabel(f)));

  function lastLine(x) {
    if (!x.last && !x.lastAuthor) return "Pas encore lu";
    return `Dernière réponse de ${x.lastAuthor ? x.lastAuthor.name : "auteur inconnu"} · ${RP.fmtAgo(x.last) || RP.fmtDate(x.last)}`;
  }

  function item(x, ...actions) {
    return h("li", { class: "item" },
      h("div", { class: "item-main" },
        h("div", { class: "item-title" }, titleLink(x), x.unseen ? badge("Nouveau", "new") : null, flagBadges(x)),
        h("div", { class: "chars" }, RP.players.map((p) => x.chars[p.key] ? pill(x.chars[p.key]) : null)),
        h("div", { class: "item-meta" }, lastLine(x), x.turn ? ` · au tour de ${RP.playerLabel(x.turn)}` : "")),
      h("div", { class: "item-actions" }, actions));
  }

  // ------------------------------------------------------------------ TABLEAU DE BORD
  function dashboard() {
    const rows = RP.rows().filter((x) => !x.done);
    if (!rows.length) {
      return [section("Bienvenue",
        h("p", {}, "Commencez par ajouter vos personnages, puis les RP à suivre."),
        h("div", { class: "dialog-actions" }, btn("Ajouter des personnages", () => goto("characters")), btn("Ajouter un RP", () => { goto("rp"); setTimeout(() => topicDialog(), 50); }, "btn-primary")))];
    }
    const unseen = rows.filter((x) => x.unseen).sort(RP.byRecent);
    const flagged = rows.filter((x) => x.flags.some((f) => f !== "jamais_lu") || (x.url && x.flags.includes("jamais_lu") && S.status));
    const tile = (n, label, preset) => h("button", { type: "button", class: "tile", onclick: () => { Object.assign(ui.rp, { q: "", char: "", turn: "", nsfw: false, done: false }, preset); goto("rp"); } },
      h("span", { class: "tile-n" }, n), h("span", { class: "tile-l" }, label));

    return [
      h("div", { class: "tiles" },
        RP.players.map((p) => tile(rows.filter((x) => x.turn === p.key).length, `Au tour de ${p.label}`, { turn: p.key })),
        tile(unseen.length, "Nouvelles réponses", {}),
        tile(flagged.length, "À vérifier", {})),
      section("Nouvelles réponses",
        unseen.length ? h("ul", { class: "list" }, unseen.map((x) => item(x, btn("Marquer comme vu", () => RP.markSeen([x.id]), "btn-small", "check")))) : empty("Rien de nouveau depuis votre dernière visite."),
        unseen.length > 1 ? btn("Tout marquer comme vu", () => RP.markSeen(unseen.map((x) => x.id)), "btn-small") : null),
      section("Activité récente", h("ul", { class: "list" }, [...rows].filter((x) => x.last).sort(RP.byRecent).slice(0, 10).map((x) => item(x)))),
      flagged.length ? section("À vérifier",
        h("ul", { class: "list" }, flagged.map((x) => item(x, btn("Modifier", () => topicDialog(x.id), "btn-small")))),
        h("p", { class: "hint" }, "Survolez l’étiquette « À vérifier » pour voir la raison.")) : null,
    ];
  }

  // ------------------------------------------------------------------ RP (le tracker)
  function rpView() {
    const f = ui.rp;
    const box = h("div", { class: "table-wrap" });
    const allChars = RP.characters();

    const bar = h("div", { class: "filters" },
      h("input", { class: "field-input", type: "search", placeholder: "Rechercher un titre ou un personnage…", value: f.q, oninput: (e) => { f.q = e.target.value; draw(); } }),
      h("select", { class: "field-input", value: f.char, onchange: (e) => { f.char = e.target.value; draw(); } },
        h("option", { value: "" }, "Tous les personnages"), allChars.map((c) => h("option", { value: c.id }, c.name))),
      h("select", { class: "field-input", value: f.turn, onchange: (e) => { f.turn = e.target.value; draw(); } },
        h("option", { value: "" }, "Tous les états"), RP.players.map((p) => h("option", { value: p.key }, `Au tour de ${p.label}`))),
      h("label", { class: "field-check" }, h("input", { type: "checkbox", checked: f.nsfw, onchange: (e) => { f.nsfw = e.target.checked; draw(); } }), h("span", {}, "NSFW")),
      h("label", { class: "field-check" }, h("input", { type: "checkbox", checked: f.done, onchange: (e) => { f.done = e.target.checked; draw(); } }), h("span", {}, "Voir les terminés")),
      btn("Ajouter un RP", () => topicDialog(), "btn-primary", "plus"));

    const sortKey = {
      order: (x) => x.order, title: (x) => norm(x.title), turn: (x) => x.turn || "~", last: (x) => RP.ms(x.last) || 0,
      ...Object.fromEntries(RP.players.map((p) => [p.key, (x) => norm((x.chars[p.key] || {}).name || "~")])),
    };

    function draw() {
      const items = RP.rows().filter((x) => {
        if (x.done && !f.done) return false;
        if (f.q && !norm([x.title, ...RP.players.map((p) => (x.chars[p.key] || {}).name)].join(" ")).includes(norm(f.q))) return false;
        if (f.char && !RP.players.some((p) => x.chars[p.key] && x.chars[p.key].id === f.char)) return false;
        if (f.turn && x.turn !== f.turn) return false;
        if (f.nsfw && !x.nsfw) return false;
        return true;
      });
      const key = sortKey[f.sort] || sortKey.order;
      items.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * f.dir);

      const th = (label, k) => h("th", { class: "sortable" + (f.sort === k ? " sorted" : "") },
        h("button", { type: "button", class: "th-btn", onclick: () => { f.dir = f.sort === k ? -f.dir : 1; f.sort = k; draw(); } }, label, f.sort === k ? (f.dir > 0 ? " ▲" : " ▼") : ""));

      box.replaceChildren(
        items.length
          ? h("table", { class: "table tracker" },
              h("thead", {}, h("tr", {}, th("#", "order"), th("Titre", "title"), RP.players.map((p) => th(`Personnage ${p.label}`, p.key)), h("th", {}, "Lien"), th("État", "turn"), h("th", {}, "NSFW"), h("th", {}, ""))),
              h("tbody", {}, items.map((x, i) => h("tr", { class: (x.unseen ? "row-new " : "") + (x.done ? "row-done" : "") },
                h("td", { class: "cell-num" }, i + 1),
                h("td", { class: "cell-title" }, h("strong", {}, x.title), x.unseen ? badge("Nouveau", "new") : null, flagBadges(x), x.done ? badge("Terminé") : null,
                  x.note ? h("div", { class: "note" }, x.note) : null, h("div", { class: "sub" }, x.last ? lastLine(x) : "")),
                RP.players.map((p) => h("td", {}, pill(x.chars[p.key]))),
                h("td", { class: "cell-link" }, x.url ? h("a", { class: "icon-link", href: x.url, target: "_blank", rel: "noopener noreferrer", title: "Ouvrir le sujet", "aria-label": "Ouvrir le sujet" }, icon("link")) : ""),
                h("td", {}, turnPill(x.turn)),
                h("td", { class: "cell-nsfw" }, x.nsfw ? "♥" : ""),
                h("td", { class: "cell-actions" },
                  x.unseen ? iconBtn("check", "Marquer comme vu", () => RP.markSeen([x.id]), "btn-small") : null,
                  iconBtn("pencil", "Modifier", () => topicDialog(x.id), "btn-small"),
                  iconBtn("trash", "Supprimer", () => confirmDelete(x.id), "btn-small btn-danger")))))
            )
          : empty(RP.rows().length ? "Aucun RP ne correspond à ces filtres." : "Aucun RP pour l’instant : cliquez sur « Ajouter un RP »."),
        h("p", { class: "count" }, `${items.length} RP`));
    }
    draw();
    return [h("h2", { class: "page-title" }, "RP"), bar, box];
  }

  function confirmDelete(id) {
    const x = RP.enrich(id);
    openDialog("Supprimer ce RP ?", h("div", {},
      h("p", {}, h("strong", {}, x.title)),
      h("p", { class: "hint" }, "Il disparaît simplement de votre liste. Rien n’est supprimé ni modifié sur le forum."),
      h("div", { class: "dialog-actions" },
        btn("Annuler", closeDialog),
        btn("Supprimer", () => { closeDialog(); RP.deleteTopic(id); }, "btn-primary btn-danger"))));
  }

  // Formulaire d'ajout (id absent) ou de modification
  function topicDialog(id) {
    const x = id ? RP.enrich(id) : null;
    const e = x ? x.e : {};
    const url = h("input", { class: "field-input", type: "text", value: e.url || "", placeholder: "https://…/t176-titre-du-sujet  (laissez vide si le RP n’a pas commencé)" });
    const title = h("input", { class: "field-input", type: "text", value: e.title || "", placeholder: x ? x.title : "Facultatif : repris du lien sinon" });
    const selects = {};
    const charFields = RP.players.map((p) => {
      const list = RP.charsOf(p.key);
      const auto = x && x.chars[p.key] && x.chars[p.key].auto ? ` (reconnu : ${x.chars[p.key].name})` : "";
      selects[p.key] = h("select", { class: "field-input", value: (e.chars || {})[p.key] || "" },
        h("option", { value: "" }, `—${auto}`), list.map((c) => h("option", { value: c.id }, c.name)));
      return h("label", { class: "field" }, h("span", { class: "field-label" }, `Personnage de ${p.label}`), selects[p.key]);
    });
    const nsfw = h("input", { type: "checkbox", checked: !!e.nsfw });
    const done = h("input", { type: "checkbox", checked: e.status === "termine" });
    const turn = h("select", { class: "field-input", value: e.turn || "" },
      h("option", { value: "" }, "Automatique (d’après le dernier message)"),
      RP.players.map((p) => h("option", { value: p.key }, `Au tour de ${p.label}`)), h("option", { value: "none" }, "Aucun (-)"));
    const note = h("textarea", { class: "field-input", rows: 2, placeholder: "Facultatif" }, e.note || "");
    const err = h("p", { class: "error", hidden: true });
    const noChars = !RP.characters().length;

    openDialog(id ? "Modifier ce RP" : "Ajouter un RP", h("div", { class: "form" },
      x && x.flags.length ? h("ul", { class: "flag-list" }, x.flags.map((f) => h("li", {}, RP.flagLabel(f)))) : null,
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Lien du sujet"), url),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Titre"), title),
      charFields,
      noChars ? h("p", { class: "hint" }, "Aucun personnage dans la liste : ajoutez-les d’abord dans l’onglet « Personnages ».") : null,
      h("label", { class: "field field-check" }, nsfw, h("span", {}, "NSFW ♥")),
      h("label", { class: "field field-check" }, done, h("span", {}, "RP terminé")),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "État (à qui le tour)"), turn),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Note"), note),
      err,
      h("div", { class: "dialog-actions" },
        id ? btn("Supprimer", () => confirmDelete(id), "btn-danger") : null,
        btn("Annuler", closeDialog),
        btn(id ? "Enregistrer" : "Ajouter", () => {
          const msg = RP.saveTopic(id, {
            url: url.value, title: title.value, nsfw: nsfw.checked, done: done.checked, turn: turn.value, note: note.value,
            chars: Object.fromEntries(RP.players.map((p) => [p.key, selects[p.key].value])),
          });
          if (msg) { err.textContent = msg; err.hidden = false; } else closeDialog();
        }, "btn-primary"))));
  }

  // ------------------------------------------------------------------ selecteur de couleur (verre liquide)
  const hexToHsl = (hex) => {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let hh = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hh = (hh * 60 + 360) % 360;
    }
    return [Math.round(hh), Math.round(s * 100), Math.round(l * 100)];
  };
  const hslToHex = (hh, s, l) => {
    s /= 100; l /= 100;
    const k = (n) => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return "#" + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("");
  };
  // Pastille d'un personnage : degrade (couleur eclaircie -> couleur) et texte « ton sur ton ».
  // Fond clair -> texte plus sombre ; fond fonce -> texte plus clair ; saturation reduite de moitie environ.
  // Ex. lightgreen -> texte ~#72b972 ; darkred -> texte ~#c76262. Reglages : les 4 nombres ci-dessous.
  const PILL = { mixWhite: 0.24, darker: 17, lighter: 33, satLight: 0.45, satDark: 0.5 };
  function pillStyle(hex) {
    const n = parseInt(hex.slice(1), 16), mix = (v) => Math.round(v + (255 - v) * PILL.mixWhite);
    const a = "#" + [n >> 16, (n >> 8) & 255, n & 255].map((v) => mix(v).toString(16).padStart(2, "0")).join("");
    const [hh, s, l] = hexToHsl(hex);
    const light = l >= 50;
    const text = light ? hslToHex(hh, Math.round(s * PILL.satLight), Math.max(l - PILL.darker, 20)) : hslToHex(hh, Math.round(s * PILL.satDark), Math.min(l + PILL.lighter, 85));
    return { a, b: hex, text, shadow: light ? "0 1px 0 rgba(255,255,255,0.45)" : "0 1px 1px rgba(0,0,0,0.28)" };
  }

  let activePicker = null;
  function closePicker() {
    if (!activePicker) return;
    activePicker.pop.remove();
    ["pointerdown", "keydown", "scroll", "resize"].forEach((ev) => window.removeEventListener(ev, activePicker.on, true));
    activePicker = null;
  }

  function colorPicker(c) {
    let color = c.effColor;
    const swatch = h("button", { type: "button", class: "swatch", style: `--c:${color}`, title: "Changer la couleur", "aria-label": "Changer la couleur" });
    swatch.addEventListener("click", () => { if (activePicker && activePicker.owner === swatch) closePicker(); else open(); });

    function open() {
      closePicker();
      let [H, S, L] = hexToHsl(color);
      const hex = h("input", { class: "field-input picker-hex", type: "text", value: color, maxlength: 7, "aria-label": "Code couleur" });
      const mk = (label, max, val, onSet) => {
        const el = h("input", { type: "range", class: "picker-range", min: 0, max, value: val, "aria-label": label });
        el.addEventListener("input", () => { onSet(+el.value); set(hslToHex(H, S, L), false); });
        return el;
      };
      const sH = mk("Teinte", 360, H, (v) => (H = v));
      const sS = mk("Saturation", 100, S, (v) => (S = v));
      const sL = mk("Luminosité", 100, L, (v) => (L = v));
      sH.style.background = "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)";
      const tracks = () => {
        sS.style.background = `linear-gradient(to right,hsl(${H},0%,${L}%),hsl(${H},100%,${L}%))`;
        sL.style.background = `linear-gradient(to right,#000,hsl(${H},${S}%,50%),#fff)`;
      };
      // fromPalette : on replace les curseurs sur la couleur choisie
      function set(hx, fromPalette) {
        color = hx; swatch.style.setProperty("--c", hx); hex.value = hx;
        if (fromPalette) { [H, S, L] = hexToHsl(hx); sH.value = H; sS.value = S; sL.value = L; }
        tracks();
        RP.setChar(c.id, { color: hx }, false);
      }
      hex.addEventListener("change", () => {
        const v = hex.value.trim().replace(/^#?/, "#").toLowerCase();
        if (/^#[0-9a-f]{6}$/.test(v)) set(v, true); else hex.value = color;
      });
      const pop = h("div", { class: "picker-pop", role: "dialog", "aria-label": "Choisir une couleur" },
        h("div", { class: "picker-grid" }, C.palette.map((col) => h("button", { type: "button", class: "swatch swatch-mini", style: `--c:${col}`, title: col, "aria-label": col, onclick: () => set(col, true) }))),
        h("div", { class: "picker-sliders" }, sH, sS, sL),
        h("div", { class: "picker-foot" }, hex,
          c.autoColor ? btn("Couleur du forum", () => { closePicker(); RP.setChar(c.id, { color: null }); }, "btn-small", "refresh") : null));
      document.body.append(pop);
      tracks();

      const r = swatch.getBoundingClientRect(), w = pop.offsetWidth, ht = pop.offsetHeight;
      pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
      pop.style.top = `${r.bottom + 8 + ht > window.innerHeight ? Math.max(8, r.top - ht - 8) : r.bottom + 8}px`;

      const on = (e) => {
        if (e.type === "keydown") { if (e.key === "Escape") closePicker(); return; }
        if (e.type === "pointerdown" && (pop.contains(e.target) || swatch.contains(e.target))) return;
        if (e.type === "scroll" && pop.contains(e.target)) return;
        closePicker();
      };
      activePicker = { pop, on, owner: swatch };
      ["pointerdown", "keydown", "scroll", "resize"].forEach((ev) => window.addEventListener(ev, on, true));
    }
    return swatch;
  }

  // ------------------------------------------------------------------ PERSONNAGES
  function charactersView() {
    const names = h("textarea", { class: "field-input", rows: 3, placeholder: "Un ou plusieurs noms, séparés par des virgules ou des retours à la ligne" });
    const player = h("select", { class: "field-input" }, RP.players.map((p) => h("option", { value: p.key }, p.label)));
    const used = {};
    RP.rows().forEach((x) => RP.players.forEach((p) => { const c = x.chars[p.key]; if (c) used[c.id] = (used[c.id] || 0) + 1; }));

    const add = section("Ajouter des personnages",
      h("div", { class: "form" }, h("label", { class: "field" }, h("span", { class: "field-label" }, "Noms"), names),
        h("label", { class: "field" }, h("span", { class: "field-label" }, "Joueuse"), player),
        btn("Ajouter", () => {
          const list = names.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
          if (list.length) RP.addCharacters(list, player.value);
        }, "btn-primary", "plus")),
      h("p", { class: "hint" }, "La couleur est relevée automatiquement dans les messages du forum (dialogues colorés) quand le nom du personnage est celui de son compte ; sinon une couleur par défaut est choisie. Cliquez sur la pastille pour la changer."),
      btn("Reprendre les couleurs du forum", confirmResetColors, "btn-small", "refresh"));

    const block = (p) => {
      const list = RP.charsOf(p.key);
      return section(`Personnages de ${p.label}`,
        list.length ? h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, ["Couleur", "Nom", "RP", ""].map((t) => h("th", {}, t)))),
          h("tbody", {}, list.map((c) => h("tr", {},
            h("td", { class: "cell-color" }, colorPicker(c), h("span", { class: "sub" }, c.color ? "" : c.autoColor ? "forum" : "défaut")),
            h("td", {}, h("input", { class: "field-input", type: "text", value: c.name, "aria-label": "Nom", onchange: (e) => { const v = e.target.value.trim(); if (v) RP.setChar(c.id, { name: v }); else e.target.value = c.name; } })),
            h("td", { class: "cell-num" }, used[c.id] || 0),
            h("td", { class: "cell-actions" }, iconBtn("trash", "Supprimer", () => confirmDeleteChar(c, used[c.id] || 0), "btn-small btn-danger"))))))) : empty("Aucun personnage."));
    };
    return [h("h2", { class: "page-title" }, "Personnages"), add, RP.players.map(block)];
  }

  function confirmResetColors() {
    openDialog("Reprendre les couleurs du forum ?", h("div", {},
      h("p", {}, "Les couleurs choisies à la main seront remplacées par celles relevées sur le forum, pour tous les personnages où le forum en donne une."),
      h("div", { class: "dialog-actions" }, btn("Annuler", closeDialog), btn("Remplacer", () => { closeDialog(); RP.resetColors(); }, "btn-primary"))));
  }

  function confirmDeleteChar(c, n) {
    openDialog("Supprimer ce personnage ?", h("div", {},
      h("p", {}, h("strong", {}, c.name)),
      h("p", { class: "hint" }, n ? `Il est utilisé dans ${n} RP : sa case y sera simplement vidée.` : "Il n’est utilisé dans aucun RP."),
      h("div", { class: "dialog-actions" }, btn("Annuler", closeDialog), btn("Supprimer", () => { closeDialog(); RP.deleteChar(c.id); }, "btn-primary btn-danger"))));
  }

  // ------------------------------------------------------------------ PARAMETRES
  function sourceForm() {
    const s = RP.getSettings();
    const repo = h("input", { class: "field-input", type: "text", value: s.repo || "", placeholder: "proprietaire/nom-du-depot" });
    const branch = h("input", { class: "field-input", type: "text", value: s.branch || C.branch });
    const token = h("input", { class: "field-input", type: "password", value: s.token || "", placeholder: "github_pat_…", autocomplete: "off" });
    const files = h("input", { type: "file", multiple: true, accept: ".json", hidden: true, onchange: (e) => RP.load("files", e.target.files) });
    return section("Source des données",
      S.source ? h("p", {}, `Données chargées depuis : ${S.source}.`) : null,
      S.error ? h("p", { class: "error" }, S.error) : null,
      h("div", { class: "form" },
        h("label", { class: "field" }, h("span", { class: "field-label" }, "Dépôt GitHub"), repo),
        h("label", { class: "field" }, h("span", { class: "field-label" }, "Branche"), branch),
        h("label", { class: "field" }, h("span", { class: "field-label" }, "Jeton d’accès"), token),
        h("div", { class: "dialog-actions" },
          btn("Oublier ce navigateur", () => { RP.saveSettings({}); RP.load(); }),
          btn("Enregistrer et charger", () => { RP.saveSettings({ repo: repo.value.trim(), branch: branch.value.trim() || C.branch, token: token.value.trim() }); RP.load("github"); }, "btn-primary"))),
      h("details", { class: "details" },
        h("summary", {}, "Comment créer le jeton ?"),
        h("ol", {},
          h("li", {}, "GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token."),
          h("li", {}, "« Repository access » : Only select repositories → choisissez uniquement ce dépôt."),
          h("li", {}, "« Permissions » → Contents : Read and write (indispensable pour que la page enregistre vos modifications toute seule)."),
          h("li", {}, "Collez le jeton ici. Il reste dans ce navigateur uniquement ; chaque appareil a besoin du sien.")),
        h("p", { class: "hint" }, "Sans jeton, vous pouvez aussi ouvrir les fichiers à la main :"),
        btn("Ouvrir forum.json, manual.json, status.json…", () => files.click(), "btn-small"), files));
  }

  function setupLinkCard() {
    const s = RP.getSettings();
    if (!s.repo || !s.token) return null;
    const out = h("input", { class: "field-input", type: "text", readOnly: true, hidden: true });
    const make = () => {
      const bytes = new TextEncoder().encode(JSON.stringify({ repo: s.repo, branch: s.branch || C.branch, token: s.token }));
      const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return `${location.origin}${location.pathname}#setup=${b64}`;
    };
    return section("Lien d’installation",
      h("p", {}, "Pour relier un autre appareil (ou votre partenaire) sans retaper le jeton : ouvrez ce lien dessus. Il enregistre la configuration, puis efface le jeton de l’adresse et de l’historique du navigateur."),
      h("p", { class: "hint" }, "Le lien contient le jeton : envoyez-le en message privé uniquement, puis supprimez le message. Si vous avez un doute, révoquez le jeton sur GitHub et créez-en un autre."),
      btn("Copier le lien d’installation", () => {
        const link = make();
        out.value = link; out.hidden = false; out.select();
        (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => { out.placeholder = ""; }, () => {});
      }, "btn-primary"),
      out);
  }

  function settingsView() {
    const st = S.status;
    const out = [h("h2", { class: "page-title" }, "Paramètres")];
    if (st) {
      out.push(section("Dernier contrôle du forum",
        h("p", {}, st.ok ? badge("Réussie", "ok") : badge("Avec erreurs", "flag"), ` ${RP.fmtUtc(st.last_run)}`),
        st.topics_total !== undefined ? h("p", { class: "sub" }, `${st.topics_total} RP dans la liste · ${st.topics_read} lus · ${st.topics_with_new_reply} avec nouvelle réponse`) : null,
        h("p", { class: "hint" }, "Le forum est contrôlé régulièrement ; cette date n’est enregistrée que si quelque chose a changé, ou toutes les 3 h au plus."),
        (st.errors || []).length ? h("ul", { class: "flag-list" }, st.errors.map((e) => h("li", {}, `${e.where} : ${e.what}`))) : h("p", { class: "sub" }, "Aucune erreur.")));
    }
    out.push(sourceForm());
    out.push(setupLinkCard());
    if (S.manual) {
      out.push(section("Vos corrections",
        RP.canSave()
          ? h("p", {}, "Vos modifications s’enregistrent toutes seules dans le dépôt, quelques secondes après chaque changement.")
          : h("p", {}, S.dirty ? `${S.dirty} modification(s) pas encore enregistrée(s).` : "Aucune modification en attente.", " Reliez la page à GitHub (ci-dessus) pour qu’elles s’enregistrent toutes seules."),
        btn("Télécharger une copie de manual.json", RP.downloadManual)));
    }
    out.push(section("Apparence", h("p", {}, "Tout l’aspect se règle dans ", h("code", {}, "docs/css/theme.css"), " : couleurs et polices en haut du fichier (variables), puis tableaux, menus, étiquettes et animations. Ce fichier n’influence jamais le fonctionnement.")));
    return out;
  }

  RP.views = { dashboard, rp: rpView, characters: charactersView, settings: settingsView };
  RP.h = h; RP.btn = btn;
  RP.sourceForm = sourceForm;
})();
