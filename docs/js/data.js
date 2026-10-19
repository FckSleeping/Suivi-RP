// Donnees et logique (aucun affichage ici).
(function () {
  const C = window.RP_CONFIG;
  const RP = (window.RP = window.RP || {});
  const SETTINGS_KEY = "rp-settings"; // depot + jeton : uniquement dans CE navigateur
  const state = (RP.state = { forum: null, manual: null, base: null, status: null, source: "", dirty: 0, error: "", saveStatus: "", saveError: "" });
  const listeners = [];
  RP.onChange = (fn) => listeners.push(fn);
  const emit = () => listeners.forEach((f) => f());
  let quiet = false;
  const notify = () => { quiet = true; emit(); quiet = false; }; // met a jour la barre sans redessiner la page

  const FLAG_LABELS = {
    auteur_inconnu: "Auteur du dernier message introuvable",
    date_illisible: "Date du dernier message illisible",
    erreur_lecture: "Erreur à la dernière lecture du sujet (lien incorrect ou sujet inaccessible ?)",
    jamais_lu: "Pas encore lu : lancez la synchronisation",
  };
  RP.flagLabel = (f) => FLAG_LABELS[f] || f;

  const norm = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  RP.norm = norm;
  const emptyManual = () => ({ schema: 2, characters: {}, topics: {}, ships: {}, seen: {} });

  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") return Object.keys(v).sort().reduce((o, k) => ((o[k] = sortKeys(v[k])), o), {});
    return v;
  }

  // ------------------------------------------------------------------ dates
  function ms(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || "");
    return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null;
  }
  RP.ms = ms;
  const nowParisMs = () => ms(new Date().toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).replace(" ", "T"));
  RP.fmtDate = (iso) => {
    const t = ms(iso);
    return t === null ? "—" : new Date(t).toLocaleString("fr-FR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  RP.fmtAgo = (iso) => {
    const t = ms(iso);
    if (t === null) return "";
    const min = Math.max(0, Math.round((nowParisMs() - t) / 60000));
    if (min < 60) return `il y a ${min} min`;
    if (min < 1440) return `il y a ${Math.round(min / 60)} h`;
    const d = Math.round(min / 1440);
    return d < 60 ? `il y a ${d} j` : `il y a ${Math.round(d / 30)} mois`;
  };
  RP.daysAgo = (iso) => { const t = ms(iso); return t === null ? Infinity : (nowParisMs() - t) / 86400000; };
  RP.fmtUtc = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "medium", timeStyle: "short" }) : "—";
  };

  // ------------------------------------------------------------------ reglages (depot + jeton)
  RP.getSettings = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } };
  RP.saveSettings = (s) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* stockage indisponible */ } };

  // ------------------------------------------------------------------ chargement
  async function fetchRelative() {
    const get = async (n) => {
      const r = await fetch(`${C.dataPath}/${n}.json`, { cache: "no-store" });
      if (!r.ok) throw new Error(`${n}.json : HTTP ${r.status}`);
      return r.json();
    };
    const [forum, manual, status] = await Promise.all([get("forum").catch(() => null), get("manual").catch(() => null), get("status").catch(() => null)]);
    if (!forum && !manual) throw new Error("Cette page n’est pas reliée à vos données. Remplissez le dépôt et le jeton ci-dessous (ou ouvrez le lien d’installation).");
    return { forum: forum || { topics: {} }, manual: manual || emptyManual(), status, source: "Fichiers locaux" };
  }

  async function fetchGitHub(s) {
    const get = async (n, optional) => {
      const url = `https://api.github.com/repos/${s.repo}/contents/data/${n}.json?ref=${encodeURIComponent(s.branch || C.branch)}`;
      const r = await fetch(url, { cache: "no-store", headers: { Accept: "application/vnd.github.raw+json", Authorization: `Bearer ${s.token}`, "X-GitHub-Api-Version": "2022-11-28" } });
      if (r.status === 401 || r.status === 403) throw new Error("Jeton refusé ou sans droit de lecture sur ce dépôt.");
      if (r.status === 404 && optional) return null;
      if (r.status === 404) throw new Error(`${n}.json introuvable (dépôt mal écrit ?).`);
      if (!r.ok) throw new Error(`GitHub a répondu HTTP ${r.status} pour ${n}.json.`);
      return r.json();
    };
    const [forum, manual, status] = await Promise.all([get("forum", true), get("manual", true), get("status", true)]);
    return { forum: forum || { topics: {} }, manual: manual || emptyManual(), status, source: `GitHub (${s.repo})` };
  }

  function readFiles(files) {
    const out = {};
    return Promise.all([...files].map((f) => f.text().then((t) => { out[f.name.replace(/\.json$/i, "")] = JSON.parse(t); })))
      .then(() => ({ forum: out.forum || { topics: {} }, manual: out.manual || emptyManual(), status: out.status || null, source: "Fichiers ouverts à la main" }));
  }

  function apply(d) {
    const m = Object.assign(emptyManual(), d.manual);
    ["forum_rules", "forum_names", "replacements"].forEach((k) => delete m[k]); // anciens reglages abandonnes
    ["characters", "topics", "ships", "seen"].forEach((k) => (m[k] = m[k] && typeof m[k] === "object" ? m[k] : {}));
    m.schema = 2;
    // Tolerance aux modifications faites a la main dans manual.json
    const playerKey = (v) => { const s = norm(v); const p = C.players.find((x) => norm(x.key) === s || norm(x.label) === s); return p ? p.key : v; };
    Object.keys(m.characters).forEach((id) => {
      const c = m.characters[id];
      if (!c || typeof c !== "object" || Array.isArray(c)) { delete m.characters[id]; return; }
      c.name = c.name == null ? "" : String(c.name);
      if (c.player) c.player = playerKey(c.player);
    });
    Object.keys(m.topics).forEach((id) => {
      const e = m.topics[id];
      if (!e || typeof e !== "object" || Array.isArray(e)) { delete m.topics[id]; return; }
      delete e.turn; // ancien choix manuel de l'etat : abandonne, l'etat est toujours automatique
      delete e.recap_redo; // les recaps automatiques n'existent plus
      if (!e.chars || typeof e.chars !== "object" || Array.isArray(e.chars)) delete e.chars;
      else Object.keys(e.chars).forEach((p) => { const k = playerKey(p); if (k !== p) { e.chars[k] = e.chars[p]; delete e.chars[p]; } });
    });
    d.forum.topics = d.forum.topics || {};
    Object.assign(state, { forum: d.forum, manual: m, base: JSON.parse(JSON.stringify(m)), status: d.status, source: d.source, dirty: 0, error: "", saveStatus: "", saveError: "" });
    emit();
  }

  RP.load = async function (how, files) {
    try {
      if (how === "files") return apply(await readFiles(files));
      const s = RP.getSettings();
      if (how === "github" || (!how && s.repo && s.token)) return apply(await fetchGitHub(s));
      return apply(await fetchRelative());
    } catch (e) {
      state.error = e.message || String(e);
      emit();
    }
  };

  // ------------------------------------------------------------------ joueuses et personnages
  RP.players = C.players;
  RP.playerLabel = (key) => (C.players.find((p) => p.key === key) || {}).label || key || "?";
  RP.playerOfGroup = (g) => (C.players.find((p) => p.group === g) || {}).key || null;
  // « de Fanny » / « d'Ambre » (elision devant une voyelle)
  RP.de = (label) => (/^[aeiouyàâäéèêëîïôöùûü]/i.test(label || "") ? `d’${label}` : `de ${label}`);
  RP.otherPlayer = (key) => (C.players.find((p) => p.key !== key) || {}).key || null;

  // Couleur « du forum » : la couleur de paroles la plus frequente du compte portant ce nom (relevee par la synchro)
  let acFor = null, acCache = {};
  const autoColors = () => {
    if (acFor === state.forum) return acCache;
    const tally = {};
    Object.values(state.forum.topics || {}).forEach((t) => (t.authors || []).forEach((a) => {
      if (!a.color) return;
      const k = norm(a.name);
      (tally[k] = tally[k] || {})[a.color] = ((tally[k] || {})[a.color] || 0) + 1;
    }));
    acCache = Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, Object.entries(v).sort((x, y) => y[1] - x[1])[0][0]]));
    acFor = state.forum;
    return acCache;
  };
  const fallbackColor = (name) => {
    let n = 0;
    for (const ch of norm(name)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    return C.palette[n % C.palette.length];
  };
  RP.autoColor = (c) => autoColors()[norm(c.name)] || null;
  RP.colorOf = (c) => c.color || RP.autoColor(c) || fallbackColor(c.name);

  RP.characters = () => Object.entries(state.manual.characters)
    .map(([id, c]) => ({ id, ...c, effColor: RP.colorOf(c), autoColor: RP.autoColor(c) }))
    .sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
  RP.charsOf = (player) => RP.characters().filter((c) => c.player === player);
  RP.textColor = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#fff";
    const n = parseInt(m[1], 16);
    const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return l > 0.62 ? "#2b2b2b" : "#ffffff";
  };

  // ------------------------------------------------------------------ RP
  const tidOf = (url) => { const m = /\/t(\d+)/.exec(url || ""); return m ? m[1] : null; };
  RP.tidOf = tidOf;
  RP.cleanPath = (url) => {
    let path = (url || "").trim();
    try { path = new URL(path, "https://x.invalid").pathname; } catch (e) { /* tel quel */ }
    return path.replace(/\/t(\d+)p\d+-/, "/t$1-");
  };
  const slugTitle = (url) => {
    const m = /\/t\d+(?:p\d+)?-([^/?#]+)/.exec(url || "");
    return m ? decodeURIComponent(m[1]).replace(/-/g, " ") : "";
  };

  RP.enrich = (id) => {
    const e = state.manual.topics[id];
    const tid = tidOf(e.url);
    const t = (tid && state.forum.topics[tid]) || null;
    const lp = t && t.last_post;
    const author = lp && lp.author;
    const authorPlayer = author ? RP.playerOfGroup(author.group) : null;

    // A qui le tour : l'autre joueuse que celle qui a ecrit en dernier. La synchro donne « last_player »
    // (auteur lu, sinon deduit par alternance : dans un RP a deux, la reponse suivante est forcement de l'autre).
    const lastPlayer = (t && t.last_player) || authorPlayer;
    const turn = lastPlayer ? RP.otherPlayer(lastPlayer) : null;

    // Personnage de chaque joueuse : celui que vous avez choisi, sinon deviné d'après les comptes vus dans le sujet
    const charFor = (player) => {
      const chosen = e.chars && e.chars[player];
      if (chosen && state.manual.characters[chosen]) { const ch = state.manual.characters[chosen]; return { ...ch, id: chosen, color: RP.colorOf(ch), auto: false }; }
      const group = (C.players.find((p) => p.key === player) || {}).group;
      const names = ((t && t.authors) || []).filter((a) => a.group === group).map((a) => norm(a.name));
      const found = RP.charsOf(player).find((c) => names.includes(norm(c.name)));
      return found ? { ...found, color: found.effColor, auto: true } : null;
    };

    return {
      id, e, tid, t,
      title: e.title || slugTitle(e.url) || "(sans titre)",
      url: e.url ? C.forumBase + RP.cleanPath(e.url) : "",
      order: e.order || 0,
      chars: Object.fromEntries(C.players.map((p) => [p.key, charFor(p.key)])),
      nsfw: !!e.nsfw,
      turn,
      last: lp ? lp.date : null,
      lastAuthor: author,
      lastPlayer,
      count: (t && t.post_count) || 0,
      flags: (t && t.flags) || [],
      isNew: !!(t && t.new_reply), // pose par la synchro, retire par la synchro suivante
      note: e.note || "",
      archived: !!e.archived,
      archivedAt: e.archived_at || null,
      side: !!e.side,                                 // RP « hors ship » : fait partie de l'histoire de chacun des deux personnages
      ended: e.ended || null,                         // date de fin saisie a la main (AAAA-MM-JJ)
      endDate: e.ended ? `${e.ended}T12:00` : lp ? lp.date : e.archived_at || null, // sert a classer les archives
    };
  };

  RP.allRows = () => Object.keys(state.manual.topics).map(RP.enrich).sort((a, b) => a.order - b.order);
  RP.rows = () => RP.allRows().filter((x) => !x.archived);                    // RP en cours (tableau de bord)
  RP.archivedRows = () => RP.allRows().filter((x) => x.archived)             // RP archives, du plus ancien au plus recent
    .sort((a, b) => (ms(a.endDate) || 0) - (ms(b.endDate) || 0));
  RP.byRecent = (a, b) => (ms(b.last) || 0) - (ms(a.last) || 0);

  // ------------------------------------------------------------------ modifications (vos corrections)
  const touch = (rerender = true) => { state.dirty++; quiet = !rerender; emit(); quiet = false; scheduleSave(); };
  RP.isSilent = () => quiet;
  const nextId = (prefix, obj) => { let id; do { id = prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 4); } while (obj[id]); return id; };
  const clean = (o) => { Object.keys(o).forEach((k) => { const v = o[k]; if (v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && !v.length) || (v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)) delete o[k]; }); return o; };

  // Ajout / modification d'un RP. Renvoie un message d'erreur, ou "".
  // Verifie un lien de sujet. Renvoie { error } ou { url } (url nettoyee, "" si aucun lien).
  function checkUrl(raw, selfId) {
    let url = (raw || "").trim();
    if (!url) return { url: "" };
    if (!tidOf(url)) return { error: "Ce lien ne ressemble pas à un sujet du forum : il doit contenir /t suivi du numéro (ex. …/t176-mon-sujet)." };
    url = RP.cleanPath(url);
    const dup = Object.entries(state.manual.topics).find(([k, e]) => k !== selfId && tidOf(e.url) === tidOf(url));
    if (dup) return { error: "Ce sujet est déjà dans la liste." };
    return { url };
  }
  const maxOrder = () => Math.max(0, ...Object.values(state.manual.topics).map((e) => e.order || 0));

  // Ajout / modification d'un RP (f.archived : true pour un RP termine ajoute a la main). Renvoie un message d'erreur, ou "".
  RP.saveTopic = (id, f) => {
    const chk = checkUrl(f.url, id);
    if (chk.error) return chk.error;
    if (!id) id = nextId("r", state.manual.topics);
    const prev = state.manual.topics[id] || {};
    const archived = f.archived !== undefined ? !!f.archived : !!prev.archived;
    state.manual.topics[id] = clean({
      order: prev.order || maxOrder() + 1,
      url: chk.url, title: (f.title || "").trim(), chars: clean({ ...f.chars }), nsfw: !!f.nsfw,
      note: (f.note || "").trim(),
      archived, archived_at: archived ? prev.archived_at || new Date().toISOString() : "",
      side: f.side !== undefined ? !!f.side : !!prev.side,
      ended: f.ended !== undefined ? f.ended || "" : prev.ended,
    });
    touch();
    return "";
  };

  // Archive un RP ; `replacement` ({ url, title }) cree en meme temps le RP qui le remplace (memes personnages, meme place).
  RP.archive = (id, replacement, opts = {}) => {
    const old = state.manual.topics[id];
    if (!old) return "";
    let fresh = null;
    if (replacement && (replacement.url || replacement.title)) {
      const chk = checkUrl(replacement.url, id);
      if (chk.error) return chk.error;
      if (chk.url && tidOf(chk.url) === tidOf(old.url)) return "Le nouveau lien est celui du RP archivé.";
      fresh = clean({ order: old.order, url: chk.url, title: (replacement.title || "").trim(), chars: clean({ ...(old.chars || {}) }), nsfw: !!old.nsfw, side: opts.side !== undefined ? !!opts.side : !!old.side });
    }
    old.archived = true;
    old.archived_at = new Date().toISOString();
    if (opts.side !== undefined) { if (opts.side) old.side = true; else delete old.side; }
    if (fresh) state.manual.topics[nextId("r", state.manual.topics)] = fresh;
    touch();
    return "";
  };
  RP.restore = (id) => { const e = state.manual.topics[id]; if (e) { delete e.archived; delete e.archived_at; touch(); } };

  // ------------------------------------------------------------------ ships (couple de personnages)
  // Cle d'une ship : « id personnage Fanny | id personnage Ambre ». Nom par defaut « Nom & Nom », renommable.
  RP.shipKey = (x) => RP.players.map((p) => (x.chars[p.key] ? x.chars[p.key].id : "")).join("|");
  // Les personnages d'une ship, au format { compte_joueuse: id } (pour pre-remplir un formulaire)
  RP.shipChars = (key) => Object.fromEntries(key.split("|").map((id, i) => [RP.players[i].key, id]).filter(([, id]) => id));
  RP.shipDefaultName = (key) => key.split("|").map((id) => (id && state.manual.characters[id] ? state.manual.characters[id].name : "")).filter(Boolean).join(" & ") || "Sans ship";
  RP.shipCustom = (key) => state.manual.ships[key] || {};
  RP.shipName = (key) => RP.shipCustom(key).name || RP.shipDefaultName(key);
  // Personnalise une ship : { name, color, banner, gif1, gif2 } (une valeur vide efface le champ)
  RP.setShip = (key, patch) => {
    const cur = { ...RP.shipCustom(key), ...patch };
    Object.keys(cur).forEach((k) => { if (!cur[k]) delete cur[k]; });
    if (cur.name === RP.shipDefaultName(key)) delete cur.name;
    if (Object.keys(cur).length) state.manual.ships[key] = cur; else delete state.manual.ships[key];
    touch();
  };

  // Blocs d'archives : un par ship. Un RP « hors ship » (side) apparait dans le bloc de CHACUN de ses deux personnages
  // (leur ship, ou un bloc a leur nom s'ils n'en ont pas). Dans chaque bloc, du plus ancien au plus recent.
  RP.ships = () => {
    const rows = RP.archivedRows();
    const shipKeys = new Set(rows.filter((x) => !x.side).map(RP.shipKey));
    const groups = {};
    const add = (key, x, direct) => {
      const g = (groups[key] = groups[key] || { key, items: [] });
      if (!g.items.some((i) => i.x.id === x.id)) g.items.push({ x, direct });
    };
    rows.filter((x) => !x.side).forEach((x) => add(RP.shipKey(x), x, true));
    rows.filter((x) => x.side).forEach((x) => {
      RP.players.forEach((p, i) => {
        const id = x.chars[p.key] ? x.chars[p.key].id : "";
        if (!id) return;
        const homes = [...shipKeys].filter((k) => k.split("|")[i] === id);
        if (homes.length) homes.forEach((k) => add(k, x, false));
        else add(RP.players.map((_, j) => (j === i ? id : "")).join("|"), x, false);
      });
    });
    return Object.values(groups).map((g) => ({
      ...g, items: g.items.sort((a, b) => (ms(a.x.endDate) || 0) - (ms(b.x.endDate) || 0)),
      name: RP.shipName(g.key), defaultName: RP.shipDefaultName(g.key), custom: RP.shipCustom(g.key),
    })).sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
  };

  RP.deleteTopic = (id) => { delete state.manual.topics[id]; touch(); };

  RP.addCharacters = (names, player) => {
    names.forEach((name) => { state.manual.characters[nextId("c", state.manual.characters)] = { name, player }; });
    touch();
  };
  RP.setChar = (id, patch, rerender = true) => {
    Object.entries(patch).forEach(([k, v]) => { if (v === null || v === undefined || v === "") delete state.manual.characters[id][k]; else state.manual.characters[id][k] = v; });
    touch(rerender);
  };
  // Modifie plusieurs personnages d'un coup (une seule sauvegarde)
  RP.bulkChars = (mutator) => { mutator(state.manual.characters); touch(); };
  // Abandonne les couleurs choisies a la main quand le forum en donne une
  RP.resetColors = () => {
    Object.values(state.manual.characters).forEach((c) => { if (c.color && RP.autoColor(c)) delete c.color; });
    touch();
  };
  RP.deleteChar = (id) => {
    delete state.manual.characters[id];
    Object.values(state.manual.topics).forEach((e) => {
      Object.keys(e.chars || {}).forEach((p) => { if (e.chars[p] === id) delete e.chars[p]; });
      if (e.chars && !Object.keys(e.chars).length) delete e.chars;
    });
    touch();
  };


  // ------------------------------------------------------------------ enregistrement direct dans le depot
  const manualText = (m) => JSON.stringify(sortKeys(m), null, 1) + "\n";
  const b64enc = (str) => { const b = new TextEncoder().encode(str); let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(s); };
  const b64dec = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
  const gh = (s, path, opts = {}) => fetch(`https://api.github.com/repos/${s.repo}/contents/${path}`, {
    cache: "no-store", ...opts,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${s.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
  });

  // Fusion a 3 : on part de la version du depot (peut-etre modifiee par l'autre joueuse entre-temps)
  // et on y applique uniquement CE QUE VOUS avez change depuis votre chargement.
  function merge3(base, local, remote) {
    const out = JSON.parse(JSON.stringify(remote));
    out.schema = 2;
    ["characters", "topics", "ships", "seen"].forEach((col) => {
      const b = base[col] || {}, l = local[col] || {}, r = (out[col] = out[col] || {});
      new Set([...Object.keys(b), ...Object.keys(l)]).forEach((k) => {
        if (JSON.stringify(l[k]) !== JSON.stringify(b[k])) { if (l[k] === undefined) delete r[k]; else r[k] = l[k]; }
      });
    });
    return out;
  }
  RP.merge3 = merge3;

  let saveTimer = null, saving = false;
  RP.canSave = () => /^GitHub/.test(state.source || "");
  function scheduleSave() {
    if (!RP.canSave()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => RP.save(), 1500);
  }

  RP.save = async function () {
    clearTimeout(saveTimer);
    if (!RP.canSave() || !state.dirty || saving) return;
    saving = true; state.saveStatus = "saving"; state.saveError = ""; notify();
    const s = RP.getSettings(), branch = s.branch || C.branch;
    const mark = state.dirty, local = JSON.parse(JSON.stringify(state.manual));
    let failed = false;
    try {
      let merged = null;
      for (let attempt = 0; attempt < 3 && !merged; attempt++) {
        const r = await gh(s, `data/manual.json?ref=${encodeURIComponent(branch)}`);
        let remote = emptyManual(), sha;
        if (r.status === 401 || r.status === 403) throw new Error("jeton refusé.");
        if (r.ok) { const j = await r.json(); sha = j.sha; remote = Object.assign(emptyManual(), JSON.parse(b64dec(j.content))); }
        else if (r.status !== 404) throw new Error(`GitHub a répondu HTTP ${r.status}.`);
        const next = merge3(state.base, local, remote);
        const put = await gh(s, "data/manual.json", { method: "PUT", body: JSON.stringify({ message: "Mise à jour de la liste (depuis la page)", content: b64enc(manualText(next)), branch, ...(sha ? { sha } : {}) }) });
        if (put.ok) merged = next;
        else if (put.status === 409 || put.status === 422) continue; // quelqu'un a enregistré entre-temps : on recommence
        else if (put.status === 401 || put.status === 403 || put.status === 404) throw new Error("le jeton n’a pas le droit d’écrire dans ce dépôt (il faut « Contents : Read and write »).");
        else throw new Error(`GitHub a répondu HTTP ${put.status}.`);
      }
      if (!merged) throw new Error("conflit répété avec un autre enregistrement, réessayez.");
      state.base = JSON.parse(JSON.stringify(merged));
      state.dirty = Math.max(0, state.dirty - mark);
      state.saveStatus = "saved";
      if (!state.dirty && JSON.stringify(merged) !== JSON.stringify(local)) { state.manual = merged; saving = false; emit(); } // l'autre joueuse avait modifie quelque chose
      else notify();
      setTimeout(() => { if (state.saveStatus === "saved") { state.saveStatus = ""; notify(); } }, 2500);
    } catch (e) {
      failed = true;
      state.saveStatus = "error"; state.saveError = e.message || String(e); notify();
    } finally {
      saving = false;
    }
    if (!failed && state.dirty) scheduleSave(); // des modifications sont arrivees pendant l'enregistrement
  };

  RP.manualJson = () => manualText(state.manual);
  RP.downloadManual = () => {
    const url = URL.createObjectURL(new Blob([RP.manualJson()], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "manual.json" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
})();
