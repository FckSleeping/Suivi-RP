// Donnees et logique (aucun affichage ici).
(function () {
  const C = window.RP_CONFIG;
  const RP = (window.RP = window.RP || {});

  const SETTINGS_KEY = "rp-settings"; // depot + jeton : uniquement dans CE navigateur
  const state = (RP.state = { forum: null, manual: null, status: null, source: "", dirty: 0, error: "" });
  const listeners = [];
  RP.onChange = (fn) => listeners.push(fn);
  const emit = () => listeners.forEach((f) => f());

  const FLAG_LABELS = {
    auteur_inconnu: "Auteur du dernier message introuvable",
    date_illisible: "Date du dernier message illisible",
    creation_inconnue: "Date de création inconnue",
    un_seul_camp: "Les personnages ne couvrent pas les deux joueuses",
    erreur_lecture: "Erreur à la dernière lecture du sujet",
    jamais_lu: "Sujet pas encore lu",
  };
  RP.flagLabel = (f) => FLAG_LABELS[f] || f;

  // ------------------------------------------------------------------ outils
  const norm = (s) =>
    (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  RP.norm = norm;

  const emptyManual = () => ({ schema: 1, characters: {}, topics: {}, forum_rules: {}, forum_names: {}, replacements: {}, seen: {} });

  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      return Object.keys(v).sort().reduce((o, k) => ((o[k] = sortKeys(v[k])), o), {});
    }
    return v;
  }

  // "2026-10-17T19:47" -> millisecondes (heure de Paris lue comme une heure « sans fuseau »)
  function ms(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || "");
    return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null;
  }
  RP.ms = ms;
  function nowParisMs() {
    const s = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Paris" }); // "2026-10-17 19:47:12"
    return ms(s.replace(" ", "T"));
  }
  RP.fmtDate = (iso) => {
    const t = ms(iso);
    if (t === null) return "—";
    return new Date(t).toLocaleString("fr-FR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
  RP.daysAgo = (iso) => {
    const t = ms(iso);
    return t === null ? Infinity : (nowParisMs() - t) / 86400000;
  };
  RP.fmtUtc = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "medium", timeStyle: "short" }) : "—";
  };

  // ------------------------------------------------------------------ reglages (depot + jeton)
  RP.getSettings = () => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
  };
  RP.saveSettings = (s) => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* stockage indisponible */ }
  };

  // ------------------------------------------------------------------ chargement
  async function fetchRelative() {
    const get = async (n) => {
      const r = await fetch(`${C.dataPath}/${n}.json`, { cache: "no-store" });
      if (!r.ok) throw new Error(`${n}.json : HTTP ${r.status}`);
      return r.json();
    };
    const forum = await get("forum");
    const manual = await get("manual").catch(() => emptyManual());
    const status = await get("status").catch(() => null);
    return { forum, manual, status, source: "Fichiers locaux" };
  }

  async function fetchGitHub(s) {
    const get = async (n, optional) => {
      const url = `https://api.github.com/repos/${s.repo}/contents/data/${n}.json?ref=${encodeURIComponent(s.branch || C.branch)}`;
      const r = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/vnd.github.raw+json", Authorization: `Bearer ${s.token}`, "X-GitHub-Api-Version": "2022-11-28" },
      });
      if (r.status === 401 || r.status === 403) throw new Error("Jeton refusé ou sans droit de lecture sur ce dépôt.");
      if (r.status === 404 && optional) return null;
      if (r.status === 404) throw new Error(`${n}.json introuvable (dépôt mal écrit, ou synchronisation jamais lancée ?).`);
      if (!r.ok) throw new Error(`GitHub a répondu HTTP ${r.status} pour ${n}.json.`);
      return r.json();
    };
    const [forum, manual, status] = await Promise.all([get("forum"), get("manual", true), get("status", true)]);
    return { forum, manual: manual || emptyManual(), status, source: `GitHub (${s.repo})` };
  }

  function readFiles(files) {
    const out = {};
    return Promise.all(
      [...files].map((f) =>
        f.text().then((t) => {
          const n = f.name.replace(/\.json$/i, "");
          out[n] = JSON.parse(t);
        })
      )
    ).then(() => {
      if (!out.forum) throw new Error("Il faut au moins forum.json.");
      return { forum: out.forum, manual: out.manual || emptyManual(), status: out.status || null, source: "Fichiers ouverts à la main" };
    });
  }

  function apply(d) {
    d.manual = Object.assign(emptyManual(), d.manual);
    ["characters", "topics", "forum_rules", "forum_names", "replacements", "seen"].forEach((k) => (d.manual[k] = d.manual[k] || {}));
    Object.assign(state, { forum: d.forum, manual: d.manual, status: d.status, source: d.source, dirty: 0, error: "" });
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

  // ------------------------------------------------------------------ personnages
  RP.players = C.players;
  RP.playerLabel = (key) => (C.players.find((p) => p.key === key) || {}).label || key || "?";
  RP.playerOfGroup = (g) => (C.players.find((p) => p.group === g) || {}).key || null;

  RP.charName = (uid) => (state.manual.characters[uid] || {}).name || (state.forum.members[uid] || {}).name || `compte #${uid}`;
  RP.charPlayer = (uid) => (state.manual.characters[uid] || {}).player || RP.playerOfGroup((state.forum.members[uid] || {}).group);

  RP.allCharacters = () => {
    const ids = new Set([...Object.keys(state.forum.members), ...Object.keys(state.manual.characters)]);
    Object.values(state.forum.topics).forEach((t) => (t.characters || []).forEach((u) => ids.add(u)));
    return [...ids].map((uid) => {
      const mc = state.manual.characters[uid] || {};
      return {
        uid,
        name: RP.charName(uid),
        account: (state.forum.members[uid] || {}).name || mc.account_name || "",
        player: RP.charPlayer(uid),
        aliases: mc.aliases || [],
        active: mc.active !== false,
        manual: uid.startsWith("manuel-"),
      };
    }).sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
  };

  // ------------------------------------------------------------------ sujets
  const mt = (tid) => state.manual.topics[tid] || {};

  RP.isRp = (tid, t) => {
    const inc = mt(tid).include;
    if (inc !== undefined && inc !== null) return !!inc;
    const rule = state.manual.forum_rules[String(t.forum_id)];
    if (rule !== undefined && rule !== null) return !!rule;
    return !!t.auto_rp;
  };

  RP.effChars = (tid, t) => {
    const forced = mt(tid).characters;
    return [...(forced !== undefined ? forced : t.characters || [])];
  };

  function aliasChars(tid, t, eff) {
    const title = norm(mt(tid).title || t.title);
    const found = [];
    Object.entries(state.manual.characters).forEach(([uid, c]) => {
      if (eff.includes(uid) || c.active === false) return;
      const names = [c.name, ...(c.aliases || [])].map(norm).filter((n) => n.length >= 3);
      if (names.some((n) => title.includes(n))) found.push(uid);
    });
    return found;
  }

  function flagsFor(tid, t, eff) {
    const lp = t.last_post;
    let flags = (t.flags || []).filter((f) => f !== "un_seul_camp");
    if (lp && mt(tid).checked === lp.post_id) flags = flags.filter((f) => f === "erreur_lecture");
    const camps = new Set(eff.map(RP.charPlayer).filter(Boolean));
    if (camps.size < 2 && !(lp && mt(tid).checked === lp.post_id)) flags.push("un_seul_camp");
    return flags;
  }

  RP.enrich = (tid) => {
    const t = state.forum.topics[tid];
    const m = mt(tid);
    const eff = RP.effChars(tid, t);
    const lp = t.last_post || null;
    const author = lp && lp.author;
    const authorPlayer = author ? RP.playerOfGroup(author.group) : null;
    const status = m.status || "en_cours";
    return {
      tid, t, m, status,
      title: m.title || t.title || `Sujet ${tid}`,
      url: C.forumBase + (m.path || t.path),
      rp: RP.isRp(tid, t),
      chars: eff,
      hints: aliasChars(tid, t, eff),
      created: (t.created || {}).date || null,
      last: lp ? lp.date : null,
      lastAuthor: author,
      lastAuthorPlayer: authorPlayer,
      turn: status === "en_cours" && authorPlayer ? (C.players.find((p) => p.key !== authorPlayer) || {}).key : null,
      count: t.post_count || 0,
      flags: flagsFor(tid, t, eff),
      unseen: !!(t.last_changed && lp && state.manual.seen[tid] !== lp.post_id),
      note: m.note || "",
      replacedBy: m.replaced_by || null,
    };
  };

  RP.topics = (filter) => Object.keys(state.forum.topics).map(RP.enrich).filter(filter || (() => true));
  RP.rpTopics = () => RP.topics((x) => x.rp);
  RP.byRecent = (a, b) => (RP.ms(b.last) || 0) - (RP.ms(a.last) || 0);

  RP.suggestions = () =>
    (state.forum.suggestions || [])
      .filter((s) => !state.manual.replacements[s.key] && state.forum.topics[s.new] && state.forum.topics[s.old])
      .filter((s) => RP.enrich(s.old).status === "en_cours" && RP.enrich(s.new).status === "en_cours");

  RP.forums = () => {
    const map = {};
    const add = (id, name, cat) => {
      if (id === null || id === undefined || id === "") return;
      const f = (map[id] = map[id] || { id: String(id), name: "", category: "", total: 0, rp: 0 });
      f.name = f.name || name || "";
      f.category = f.category || cat || "";
    };
    Object.entries(state.forum.forums).forEach(([id, f]) => add(id, f.name, f.category));
    Object.keys(state.manual.forum_rules).forEach((id) => add(id));
    Object.values(state.forum.topics).forEach((t) => add(t.forum_id, t.forum, t.category));
    Object.entries(state.manual.forum_names).forEach(([id, n]) => { if (map[id]) map[id].name = n; else add(id, n); });
    RP.topics().forEach((x) => {
      const f = map[x.t.forum_id];
      if (f) { f.total++; if (x.rp) f.rp++; }
    });
    return Object.values(map).sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name));
  };

  // ------------------------------------------------------------------ modifications (vos corrections)
  const touch = (rerender = true) => { state.dirty++; emit.silent = !rerender; emit(); emit.silent = false; };
  RP.isSilent = () => !!emit.silent;

  RP.setTopic = (tid, patch) => {
    const m = (state.manual.topics[tid] = state.manual.topics[tid] || {});
    Object.entries(patch).forEach(([k, v]) => { if (v === undefined || v === null || v === "") delete m[k]; else m[k] = v; });
    if (!Object.keys(m).length) delete state.manual.topics[tid];
    touch();
  };

  RP.setChar = (uid, patch, rerender = true) => {
    const c = (state.manual.characters[uid] = state.manual.characters[uid] || {});
    Object.entries(patch).forEach(([k, v]) => { if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) delete c[k]; else c[k] = v; });
    if (!Object.keys(c).length) delete state.manual.characters[uid];
    touch(rerender);
  };

  RP.addCharacter = ({ name, player, account_name, aliases }) => {
    let i = 1;
    while (state.manual.characters[`manuel-${i}`]) i++;
    state.manual.characters[`manuel-${i}`] = { name, player, account_name, aliases: aliases || [], active: true };
    Object.keys(state.manual.characters[`manuel-${i}`]).forEach((k) => { const v = state.manual.characters[`manuel-${i}`][k]; if (!v || (Array.isArray(v) && !v.length)) delete state.manual.characters[`manuel-${i}`][k]; });
    touch();
  };

  RP.setForumRule = (id, val) => {
    if (val === null) delete state.manual.forum_rules[id]; else state.manual.forum_rules[id] = !!val;
    touch();
  };
  RP.addForum = (id, name, isRp) => {
    state.manual.forum_rules[id] = !!isRp;
    if (name) state.manual.forum_names[id] = name;
    touch();
  };

  RP.markSeen = (tids) => {
    tids.forEach((tid) => { const lp = state.forum.topics[tid].last_post; if (lp) state.manual.seen[tid] = lp.post_id; });
    touch();
  };

  RP.accept = (key, newTid, oldTid) => {
    state.manual.replacements[key] = { decision: "accepted", at: new Date().toISOString() };
    RP.setTopic(oldTid, { status: "archive", replaced_by: newTid });
  };
  RP.refuse = (key) => {
    state.manual.replacements[key] = { decision: "refused", at: new Date().toISOString() };
    touch();
  };
  RP.restore = (tid) => {
    Object.keys(state.manual.replacements).forEach((k) => {
      if (k.endsWith(`>${tid}`) && state.manual.replacements[k].decision === "accepted") delete state.manual.replacements[k];
    });
    RP.setTopic(tid, { status: null, replaced_by: null });
  };

  RP.addManualTopic = ({ input, title, status, characters }) => {
    const m = /\/t(\d+)/.exec(input || "");
    if (!m) return "Adresse invalide : elle doit contenir /t suivi du numéro du sujet (ex. /t176-mon-sujet).";
    let path = input.trim();
    try { path = new URL(path, "https://x.invalid").pathname; } catch (e) { /* garde tel quel */ }
    const tid = m[1];
    state.manual.topics[tid] = Object.assign(state.manual.topics[tid] || {}, { path, title: title || undefined, include: true, status: status === "en_cours" ? undefined : status, characters: characters && characters.length ? characters : undefined });
    Object.keys(state.manual.topics[tid]).forEach((k) => state.manual.topics[tid][k] === undefined && delete state.manual.topics[tid][k]);
    touch();
    return "";
  };

  RP.manualJson = () => JSON.stringify(sortKeys(state.manual), null, 1) + "\n";
  RP.downloadManual = () => {
    const url = URL.createObjectURL(new Blob([RP.manualJson()], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "manual.json" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
})();
