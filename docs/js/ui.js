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
      else if (["checked", "disabled", "hidden", "open", "multiple", "required", "selected", "readOnly"].includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    kids.flat(Infinity).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    if (value !== undefined) el.value = value;
    return el;
  }
  const btn = (label, onclick, cls = "") => h("button", { type: "button", class: `btn ${cls}`.trim(), onclick }, label);
  const badge = (text, cls = "", title = "") => h("span", { class: `badge ${cls}`.trim(), title }, text);
  const empty = (text) => h("p", { class: "empty" }, text);
  const section = (title, ...kids) => h("section", { class: "card" }, h("h2", { class: "card-title" }, title), ...kids);

  const ui = (RP.ui = {
    rp: { q: "", char: "", status: "", act: "", turn: "", sort: "last", dir: -1 },
    arch: { q: "", char: "" },
    off: { q: "" },
  });

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
  const statusBadge = (s) => badge(C.statuses[s] || s, `status-${s}`);
  const playerTag = (key) => (key ? badge(RP.playerLabel(key), `player player-${key}`) : null);

  function chips(x) {
    return h("span", { class: "chars" },
      x.chars.map((u) => h("span", { class: `chip player-${RP.charPlayer(u) || "none"}` }, RP.charName(u))),
      x.hints.map((u) => h("span", { class: "chip chip-hint", title: "Repéré par alias dans le titre" }, RP.charName(u) + " ?"))
    );
  }
  const topicLink = (x) => h("a", { class: "topic-link", href: x.url, target: "_blank", rel: "noopener noreferrer" }, x.title);
  const flagBadges = (x) => x.flags.map((f) => badge("À vérifier", "flag", RP.flagLabel(f)));

  function lastLine(x) {
    if (!x.last && !x.lastAuthor) return "Pas encore lu";
    const who = x.lastAuthor ? x.lastAuthor.name : "auteur inconnu";
    return `Dernière réponse de ${who} · ${RP.fmtAgo(x.last) || RP.fmtDate(x.last)}`;
  }

  function topicItem(x, ...actions) {
    return h("li", { class: "item" },
      h("div", { class: "item-main" },
        h("div", { class: "item-title" }, topicLink(x), x.unseen ? badge("Nouveau", "new") : null, flagBadges(x)),
        chips(x),
        h("div", { class: "item-meta" }, lastLine(x), x.turn ? ` · au tour de ${RP.playerLabel(x.turn)}` : "")
      ),
      h("div", { class: "item-actions" }, actions)
    );
  }

  // ------------------------------------------------------------------ TABLEAU DE BORD
  function dashboard() {
    const rp = RP.rpTopics().filter((x) => x.status !== "archive");
    const active = rp.filter((x) => x.status === "en_cours");
    const unseen = rp.filter((x) => x.unseen).sort(RP.byRecent);
    const flagged = rp.filter((x) => x.flags.length);
    const sugg = RP.suggestions();
    const recent = [...active].sort(RP.byRecent).slice(0, 10);

    const tile = (n, label, preset) =>
      h("button", { type: "button", class: "tile", onclick: () => { Object.assign(ui.rp, { q: "", char: "", status: "", act: "", turn: "" }, preset); location.hash = "#/rp"; } },
        h("span", { class: "tile-n" }, n), h("span", { class: "tile-l" }, label));

    const out = [h("div", { class: "tiles" },
      tile(active.length, "RP en cours", { status: "en_cours" }),
      tile(unseen.length, "Nouvelles réponses", { act: "new" }),
      tile(flagged.length, "À vérifier", { act: "check" }),
      h("button", { type: "button", class: "tile", onclick: () => document.getElementById("sugg")?.scrollIntoView({ behavior: "smooth" }) },
        h("span", { class: "tile-n" }, sugg.length), h("span", { class: "tile-l" }, "Suggestions")))];

    out.push(section("Nouvelles réponses",
      unseen.length ? h("ul", { class: "list" }, unseen.map((x) => topicItem(x, btn("Marquer comme vu", () => RP.markSeen([x.tid]), "btn-small")))) : empty("Rien de nouveau depuis votre dernière visite."),
      unseen.length > 1 ? btn("Tout marquer comme vu", () => RP.markSeen(unseen.map((x) => x.tid)), "btn-small") : null));

    const sec = section("Suggestions de remplacement");
    sec.id = "sugg";
    sec.append(sugg.length ? h("ul", { class: "list" }, sugg.map(suggestionItem)) : empty("Aucune suggestion en attente."));
    out.push(sec);

    out.push(section("Activité récente",
      recent.length ? h("ul", { class: "list" }, recent.map((x) => topicItem(x))) : empty("Aucun RP en cours.")));

    if (flagged.length) {
      out.push(section("À vérifier",
        h("ul", { class: "list" }, flagged.map((x) => topicItem(x, btn("Corriger", () => editTopic(x.tid), "btn-small")))),
        h("p", { class: "hint" }, "Survolez l’étiquette « À vérifier » pour voir la raison.")));
    }
    return out;
  }

  function suggestionItem(s) {
    const n = RP.enrich(s.new), o = RP.enrich(s.old);
    return h("li", { class: "item item-suggestion" },
      h("div", { class: "item-main" },
        h("div", { class: "item-title" }, "Le nouveau RP ", topicLink(n), " remplace-t-il ", topicLink(o), " ?"),
        chips(n),
        h("div", { class: "item-meta" }, `Ancien créé le ${RP.fmtDate(s.created_old)} · nouveau créé le ${RP.fmtDate(s.created_new)}`)),
      h("div", { class: "item-actions" },
        btn("Accepter", () => RP.accept(s.key, s.new, s.old), "btn-primary btn-small"),
        btn("Refuser", () => RP.refuse(s.key), "btn-small"),
        btn("Corriger", () => correctSuggestion(s), "btn-small")));
  }

  function correctSuggestion(s) {
    const options = RP.rpTopics().filter((x) => x.status === "en_cours" && x.tid !== s.new).sort(RP.byRecent);
    const sel = h("select", { class: "field-input", value: s.old },
      h("option", { value: "" }, "Aucun : ne rien remplacer"),
      options.map((x) => h("option", { value: x.tid }, x.title)));
    openDialog("Corriger la suggestion", h("div", {},
      h("p", {}, "Quel RP le nouveau sujet remplace-t-il vraiment ?"),
      sel,
      h("div", { class: "dialog-actions" },
        btn("Annuler", closeDialog),
        btn("Valider", () => {
          closeDialog();
          RP.refuse(s.key);
          if (sel.value) RP.accept(`${s.new}>${sel.value}`, s.new, sel.value);
        }, "btn-primary"))));
  }

  // ------------------------------------------------------------------ RP
  function charSelect(current, onchange, label = "Tous les personnages") {
    const used = new Set(RP.rpTopics().flatMap((x) => x.chars));
    return h("select", { class: "field-input", value: current, onchange },
      h("option", { value: "" }, label),
      RP.allCharacters().filter((c) => used.has(c.uid) || c.manual).map((c) => h("option", { value: c.uid }, c.name)));
  }

  function rpView() {
    const f = ui.rp;
    const listBox = h("div", { class: "table-wrap" });

    const bar = h("div", { class: "filters" },
      h("input", { class: "field-input", type: "search", placeholder: "Rechercher un titre ou un personnage…", value: f.q, oninput: (e) => { f.q = e.target.value; draw(); } }),
      charSelect(f.char, (e) => { f.char = e.target.value; draw(); }),
      h("select", { class: "field-input", value: f.status, onchange: (e) => { f.status = e.target.value; draw(); } },
        h("option", { value: "" }, "Tous les statuts"), h("option", { value: "en_cours" }, "En cours"), h("option", { value: "termine" }, "Terminés")),
      h("select", { class: "field-input", value: f.act, onchange: (e) => { f.act = e.target.value; draw(); } },
        h("option", { value: "" }, "Toute activité"),
        h("option", { value: "new" }, "Nouvelles réponses"),
        h("option", { value: "1" }, "Dernières 24 h"),
        h("option", { value: String(C.recentDays) }, `Derniers ${C.recentDays} jours`),
        h("option", { value: "30" }, "Derniers 30 jours"),
        h("option", { value: "check" }, "À vérifier")),
      h("select", { class: "field-input", value: f.turn, onchange: (e) => { f.turn = e.target.value; draw(); } },
        h("option", { value: "" }, "Au tour de…"),
        C.players.map((p) => h("option", { value: p.key }, p.label))),
      btn("Ajouter un RP", addTopicDialog));

    function draw() {
      let items = RP.rpTopics().filter((x) => {
        if (x.status === "archive") return false;
        if (f.q && !norm([x.title, ...x.chars.map(RP.charName)].join(" ")).includes(norm(f.q))) return false;
        if (f.char && !x.chars.includes(f.char) && !x.hints.includes(f.char)) return false;
        if (f.status && x.status !== f.status) return false;
        if (f.act === "new" && !x.unseen) return false;
        if (f.act === "check" && !x.flags.length) return false;
        if (/^\d+$/.test(f.act) && RP.daysAgo(x.last) > +f.act) return false;
        if (f.turn && x.turn !== f.turn) return false;
        return true;
      });
      const key = { title: (x) => norm(x.title), created: (x) => RP.ms(x.created) || 0, last: (x) => RP.ms(x.last) || 0, count: (x) => x.count, status: (x) => x.status }[f.sort];
      items.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * f.dir);

      const th = (label, k) => h("th", { class: "sortable" + (f.sort === k ? " sorted" : "") },
        h("button", { type: "button", class: "th-btn", onclick: () => { f.dir = f.sort === k ? -f.dir : -1; f.sort = k; draw(); } }, label, f.sort === k ? (f.dir > 0 ? " ▲" : " ▼") : ""));

      listBox.replaceChildren(items.length
        ? h("table", { class: "table" },
            h("thead", {}, h("tr", {}, th("Sujet", "title"), h("th", {}, "Personnages"), th("Création", "created"), th("Dernière réponse", "last"), th("Messages", "count"), th("Statut", "status"), h("th", {}, ""))),
            h("tbody", {}, items.map((x) => h("tr", { class: x.unseen ? "row-new" : "" },
              h("td", { class: "cell-title" }, topicLink(x), x.unseen ? badge("Nouveau", "new") : null, flagBadges(x), x.note ? h("div", { class: "note" }, x.note) : null),
              h("td", {}, chips(x)),
              h("td", { class: "cell-date" }, RP.fmtDate(x.created)),
              h("td", { class: "cell-date" }, RP.fmtDate(x.last), h("div", { class: "sub" }, x.lastAuthor ? `par ${x.lastAuthor.name}` : "auteur inconnu", x.turn ? ` · tour de ${RP.playerLabel(x.turn)}` : "")),
              h("td", { class: "cell-num" }, x.count || "—"),
              h("td", {}, statusBadge(x.status)),
              h("td", { class: "cell-actions" }, x.unseen ? btn("Vu", () => RP.markSeen([x.tid]), "btn-small") : null, btn("Modifier", () => editTopic(x.tid), "btn-small"))))))
        : empty("Aucun RP ne correspond à ces filtres."), h("p", { class: "count" }, `${items.length} RP`));
    }
    draw();
    return [h("h2", { class: "page-title" }, "RP"), bar, listBox];
  }

  function editTopic(tid) {
    const x = RP.enrich(tid);
    const auto = x.t.characters || [];
    const status = h("select", { class: "field-input", value: x.status },
      Object.entries(C.statuses).map(([k, v]) => h("option", { value: k }, v)));
    const follow = h("input", { type: "checkbox", checked: x.rp });
    const title = h("input", { class: "field-input", type: "text", value: x.m.title || "", placeholder: x.t.title || "" });
    const note = h("textarea", { class: "field-input", rows: 3, placeholder: "Une note pour vous deux…" }, x.m.note || "");
    const boxes = RP.allCharacters().filter((c) => c.active || x.chars.includes(c.uid)).map((c) => ({
      c, box: h("input", { type: "checkbox", checked: x.chars.includes(c.uid) }),
    }));

    openDialog("Modifier ce RP", h("div", { class: "form" },
      h("p", { class: "dialog-sub" }, x.t.title || x.title),
      x.flags.length ? h("ul", { class: "flag-list" }, x.flags.map((f) => h("li", {}, RP.flagLabel(f)))) : null,
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Statut"), status),
      h("label", { class: "field field-check" }, follow, h("span", {}, "Suivre ce sujet comme un RP")),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Titre affiché (facultatif)"), title),
      h("fieldset", { class: "field" }, h("legend", { class: "field-label" }, "Personnages"),
        h("div", { class: "check-grid" }, boxes.map(({ c, box }) => h("label", { class: "field-check" }, box, h("span", {}, `${c.name}${c.player ? ` (${RP.playerLabel(c.player)})` : ""}`)))),
        x.m.characters ? btn("Revenir à la détection automatique", () => { closeDialog(); RP.setTopic(tid, { characters: null }); }, "btn-small") : h("p", { class: "hint" }, "Détectés automatiquement d’après les auteurs des messages.")),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Note"), note),
      h("div", { class: "dialog-actions" },
        x.flags.length && x.t.last_post ? btn("Marquer comme vérifié", () => { closeDialog(); RP.setTopic(tid, { checked: x.t.last_post.post_id }); }) : null,
        btn("Annuler", closeDialog),
        btn("Enregistrer", () => {
          const chosen = boxes.filter((b) => b.box.checked).map((b) => b.c.uid);
          const same = chosen.length === auto.length && chosen.every((u) => auto.includes(u));
          const rule = S.manual.forum_rules[String(x.t.forum_id)];
          const base = rule !== undefined ? !!rule : !!x.t.auto_rp;
          const keepManualChars = x.m.characters !== undefined || !same;
          closeDialog();
          RP.setTopic(tid, {
            status: status.value === "en_cours" ? null : status.value,
            include: follow.checked === base ? null : follow.checked,
            title: title.value.trim() || null,
            note: note.value.trim() || null,
            characters: keepManualChars ? chosen : null,
          });
        }, "btn-primary"))));
  }

  function addTopicDialog() {
    const url = h("input", { class: "field-input", type: "text", placeholder: "https://…/t176-titre-du-sujet  ou  /t176-titre" });
    const title = h("input", { class: "field-input", type: "text" });
    const status = h("select", { class: "field-input" }, Object.entries(C.statuses).map(([k, v]) => h("option", { value: k }, v)));
    const boxes = RP.allCharacters().filter((c) => c.active).map((c) => ({ c, box: h("input", { type: "checkbox" }) }));
    const err = h("p", { class: "error", hidden: true });
    openDialog("Ajouter un RP à la main", h("div", { class: "form" },
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Adresse du sujet"), url),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Titre"), title),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Statut"), status),
      h("fieldset", { class: "field" }, h("legend", { class: "field-label" }, "Personnages"),
        h("div", { class: "check-grid" }, boxes.map(({ c, box }) => h("label", { class: "field-check" }, box, h("span", {}, c.name))))),
      err,
      h("p", { class: "hint" }, "Le sujet sera lu à la prochaine synchronisation."),
      h("div", { class: "dialog-actions" },
        btn("Annuler", closeDialog),
        btn("Ajouter", () => {
          const msg = RP.addManualTopic({ input: url.value, title: title.value.trim(), status: status.value, characters: boxes.filter((b) => b.box.checked).map((b) => b.c.uid) });
          if (msg) { err.textContent = msg; err.hidden = false; } else closeDialog();
        }, "btn-primary"))));
  }

  // ------------------------------------------------------------------ PERSONNAGES
  function charactersView() {
    const rp = RP.rpTopics();
    const name = h("input", { class: "field-input", type: "text", placeholder: "Nom du personnage" });
    const player = h("select", { class: "field-input" }, C.players.map((p) => h("option", { value: p.key }, p.label)));
    const account = h("input", { class: "field-input", type: "text", placeholder: "Compte Forumactif (facultatif)" });
    const aliases = h("input", { class: "field-input", type: "text", placeholder: "Alias, séparés par des virgules" });
    const split = (s) => s.split(",").map((a) => a.trim()).filter(Boolean);

    const add = section("Ajouter un personnage",
      h("div", { class: "filters" }, name, player, account, aliases,
        btn("Ajouter", () => { if (name.value.trim()) RP.addCharacter({ name: name.value.trim(), player: player.value, account_name: account.value.trim(), aliases: split(aliases.value) }); }, "btn-primary")),
      h("p", { class: "hint" }, "Les comptes des groupes 3 et 4 sont ajoutés automatiquement ; ceci sert pour un personnage qui n’y figure pas."));

    const rows = RP.allCharacters().map((c) => {
      const n = rp.filter((x) => x.chars.includes(c.uid)).length;
      return h("tr", { class: c.active ? "" : "row-off" },
        h("td", {}, h("input", { class: "field-input", type: "text", value: c.name, "aria-label": "Nom", onchange: (e) => RP.setChar(c.uid, { name: e.target.value.trim() === ((S.forum.members[c.uid] || {}).name || "") ? null : e.target.value.trim() }, false) })),
        h("td", { class: "sub" }, c.account || (c.manual ? "ajouté à la main" : `#${c.uid}`)),
        h("td", {}, h("select", { class: "field-input", value: (S.manual.characters[c.uid] || {}).player || "", "aria-label": "Joueuse", onchange: (e) => RP.setChar(c.uid, { player: e.target.value || null }, false) },
          h("option", { value: "" }, c.player && !(S.manual.characters[c.uid] || {}).player ? `${RP.playerLabel(c.player)} (groupe)` : "—"),
          C.players.map((p) => h("option", { value: p.key }, p.label)))),
        h("td", {}, h("input", { class: "field-input", type: "text", value: c.aliases.join(", "), "aria-label": "Alias", placeholder: "alias…", onchange: (e) => RP.setChar(c.uid, { aliases: split(e.target.value) }, false) })),
        h("td", { class: "cell-num" }, n),
        h("td", {}, h("label", { class: "field-check" }, h("input", { type: "checkbox", checked: c.active, onchange: (e) => RP.setChar(c.uid, { active: e.target.checked ? null : false }) }), h("span", {}, "Actif"))));
    });

    return [h("h2", { class: "page-title" }, "Personnages"), add,
      section("Tous les personnages",
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, ["Nom affiché", "Compte", "Joueuse", "Alias", "RP", ""].map((t) => h("th", {}, t)))),
          h("tbody", {}, rows))),
        h("p", { class: "hint" }, "Un alias sert à reconnaître un personnage cité dans un titre (ex. « Fleur »). Désactiver un personnage ne supprime rien."))];
  }

  // ------------------------------------------------------------------ CATEGORIES
  function categoriesView() {
    const id = h("input", { class: "field-input", type: "text", inputmode: "numeric", placeholder: "Numéro du forum (ex. 12)" });
    const nm = h("input", { class: "field-input", type: "text", placeholder: "Nom (facultatif)" });
    const isRp = h("select", { class: "field-input" }, h("option", { value: "1" }, "C’est du RP"), h("option", { value: "0" }, "Ce n’est pas du RP"));

    const add = section("Ajouter une catégorie",
      h("div", { class: "filters" }, id, nm, isRp,
        btn("Ajouter", () => { const v = id.value.trim().replace(/^f/i, ""); if (/^\d+$/.test(v)) RP.addForum(v, nm.value.trim(), isRp.value === "1"); }, "btn-primary")),
      h("p", { class: "hint" }, "Le numéro est celui de l’adresse du forum : dans /f12-nom, c’est 12. Les sujets où vos personnages ont posté seront rangés automatiquement à la prochaine synchronisation."));

    const autoOf = (id) => {
      const t = Object.values(S.forum.topics).find((t) => String(t.forum_id) === id);
      return t ? !!t.auto_rp : null;
    };
    const rows = RP.forums().map((f) => {
      const rule = S.manual.forum_rules[f.id];
      const auto = autoOf(f.id);
      return h("tr", {},
        h("td", {}, f.name || h("span", { class: "sub" }, "(sans nom)"), h("div", { class: "sub" }, f.category || "")),
        h("td", { class: "cell-num" }, `#${f.id}`),
        h("td", { class: "cell-num" }, `${f.rp} / ${f.total}`),
        h("td", { class: "sub" }, auto === null ? "—" : auto ? "RP" : "hors RP"),
        h("td", {}, h("select", { class: "field-input", value: rule === undefined ? "" : rule ? "1" : "0", "aria-label": "Règle", onchange: (e) => RP.setForumRule(f.id, e.target.value === "" ? null : e.target.value === "1") },
          h("option", { value: "" }, "Automatique"), h("option", { value: "1" }, "Toujours du RP"), h("option", { value: "0" }, "Jamais du RP"))));
    });

    const off = ui.off;
    const offBox = h("div", {});
    const drawOff = () => {
      const items = RP.topics((x) => !x.rp && (!off.q || norm(x.title).includes(norm(off.q)))).sort(RP.byRecent).slice(0, 40);
      offBox.replaceChildren(items.length
        ? h("ul", { class: "list" }, items.map((x) => h("li", { class: "item" },
            h("div", { class: "item-main" }, h("div", { class: "item-title" }, topicLink(x)), h("div", { class: "item-meta" }, x.t.forum || "forum inconnu")),
            h("div", { class: "item-actions" }, btn("Suivre comme RP", () => RP.setTopic(x.tid, { include: true }), "btn-small")))))
        : empty("Aucun sujet hors RP."));
    };
    drawOff();

    return [h("h2", { class: "page-title" }, "Catégories"), add,
      section("Forums connus",
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, ["Forum", "N°", "RP / total", "Détection", "Règle"].map((t) => h("th", {}, t)))),
          h("tbody", {}, rows)))),
      section("Sujets hors RP",
        h("input", { class: "field-input", type: "search", placeholder: "Rechercher…", value: off.q, oninput: (e) => { off.q = e.target.value; drawOff(); } }),
        offBox, h("p", { class: "hint" }, "Les 40 plus récents. Pour exclure ou inclure tout un forum, utilisez la règle ci-dessus."))];
  }

  // ------------------------------------------------------------------ ARCHIVES
  function archivesView() {
    const f = ui.arch;
    const box = h("div", {});
    const draw = () => {
      const items = RP.rpTopics().filter((x) => x.status === "archive")
        .filter((x) => !f.q || norm([x.title, ...x.chars.map(RP.charName)].join(" ")).includes(norm(f.q)))
        .filter((x) => !f.char || x.chars.includes(f.char))
        .sort(RP.byRecent);
      box.replaceChildren(items.length
        ? h("ul", { class: "list" }, items.map((x) => {
            const by = x.replacedBy && S.forum.topics[x.replacedBy] ? RP.enrich(x.replacedBy) : null;
            return h("li", { class: "item" },
              h("div", { class: "item-main" },
                h("div", { class: "item-title" }, topicLink(x)), chips(x),
                h("div", { class: "item-meta" }, `Créé le ${RP.fmtDate(x.created)} · dernier message le ${RP.fmtDate(x.last)} · ${x.count || "?"} messages`),
                by ? h("div", { class: "item-meta" }, "Remplacé par ", topicLink(by)) : null),
              h("div", { class: "item-actions" }, btn("Restaurer", () => RP.restore(x.tid), "btn-small"), btn("Modifier", () => editTopic(x.tid), "btn-small")));
          }))
        : empty("Aucun RP archivé."), h("p", { class: "count" }, `${items.length} RP archivé(s)`));
    };
    draw();
    return [h("h2", { class: "page-title" }, "Archives"),
      h("div", { class: "filters" },
        h("input", { class: "field-input", type: "search", placeholder: "Rechercher…", value: f.q, oninput: (e) => { f.q = e.target.value; draw(); } }),
        charSelect(f.char, (e) => { f.char = e.target.value; draw(); })),
      box];
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
          h("li", {}, "« Permissions » → Contents : Read and write (lecture seule suffit pour regarder, l’écriture servira à enregistrer vos corrections)."),
          h("li", {}, "Collez le jeton ici. Il reste dans ce navigateur uniquement ; chaque appareil a besoin du sien.")),
        h("p", { class: "hint" }, "Sans jeton, vous pouvez aussi ouvrir les fichiers à la main :"),
        btn("Ouvrir forum.json, manual.json, status.json…", () => files.click(), "btn-small"), files));
  }

  function settingsView() {
    const st = S.status;
    const out = [h("h2", { class: "page-title" }, "Paramètres")];
    if (st) {
      out.push(section("Dernière synchronisation",
        h("p", {}, st.ok ? badge("Réussie", "ok") : badge("Avec erreurs", "flag"), ` ${RP.fmtUtc(st.last_run)}`),
        st.topics_rp !== undefined ? h("p", { class: "sub" }, `${st.topics_rp} RP suivis · ${st.topics_read} lus · ${st.topics_with_new_reply} avec nouvelle réponse`) : null,
        S.forum.meta && S.forum.meta.last_discovery ? h("p", { class: "sub" }, `Dernière recherche de nouveaux sujets : ${RP.fmtUtc(S.forum.meta.last_discovery)}`) : null,
        (st.errors || []).length ? h("ul", { class: "flag-list" }, st.errors.map((e) => h("li", {}, `${e.where} : ${e.what}`))) : h("p", { class: "sub" }, "Aucune erreur.")));
    }
    out.push(sourceForm());
    if (S.manual) {
      out.push(section("Vos corrections",
        h("p", {}, S.dirty ? `${S.dirty} modification(s) pas encore enregistrée(s).` : "Aucune modification en attente."),
        btn("Télécharger manual.json", RP.downloadManual, "btn-primary")));
    }
    out.push(section("Apparence", h("p", {}, "Tout l’aspect se règle dans ", h("code", {}, "docs/css/theme.css"), " : couleurs et polices en haut du fichier (variables), puis tableaux, menus, étiquettes et animations. Ce fichier n’influence jamais le fonctionnement.")));
    return out;
  }

  RP.views = { dashboard, rp: rpView, characters: charactersView, categories: categoriesView, archives: archivesView, settings: settingsView };
  RP.h = h; RP.btn = btn;
  RP.sourceForm = sourceForm;
})();
