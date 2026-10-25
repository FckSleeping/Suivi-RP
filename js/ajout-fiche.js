/* ==========================================================================
   ajout-fiche.js — pop-up « Nouvelle fiche »
   - Les fiches ajoutées sont stockées dans data/fiches.json (une entrée = un personnage)
   - Au chargement, elles sont rendues avec le même gabarit HTML que tes fiches d'origine
   - À l'enregistrement : commit direct sur GitHub (jeton) ou, à défaut, téléchargement du JSON
   ========================================================================== */
(function (root) {
  'use strict';

  /* ---------- Réglages ---------- */
  var DATA_URL  = 'data/fiches.json';
  var CFG_KEY   = 'fiches_github_cfg';
  var ICONES    = ['alternate', 'ana', 'timelimit', 'mantika', 'settimocielo'];

  // Les 12 lignes du bloc « about », dans l'ordre d'origine.
  // precision : texte entre parenthèses affiché en petit (null = pas de précision pour cette ligne)
  var CHAMPS = [
    { label: 'NOM COMPLET',       precision: 'origine' },
    { label: 'OCCUPATION',        precision: null },
    { label: 'LIEU DE NAISSANCE', precision: 'pays' },
    { label: 'DATE DE NAISSANCE', precision: 'âge' },
    { label: 'GENRE',             precision: 'pronoms' },
    { label: 'OR. SEXUELLE',      precision: null },
    { label: 'FACECLAIM',         precision: 'œuvre' },
    { label: 'FACECLAIM IRL',     precision: null },
    { label: 'VOIX',              precision: null },
    { label: 'COULEUR',           precision: null },
    { label: 'ZODIAQUE',          precision: null },
    { label: 'PARFUM',            precision: null }
  ];
  var IDX_COULEUR = 9;
  var COULEURS_DEFAUT = ['#ffd9e6', '#c74c7d'];

  /* ---------- Fonctions pures (testables hors navigateur) ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Mini-balisage : **gras**  *italique*  __souligné__  ~~barré~~  ||flou au survol||
  function fmt(s) {
    return esc(s)
      .replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*]+?)\*/g, '<i>$1</i>')
      .replace(/__([^_]+?)__/g, '<u>$1</u>')
      .replace(/~~([^~]+?)~~/g, '<strike>$1</strike>')
      .replace(/\|\|([^|]+?)\|\|/g, '<tw>$1</tw>');
  }

  function safeUrl(u) {
    u = String(u || '').trim();
    return /^https?:\/\//i.test(u) ? esc(u) : '';
  }

  function slug(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function okColor(c, def) {
    return /^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : def;
  }

  function lignes(txt) {
    return String(txt || '').split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
  }

  function aUnPartenaire(f) {
    var p = f.partenaire;
    return !!(p && ((p.nom || '').trim() || safeUrl(p.gif)));
  }

  // Produit exactement le gabarit des fiches d'origine.
  function renderFiche(f) {
    var nom    = esc((f.nom || f.id || '').trim());
    var icone  = ICONES.indexOf(f.icone) >= 0 ? f.icone : 'alternate';
    var ban    = safeUrl(f.banniere);
    var av     = safeUrl(f.avatar);
    var c      = f.couleurs || [];
    var c1     = okColor(c[0], COULEURS_DEFAUT[0]);
    var c2     = okColor(c[1], COULEURS_DEFAUT[1]);
    var grad   = 'radial-gradient(ellipse farthest-corner at center top, ' + c1 + ', ' + c2 + ')';
    var fond   = 'linear-gradient(rgba(0,0,0,0.85), rgba(0,0,0,0.85)), ' + grad;
    var ship   = aUnPartenaire(f);

    var anec = (f.anecdotes || []).map(function (a) { return String(a).trim(); }).filter(Boolean)
      .map(fmt).join(' <b>✧</b> ');

    var mood = (f.aesthetic || []).map(safeUrl).filter(Boolean)
      .map(function (u) { return ' <img src="' + u + '">'; }).join('\n');

    var rows = CHAMPS.map(function (ch, i) {
      var r = (f.about && f.about[i]) || {};
      var v = String(r.valeur || '').trim() || 'réponse';
      var p = String(r.precision || '').trim();
      return '<div><div class="ask"><span>' + ch.label + '</span></div> <div class="ans">' + fmt(v) +
             (p ? '<span class="small">(' + fmt(p) + ')</span>' : '') + '</div></div>';
    }).join('\n');

    var histoire = (f.histoire || []).map(function (p) { return String(p).trim(); }).filter(Boolean)
      .map(function (p) { return '<div>' + fmt(p) + '</div>'; }).join('\n');

    var part = f.partenaire || {};
    var shipHtml =
      '<div class="ship" style="display: ' + (ship ? 'block' : 'none') + ';">\n' +
      '  <span>IMPORTANT PERSON</span>\n' +
      '  <div class="gif"><div class="partner">' + esc((part.nom || '').trim()) + '</div>' +
        (safeUrl(part.gif) ? '<img src="' + safeUrl(part.gif) + '">' : '') + '\n' +
      '<span class="material-icons">favorite</span>\n' +
      '  </div>\n' +
      '</div>';

    return '<div class="container' + (ship ? '' : ' no-ship') + '" id="' + esc(f.id) + '" style="--lateral: ' + grad +
      '; background-image: ' + fond + '; background-blend-mode: color;">' +
      '<cir1></cir1><cir2></cir2><cir3></cir3><cir4></cir4>' +
      '<div class="header">\n' +
      '  <div class="' + icone + '"></div>\n' +
      '  <div class="name">✧ ' + nom + '<div>✧ ' + nom + '</div></div>\n' +
      '  <div class="gif">' + (ban ? '<img src="' + ban + '">' : '') + '</div>\n' +
      '</div>\n' +
      '<div id="one">\n' +
      '  <div class="avatar">' + (av ? '<img src="' + av + '">' : '') + '</div>\n' +
      '  <div class="status"><div class="anecdotes"><h1 style="width: 250px;"><span>ANECDOTES</span></h1></div>\n' +
      '    <div class="update" style="height: 190px; width: 248px;">\n' +
      '      <span>' + anec + '</span>\n' +
      '    </div></div>\n' +
      '</div>\n' +
      '<div id="two">\n' +
      '  <div class="scl"><div class="photos"><h1><span>AESTHETIC</span></h1>\n' +
      '  <div class="mood">\n' + mood + '\n  </div></div></div>\n' +
      '  <div class="basic"><h1>about</h1>\n' +
      '    <div class="info">\n' + rows + '\n    </div>\n' +
      '  </div>\n' +
      '</div>\n' +
      '<div id="three">\n' +
      '  <div class="status"><h1><span>STORY</span></h1>\n' +
      '    <div class="update" style="height: ' + (ship ? '405px' : '624px') + ';">\n' + histoire + '\n    </div></div>\n' +
      shipHtml + '\n' +
      '</div>\n' +
      '</div>';
  }

  var API = {
    esc: esc, fmt: fmt, safeUrl: safeUrl, slug: slug, lignes: lignes,
    renderFiche: renderFiche, CHAMPS: CHAMPS, ICONES: ICONES
  };

  if (typeof document === 'undefined') {            // exécution sous Node (tests)
    if (typeof module !== 'undefined') module.exports = API;
    return;
  }

  /* ======================================================================
     Partie navigateur
     ====================================================================== */
  var fichesDonnees = [];          // contenu courant de data/fiches.json
  var modalConstruit = false;
  var couleurTouchee = false;
  var idEdition = '';              // identifiant de la fiche modifiée ('' = nouvelle fiche)
  var IDS_RESERVES = ['one', 'two', 'three', 'fiches', 'lightbox', 'videozoom_lightbox'];

  function $(id) { return document.getElementById(id); }
  function stockageLire(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function stockageEcrire(k, v) { try { root.localStorage.setItem(k, v); } catch (e) { /* ignoré */ } }

  function lireConfig() {
    var cfg = {};
    try { cfg = JSON.parse(stockageLire(CFG_KEY) || '{}') || {}; } catch (e) { cfg = {}; }
    // Valeurs devinées depuis l'adresse (monpseudo.github.io/mon-depot/)
    var h = root.location.hostname, seg = root.location.pathname.split('/').filter(Boolean)[0] || '';
    if (/\.github\.io$/i.test(h)) {
      cfg.owner = cfg.owner || h.split('.')[0];
      cfg.repo  = cfg.repo  || seg;
    }
    cfg.branch = cfg.branch || 'main';
    cfg.dir    = cfg.dir == null ? '' : cfg.dir;
    cfg.clicDroit = cfg.clicDroit == null ? !!cfg.token : !!cfg.clicDroit;
    return cfg;
  }

  /* ---------- Rendu dans la page (remplace la fiche si elle existe déjà) ---------- */
  function afficherFiche(f) {
    if (!f || !f.id) return null;
    var tpl = document.createElement('template');
    tpl.innerHTML = renderFiche(f).trim();
    var carte = tpl.content.firstElementChild;
    var ancienne = $(f.id);
    if (ancienne && ancienne.classList.contains('container')) {
      ancienne.parentNode.replaceChild(carte, ancienne);
    } else if (!ancienne) {
      var conteneur = $('fiches') || document.querySelector('grocontainer');
      var existantes = conteneur.querySelectorAll('.container');
      var ref = null;
      for (var i = 0; i < existantes.length; i++) {                     // ordre alphabétique
        if (existantes[i].id.localeCompare(f.id, 'fr') > 0) { ref = existantes[i]; break; }
      }
      var br1 = document.createElement('br'), br2 = document.createElement('br');
      if (ref) {
        ref.parentNode.insertBefore(carte, ref);
        ref.parentNode.insertBefore(br1, ref);
        ref.parentNode.insertBefore(br2, ref);
      } else {
        conteneur.appendChild(carte); conteneur.appendChild(br1); conteneur.appendChild(br2);
      }
    } else { return null; }
    if (root.setupImageGallery) root.setupImageGallery();               // lightbox des images « aesthetic »
    return carte;
  }

  /* ---------- Lecture d'une fiche déjà présente dans la page (pour la modifier) ---------- */
  function propre(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  function marq(n) {                                   // HTML -> mini-balisage (**gras** *italique* …)
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType !== 1) return '';
    var inner = marqEnfants(n);
    var w = { b: '**', strong: '**', i: '*', em: '*', u: '__', strike: '~~', s: '~~', del: '~~', tw: '||' }[n.tagName.toLowerCase()];
    return (w && inner.trim()) ? w + inner + w : inner;
  }
  function marqEnfants(el, sauf) {
    var out = '';
    for (var n = el.firstChild; n; n = n.nextSibling) if (n !== sauf) out += marq(n);
    return out;
  }

  function decouperHaut(txt) {                         // découpe sur les virgules hors parenthèses
    var out = [], prof = 0, cur = '';
    for (var i = 0; i < txt.length; i++) {
      var ch = txt[i];
      if (ch === '(') prof++;
      if (ch === ')') prof--;
      if (ch === ',' && prof === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function versHex(c, def) {                           // « darkorange », rgb(…) -> #rrggbb
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    try {
      var ctx = document.createElement('canvas').getContext('2d');
      ctx.fillStyle = '#000000'; ctx.fillStyle = c;
      var r = ctx.fillStyle;
      if (/^#[0-9a-f]{6}$/i.test(r)) return r;
      var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(r);
      if (m) return '#' + [1, 2, 3].map(function (k) { return ('0' + (+m[k]).toString(16)).slice(-2); }).join('');
    } catch (e) { /* défaut */ }
    return def;
  }

  function couleursDe(carte) {
    var v = (root.getComputedStyle(carte).getPropertyValue('--lateral') || '').trim();
    var a = v.indexOf('('), b = v.lastIndexOf(')');
    if (a < 0 || b < a) return COULEURS_DEFAUT.slice();
    var parts = decouperHaut(v.slice(a + 1, b));
    if (parts.length < 2) return COULEURS_DEFAUT.slice();
    return [versHex(parts[parts.length - 2], COULEURS_DEFAUT[0]), versHex(parts[parts.length - 1], COULEURS_DEFAUT[1])];
  }

  function extraireFiche(carte) {
    var q = function (sel) { return carte.querySelector(sel); };
    var imgSrc = function (sel) { var im = q(sel); return im ? (im.getAttribute('src') || '') : ''; };
    var hdr = q('.header'), nomEl = hdr.querySelector('.name');
    var nom = propre(nomEl && nomEl.firstChild ? nomEl.firstChild.nodeValue : carte.id).replace(/^✧\s*/, '');
    var icone = hdr.firstElementChild ? hdr.firstElementChild.className : 'alternate';

    var anec = [], cur = '', span = q('#one .update > span');
    if (span) {
      for (var n = span.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 1 && n.tagName.toLowerCase() === 'b' && n.textContent.trim() === '✧') { anec.push(propre(cur)); cur = ''; }
        else cur += marq(n);
      }
      anec.push(propre(cur));
    }

    var about = Array.prototype.map.call(carte.querySelectorAll('.info > div'), function (row) {
      var ans = row.querySelector('.ans'), sm = ans ? ans.querySelector('.small') : null;
      var v = ans ? propre(marqEnfants(ans, sm)) : '';
      var p = sm ? propre(sm.textContent).replace(/^\(\s*/, '').replace(/\s*\)$/, '') : '';
      return { valeur: v === 'réponse' ? '' : v, precision: p === 'réponse' ? '' : p };
    });

    var histoire = Array.prototype.map.call(carte.querySelectorAll('#three .status .update > div'), function (d) {
      return propre(marqEnfants(d));
    });

    var ship = q('.ship'), visible = ship && root.getComputedStyle(ship).display !== 'none';
    var part = { nom: '', gif: '' };
    if (visible) {
      var pn = ship.querySelector('.partner'), pg = ship.querySelector('img');
      part = { nom: pn ? propre(pn.textContent) : '', gif: pg ? (pg.getAttribute('src') || '') : '' };
    }

    return {
      id: carte.id, nom: nom, icone: icone,
      banniere: imgSrc('.header .gif img'), avatar: imgSrc('.avatar img'),
      couleurs: couleursDe(carte),
      about: about,
      anecdotes: anec.filter(Boolean),
      aesthetic: Array.prototype.map.call(carte.querySelectorAll('.mood img'), function (im) { return im.getAttribute('src') || ''; }),
      histoire: histoire.filter(Boolean),
      partenaire: part
    };
  }

  /* ---------- Champs à plusieurs entrées (anecdotes, story) ---------- */
  function ajusterHauteur(t) { t.style.height = 'auto'; t.style.height = Math.max(t.scrollHeight + 2, 72) + 'px'; }
  function ajusterTout() {
    Array.prototype.forEach.call(document.querySelectorAll('#fp-histoire textarea'), ajusterHauteur);
  }

  function nouvelItem(liste, valeur) {
    var long = liste.classList.contains('fp-liste-longue');
    var item = document.createElement('div'); item.className = 'fp-item';
    var champ = document.createElement(long ? 'textarea' : 'input');
    if (long) { champ.rows = 3; champ.placeholder = 'Paragraphe'; champ.addEventListener('input', function () { ajusterHauteur(champ); }); }
    else { champ.type = 'text'; champ.placeholder = 'anecdote'; }
    champ.value = valeur || '';
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'fp-del'; del.textContent = '×'; del.setAttribute('aria-label', 'Supprimer');
    del.addEventListener('click', function () { item.remove(); });
    item.appendChild(champ); item.appendChild(del);
    liste.insertBefore(item, liste.querySelector('.fp-add'));
    if (long) ajusterHauteur(champ);
    return champ;
  }
  function listeInit(id) {
    var l = $(id), b = document.createElement('button');
    b.type = 'button'; b.className = 'fp-add'; b.textContent = '+'; b.setAttribute('aria-label', 'Ajouter');
    b.addEventListener('click', function () { nouvelItem(l, '').focus(); });
    l.appendChild(b);
    nouvelItem(l, '');
  }
  function listeSet(id, vals) {
    var l = $(id);
    Array.prototype.forEach.call(l.querySelectorAll('.fp-item'), function (i) { i.remove(); });
    (vals && vals.length ? vals : ['']).forEach(function (v) { nouvelItem(l, v); });
  }
  function listeGet(id) {
    return Array.prototype.map.call($(id).querySelectorAll('.fp-item > :first-child'), function (c) { return c.value.trim(); })
      .filter(Boolean);
  }

  /* ---------- Pop-up ---------- */
  function champsAbout() {
    return CHAMPS.map(function (ch, i) {
      return '<div class="fp-row">' +
        '<span class="fp-lab">' + ch.label + '</span>' +
        '<input id="fp-v-' + i + '" type="text" placeholder="réponse">' +
        (ch.precision ? '<input id="fp-p-' + i + '" type="text" class="fp-small" placeholder="' + ch.precision + '">' : '<span></span>') +
        '</div>';
    }).join('');
  }

  var champsApercu = [];                               // champs « lien d'image » qui ont une miniature

  function apercu(input) {                             // ajoute une miniature à droite d'un champ de lien
    var boite = document.createElement('div'); boite.className = 'fp-urlbox';
    input.parentNode.insertBefore(boite, input);
    boite.appendChild(input);
    var vig = document.createElement('div'), img = document.createElement('img'), t = null;
    vig.className = 'fp-thumb'; img.alt = ''; img.referrerPolicy = 'no-referrer';
    vig.appendChild(img); boite.appendChild(vig);
    img.addEventListener('load',  function () { vig.className = 'fp-thumb fp-ok'; });
    img.addEventListener('error', function () { vig.className = 'fp-thumb fp-bad'; vig.title = 'Image introuvable ou lien invalide'; });
    function maj() {
      var u = input.value.trim();
      vig.className = 'fp-thumb'; vig.title = '';
      img.removeAttribute('src');
      if (!u) return;
      if (!/^https?:\/\//i.test(u)) { vig.className = 'fp-thumb fp-bad'; vig.title = 'Le lien doit commencer par http(s)://'; return; }
      vig.className = 'fp-thumb fp-load';
      img.src = u;
    }
    input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(maj, 350); });
    champsApercu.push(maj);
  }
  function majApercus() { champsApercu.forEach(function (f) { f(); }); }

  function champsImages() {
    var h = '';
    for (var i = 0; i < 8; i++) h += '<input id="fp-img-' + i + '" type="url" placeholder="Image ' + (i + 1) + ' — https://…">';
    return h;
  }

  function construireModal() {
    if (modalConstruit) return;
    modalConstruit = true;

    var ov = document.createElement('div');
    ov.id = 'fp-overlay';
    ov.className = 'fp-overlay';
    ov.hidden = true;
    ov.innerHTML =
      '<form class="fp-modal" id="fp-modal" autocomplete="off" novalidate>' +
        '<div class="fp-top"><div class="fp-title" id="fp-titre">Nouvelle fiche</div>' +
          '<button type="button" class="fp-x" id="fp-close" aria-label="Fermer">×</button></div>' +
        '<div class="fp-body">' +

          '<div class="fp-sec"><div class="fp-h">Fiche</div>' +
            '<label>Choisir la fiche à modifier, ou en créer une nouvelle<select id="fp-choix"></select></label>' +
          '</div>' +

          '<div class="fp-sec"><div class="fp-h">En-tête</div>' +
            '<label>Prénom <em>(sert aussi d’identifiant pour une nouvelle fiche)</em><input id="fp-prenom" type="text" required></label>' +
            '<div class="fp-hint" id="fp-idhint"></div>' +
            '<label>Type d’icône (coin de l’en-tête)<select id="fp-icone">' +
              ICONES.map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('') +
            '</select></label>' +
            '<label>Bannière — lien du gif / de l’image<input id="fp-banniere" type="url" placeholder="https://…"></label>' +
            '<label>Avatar — lien de l’image<input id="fp-avatar" type="url" placeholder="https://…"></label>' +
            '<div class="fp-duo">' +
              '<label>Couleur claire<input id="fp-c1" type="color" value="' + COULEURS_DEFAUT[0] + '"></label>' +
              '<label>Couleur foncée<input id="fp-c2" type="color" value="' + COULEURS_DEFAUT[1] + '"></label>' +
            '</div>' +
          '</div>' +

          '<div class="fp-sec"><div class="fp-h">About</div>' + champsAbout() +
            '<div class="fp-hint">La précision entre parenthèses est facultative. Une ligne vide s’affichera « réponse ».</div></div>' +

          '<div class="fp-sec"><div class="fp-h">Anecdotes</div><div class="fp-liste" id="fp-anecdotes"></div></div>' +

          '<div class="fp-sec"><div class="fp-h">Aesthetic</div><div class="fp-grille">' + champsImages() + '</div></div>' +

          '<div class="fp-sec"><div class="fp-h">Story</div><div class="fp-liste fp-liste-longue" id="fp-histoire"></div>' +
            '<div class="fp-hint">Un champ par paragraphe. Mise en forme : **gras**  *italique*  __souligné__  ~~barré~~  ||flou au survol||  (aussi dans les anecdotes et l’about)</div></div>' +

          '<div class="fp-sec"><div class="fp-h">Important person</div>' +
            '<label>Nom<input id="fp-pnom" type="text"></label>' +
            '<label>Gif — lien<input id="fp-pgif" type="url" placeholder="https://…"></label>' +
            '<div class="fp-hint">Les deux champs vides : le bloc est masqué et l’histoire prend toute la hauteur, comme sur tes fiches sans ship.</div></div>' +

        '</div>' +
        '<div class="fp-foot"><span class="fp-statusbar" id="fp-status" role="status"></span>' +
          '<button type="button" class="fp-cancel" id="fp-cancel">Annuler</button>' +
          '<button type="submit" id="fp-save">Enregistrer la fiche</button></div>' +
      '</form>';
    document.body.appendChild(ov);

    listeInit('fp-anecdotes');
    listeInit('fp-histoire');
    ['fp-banniere', 'fp-avatar', 'fp-pgif'].concat([0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return 'fp-img-' + i; }))
      .forEach(function (id) { apercu($(id)); });

    $('fp-close').addEventListener('click', fermerModal);
    $('fp-cancel').addEventListener('click', fermerModal);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) fermerModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !ov.hidden) fermerModal();
    });
    $('fp-prenom').addEventListener('input', majIdHint);
    $('fp-c2').addEventListener('input', function () {
      if (!couleurTouchee) $('fp-v-' + IDX_COULEUR).value = $('fp-c2').value;
    });
    $('fp-v-' + IDX_COULEUR).addEventListener('input', function () { couleurTouchee = true; });
    $('fp-v-' + IDX_COULEUR).value = $('fp-c2').value;
    $('fp-choix').addEventListener('change', function () {
      if (this.value) chargerFiche(this.value); else viderFormulaire();
    });
    $('fp-modal').addEventListener('submit', soumettre);
  }

  function peuplerChoix() {
    var sel = $('fp-choix'), h = '<option value="">＋ Nouvelle fiche</option>';
    Array.prototype.forEach.call(document.querySelectorAll('grocontainer .container'), function (c) {
      var n = c.querySelector('.name');
      var nom = propre(n && n.firstChild ? n.firstChild.nodeValue : c.id).replace(/^✧\s*/, '');
      h += '<option value="' + esc(c.id) + '">✎ ' + esc(nom) + '</option>';
    });
    sel.innerHTML = h;
    sel.value = idEdition;
  }

  function majTitre() {
    $('fp-titre').textContent = idEdition ? 'Modifier la fiche' : 'Nouvelle fiche';
    $('fp-save').textContent = idEdition ? 'Enregistrer les modifications' : 'Enregistrer la fiche';
  }

  function majIdHint() {
    var h = $('fp-idhint');
    if (idEdition) { h.textContent = 'Identifiant (inchangé) : ' + idEdition; h.className = 'fp-hint'; return; }
    var id = slug($('fp-prenom').value);
    if (!id) { h.textContent = ''; h.className = 'fp-hint'; return; }
    var pris = $(id) || IDS_RESERVES.indexOf(id) >= 0 || fichesDonnees.some(function (x) { return x.id === id; });
    h.textContent = pris ? 'Identifiant « ' + id + ' » déjà utilisé — choisis un autre prénom.' : 'Identifiant : ' + id;
    h.className = 'fp-hint' + (pris ? ' fp-err' : '');
  }

  function statutDans(id, msg, erreur) {
    var el = $(id);
    el.textContent = msg || '';
    el.classList.toggle('fp-err', !!erreur);
  }
  function statut(msg, erreur) { statutDans('fp-status', msg, erreur); }

  function viderFormulaire() {
    idEdition = '';
    $('fp-modal').reset();
    couleurTouchee = false;
    $('fp-v-' + IDX_COULEUR).value = $('fp-c2').value;
    listeSet('fp-anecdotes'); listeSet('fp-histoire');
    $('fp-choix').value = '';
    majTitre(); majIdHint(); statut('');
    majApercus();
    ajusterTout();
  }

  function remplirFormulaire(f) {
    $('fp-prenom').value = f.nom || f.id || '';
    $('fp-icone').value = ICONES.indexOf(f.icone) >= 0 ? f.icone : 'alternate';
    $('fp-banniere').value = f.banniere || '';
    $('fp-avatar').value = f.avatar || '';
    $('fp-c1').value = okColor((f.couleurs || [])[0], COULEURS_DEFAUT[0]);
    $('fp-c2').value = okColor((f.couleurs || [])[1], COULEURS_DEFAUT[1]);
    CHAMPS.forEach(function (ch, i) {
      var r = (f.about && f.about[i]) || {};
      $('fp-v-' + i).value = r.valeur || '';
      if ($('fp-p-' + i)) $('fp-p-' + i).value = r.precision || '';
    });
    couleurTouchee = true;                                  // ne pas écraser la ligne COULEUR existante
    listeSet('fp-anecdotes', f.anecdotes);
    listeSet('fp-histoire', f.histoire);
    for (var i = 0; i < 8; i++) $('fp-img-' + i).value = (f.aesthetic || [])[i] || '';
    $('fp-pnom').value = (f.partenaire && f.partenaire.nom) || '';
    $('fp-pgif').value = (f.partenaire && f.partenaire.gif) || '';
    majApercus();
  }

  function chargerFiche(id) {
    var f = fichesDonnees.filter(function (x) { return x.id === id; })[0];
    if (!f) {
      var carte = $(id);
      if (!carte) return;
      f = extraireFiche(carte);
    }
    idEdition = id;
    remplirFormulaire(f);
    $('fp-choix').value = id;
    majTitre(); majIdHint(); statut('');
    ajusterTout();
  }

  function ouvrirModal(id) {
    construireModal();
    peuplerChoix();
    if (id) chargerFiche(id); else if (idEdition) viderFormulaire();
    majTitre(); majIdHint(); statut('');
    $('fp-overlay').hidden = false;
    document.body.style.overflow = 'hidden';
    ajusterTout();
    $('fp-prenom').focus();
  }

  function fermerModal() {
    $('fp-overlay').hidden = true;
    document.body.style.overflow = '';
  }

  function toast(msg) {
    var t = $('fp-toast');
    if (!t) { t = document.createElement('div'); t.id = 'fp-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 9000);
  }

  function lireFormulaire() {
    var prenom = $('fp-prenom').value.trim(), imgs = [];
    for (var i = 0; i < 8; i++) imgs.push($('fp-img-' + i).value.trim());
    return {
      id: idEdition || slug(prenom),
      nom: prenom,
      icone: $('fp-icone').value,
      banniere: $('fp-banniere').value.trim(),
      avatar: $('fp-avatar').value.trim(),
      couleurs: [$('fp-c1').value, $('fp-c2').value],
      about: CHAMPS.map(function (ch, i) {
        return { valeur: $('fp-v-' + i).value.trim(), precision: $('fp-p-' + i) ? $('fp-p-' + i).value.trim() : '' };
      }),
      anecdotes: listeGet('fp-anecdotes'),
      aesthetic: imgs.filter(Boolean),
      histoire: listeGet('fp-histoire'),
      partenaire: { nom: $('fp-pnom').value.trim(), gif: $('fp-pgif').value.trim() }
    };
  }

  /* ---------- GitHub ---------- */
  function utf8VersB64(txt) {
    var bytes = new TextEncoder().encode(txt), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64VersUtf8(b64) {
    var bin = atob(String(b64).replace(/\s/g, '')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function appelApi(cfg, methode, corps) {
    var chemin = (cfg.dir ? cfg.dir + '/' : '') + 'data/fiches.json';
    var url = 'https://api.github.com/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) +
      '/contents/' + chemin.split('/').map(encodeURIComponent).join('/') +
      (methode === 'GET' ? '?ref=' + encodeURIComponent(cfg.branch) + '&t=' + Date.now() : '');
    var headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + cfg.token,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (corps) headers['Content-Type'] = 'application/json';
    return fetch(url, { method: methode, headers: headers, cache: 'no-store', body: corps ? JSON.stringify(corps) : undefined });
  }

  function erreurApi(r) {
    if (r.status === 401) return new Error('jeton refusé (401) — vérifie qu’il est correct et non expiré.');
    if (r.status === 403 || r.status === 404) return new Error('accès refusé ou dépôt introuvable (' + r.status + ') — vérifie compte, dépôt, branche, dossier, et que le jeton a bien « Contents : Read and write » sur ce dépôt.');
    return new Error('GitHub a répondu ' + r.status + '.');
  }

  function fusionner(liste, fiche, edition) {            // remplace la fiche de même id, sinon l'ajoute
    var idx = -1;
    liste.forEach(function (x, i) { if (x.id === fiche.id) idx = i; });
    if (idx >= 0) { if (!edition) throw new Error('l’identifiant « ' + fiche.id + ' » existe déjà sur GitHub.'); liste[idx] = fiche; }
    else liste.push(fiche);
    return liste;
  }

  async function enregistrerSurGitHub(fiche, cfg, edition) {
    if (!cfg.owner || !cfg.repo) throw new Error('renseigne le compte et le dépôt GitHub.');
    for (var essai = 0; essai < 2; essai++) {
      var r = await appelApi(cfg, 'GET');
      var sha = null, liste = [];
      if (r.status === 404 && essai === 0) {
        // fichier absent : on le créera ; (404 peut aussi venir d'un mauvais dépôt, le PUT le dira)
      } else if (!r.ok) {
        throw erreurApi(r);
      } else {
        var j = await r.json();
        sha = j.sha;
        try { liste = JSON.parse(b64VersUtf8(j.content) || '[]'); } catch (e) { throw new Error('data/fiches.json n’est pas un JSON valide.'); }
        if (!Array.isArray(liste)) throw new Error('data/fiches.json doit contenir une liste [ ].');
      }
      fusionner(liste, fiche, edition);
      var corps = {
        message: (edition ? 'Modification de la fiche ' : 'Ajout de la fiche ') + (fiche.nom || fiche.id),
        content: utf8VersB64(JSON.stringify(liste, null, 2) + '\n'),
        branch: cfg.branch
      };
      if (sha) corps.sha = sha;
      var p = await appelApi(cfg, 'PUT', corps);
      if (p.ok) { fichesDonnees = liste; return; }
      if ((p.status === 409 || p.status === 422) && essai === 0) continue;   // quelqu'un a modifié le fichier entre-temps : on réessaie
      throw erreurApi(p);
    }
  }

  function telechargerJson(liste) {
    var blob = new Blob([JSON.stringify(liste, null, 2) + '\n'], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fiches.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* ---------- Lien d'installation (#setup=…) ---------- */
  function copierLienInstallation() {
    var cfg = lireConfigParams();
    if (!cfg.owner || !cfg.repo || !cfg.token) return statutDans('fp-pstatus', 'Renseigne d’abord compte, dépôt et jeton.', true);
    var url = root.location.origin + root.location.pathname + '#setup=' + encodeURIComponent(utf8VersB64(JSON.stringify(cfg)));
    var ok = function () { statutDans('fp-pstatus', 'Lien copié. Garde-le précieusement : il contient ton jeton.'); };
    if (root.navigator.clipboard && root.navigator.clipboard.writeText) {
      root.navigator.clipboard.writeText(url).then(ok, function () { root.prompt('Copie ce lien :', url); });
    } else { root.prompt('Copie ce lien :', url); }
  }

  function installerDepuisLien() {
    var m = /^#setup=(.+)$/.exec(root.location.hash);
    if (!m) return;
    try {
      var c = JSON.parse(b64VersUtf8(decodeURIComponent(m[1])));
      if (c && c.owner && c.repo && c.token) {
        stockageEcrire(CFG_KEY, JSON.stringify({ owner: c.owner, repo: c.repo, branch: c.branch || 'main', dir: c.dir || '', token: c.token }));
        toast('Installation terminée : le jeton est enregistré dans ce navigateur.');
      }
    } catch (e) { /* lien invalide : ignoré */ }
    root.history.replaceState(null, '', root.location.pathname + root.location.search);   // retire le jeton de l'adresse
  }

  /* ---------- Envoi du formulaire ---------- */
  async function soumettre(e) {
    e.preventDefault();
    var f = lireFormulaire(), edition = !!idEdition;
    if (!f.id) return statut('Le prénom est obligatoire.', true);
    if (!edition) {
      var ex = $(f.id);
      if (IDS_RESERVES.indexOf(f.id) >= 0 || (ex && !ex.classList.contains('container')))
        return statut('Cet identifiant est réservé — change le prénom.', true);
      if (ex || fichesDonnees.some(function (x) { return x.id === f.id; }))
        return statut('Cet identifiant existe déjà — change le prénom, ou choisis la fiche à modifier en haut du formulaire.', true);
    }

    var cfg = lireConfig(), btn = $('fp-save');
    btn.disabled = true;
    statut('Enregistrement…');
    try {
      if (cfg.token) {
        await enregistrerSurGitHub(f, cfg, edition);
        toast('Fiche enregistrée sur GitHub. Elle sera visible par tout le monde dans une à deux minutes (temps de publication de Pages).');
      } else {
        fusionner(fichesDonnees, f, true);
        telechargerJson(fichesDonnees);
        toast('Fiche mise à jour ici. Pour la publier, remplace data/fiches.json sur le dépôt par le fichier téléchargé — ou enregistre un jeton dans ⚙ Paramètres pour que ce soit automatique.');
      }
      var carte = afficherFiche(f);
      viderFormulaire();
      fermerModal();
      if (carte) carte.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (ex) {
      statut('Erreur : ' + (ex && ex.message ? ex.message : ex), true);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- Paramètres (GitHub, clic droit) ---------- */
  var paramsConstruit = false;

  function lireConfigParams() {
    return {
      owner: $('fp-owner').value.trim(), repo: $('fp-repo').value.trim(),
      branch: $('fp-branch').value.trim() || 'main',
      dir: $('fp-dir').value.trim().replace(/^\/+|\/+$/g, ''),
      token: $('fp-token').value.trim(),
      clicDroit: $('fp-clicdroit').checked
    };
  }

  function construireParams() {
    if (paramsConstruit) return;
    paramsConstruit = true;
    var ov = document.createElement('div');
    ov.id = 'fp-overlay2'; ov.className = 'fp-overlay'; ov.hidden = true;
    ov.innerHTML =
      '<form class="fp-modal" id="fp-pmodal" autocomplete="off" novalidate>' +
        '<div class="fp-top"><div class="fp-title">Paramètres</div>' +
          '<button type="button" class="fp-x" id="fp-pclose" aria-label="Fermer">×</button></div>' +
        '<div class="fp-body">' +
          '<div class="fp-sec"><div class="fp-h">Enregistrement sur GitHub</div>' +
            '<div class="fp-hint">Avec un jeton, chaque fiche est commitée toute seule sur le dépôt. Sans jeton, un fichier <b>fiches.json</b> à envoyer à la main est téléchargé. ' +
            'Le jeton reste uniquement dans ce navigateur.</div>' +
            '<div class="fp-duo"><label>Compte<input id="fp-owner" type="text"></label>' +
            '<label>Dépôt<input id="fp-repo" type="text"></label></div>' +
            '<div class="fp-duo"><label>Branche<input id="fp-branch" type="text"></label>' +
            '<label>Dossier du site <em>(« docs » si Pages publie depuis /docs)</em><input id="fp-dir" type="text" placeholder="vide = racine"></label></div>' +
            '<label>Jeton d’accès (fine-grained, « Contents : Read and write » sur ce seul dépôt)' +
            '<input id="fp-token" type="password" autocomplete="off"></label>' +
          '</div>' +
          '<div class="fp-sec"><div class="fp-h">Modification</div>' +
            '<label class="fp-check"><input type="checkbox" id="fp-clicdroit"> Clic droit sur une fiche pour la modifier</label>' +
            '<div class="fp-hint">Réglage propre à ce navigateur, activé par défaut quand un jeton est enregistré : les visiteurs gardent leur menu habituel. ' +
            'Maj + clic droit ouvre le menu du navigateur. Sur téléphone, choisis la fiche dans la liste en haut de « Nouvelle fiche ».</div>' +
          '</div>' +
          '<div class="fp-sec"><div class="fp-h">Lien d’installation</div>' +
            '<button type="button" id="fp-lien">Copier le lien d’installation</button>' +
            '<div class="fp-hint">Ouvre ce lien sur un autre navigateur ou appareil : compte, dépôt et jeton s’y installent seuls. ' +
            'Il contient le jeton : garde-le comme un mot de passe.</div>' +
          '</div>' +
        '</div>' +
        '<div class="fp-foot"><span class="fp-statusbar" id="fp-pstatus" role="status"></span>' +
          '<button type="button" class="fp-cancel" id="fp-pfermer">Fermer</button>' +
          '<button type="submit">Enregistrer</button></div>' +
      '</form>';
    document.body.appendChild(ov);
    $('fp-pclose').addEventListener('click', fermerParams);
    $('fp-pfermer').addEventListener('click', fermerParams);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) fermerParams(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !ov.hidden) fermerParams(); });
    $('fp-lien').addEventListener('click', copierLienInstallation);
    $('fp-pmodal').addEventListener('submit', function (e) {
      e.preventDefault();
      stockageEcrire(CFG_KEY, JSON.stringify(lireConfigParams()));
      majNav();
      fermerParams();
      toast('Paramètres enregistrés dans ce navigateur.');
    });
  }

  function ouvrirParams() {
    construireParams();
    var cfg = lireConfig();
    $('fp-owner').value = cfg.owner || '';
    $('fp-repo').value = cfg.repo || '';
    $('fp-branch').value = cfg.branch || 'main';
    $('fp-dir').value = cfg.dir || '';
    $('fp-token').value = cfg.token || '';
    $('fp-clicdroit').checked = !!cfg.clicDroit;
    statutDans('fp-pstatus', '');
    $('fp-overlay2').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function fermerParams() {
    $('fp-overlay2').hidden = true;
    document.body.style.overflow = '';
  }

  /* ---------- Barre de navigation (en haut à droite, au-dessus de la zone des fiches) ---------- */
  function majNav() {
    var a = $('fp-astuce');
    if (a) a.hidden = !lireConfig().clicDroit;
  }

  function afficherNav() {
    if ($('fp-nav')) return;
    var nav = document.createElement('nav');
    nav.id = 'fp-nav';
    nav.innerHTML = '<span id="fp-astuce" hidden>clic droit sur une fiche pour la modifier</span>' +
                    '<button type="button" class="fp-navbtn" id="fp-open"><span>＋</span> Nouvelle fiche</button>' +
                    '<button type="button" class="fp-navbtn" id="fp-params"><span>⚙</span> Paramètres</button>';
    document.body.appendChild(nav);
    $('fp-open').addEventListener('click', function () { ouvrirModal(''); });
    $('fp-params').addEventListener('click', ouvrirParams);
    majNav();
  }

  /* Clic droit sur une fiche = ouvrir le formulaire de modification (seulement si activé dans ce navigateur) */
  document.addEventListener('contextmenu', function (e) {
    if (e.shiftKey || !lireConfig().clicDroit) return;
    if (document.querySelector('.fp-overlay:not([hidden])')) return;
    var carte = e.target.closest ? e.target.closest('grocontainer .container') : null;
    if (!carte) return;
    e.preventDefault();
    ouvrirModal(carte.id);
  });

  function init() {
    installerDepuisLien();
    afficherNav();

    fetch(DATA_URL, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (liste) {
        fichesDonnees = Array.isArray(liste) ? liste : [];
        fichesDonnees.forEach(afficherFiche);               // ajoute les nouvelles fiches, remplace celles qui ont été modifiées
      })
      .catch(function () { /* page ouverte hors serveur : pas de fiches à charger */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : this);
