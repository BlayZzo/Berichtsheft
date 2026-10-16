'use strict';
/* Berichtsheft - Oberflaeche (ohne Zusatzbibliotheken) */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const app = $('#app');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const HINWEIS = 'Privates Hilfsprogramm, nicht offiziell. Kein Angebot der Handelskammer Bremen (IHK) und ohne Verbindung zu Ausbildungsbetrieben.';

  let S = { user: null, settings: null, setup: false, missing: [] };
  const isAdmin = () => S.user && S.user.role === 'admin';
  const locked = (k) => !!(S.settings && S.settings.gesperrt && S.settings.gesperrt[k]);

  /* ---------- Hilfen ---------- */
  async function api(method, url, body) {
    const res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-BH': '1' },
      body: method === 'GET' ? undefined : JSON.stringify(body || {})
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (res.status === 401 && !url.includes('/login')) { S.user = null; render(); }
    if (!res.ok) { const e = new Error(data.error || 'Fehler ' + res.status); e.status = res.status; throw e; }
    return data;
  }
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fmt = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, k) => fmt(new Date(parse(s).getTime() + k * 864e5));
  const wd = (s) => (parse(s).getUTCDay() + 6) % 7;
  const monday = (s) => addDays(s, -wd(s));
  const today = () => { const d = new Date(); return fmt(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))); };
  const de = (s) => s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : '';
  const deShort = (s) => s.slice(8, 10) + '.' + s.slice(5, 7) + '.';
  const deDate = (iso) => iso ? de(new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' })) : '–';
  function ago(iso) {
    if (!iso) return 'noch nie';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 2) return 'gerade eben';
    if (m < 60) return `vor ${m} Minuten`;
    const h = Math.round(m / 60); if (h < 24) return `vor ${h} Stunde${h === 1 ? '' : 'n'}`;
    const d = Math.round(h / 24); if (d < 31) return `vor ${d} Tag${d === 1 ? '' : 'en'}`;
    return 'am ' + deDate(iso);
  }
  function since(iso) {
    if (!iso) return '–';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
    const txt = days < 1 ? 'seit heute' : days < 60 ? `seit ${days} Tag${days === 1 ? '' : 'en'}` : `seit ${Math.round(days / 30)} Monaten`;
    return `${txt} (${deDate(iso)})`;
  }

  const mb = (b) => (b / 1048576).toLocaleString('de-DE', { maximumFractionDigits: b < 1048576 ? 2 : 1 });
  function speicherBar(sp) {
    if (!sp) return '';
    const cls = sp.prozent >= 90 ? 'bad' : sp.prozent >= 70 ? 'warn' : '';
    return `<div class="meter ${cls}"><span data-p="${Math.max(1, sp.prozent)}"></span></div>
      <div class="muted small-t">${mb(sp.used)} MB von ${mb(sp.quota)} MB belegt (${sp.prozent} %)${sp.eigen ? ' · eigene Grenze' : ''}</div>`;
  }
  function fillBars() { $$('.meter span, .progress span').forEach((el) => { el.style.width = el.dataset.p + '%'; }); }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3800);
  }
  /* Dialog: Knoepfe mit data-m schliessen ihn, data-m="form" gibt die Formularfelder zurueck */
  function modal(html, onOpen) {
    $('#modal-box').innerHTML = html; $('#modal').hidden = false;
    return new Promise((resolve) => {
      const done = (v) => { $('#modal').hidden = true; $('#modal-box').innerHTML = ''; resolve(v); };
      $('#modal-box').onclick = (e) => {
        const b = e.target.closest('[data-m]'); if (!b) return;
        e.preventDefault();
        if (b.dataset.m === 'form') { const f = $('#modal-box form'); if (!f.reportValidity()) return; done(Object.fromEntries(new FormData(f))); }
        else done(b.dataset.m);
      };
      const f = $('#modal-box form'); if (f) f.onsubmit = (e) => { e.preventDefault(); const b = $('[data-m=form]', f); if (b) b.click(); };
      $('#modal').onclick = (e) => { if (e.target.id === 'modal') done(null); };
      if (onOpen) onOpen($('#modal-box'), done);
    });
  }
  const errBox = (el, msg, kind = 'err') => { if (el) el.innerHTML = msg ? `<div class="msg ${kind}">${esc(msg)}</div>` : ''; };
  async function busy(btn, fn) { if (btn) btn.disabled = true; try { return await fn(); } finally { if (btn) btn.disabled = false; } }
  async function copy(t) {
    try { await navigator.clipboard.writeText(t); toast('Kopiert.'); }
    catch { toast('Kopieren geht hier nicht. Bitte markieren und von Hand kopieren.'); }
  }
  const lockNote = (k) => locked(k) ? `<div class="msg warn">${esc(S.settings.funktionen[k])}: ${esc(S.settings.sperrText)}</div>` : '';

  /* ---------- Hell / Dunkel ---------- */
  function themeNow() { try { return localStorage.getItem('bh-theme') || 'auto'; } catch { return 'auto'; } }
  function setTheme(t) {
    try { if (t === 'auto') localStorage.removeItem('bh-theme'); else localStorage.setItem('bh-theme', t); } catch {}
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    const ICONS = {
      light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>',
      dark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>',
      auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>'
    };
    $('#themebtn').innerHTML = ICONS[t];
    $('#themebtn').title = t === 'dark' ? 'Dunkel (tippen für Automatisch)' : t === 'light' ? 'Hell (tippen für Dunkel)' : 'Automatisch (tippen für Hell)';
  }
  $('#themebtn').onclick = () => {
    const t = themeNow(), n = t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto';
    setTheme(n);
    toast(n === 'auto' ? 'Hell/Dunkel wie am Gerät' : n === 'dark' ? 'Dunkler Modus' : 'Heller Modus');
    /* Im Profil merken, damit es auf jedem Geraet gleich ist */
    if (S.user) api('POST', '/api/me', { theme: n }).then((r) => { S.user = r.user; }).catch(() => {});
  };
  setTheme(themeNow());

  /* ---------- Speicherort (PC: fester Ordner, Handy: Teilen) ---------- */
  const IDB = {
    open() { return new Promise((res, rej) => { const r = indexedDB.open('berichtsheft', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async get(k) { try { const d = await this.open(); return await new Promise((res) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); } catch { return null; } },
    async set(k, v) { try { const d = await this.open(); await new Promise((res) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch {} },
    async del(k) { try { const d = await this.open(); await new Promise((res) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; t.onerror = res; }); } catch {} }
  };
  const canPickFolder = () => 'showDirectoryPicker' in window;

  async function savePdf(r) {
    const res = await fetch('/api/pdf?id=' + encodeURIComponent(r.id), { credentials: 'same-origin' });
    if (!res.ok) { let m = 'PDF konnte nicht erstellt werden.'; try { m = (await res.json()).error || m; } catch {} return toast(m); }
    const blob = await res.blob(), name = r.file;
    const dir = canPickFolder() ? await IDB.get('dir') : null;
    if (dir) {
      try {
        let p = await dir.queryPermission({ mode: 'readwrite' });
        if (p !== 'granted') p = await dir.requestPermission({ mode: 'readwrite' });
        if (p === 'granted') {
          const fh = await dir.getFileHandle(name, { create: true });
          const w = await fh.createWritable(); await w.write(blob); await w.close();
          return toast(`Gespeichert in „${dir.name}“: ${name}`);
        }
      } catch (e) { console.warn(e); }
    }
    const file = new File([blob], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Heruntergeladen: ' + name);
  }

  /* ---------- Navigation ---------- */
  function nav() {
    const ready = S.user && !S.user.mustChange && !S.missing.length;
    if (!ready) { $('#nav').innerHTML = ''; return; }
    const r = location.hash.split('/')[1] || '';
    const items = isAdmin()
      ? [['admin', '★', 'Konten', '#/admin'], ['einstellungen', '⚙', 'Konto', '#/einstellungen']]
      : [['', '▤', 'Berichte', '#/'], ['einstellungen', '⚙', 'Einstellungen', '#/einstellungen']];
    const on = (k) => (k === '' ? (r === '' || r === 'bericht') : r === k);
    $('#nav').innerHTML = items.map(([k, ic, t, h]) => `<a href="${h}" class="${on(k) ? 'on' : ''}"><span class="ic">${ic}</span>${t}</a>`).join('')
      + '<a href="#" data-logout><span class="ic">⏻</span>Abmelden</a>';
  }
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-logout]')) return;
    e.preventDefault();
    await flushSave();
    await api('POST', '/api/logout').catch(() => {});
    S.user = null; location.hash = ''; render();
  });

  async function boot() {
    try { S = { ...S, ...(await api('GET', '/api/state')) }; if (S.user && S.user.theme && S.user.theme !== themeNow()) setTheme(S.user.theme); }
    catch { app.innerHTML = '<div class="card narrow"><div class="msg err">Der Server ist gerade nicht erreichbar. Bitte später neu laden.</div></div>'; return; }
    render();
  }
  window.addEventListener('hashchange', async () => { await flushSave(); render(); });

  function render() {
    app.oninput = app.onchange = app.onclick = app.onfocusout = null;
    nav();
    window.scrollTo(0, 0);
    const [, r, a, b] = location.hash.split('/');
    /* Geschlossener Bereich: ohne Anmeldung ist nur die Anmeldemaske sichtbar */
    document.body.classList.toggle('guest', !S.user);
    if (r === 'datenschutz') return viewDatenschutz();
    if (S.setup) return viewSetup();
    if (!S.user) return viewLogin();
    if (r === 'hilfe') return viewHelp();
    if (S.user.mustChange) return viewForcePw();
    if (S.missing.length) return viewProfileFirst();
    if (r === 'einstellungen') return viewSettings();
    if (isAdmin()) return viewAdmin(r === 'admin' && a ? a : 'konten');
    if (r === 'bericht' && a) return viewReport(a);
    viewHome();
    if (!S.user.tutorialDone) setTimeout(() => tutorial(), 300);
  }

  /* ---------- Einrichtung / Anmeldung / erster Start ---------- */
  function viewSetup() {
    app.innerHTML = `<div class="card narrow">
      <h1>Ersteinrichtung</h1>
      <p class="muted">Hier legst du den <strong>Admin-Zugang</strong> an. Er ist nur zum Verwalten da. Dein persönliches Berichtsheft legst du danach als eigenes Konto an.</p>
      <form id="f">
        <label>Einrichtungs-Code</label><input type="text" name="code" autocomplete="off" autocapitalize="characters" required>
        <div class="hint">Zeigt das Einrichtungsskript am Ende an. Steht auch auf dem Server in <code>/var/lib/berichtsheft/secret/setup-code.txt</code>.</div>
        <label>Benutzername für den Admin</label><input type="text" name="username" autocomplete="username" autocapitalize="none" required placeholder="z. B. admin">
        <label>Passwort (mindestens 8 Zeichen)</label><input type="password" name="password" autocomplete="new-password" required minlength="8">
        <div id="err"></div>
        <div class="actions"><button class="primary">Admin anlegen</button></div>
      </form></div>`;
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/setup', Object.fromEntries(new FormData(e.target))); location.hash = '#/admin'; await boot(); }
      catch (x) { errBox($('#err'), x.message); }
    };
  }
  function viewLogin() {
    app.innerHTML = `<div class="card narrow">
      <div class="lead"><img src="/icon.svg" width="44" height="44" alt=""><div><h1>Anmelden</h1><p class="muted">Geschlossener Bereich. Zugang nur mit Einladung.</p></div></div>
      <form id="f">
        <label>Benutzername</label><input type="text" name="username" autocomplete="username" autocapitalize="none" required>
        <label>Passwort</label><input type="password" name="password" autocomplete="current-password" required>
        <div id="err"></div>
        <div class="actions"><button class="primary">Anmelden</button></div>
      </form>
      <p class="muted mt2">Passwort vergessen? Bitte bei der Person melden, die dich eingeladen hat.</p>
      <p class="small-t"><a href="#/datenschutz">Datenschutz</a></p></div>`;
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      await busy($('button', e.target), async () => {
        try { await api('POST', '/api/login', Object.fromEntries(new FormData(e.target))); location.hash = ''; await boot(); }
        catch (x) { errBox($('#err'), x.message); }
      });
    };
  }
  function pwForm(title, hint, oldLabel = 'Bisheriges Passwort') {
    return `<form id="pwf"><h2>${title}</h2>${hint ? `<p class="muted">${hint}</p>` : ''}
      <label>${oldLabel}</label><input type="password" name="old" autocomplete="current-password" required>
      <label>Neues Passwort (mindestens 8 Zeichen)</label><input type="password" name="new" autocomplete="new-password" minlength="8" required>
      <label>Neues Passwort wiederholen</label><input type="password" name="new2" autocomplete="new-password" minlength="8" required>
      <div id="pwerr"></div><div class="actions"><button class="primary">Passwort speichern</button></div></form>`;
  }
  function bindPw(after) {
    $('#pwf').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (f.new !== f.new2) return errBox($('#pwerr'), 'Die beiden neuen Passwörter sind nicht gleich.');
      try { await api('POST', '/api/password', f); e.target.reset(); after(); }
      catch (x) { errBox($('#pwerr'), x.message); }
    };
  }
  function viewForcePw() {
    app.innerHTML = `<div class="card narrow"><p class="chip brand">Schritt 1 von ${isAdmin() ? 1 : 2}</p>
      ${pwForm('Eigenes Passwort festlegen', 'Du hast dich mit dem Startpasswort angemeldet. Lege jetzt ein eigenes Passwort fest, das nur du kennst.', 'Startpasswort')}</div>`;
    bindPw(async () => { toast('Passwort gespeichert.'); await boot(); });
  }
  function viewProfileFirst() {
    const u = S.user;
    app.innerHTML = `<div class="card narrow"><p class="chip brand">Schritt 2 von 2</p><h2>Deine Angaben</h2>
      <p class="muted">Diese Angaben kommen automatisch in jeden Bericht. Du kannst sie später in den Einstellungen ändern.</p>
      <form id="f">${profileFields(u)}
      <label class="inline mt2"><input type="checkbox" name="datenschutzOk" required ${u.datenschutzAm ? 'checked' : ''}> Ich habe die <a href="#/datenschutz" target="_blank" rel="noopener">Datenschutzerklärung</a> gelesen.</label>
      <div id="err"></div><div class="actions"><button class="primary">Weiter</button></div></form></div>`;
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      try { const r = await api('POST', '/api/me', Object.fromEntries(new FormData(e.target))); S.user = r.user; S.missing = r.missing; location.hash = ''; render(); }
      catch (x) { errBox($('#err'), x.message); }
    };
  }
  function profileFields(u) {
    return `<div class="grid"><div><label>Vorname <span class="req">*</span></label><input type="text" name="vorname" value="${esc(u.vorname)}" required></div>
      <div><label>Nachname <span class="req">*</span></label><input type="text" name="nachname" value="${esc(u.nachname)}" required></div></div>
      <label>Firma <span class="req">*</span></label><input type="text" name="firma" value="${esc(u.firma)}" required placeholder="Name deines Ausbildungsbetriebs">
      <label>Lehrberuf <span class="req">*</span></label><input type="text" name="beruf" value="${esc(u.beruf)}" required placeholder="z. B. Elektroniker/in für Betriebstechnik">
      <label>Lehrjahr <span class="req">*</span></label><select name="lehrjahr" required>${['', 1, 2, 3, 4].map((n) => `<option value="${n}" ${String(n) === String(u.lehrjahr) ? 'selected' : ''}>${n ? n + '. Lehrjahr' : 'Bitte wählen'}</option>`).join('')}</select>`;
  }

  /* ---------- Einfuehrung ---------- */
  const TOUR = [
    ['👋', 'Willkommen', `Hier schreibst du dein wöchentliches Berichtsheft und bekommst am Ende ein fertiges, unterschriebenes PDF.<br><br><span class="muted">${HINWEIS}</span>`],
    ['⚙', 'Einmal einrichten', 'Unter <strong>Einstellungen</strong> hinterlegst du einmal deine <strong>Unterschrift</strong> und deine <strong>Arbeitsorte</strong> (z. B. „Hof“, Adresse, Ausbilder). Die kannst du später mit einem Tipp in den Text einfügen.'],
    ['＋', 'Neuer Wochenbericht', 'Tippe auf <strong>Neuer Wochenbericht</strong> und wähle <strong>Diese Woche</strong> oder ein Datum. Die Woche geht immer von Montag bis Sonntag, die Nummer zählt automatisch weiter.'],
    ['✎', 'Tage ausfüllen', 'Schreib zu jedem Tag, was du gemacht hast. Alles wird <strong>automatisch gespeichert</strong>, du kannst also jeden Tag ein Stück machen. Unter jedem Feld findest du <strong>Einfügen</strong>, <strong>Ideen</strong> und <strong>Rückgängig</strong>.'],
    ['✓', 'Rechtschreibung', 'Fehler werden unter dem Tag angezeigt. Tippe auf den grünen Vorschlag, auf „So lassen“ oder nimm Fachwörter ins Wörterbuch auf.'],
    ['✍', 'Unterschreiben & speichern', 'Unten das Datum wählen und <strong>Prüfen & unterschreiben</strong> tippen. Danach <strong>PDF speichern</strong>. Du kannst am Handy schreiben und später z. B. am Tablet in der Firma herunterladen. 3 Monate lang kannst du noch etwas ändern.'],
    ['?', 'Hilfe', 'Oben rechts über <strong>?</strong> findest du jederzeit die Anleitung. Mit <strong>◐</strong> schaltest du zwischen hell und dunkel um.']
  ];
  async function tutorial(fromHelp) {
    let i = 0;
    const draw = (box, done) => {
      const [ico, title, body] = TOUR[i];
      box.innerHTML = `<div class="tour"><div class="big-ico">${ico}</div><h2>${title}</h2><p>${body}</p>
        <div class="dots">${TOUR.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>
        <div class="actions"><button class="ghost" data-t="skip">${i === TOUR.length - 1 ? '' : 'Überspringen'}</button>
        <div class="row">${i ? '<button data-t="back">Zurück</button>' : ''}<button class="primary" data-t="next">${i === TOUR.length - 1 ? 'Los geht’s' : 'Weiter'}</button></div></div></div>`;
      box.onclick = (e) => {
        const b = e.target.closest('[data-t]'); if (!b) return;
        if (b.dataset.t === 'back') { i--; draw(box, done); }
        else if (b.dataset.t === 'next' && i < TOUR.length - 1) { i++; draw(box, done); }
        else done('end');
      };
    };
    await modal('', (box, done) => draw(box, done));
    if (!fromHelp && S.user && !S.user.tutorialDone) {
      try { S.user = (await api('POST', '/api/me', { tutorialDone: true })).user; } catch {}
    }
  }

  /* ---------- Datenschutzerklaerung ---------- */
  function viewDatenschutz() {
    const d = S.datenschutz || {};
    const name = d.name || '[Name des Betreibers – vom Admin einzutragen]';
    const kontakt = d.kontakt || '[E-Mail-Adresse – vom Admin einzutragen]';
    const h = (t) => `<h2 class="mt2">${t}</h2>`;
    app.innerHTML = `<div class="toprow"><a href="#/" class="back">‹ Zurück</a></div>
      <div class="card legal"><h1>Datenschutzerklärung</h1>
      <p class="muted">Stand: Oktober 2026</p>
      ${!d.name ? '<div class="msg warn">Der Betreiber hat seinen Namen und Kontakt noch nicht eingetragen.</div>' : ''}
      ${h('1. Wer ist verantwortlich?')}
      <p>${esc(name)}<br>Kontakt: ${esc(kontakt)}</p>
      <p>Dieses Berichtsheft ist ein privates, kostenloses Hilfsprogramm für einen geschlossenen Kreis eingeladener Personen. Es ist kein Angebot der Handelskammer Bremen (IHK) und steht in keiner Verbindung zu Ausbildungsbetrieben.</p>
      ${h('2. Wozu werden Daten verarbeitet?')}
      <p>Ausschließlich, um dir das Schreiben, Prüfen, Unterschreiben und Speichern deiner Ausbildungsnachweise zu ermöglichen. Es gibt keine Werbung, keine Weitergabe an Dritte zu eigenen Zwecken, kein Tracking und keine Auswertung deines Verhaltens.</p>
      ${h('3. Welche Daten werden gespeichert?')}
      <ul>
        <li><strong>Konto:</strong> Benutzername und Passwort. Das Passwort wird nur verschlüsselt (als nicht umkehrbarer Hash) gespeichert.</li>
        <li><strong>Deine Angaben:</strong> Vor- und Nachname, Firma, Lehrberuf, Lehrjahr, Stunden und Berufsschultage.</li>
        <li><strong>Deine Berichte:</strong> Texte, Stunden, Ausbildungsbereich, Nummer, Datum der Unterschrift und frühere Fassungen, wenn du einen Bericht nachträglich änderst.</li>
        <li><strong>Unterschrift:</strong> das Bild deiner Unterschrift, das du hochlädst oder zeichnest.</li>
        <li><strong>Hilfen:</strong> Arbeitsorte (z. B. Adresse und Name von Ausbilder oder Geselle), Textbausteine und dein Wörterbuch. Bitte trage bei Dritten nur ein, was für den Bericht nötig ist.</li>
        <li><strong>Technisch:</strong> Zeitpunkt der Kontoerstellung, der letzten Anmeldung und der letzten Aktivität sowie die belegte Speichermenge.</li>
      </ul>
      ${h('4. Cookies und Speicher im Browser')}
      <p>Es wird nur ein technisch notwendiges Sitzungs-Cookie gesetzt, damit du angemeldet bleibst. Es läuft nach spätestens 14 Tagen oder 12 Stunden ohne Nutzung ab. Im Browser selbst werden nur deine Hell-/Dunkel-Einstellung und, falls du ihn wählst, dein Speicherordner für PDFs gemerkt. Diese Angaben bleiben auf deinem Gerät.</p>
      ${h('5. Schutz vor Missbrauch')}
      <p>Bei Anmeldeversuchen wird deine IP-Adresse kurzzeitig nur im Arbeitsspeicher gehalten, um das Erraten von Passwörtern zu verhindern. Sie wird nach spätestens 15 Minuten verworfen und nicht dauerhaft gespeichert.</p>
      ${h('6. Wo liegen die Daten?')}
      <p>Auf einem gemieteten Server der Hetzner Online GmbH (Industriestr. 25, 91710 Gunzenhausen) in ${esc(d.serverOrt || 'Deutschland')}. Hetzner verarbeitet die Daten nur als technischer Dienstleister (Auftragsverarbeitung) und nicht für eigene Zwecke. Die Verbindung ist per https verschlüsselt.</p>
      <p>Die Rechtschreib- und Grammatikprüfung läuft auf demselben Server. Deine Texte werden dafür <strong>nicht</strong> an andere Anbieter geschickt. Es werden keine Schriften, Skripte oder Inhalte von fremden Servern geladen.</p>
      ${h('7. Wer kann die Daten sehen?')}
      <p>Deine Berichte siehst nur du. Der Admin-Bereich zeigt nur Kontodaten (Name, Firma, Lehrberuf, Aktivität und belegten Speicher), keine Berichte. Als Betreiber des Servers hat der Verantwortliche technisch Zugriff auf alle gespeicherten Daten. Er nutzt diesen Zugriff nur für Wartung, Fehlerbehebung und Sicherungen.</p>
      ${h('8. Wie lange werden Daten gespeichert?')}
      <p>So lange dein Konto besteht. Nach dem Ende deiner Ausbildung kann dein Konto mit allen Berichten gelöscht werden. Du bekommst vorher einen Hinweis, um alles als PDF zu sichern. Zur Ausfallsicherheit gibt es Sicherungskopien des Servers: tägliche werden nach 14 Tagen gelöscht, monatliche nach spätestens 4 Jahren. Ausbildungsnachweise werden oft noch nach der Prüfung gebraucht.</p>
      ${h('9. Rechtsgrundlage')}
      <p>Die Verarbeitung ist nötig, damit du das Berichtsheft nutzen kannst (Art. 6 Abs. 1 lit. b DSGVO). Der Schutz vor Missbrauch und die Sicherungskopien beruhen auf dem berechtigten Interesse an einem sicheren Betrieb (Art. 6 Abs. 1 lit. f DSGVO). Die Nutzung ist freiwillig.</p>
      ${h('10. Deine Rechte')}
      <ul>
        <li><strong>Auskunft und Kopie</strong> (Art. 15 und 20 DSGVO): Deine Angaben siehst du unter Einstellungen, alle Berichte bekommst du dort über „Alle Berichte sichern“ als ZIP-Datei.</li>
        <li><strong>Berichtigung</strong> (Art. 16): Angaben und Berichte kannst du selbst ändern.</li>
        <li><strong>Löschung, Einschränkung, Widerspruch</strong> (Art. 17, 18, 21): bitte formlos an die oben genannte Kontaktadresse.</li>
        <li><strong>Beschwerde</strong> (Art. 77) bei einer Datenschutz-Aufsichtsbehörde, z. B. der Landesbeauftragten für Datenschutz und Informationsfreiheit der Freien Hansestadt Bremen.</li>
      </ul></div>`;
  }

  /* ---------- Hilfe ---------- */
  function viewHelp() {
    const q = (t, b, open) => `<details ${open ? 'open' : ''}><summary>${t}</summary><div>${b}</div></details>`;
    app.innerHTML = `<div class="toprow"><a href="#/" class="back">‹ Zurück</a></div><h1>Anleitung</h1><p class="muted">Kurz erklärt, Schritt für Schritt.</p>
      ${S.user && !isAdmin() ? '<div class="actions"><button class="primary" id="tourbtn">Einführung noch einmal ansehen</button></div><div class="mt"></div>' : ''}
      ${q('Erste Anmeldung', '<ol><li>Benutzername und Startpasswort vom Admin eingeben.</li><li>Ein eigenes Passwort festlegen.</li><li>Name, Firma, Lehrberuf, Lehrjahr und das Jahr, in dem die Ausbildung endet, eintragen.</li></ol>', true)}
      ${q('Einmal einrichten', '<ol><li><strong>Einstellungen → Unterschrift:</strong> mit Finger oder Maus unterschreiben, oder ein Foto deiner Unterschrift auf weißem Papier hochladen.</li><li><strong>Einstellungen → Arbeitsorte:</strong> z. B. Überschrift „Hof“, Adresse „Liebauer Straße 14, Bremen“, Bereich „AW“, Ausbilder/Geselle „Herr Müller“.</li><li>Stunden pro Tag und feste Berufsschultage einstellen.</li></ol>')}
      ${q('Neuen Wochenbericht anlegen', '<ol><li>Auf der Startseite <strong>Neuer Wochenbericht</strong> tippen.</li><li><strong>Diese Woche</strong> oder <strong>Nächste Woche</strong> wählen, oder ein beliebiges Datum. Die Woche wird automatisch auf Montag bis Sonntag gesetzt.</li><li>Die Nummer zählt von selbst weiter. Nur ändern, wenn sie nicht stimmt.</li><li>Ausbildungsbereich wählen, z. B. AW, BBS oder Betrieb.</li></ol>')}
      ${q('Tage ausfüllen', '<ul><li>Alles wird beim Schreiben gespeichert. Du kannst den Bericht jederzeit schließen und später weitermachen, auch auf einem anderen Gerät.</li><li><strong>Einfügen:</strong> setzt einen Arbeitsort oder Textbaustein an der Stelle ein, wo der Cursor steht.</li><li><strong>Markiertes merken:</strong> Text im Feld markieren und tippen. Er wird ein Textbaustein für später.</li><li><strong>Ideen:</strong> Vorschläge aus deinen früheren Berichten und den anderen Tagen der Woche. Einfügen oder kopieren, danach selbst anpassen.</li><li><strong>Rückgängig:</strong> macht das letzte Einfügen, die letzte Idee oder Korrektur wieder rückgängig.</li><li>Über das kleine Auswahlfeld beim Tag stellst du Urlaub, Krank, Feiertag oder Berufsschule ein.</li></ul>')}
      ${q('Rechtschreibung', '<ul><li>Wird beim Schreiben automatisch geprüft. Fehler sind direkt im Text farbig unterstrichen: <span class="dot a-rs"></span>Rechtschreibung, <span class="dot a-gr"></span>Grammatik, <span class="dot a-zs"></span>Zeichensetzung, <span class="dot a-st"></span>Stil.</li><li>Markiertes Wort antippen: grüner Knopf = Vorschlag übernehmen, „So lassen“ = Hinweis ausblenden.</li><li>„Alle Rechtschreibfehler korrigieren“ übernimmt jeweils den ersten Vorschlag. Mit „Rückgängig“ nimmst du es zurück.</li><li>Fachwörter mit „Ins Wörterbuch“ speichern.</li><li>In den Einstellungen kannst du die <strong>genaue Prüfung</strong> einschalten (auch Stil und Füllwörter).</li></ul>')}
      ${q('Speicherplatz', 'Jedes Konto hat eine Speichergrenze, damit der Server nicht voll wird. Wie viel belegt ist, siehst du in den Einstellungen. Berichte brauchen nur wenige KB. Wenn es voll ist, kann der Admin dir mehr geben.')}
      ${q('Unterschreiben und PDF speichern', '<ol><li>Unter dem Formular das Datum wählen (heute oder ein anderes).</li><li><strong>Prüfen & unterschreiben</strong> tippen. Es wird noch einmal alles geprüft.</li><li><strong>PDF speichern</strong> tippen. Am iPhone „In Dateien sichern“ wählen, am PC mit Chrome/Edge kannst du einen festen Ordner einstellen.</li></ol>')}
      ${q('Später etwas ändern', 'Nach dem Unterschreiben kannst du einen Bericht noch 3 Monate lang über <strong>Nachträglich bearbeiten</strong> ändern. Danach musst du neu unterschreiben, im PDF steht dann klein „korrigiert“.')}
      ${q('Alle Berichte sichern', 'Unter <strong>Einstellungen → Alle Berichte sichern</strong> lädst du jederzeit alle PDFs als ZIP-Datei herunter. Am besten ab und zu machen, spätestens zum Ende der Ausbildung.')}
      ${q('Passwort vergessen?', 'Ein neues Passwort kann nur der Admin erstellen. Melde dich bei ihm, du bekommst ein neues Startpasswort. Damit meldest du dich an und legst wieder ein eigenes fest.')}
      ${q('Als App auf den Startbildschirm', '<ul><li><strong>iPhone (Safari):</strong> Teilen-Symbol → „Zum Home-Bildschirm“.</li><li><strong>Android (Chrome):</strong> Menü ⋮ → „Zum Startbildschirm hinzufügen“.</li></ul>')}
      <p class="muted mt2">${esc(HINWEIS)}</p>`;
    const t = $('#tourbtn'); if (t) t.onclick = () => tutorial(true);
  }

  /* ---------- Startseite ---------- */
  function statusChip(r) {
    if (r.status === 'abgeschlossen') return r.editable ? '<span class="chip ok">Fertig</span>' : '<span class="chip">Archiviert</span>';
    return '<span class="chip warn">In Bearbeitung</span>';
  }
  async function viewHome() {
    app.innerHTML = '<p class="loading">Lädt …</p>';
    let reports, next;
    try { let st; [{ reports }, next, st] = await Promise.all([api('GET', '/api/reports'), api('GET', '/api/report/next'), api('GET', '/api/state')]); S = { ...S, ...st }; }
    catch (x) { app.innerHTML = `<div class="msg err">${esc(x.message)}</div>`; return; }
    const sperren = Object.keys(S.settings.funktionen).filter(locked);
    let html = `<p class="hello"><strong>Hallo ${esc(S.user.vorname)}!</strong> <span class="muted">${esc(S.user.firma)}</span></p>`;
    if (sperren.length) html += `<div class="msg warn">Gerade gesperrt: ${sperren.map((k) => esc(S.settings.funktionen[k])).join(', ')}. ${esc(S.settings.sperrText)}</div>`;
    const sp = S.user.speicher;
    if (sp && sp.prozent >= 90) html += `<div class="msg ${sp.prozent >= 100 ? 'err' : 'warn'}">Dein Speicherplatz ist ${sp.prozent >= 100 ? 'voll' : 'fast voll'} (${mb(sp.used)} von ${mb(sp.quota)} MB). Bitte beim Admin mehr Speicher anfragen.</div>`;
    if (!next.hasSignature) html += `<div class="msg info">✍ Noch keine Unterschrift hinterlegt. Das geht in den <a href="#/einstellungen">Einstellungen</a>.</div>`;
    html += `<button class="primary big" id="newbtn" ${locked('neu') ? 'disabled' : ''}><span class="plus">+</span> Neuer Wochenbericht</button>
      <h2 class="mt2">Meine Berichte</h2>`;
    const item = (r) => `<a class="item link" href="#/bericht/${esc(r.id)}">
        <div class="nr">${r.nr}</div>
        <div class="main"><strong>KW ${r.kw} · ${deShort(r.weekStart)} – ${de(r.bis)}</strong>
        <span class="muted">${esc(r.bereich || '–')}${r.status === 'abgeschlossen' ? ' · unterschrieben ' + deDate(r.signedAt) : ` · ${r.filled} von ${r.total} Tagen ausgefüllt`}</span>
        ${r.status === 'abgeschlossen' ? '' : `<div class="progress"><span data-p="${Math.round(100 * r.filled / Math.max(1, r.total))}"></span></div>`}</div></a>`;
    /* Gestaffelt: In Bearbeitung, Fertig (unterschrieben, noch aenderbar), Archiviert (Frist abgelaufen) */
    const gruppen = [
      ['In Bearbeitung', reports.filter((r) => r.status !== 'abgeschlossen'), ''],
      ['Fertig', reports.filter((r) => r.status === 'abgeschlossen' && r.editable), `Unterschrieben, noch ${S.settings.bearbeitbarTage} Tage nach dem Unterschreiben änderbar`],
      ['Archiviert', reports.filter((r) => r.status === 'abgeschlossen' && !r.editable), 'Bearbeitungsfrist abgelaufen, nur noch ansehen und herunterladen'],
    ];
    if (!reports.length) html += '<div class="card muted">Noch keine Berichte. Tippe oben auf „Neuer Wochenbericht“.</div>';
    else for (const [titel, liste, info] of gruppen) {
      if (!liste.length) continue;
      const kopf = `<span>${titel}</span> <span class="count">${liste.length}</span>`;
      const inhalt = `${info ? `<p class="muted small-t">${esc(info)}</p>` : ''}<div class="list">${liste.map(item).join('')}</div>`;
      html += titel === 'Archiviert'
        ? `<details class="gruppe"><summary class="ghead">${kopf}</summary>${inhalt}</details>`
        : `<section class="gruppe"><h3 class="ghead">${kopf}</h3>${inhalt}</section>`;
    }
    app.innerHTML = html;
    /* Fortschrittsbalken per Skript setzen (Inline-Styles sind aus Sicherheitsgruenden gesperrt) */
    fillBars();
    const btn = $('#newbtn'); if (btn) btn.onclick = () => newReport(next);
  }

  async function exportAll(btn) {
    await busy(btn, async () => {
      toast('ZIP wird erstellt …');
      const res = await fetch('/api/export', { credentials: 'same-origin' });
      if (!res.ok) { let m = 'Sichern hat nicht geklappt.'; try { m = (await res.json()).error || m; } catch {} return toast(m); }
      const blob = await res.blob();
      const name = (/filename\*=UTF-8''([^;]+)/.exec(res.headers.get('Content-Disposition') || '') || [])[1];
      const file = new File([blob], name ? decodeURIComponent(name) : 'Berichtsheft.zip', { type: 'application/zip' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
        try { await navigator.share({ files: [file], title: file.name }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('Heruntergeladen: ' + file.name);
    });
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-export]'); if (b) exportAll(b); });

  function bereichListe(extra) {
    const fromOrte = (S.user.orte || []).map((o) => o.label).filter(Boolean);
    return [...new Set([...(S.settings.bereiche || []), ...fromOrte, extra].filter(Boolean))];
  }

  async function newReport(next) {
    const nextWeek = addDays(next.thisWeek, 7);
    let chosen = next.weekStart;
    const res = await modal(`<form><h2>Neuer Wochenbericht</h2>
      <label>Welche Woche?</label>
      <div class="weekpick"><button type="button" data-w="${next.thisWeek}">Diese Woche</button><button type="button" data-w="${nextWeek}">Nächste Woche</button></div>
      <label>… oder ein Datum aus der Woche</label><input type="date" id="wdate" value="${chosen}">
      <div class="range" id="range"></div><div id="taken"></div>
      <input type="hidden" name="weekStart" value="${chosen}">
      <label>Nummer</label><input type="number" name="nr" min="1" max="9999" value="${next.nr}" required>
      <div class="hint">Zählt automatisch weiter. Nur ändern, wenn sie nicht stimmt.</div>
      <label>Ausbildungsbereich</label><select name="bereich">${bereichListe(next.bereich).map((b) => `<option ${b === next.bereich ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
      <div class="hint">Eigene Bereiche legst du unter Einstellungen → Arbeitsorte an.</div>
      <div class="actions"><button class="primary" data-m="form">Bericht anlegen</button><button type="button" data-m="cancel">Abbrechen</button></div></form>`,
    (box) => {
      const upd = (d) => {
        chosen = monday(d);
        $('input[name=weekStart]', box).value = chosen;
        $('#wdate', box).value = d;
        $('#range', box).textContent = `Montag ${de(chosen)} bis Sonntag ${de(addDays(chosen, 6))}`;
        $$('[data-w]', box).forEach((b) => b.classList.toggle('on', b.dataset.w === chosen));
        $('#taken', box).innerHTML = next.taken.includes(chosen) ? '<div class="msg info">Für diese Woche gibt es schon einen Bericht. Er wird geöffnet.</div>' : '';
      };
      $$('[data-w]', box).forEach((b) => { b.onclick = () => upd(b.dataset.w); });
      $('#wdate', box).onchange = (e) => { if (e.target.value) upd(e.target.value); };
      upd(chosen);
    });
    if (!res || typeof res !== 'object') return;
    try {
      const r = await api('POST', '/api/report/new', res);
      if (r.existed) toast('Für diese Woche gibt es schon einen Bericht.');
      location.hash = '#/bericht/' + r.id;
    } catch (x) { toast(x.message); }
  }

  /* ---------- Bericht (sieht aus wie das Formular) ---------- */
  const R = { id: null, rep: null, dirty: false, saveTimer: null, saving: null, checks: {}, checkTimers: {}, ignored: new Set(), undo: {}, panel: {}, showList: {} };
  const editable = () => R.rep && R.rep.status !== 'abgeschlossen' && !locked('bearbeiten');
  function fillText(type, hol) { return ((S.settings.vorbelegung || {})[type] || '').replace(/\{name\}/g, hol || ''); }

  async function viewReport(id) {
    R.id = id; R.checks = {}; R.dirty = false; R.undo = {}; R.panel = {}; R.showList = {};
    app.innerHTML = '<p class="loading">Lädt …</p>';
    try { const [rr, st] = await Promise.all([api('GET', '/api/report?id=' + encodeURIComponent(id)), api('GET', '/api/state')]); R.rep = rr.report; S = { ...S, ...st }; }
    catch (x) { app.innerHTML = `<div class="msg err">${esc(x.message)}</div><a href="#/">Zurück</a>`; return; }
    if (R.id !== id) return;
    drawReport();
    if (editable()) R.rep.days.forEach((d, i) => { if (d.text.trim()) runCheck(i); });
  }

  function drawReport() {
    const r = R.rep, ed = editable(), u = S.user;
    let html = `<div class="toprow"><a href="#/" class="back">‹ Meine Berichte</a><span class="spacer"></span>${statusChip(r)}</div>`;
    html += lockNote('bearbeiten');
    if (r.status === 'abgeschlossen') {
      html += `<div class="card done"><p><strong>✓ Unterschrieben</strong> mit Datum ${de(r.sigDate)}${r.korrigiertAm ? ' (korrigiert)' : ''}</p>
        <p class="muted fname">${esc(r.file)}</p>${lockNote('pdf')}
        <div class="actions"><button class="primary" data-act="save" ${locked('pdf') ? 'disabled' : ''}>PDF speichern</button>
        <a class="btn ${locked('pdf') ? 'disabled' : ''}" href="/api/pdf?id=${esc(r.id)}&view=1" target="_blank" rel="noopener">Ansehen</a>
        ${r.editable ? `<button data-act="reopen" ${locked('bearbeiten') ? 'disabled' : ''}>Nachträglich bearbeiten</button>` : ''}
        <button class="danger" data-act="delete">Löschen</button></div>
        <p class="muted">${r.editable ? `Noch bearbeitbar bis ${de(r.deadline.slice(0, 10))}.` : 'Die Bearbeitungsfrist ist abgelaufen.'}</p></div>`;
    }
    html += `<div class="sheet">
      <div class="sheet-head"><div><div class="sheet-title">Ausbildungsnachweis (Berichtsheft)</div><div class="muted">täglich · KW ${r.kw}/${r.jahr}</div></div>
        <label class="nrbox">Nr.${ed ? `<input type="number" min="1" max="9999" data-f="nr" value="${r.nr}" aria-label="Nummer">` : `<b>${r.nr}</b>`}</label></div>
      <table class="hdr"><tbody>
        <tr><th><span class="lg">Name des/der Auszubildenden</span><span class="sm">Name</span></th><td colspan="3">${esc(u.vorname)} ${esc(u.nachname)}</td></tr>
        <tr><th><span class="lg">Ausbildungsjahr</span><span class="sm">Lehrjahr</span></th><td>${ed ? `<select data-f="ausbildungsjahr">${[1, 2, 3, 4].map((n) => `<option ${n === Number(r.ausbildungsjahr) ? 'selected' : ''}>${n}</option>`).join('')}</select>` : r.ausbildungsjahr}</td>
          <th><span class="lg">Ausbildungsbereich</span><span class="sm">Bereich</span></th><td>${ed ? `<select data-f="bereich">${bereichListe(r.bereich).map((b) => `<option ${b === r.bereich ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>` : esc(r.bereich)}</td></tr>
        <tr><th><span class="lg">Ausbildungswoche vom</span><span class="sm">Woche vom</span></th><td>${de(r.weekStart)}</td><th>bis</th><td>${de(r.bis)}</td></tr>
      </tbody></table>
      <div class="days"><div class="dhead"><span></span><span>Betriebliche Tätigkeiten, Unterweisungen, Unterricht, Themen der Berufsschule</span><span>Std.</span></div>
      ${r.days.map((d, i) => dayRow(d, i, ed)).join('')}</div>
      ${ed ? `<label class="inline wkend"><input type="checkbox" data-f="wochenende" ${r.days.some((d) => wd(d.date) >= 5) ? 'checked' : ''}> Samstag und Sonntag auch eintragen <span class="muted">(z. B. bei Wochenendarbeit)</span></label>` : ''}`;
    if (ed) {
      html += `<div class="sigrow"><div><label for="sigdate">Datum</label><input type="date" id="sigdate" value="${today()}" max="${today()}"></div>
        <div class="sigprev">${u.hasSignature ? `<img src="/api/me/signature?t=${Date.now()}" alt="Unterschrift">` : '<a href="#/einstellungen">Unterschrift hinterlegen</a>'}</div>
        <div class="siglabel muted">Datum, Unterschrift Auszubildende/r</div></div>`;
    }
    html += '</div>';
    if (ed) {
      html += `<div class="card actionsbar"><span class="savestate" id="savestate">✓ Gespeichert</span><span class="spacer"></span>
        <button class="small danger" data-act="delete">Löschen</button>
        <button type="button" data-act="preview">Vorschau mit Unterschrift</button>
        <button class="primary" data-act="finish" ${locked('unterschreiben') ? 'disabled' : ''}>Prüfen & unterschreiben</button><div id="finerr" class="full">${lockNote('unterschreiben')}</div></div>`;
    }
    app.innerHTML = html;
    $$('textarea[data-k=text]').forEach(autosize);
    bindReport();
  }

  function dayRow(d, i, ed) {
    const hol = R.rep.holidays[i];
    const fit = R.rep.fits[wd(d.date)];
    const types = S.settings.typen;
    return `<div class="drow t-${d.type}" id="day-${i}">
      <div class="dlabel"><span>${TAGE[wd(d.date)]}</span></div>
      <div class="dtext">
        <div class="dmeta"><b>${deShort(d.date)}</b>${hol ? `<span class="hol">${esc(hol)}</span>` : ''}
          ${ed ? `<select data-i="${i}" data-k="type" aria-label="Art des Tages">${Object.entries(types).map(([k, t]) => `<option value="${k}" ${k === d.type ? 'selected' : ''}>${t}</option>`).join('')}</select>` : `<span class="muted">${types[d.type]}</span>`}</div>
        ${ed ? `<div class="tawrap"><div class="mirror" id="mir-${i}" aria-hidden="true">${esc(d.text)}&#8203;</div><textarea data-i="${i}" data-k="text" spellcheck="false" lang="de" rows="4" placeholder="Was hast du an diesem Tag gemacht?">${esc(d.text)}</textarea></div>
        <div class="tools">
          <button type="button" data-act="insert" data-i="${i}">＋ Einfügen</button>
          <button type="button" data-act="ideas" data-i="${i}" ${locked('ideen') ? 'disabled' : ''}>💡 Ideen</button>
          <button type="button" data-act="remember" data-i="${i}">★ Markiertes merken</button>
          <button type="button" data-act="undo" data-i="${i}" id="undo-${i}" ${(R.undo[i] || []).length ? '' : 'disabled'}>↶ Rückgängig</button>
        </div><div id="panel-${i}"></div>`
      : `<div class="readonly">${esc(d.text) || '&nbsp;'}</div>`}
        <div class="fit" id="fit-${i}">${fit && !fit.fits ? fitMsg(fit) : ''}</div>
        <div class="issues" id="iss-${i}"></div>
      </div>
      <div class="dhours">${ed ? `<input type="number" data-i="${i}" data-k="hours" min="0" max="24" step="0.1" value="${d.hours}" aria-label="Stunden">` : esc(String(d.hours).replace('.', ','))}</div>
    </div>`;
  }
  const fitMsg = (f) => `<span class="toolong">Zu lang für das Feld im Formular (${f.over} Zeile${f.over === 1 ? '' : 'n'} zu viel) – bitte etwas kürzen.</span>`;

  /* Text programmgesteuert aendern, mit Rueckgaengig */
  function setText(i, value, cursor) {
    const day = R.rep.days[i];
    if (value === day.text) return;
    (R.undo[i] ||= []).push(day.text);
    if (R.undo[i].length > 40) R.undo[i].shift();
    day.text = value;
    const ta = $(`textarea[data-i="${i}"]`);
    if (ta) { ta.value = value; autosize(ta); if (cursor !== undefined) { ta.focus(); ta.setSelectionRange(cursor, cursor); } }
    drawMirror(i);
    const u = $('#undo-' + i); if (u) u.disabled = false;
    markDirty(true);
    runCheck(i);
  }
  function undo(i) {
    const st = R.undo[i] || []; if (!st.length) return;
    const prev = st.pop(), day = R.rep.days[i];
    day.text = prev;
    const ta = $(`textarea[data-i="${i}"]`); if (ta) { ta.value = prev; autosize(ta); }
    drawMirror(i);
    const u = $('#undo-' + i); if (u) u.disabled = !st.length;
    markDirty(true); runCheck(i);
    toast('Rückgängig gemacht.');
  }
  /* An der Cursor-Stelle einfuegen, mit sinnvollem Abstand */
  const lastCursor = {};
  function insertAt(i, snippet) {
    const day = R.rep.days[i], t = day.text;
    const ta = $(`textarea[data-i="${i}"]`);
    let pos = lastCursor[i] ?? t.length;
    if (pos > t.length) pos = t.length;
    const before = t.slice(0, pos), after = t.slice(pos);
    let sep = '';
    if (before.trim()) sep = /[\s(„"-]$/.test(before) ? '' : /[.!?:;,]$/.test(before.trimEnd()) ? ' ' : ', ';
    const tail = after && !/^[\s.,;:)]/.test(after) ? ' ' : '';
    const value = before + sep + snippet + tail + after;
    setText(i, value, (before + sep + snippet).length);
    lastCursor[i] = (before + sep + snippet).length;
    if (ta) ta.blur();
  }

  function openPanel(i, kind, html) {
    const el = $('#panel-' + i);
    if (R.panel[i] === kind) { el.innerHTML = ''; R.panel[i] = null; return; }
    R.panel[i] = kind; el.innerHTML = `<div class="panel">${html}</div>`;
  }
  function ortText(o) { return [o.titel, o.adresse ? `(${o.adresse})` : ''].filter(Boolean).join(' '); }
  function insertPanel(i) {
    const orte = S.user.orte || [], bs = S.user.bausteine || [];
    let html = '';
    if (orte.length) {
      html += '<h4>Arbeitsorte</h4>' + orte.map((o, k) => `<div class="pick">
        ${o.titel || o.adresse ? `<button type="button" data-act="ins" data-i="${i}" data-src="ort" data-k="${k}" data-p="ort">${esc(ortText(o))}</button>` : ''}
        ${o.person ? `<button type="button" data-act="ins" data-i="${i}" data-src="ort" data-k="${k}" data-p="person">mit ${esc(o.person)}</button>` : ''}
        ${o.titel && o.person ? `<button type="button" data-act="ins" data-i="${i}" data-src="ort" data-k="${k}" data-p="beides">${esc(o.titel)} mit ${esc(o.person)}</button>` : ''}</div>`).join('');
    }
    if (bs.length) html += '<h4>Textbausteine</h4><div class="pick">' + bs.map((b, k) => `<button type="button" data-act="ins" data-i="${i}" data-src="bs" data-k="${k}">${esc(b.text)}</button>`).join('') + '</div>';
    if (!html) html = '<p class="muted">Noch nichts angelegt. Unter <a href="#/einstellungen">Einstellungen</a> kannst du Arbeitsorte anlegen, oder du markierst hier Text und tippst „Markiertes merken“.</p>';
    else html += '<p class="muted small-t">Wird an der Stelle eingefügt, wo der Cursor zuletzt stand. <a href="#/einstellungen">Verwalten</a></p>';
    openPanel(i, 'insert', html);
  }
  async function ideasPanel(i) {
    if (R.panel[i] === 'ideas') return openPanel(i, 'ideas');
    openPanel(i, 'ideas', '<p class="muted">Suche passende Ideen …</p>');
    try {
      const { ideas } = await api('POST', '/api/ideas', { id: R.rep.id, day: i, text: R.rep.days[i].text, week: R.rep.days.filter((_, k) => k !== i).map((d) => d.text) });
      if (R.panel[i] !== 'ideas') return;
      R.ideas = R.ideas || {}; R.ideas[i] = ideas;
      $('#panel-' + i).innerHTML = `<div class="panel"><h4>Ideen für ${TAGE[wd(R.rep.days[i].date)]}</h4>
        ${ideas.length ? ideas.map((x, k) => `<div class="idea"><div class="t">${esc(x.text)}<span class="q">${esc(x.quelle)}</span></div>
          <button type="button" class="ins" data-act="idea" data-i="${i}" data-k="${k}">Einfügen</button>
          <button type="button" data-act="ideacopy" data-i="${i}" data-k="${k}">Kopieren</button></div>`).join('')
      : '<p class="muted">Noch keine Ideen. Je mehr Berichte du schreibst, desto besser werden die Vorschläge.</p>'}
        <p class="muted small-t">Vorschläge aus deinen eigenen Berichten und den anderen Tagen dieser Woche. Danach bitte selbst anpassen.</p></div>`;
    } catch (x) { $('#panel-' + i).innerHTML = `<div class="panel"><div class="msg err">${esc(x.message)}</div></div>`; }
  }
  async function remember(i) {
    const ta = $(`textarea[data-i="${i}"]`);
    let sel = ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd).trim() : '';
    if (!sel && R.lastSel && R.lastSel.i === i) sel = R.lastSel.text;
    if (!sel) return toast('Erst ein Stück Text im Feld markieren, dann „Markiertes merken“ tippen.');
    if (sel.length > 300) return toast('Bitte höchstens 300 Zeichen markieren.');
    if ((S.user.bausteine || []).some((b) => b.text === sel)) return toast('Diesen Baustein gibt es schon.');
    try { S.user = (await api('POST', '/api/me', { bausteine: [...(S.user.bausteine || []), { text: sel }] })).user; toast(`Gemerkt: „${sel.slice(0, 40)}${sel.length > 40 ? '…' : ''}“`); }
    catch (x) { toast(x.message); }
  }

  /* Cursor und Markierung merken, bevor ein Knopf getippt wird (Handy verliert sie sonst) */
  function track(e) {
    const ta = e.target; if (!ta || !ta.dataset || ta.dataset.k !== 'text' || !R.rep) return;
    const i = Number(ta.dataset.i);
    lastCursor[i] = ta.selectionEnd;
    if (ta.selectionEnd > ta.selectionStart) R.lastSel = { i, text: ta.value.slice(ta.selectionStart, ta.selectionEnd).trim() };
  }
  ['keyup', 'mouseup', 'touchend', 'select'].forEach((ev) => app.addEventListener(ev, track));
  document.addEventListener('selectionchange', () => track({ target: document.activeElement }));

  function bindReport() {
    app.onclick = async (e) => {
      if (e.target.matches && e.target.matches('textarea[data-k=text]')) { const ta = e.target; return setTimeout(() => popover(Number(ta.dataset.i), ta.selectionStart), 0); }
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act, i = Number(b.dataset.i);
      if (act === 'save') return busy(b, () => savePdf(R.rep));
      if (act === 'reopen') return reopen();
      if (act === 'preview') {
        const d = ($('#sigdate') || {}).value || today();
        await flushSave();
        return window.open(`/api/pdf?id=${encodeURIComponent(R.rep.id)}&view=1&preview=1&date=${d}`, '_blank', 'noopener');
      }
      if (act === 'delete') return del();
      if (act === 'finish') return finish(b);
      if (act === 'fix') return applyFix(i, Number(b.dataset.m), b.dataset.v);
      if (act === 'ignore') { R.ignored.add(b.dataset.key); renderIssues(i); return; }
      if (act === 'dict') return addDict(b.dataset.word);
      if (act === 'insert') return insertPanel(i);
      if (act === 'ideas') return ideasPanel(i);
      if (act === 'remember') return remember(i);
      if (act === 'undo') return undo(i);
      if (act === 'fixall') return fixAll(i);
      if (act === 'list') { R.showList[i] = !R.showList[i]; return renderIssues(i); }
      if (act === 'ins') {
        let t = '';
        if (b.dataset.src === 'bs') t = S.user.bausteine[Number(b.dataset.k)].text;
        else { const o = S.user.orte[Number(b.dataset.k)]; t = b.dataset.p === 'person' ? `mit ${o.person}` : b.dataset.p === 'beides' ? `${o.titel} mit ${o.person}` : ortText(o); }
        return insertAt(i, t);
      }
      if (act === 'idea') return insertAt(i, R.ideas[i][Number(b.dataset.k)].text);
      if (act === 'ideacopy') return copy(R.ideas[i][Number(b.dataset.k)].text);
    };
    if (!editable()) return;
    app.oninput = (e) => {
      const el = e.target;
      if (el.dataset.f === 'nr') { R.rep.nr = Number(el.value) || R.rep.nr; markDirty(); return; }
      if (el.dataset.i === undefined) return;
      const i = Number(el.dataset.i), day = R.rep.days[i];
      if (el.dataset.k === 'text') { day.text = el.value; lastCursor[i] = el.selectionEnd; autosize(el); drawMirror(i); hidePop(); markDirty(); scheduleCheck(i); }
      if (el.dataset.k === 'hours') { day.hours = Number(el.value) || 0; markDirty(); }
    };
    app.onchange = (e) => {
      const el = e.target;
      if (el.dataset.f === 'bereich') { R.rep.bereich = el.value; markDirty(true); return; }
      if (el.dataset.f === 'wochenende') { wochenende(el.checked, el); return; }
      if (el.dataset.f === 'ausbildungsjahr') { R.rep.ausbildungsjahr = Number(el.value); markDirty(true); return; }
      if (el.dataset.k !== 'type') return;
      const i = Number(el.dataset.i), day = R.rep.days[i], old = day.type, hol = R.rep.holidays[i];
      day.type = el.value;
      if (!day.text.trim() || day.text === fillText(old, hol)) day.text = fillText(day.type, hol);
      day.hours = day.type === 'betrieb' ? Number(S.user.stunden) || 7.6 : day.type === 'schule' ? Number(S.user.schulstunden) || 7.6 : 0;
      $('#day-' + i).outerHTML = dayRow(day, i, true);
      autosize($(`textarea[data-i="${i}"]`));
      markDirty(true); runCheck(i);
    };
    app.onfocusout = (e) => {
      const k = e.target.dataset && e.target.dataset.k;
      if (k === 'text') runCheck(Number(e.target.dataset.i));
      if (R.dirty) save();
    };
  }

  /* Samstag/Sonntag nur bei Bedarf: per Haken unten ein- oder ausblenden */
  async function wochenende(on, box) {
    const r = R.rep;
    if (on) {
      for (const k of [5, 6]) {
        const date = addDays(r.weekStart, k);
        if (!r.days.some((d) => d.date === date)) { r.days.push({ date, type: 'betrieb', hours: Number(S.user.stunden) || 7.6, text: '' }); r.holidays.push(''); }
      }
    } else {
      const we = r.days.filter((d) => wd(d.date) >= 5);
      if (we.some((d) => d.text.trim())) {
        const ok = await modal('<h2>Wochenende entfernen?</h2><p>Bei Samstag oder Sonntag steht schon Text. Der wird gelöscht.</p><div class="actions"><button class="danger" data-m="y">Entfernen</button><button data-m="n">Abbrechen</button></div>');
        if (ok !== 'y') { box.checked = true; return; }
      }
      const keep = r.days.map((d, i) => wd(d.date) < 5 ? i : -1).filter((i) => i >= 0);
      r.holidays = keep.map((i) => r.holidays[i] || '');
      r.days = keep.map((i) => r.days[i]);
    }
    const order = r.days.map((d, i) => [d, r.holidays[i] || '']).sort((a, b) => a[0].date.localeCompare(b[0].date));
    r.days = order.map((x) => x[0]); r.holidays = order.map((x) => x[1]);
    R.checks = {}; R.undo = {}; R.panel = {};
    drawReport();
    r.days.forEach((d, i) => { if (d.text.trim()) runCheck(i); });
    markDirty(true);
    if (on) { const el = $('#day-' + (r.days.length - 2)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }

  function markDirty(now) {
    R.dirty = true;
    const s = $('#savestate'); if (s) s.textContent = 'Wird gespeichert …';
    clearTimeout(R.saveTimer);
    R.saveTimer = setTimeout(() => save(), now ? 50 : 1200);
  }
  async function save() {
    clearTimeout(R.saveTimer);
    if (!R.dirty || !R.rep) return;
    if (R.saving) { await R.saving; if (!R.dirty) return; }
    R.dirty = false;
    const rep = R.rep;
    R.saving = api('POST', '/api/report/save', { id: rep.id, nr: rep.nr, bereich: rep.bereich, ausbildungsjahr: rep.ausbildungsjahr, days: rep.days }).then((res) => {
      if (R.rep !== rep) return;
      rep.fits = res.report.fits; rep.file = res.report.file; rep.holidays = res.report.holidays;
      rep.days.forEach((d, i) => { const f = rep.fits[wd(d.date)], el = $('#fit-' + i); if (el) el.innerHTML = f && !f.fits ? fitMsg(f) : ''; });
      const s = $('#savestate'); if (s && !R.dirty) s.textContent = '✓ Gespeichert';
    }).catch((x) => {
      R.dirty = true;
      const s = $('#savestate'); if (s) s.textContent = 'Nicht gespeichert: ' + x.message;
    }).finally(() => { R.saving = null; });
    return R.saving;
  }
  async function flushSave() { if (R.dirty) await save(); else if (R.saving) await R.saving; }
  window.addEventListener('beforeunload', (e) => { if (R.dirty) { save(); e.preventDefault(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

  /* ---- Rechtschreibung und Grammatik ---- */
  function scheduleCheck(i) { clearTimeout(R.checkTimers[i]); R.checkTimers[i] = setTimeout(() => runCheck(i), 1500); }
  async function runCheck(i) {
    clearTimeout(R.checkTimers[i]);
    const day = R.rep && R.rep.days[i];
    if (!day || locked('pruefung')) return null;
    const t = day.text;
    if (R.checks[i] && R.checks[i].text === t) { renderIssues(i); return R.checks[i]; }
    if (!t.trim()) { R.checks[i] = { text: t, matches: [] }; renderIssues(i); return R.checks[i]; }
    try {
      const res = await api('POST', '/api/check', { text: t });
      if (!R.rep || R.rep.days[i] !== day) return null;
      R.checks[i] = { text: t, matches: res.matches || [], error: res.error };
    } catch (x) { R.checks[i] = { text: t, matches: [], error: x.message }; }
    if (day.text === t) renderIssues(i);
    return R.checks[i];
  }
  const keyOf = (m) => m.word.toLowerCase() + '|' + m.rule;
  function openIssues(i) {
    const c = R.checks[i];
    if (!c || c.text !== R.rep.days[i].text) return null;
    return c.matches.filter((m) => !R.ignored.has(keyOf(m)));
  }
  const ART = { rs: 'Rechtschreibung', gr: 'Grammatik', zs: 'Zeichensetzung', st: 'Stil' };
  /* Fehler direkt im Text farbig unterstreichen (Spiegel-Ebene hinter dem Textfeld) */
  function drawMirror(i) {
    const mir = $('#mir-' + i); if (!mir) return;
    const day = R.rep.days[i], c = R.checks[i];
    const list = c && c.text === day.text && !c.error ? openIssues(i) : [];
    let html = '', pos = 0;
    for (const m of [...list].sort((x, y) => x.offset - y.offset)) {
      if (m.offset < pos) continue;
      html += esc(day.text.slice(pos, m.offset)) + `<mark class="a-${m.art || 'gr'}" data-m="${c.matches.indexOf(m)}">${esc(day.text.substr(m.offset, m.length)) || ' '}</mark>`;
      pos = m.offset + m.length;
    }
    mir.innerHTML = html + esc(day.text.slice(pos)) + '&#8203;';
  }
  function autosize(ta) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight + 2, 88) + 'px'; }
  function renderIssues(i) {
    drawMirror(i);
    const box = $('#iss-' + i); if (!box) return;
    const c = R.checks[i];
    if (!c || c.text !== R.rep.days[i].text) { box.innerHTML = ''; return; }
    if (c.error) { box.innerHTML = `<div class="muted">${esc(c.error)}</div>`; return; }
    const list = openIssues(i);
    if (!list.length) { box.innerHTML = c.text.trim() ? '<div class="checkok">✓ Rechtschreibung und Grammatik in Ordnung</div>' : ''; return; }
    const count = {}; list.forEach((m) => { count[m.art || 'gr'] = (count[m.art || 'gr'] || 0) + 1; });
    const fixable = list.filter((m) => m.art === 'rs' && m.replacements.length).length;
    let html = `<div class="sumline">${Object.entries(count).map(([k, n]) => `<span class="dot a-${k}"></span>${n} ${ART[k]}`).join(' &nbsp;')}
      <span class="muted"> · markiertes Wort antippen</span></div>
      <div class="row sumbtns">${fixable > 1 ? `<button type="button" class="small ok" data-act="fixall" data-i="${i}">Alle ${fixable} Rechtschreibfehler korrigieren</button>` : ''}
      <button type="button" class="small" data-act="list" data-i="${i}">${R.showList[i] ? 'Liste ausblenden' : 'Als Liste zeigen'}</button></div>`;
    if (R.showList[i]) {
      html += list.map((m) => {
        const idx = c.matches.indexOf(m);
        const a = Math.max(0, m.offset - 25), b = Math.min(c.text.length, m.offset + m.length + 25);
        const ctx = (a > 0 ? '…' : '') + esc(c.text.slice(a, m.offset)) + `<mark class="a-${m.art}">` + esc(c.text.substr(m.offset, m.length)) + '</mark>' + esc(c.text.slice(m.offset + m.length, b)) + (b < c.text.length ? '…' : '');
        return `<div class="issue"><div><span class="dot a-${m.art}"></span>${esc(m.message)}</div><div class="ctx">${ctx}</div>${sugButtons(i, m, idx)}</div>`;
      }).join('');
    }
    box.innerHTML = html;
  }
  function sugButtons(i, m, idx) {
    return `<div class="sug">${m.replacements.map((v) => `<button class="fix" data-act="fix" data-i="${i}" data-m="${idx}" data-v="${esc(v)}">${esc(v) || '(entfernen)'}</button>`).join('')}
      <button data-act="ignore" data-i="${i}" data-key="${esc(keyOf(m))}">So lassen</button>
      ${m.typo ? `<button data-act="dict" data-word="${esc(m.word)}">Ins Wörterbuch</button>` : ''}</div>`;
  }
  /* Antippen eines markierten Wortes: kleines Fenster mit Vorschlaegen */
  function popover(i, caret) {
    hidePop();
    const c = R.checks[i], day = R.rep.days[i];
    if (!c || c.text !== day.text || c.error) return;
    const m = openIssues(i).find((x) => caret >= x.offset && caret <= x.offset + x.length);
    if (!m) return;
    const idx = c.matches.indexOf(m), mark = $(`#mir-${i} mark[data-m="${idx}"]`);
    if (!mark) return;
    const r = mark.getBoundingClientRect(), pop = document.createElement('div');
    pop.id = 'pop'; pop.className = 'pop';
    pop.innerHTML = `<div class="pophead"><span class="dot a-${m.art}"></span>${ART[m.art]}</div><div>${esc(m.message)}</div>${sugButtons(i, m, idx)}`;
    document.body.appendChild(pop);
    const w = Math.min(340, window.innerWidth - 16);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
    const below = r.bottom + 6, h = pop.offsetHeight;
    pop.style.top = (below + h > window.innerHeight - 70 ? Math.max(8, r.top - h - 6) : below) + 'px';
  }
  function hidePop() { const p = $('#pop'); if (p) p.remove(); }
  window.addEventListener('scroll', hidePop, { passive: true });
  document.addEventListener('click', (e) => { if (!e.target.closest('#pop') && !e.target.matches('textarea[data-k=text]')) hidePop(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#pop button[data-act]'); if (!b) return;
    const i = Number(b.dataset.i);
    if (b.dataset.act === 'fix') applyFix(i, Number(b.dataset.m), b.dataset.v);
    if (b.dataset.act === 'ignore') { R.ignored.add(b.dataset.key); renderIssues(i); }
    if (b.dataset.act === 'dict') addDict(b.dataset.word);
    hidePop();
  });
  function fixAll(i) {
    const c = R.checks[i], day = R.rep.days[i];
    if (!c || c.text !== day.text) return;
    let t = day.text;
    for (const m of openIssues(i).filter((x) => x.art === 'rs' && x.replacements.length).sort((x, y) => y.offset - x.offset)) {
      t = t.slice(0, m.offset) + m.replacements[0] + t.slice(m.offset + m.length);
    }
    setText(i, t);
    toast('Korrigiert. Mit „Rückgängig“ kannst du es zurücknehmen.');
  }
  function applyFix(i, mi, value) {
    const c = R.checks[i], day = R.rep.days[i];
    if (!c || c.text !== day.text) return runCheck(i);
    const m = c.matches[mi];
    setText(i, day.text.slice(0, m.offset) + value + day.text.slice(m.offset + m.length));
  }
  async function addDict(word) {
    try { S.user.woerterbuch = (await api('POST', '/api/me/dict', { add: word })).woerterbuch; } catch (x) { return toast(x.message); }
    Object.values(R.checks).forEach((c) => { c.matches = c.matches.filter((m) => !(m.typo && m.word.toLowerCase() === word.toLowerCase())); });
    R.rep.days.forEach((_, k) => renderIssues(k));
    toast(`„${word}“ steht jetzt in deinem Wörterbuch.`);
  }

  async function finish(btn) {
    const errEl = $('#finerr'); errBox(errEl, '');
    const date = $('#sigdate').value;
    if (!date) return errBox(errEl, 'Bitte ein Datum für die Unterschrift wählen.');
    await busy(btn, async () => {
      R.dirty = true; await save();
      if (R.dirty) return errBox(errEl, 'Speichern hat nicht geklappt. Bitte noch einmal versuchen.');
      if (!S.user.hasSignature) return errBox(errEl, 'Bitte zuerst in den Einstellungen deine Unterschrift hinterlegen.');
      const empty = R.rep.days.findIndex((d) => (d.type === 'betrieb' || d.type === 'schule') && !d.text.trim() && wd(d.date) < 5);
      if (empty >= 0) { $('#day-' + empty).scrollIntoView({ behavior: 'smooth', block: 'center' }); return errBox(errEl, `${TAGE[wd(R.rep.days[empty].date)]} ist noch leer.`); }
      const long = R.rep.days.findIndex((d) => { const f = R.rep.fits[wd(d.date)]; return f && !f.fits; });
      if (long >= 0) { $('#day-' + long).scrollIntoView({ behavior: 'smooth', block: 'center' }); return errBox(errEl, `${TAGE[wd(R.rep.days[long].date)]}: zu viel Text für das Feld. Bitte etwas kürzen.`); }
      btn.textContent = 'Prüfe …';
      let open = 0, failedCheck = false;
      if (!locked('pruefung')) {
        const results = await Promise.all(R.rep.days.map((_, i) => runCheck(i)));
        results.forEach((c, i) => { if (!c) return; if (c.error) failedCheck = true; open += (openIssues(i) || []).length; });
      }
      btn.textContent = 'Prüfen & unterschreiben';
      if (open) {
        const first = R.rep.days.findIndex((_, i) => (openIssues(i) || []).length);
        const ch = await modal(`<h2>Noch ${open} Hinweis${open > 1 ? 'e' : ''}</h2><p>Die Prüfung hat noch etwas gefunden. Unter dem Tag kannst du auswählen, was geändert werden soll, oder „So lassen“ tippen.</p>
          <div class="actions"><button class="primary" data-m="fix">Zu den Hinweisen</button><button data-m="go">Trotzdem unterschreiben</button></div>`);
        if (ch !== 'go') { if (first >= 0) $('#day-' + first).scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      } else if (failedCheck) {
        const ch = await modal('<h2>Prüfung nicht erreichbar</h2><p>Die Rechtschreibprüfung antwortet gerade nicht. Trotzdem unterschreiben?</p><div class="actions"><button data-m="go" class="primary">Trotzdem unterschreiben</button><button data-m="no">Abbrechen</button></div>');
        if (ch !== 'go') return;
      }
      const ok = await modal(`<h2>Unterschreiben</h2><p>Bericht Nr. ${R.rep.nr} bekommt deine Unterschrift mit dem Datum <strong>${de(date)}</strong> und wird als PDF erstellt.</p>
        <p><img class="sigimg" src="/api/me/signature?t=${Date.now()}" alt="Deine Unterschrift"></p>
        <p class="muted">Danach kannst du ihn noch ${S.settings.bearbeitbarTage} Tage lang ändern.</p>
        <div class="actions"><button class="ok" data-m="yes">Unterschreiben</button><button data-m="no">Abbrechen</button></div>`);
      if (ok !== 'yes') return;
      try {
        R.rep = (await api('POST', '/api/report/finish', { id: R.rep.id, date })).report;
        drawReport();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        toast('Fertig! Jetzt nur noch „PDF speichern“ tippen.');
      } catch (x) { errBox(errEl, x.message); }
    });
  }
  async function reopen() {
    const ok = await modal(`<h2>Nachträglich bearbeiten?</h2><p>Der Bericht wird wieder bearbeitbar. Danach musst du ihn erneut unterschreiben. Im PDF steht dann klein, dass er korrigiert wurde.</p>
      <div class="actions"><button class="primary" data-m="yes">Bearbeiten</button><button data-m="no">Abbrechen</button></div>`);
    if (ok !== 'yes') return;
    try { R.rep = (await api('POST', '/api/report/reopen', { id: R.rep.id })).report; drawReport(); } catch (x) { toast(x.message); }
  }
  async function del() {
    const r = R.rep;
    if (!r.firstSignedAt) {
      const ok = await modal(`<h2>Bericht löschen?</h2><p>Bericht Nr. ${r.nr} (KW ${r.kw}) wird endgültig gelöscht.</p><div class="actions"><button class="danger" data-m="yes">Löschen</button><button data-m="no">Abbrechen</button></div>`);
      if (ok !== 'yes') return;
    } else {
      /* Unterschriebener Bericht: vorher PDF sichern anbieten und LÖSCHEN eintippen lassen */
      for (;;) {
        const res = await modal(`<form><h2>Unterschriebenen Bericht löschen?</h2>
          <p>Bericht Nr. ${r.nr} (KW ${r.kw}) ist unterschrieben. Nach dem Löschen ist er <strong>weg</strong> und kann nicht wiederhergestellt werden. Speichere vorher das PDF, falls du es noch brauchst.</p>
          <label for="delok">Zum Bestätigen <strong>LÖSCHEN</strong> eintippen</label>
          <input id="delok" name="ok" autocomplete="off" autocapitalize="characters" required pattern="\\s*[Ll][Öö][Ss][Cc][Hh][Ee][Nn]\\s*">
          <div class="actions"><button class="danger" data-m="form">Endgültig löschen</button>
          <button type="button" data-m="pdf" ${locked('pdf') ? 'disabled' : ''}>Erst PDF speichern</button>
          <button type="button" data-m="no">Abbrechen</button></div></form>`);
        if (res === 'pdf') { try { await savePdf(r); } catch (x) { toast(x.message); } continue; }
        if (!res || typeof res !== 'object') return;
        break;
      }
    }
    try {
      R.dirty = false;
      await api('POST', '/api/report/delete', { id: r.id, bestaetigt: !!r.firstSignedAt });
      R.rep = null; toast(`Bericht Nr. ${r.nr} gelöscht.`); location.hash = '#/';
    } catch (x) { toast(x.message); }
  }

  /* ---------- Einstellungen ---------- */
  async function viewSettings() {
    const u = S.user;
    if (isAdmin()) {
      app.innerHTML = `<div class="card"><h1>Admin-Konto</h1><p class="muted">Der Admin-Zugang ist nur zum Verwalten da und hat kein eigenes Berichtsheft. Für deine eigenen Berichte legst du dir unter <a href="#/admin">Konten</a> ein persönliches Konto an.</p></div>
        <div class="card">${pwForm('Passwort ändern')}</div>`;
      return bindPw(() => toast('Passwort geändert.'));
    }
    app.innerHTML = `
      <h1>Einstellungen</h1><p class="muted">Alles hier wird automatisch in neue Berichte übernommen.</p>
      <div class="card"><h2>Persönliche Angaben</h2>
      <form id="pf">${profileFields(u)}
        <div class="grid"><div><label>Stunden pro Arbeitstag</label><input type="number" name="stunden" min="0" max="24" step="0.1" value="${u.stunden}"></div>
        <div><label>Stunden pro Schultag</label><input type="number" name="schulstunden" min="0" max="24" step="0.1" value="${u.schulstunden}"></div></div>
        <label>Feste Berufsschultage</label><div>${[0, 1, 2, 3, 4, 5].map((t) => `<label class="inline"><input type="checkbox" name="schultage" value="${t}" ${u.schultage.includes(t) ? 'checked' : ''}> ${KURZ[t]}</label>`).join('')}</div>
        <div class="hint">Diese Tage werden in neuen Berichten als Berufsschule vorbelegt.</div>
        <label>Üblicher Ausbildungsbereich</label><select name="bereich">${bereichListe(u.bereich).map((b) => `<option ${b === u.bereich ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
        <div id="perr"></div><div class="actions"><button class="primary">Speichern</button></div></form></div>

      <div class="card"><h2>Arbeitsorte</h2><p class="muted">Z. B. Überschrift „Hof“, Adresse „Liebauer Straße 14, Bremen“, Bereich „AW“, Ausbilder/Geselle „Herr Müller“. Im Bericht fügst du sie mit <strong>＋ Einfügen</strong> ein. Der Bereich erscheint auch in der Auswahl „Ausbildungsbereich“.</p>
        <div id="orte"></div>
        <div class="actions"><button id="ortadd">＋ Arbeitsort hinzufügen</button><button class="primary" id="ortsave">Arbeitsorte speichern</button></div><div id="oerr"></div></div>

      <div class="card"><h2>Textbausteine</h2><p class="muted">Sätze, die du oft brauchst. Im Bericht kannst du auch Text markieren und „★ Markiertes merken“ tippen.</p>
        <div id="bst"></div>
        <form id="bf" class="row mt"><input type="text" name="t" placeholder="Neuer Textbaustein" class="grow" maxlength="300"><button>Hinzufügen</button></form></div>

      <div class="card"><h2>Unterschrift</h2>
        <p class="muted">Wird beim Unterschreiben mit Datum eingesetzt, jedes Mal minimal anders, wie von Hand. Mit dem Finger oder der Maus unterschreiben, oder ein Bild deiner Unterschrift hochladen (Foto oder Scan auf weißem Papier, PNG oder JPG). Der weiße Hintergrund wird automatisch entfernt, die Unterschrift wird schwarz.</p>
        ${lockNote('unterschreiben')}
        <div id="cursig">${u.hasSignature ? `<p>Aktuell hinterlegt:</p><img class="sigimg" src="/api/me/signature?t=${Date.now()}" alt="Unterschrift">` : '<div class="msg warn">Noch keine Unterschrift hinterlegt.</div>'}</div>
        <div class="sigpad mt"><canvas id="pad" width="900" height="300"></canvas><div class="base"></div><div class="hint2" id="padhint">Hier unterschreiben</div></div>
        <div class="actions"><button class="primary" id="sigsave">Unterschrift speichern</button><button id="sigclear">Feld leeren</button>
        <label class="btn nomargin">Bild oder Datei hochladen<input type="file" id="sigfile" accept="image/*" hidden></label></div><div id="serr"></div></div>

      <div class="card"><h2>Speicherort für PDFs</h2><div id="folder"></div></div>

      <div class="card"><h2>Rechtschreibprüfung</h2>
        <p class="muted">Fehler werden direkt im Text farbig unterstrichen. Tippe auf ein markiertes Wort, um einen Vorschlag zu übernehmen.</p>
        <p class="legend"><span><span class="dot a-rs"></span>Rechtschreibung</span><span><span class="dot a-gr"></span>Grammatik</span><span><span class="dot a-zs"></span>Zeichensetzung</span><span><span class="dot a-st"></span>Stil</span></p>
        <label class="switch"><span>Genaue Prüfung (empfohlen)<br><span class="muted">Zusätzlich Stil, Füllwörter und Wiederholungen</span></span><input type="checkbox" id="genau" ${u.genau ? 'checked' : ''}></label></div>

      <div class="card"><h2>Alle Berichte sichern</h2><p class="muted">Lädt alle deine Berichte als PDFs in einer ZIP-Datei herunter. Am besten ab und zu machen, spätestens zum Ende der Ausbildung.</p>
        <div class="actions nomargin"><button class="primary" data-export ${locked('pdf') ? 'disabled' : ''}>Alle Berichte herunterladen (ZIP)</button></div></div>

      <div class="card"><h2>Speicherplatz</h2>${speicherBar(u.speicher)}
        <p class="muted small-t">Berichte brauchen sehr wenig Platz. Wenn er voll wird, kann der Admin dir mehr geben.</p></div>

      <div class="card"><h2>Mein Wörterbuch</h2><p class="muted">Fachwörter, die die Rechtschreibprüfung nicht anstreichen soll.</p>
        <div class="tags" id="dict">${dictTags()}</div>
        <form id="df" class="row"><input type="text" name="w" placeholder="Wort hinzufügen" class="grow"><button>Hinzufügen</button></form></div>

      <div class="card">${pwForm('Passwort ändern')}</div>
      <div class="card"><h2>Hilfe</h2><div class="actions nomargin"><button id="tour2">Einführung ansehen</button><a class="btn" href="#/hilfe">Anleitung öffnen</a><a class="btn" href="#/datenschutz">Datenschutz</a></div></div>
      <p class="muted center">Angemeldet als <strong>${esc(u.username)}</strong></p>`;

    $('#pf').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target), body = Object.fromEntries(fd);
      body.schultage = fd.getAll('schultage').map(Number);
      try { const r = await api('POST', '/api/me', body); S.user = r.user; S.missing = r.missing; toast('Gespeichert.'); errBox($('#perr'), ''); }
      catch (x) { errBox($('#perr'), x.message); }
    };
    bindPw(() => toast('Passwort geändert.'));
    bindDict(); signaturePad(); folderCard(); orteEditor(); bausteineEditor(); fillBars();
    $('#tour2').onclick = () => tutorial(true);
    $('#genau').onchange = async (e) => {
      try { S.user = (await api('POST', '/api/me', { genau: e.target.checked })).user; toast(e.target.checked ? 'Genaue Prüfung ist an.' : 'Normale Prüfung.'); } catch (x) { toast(x.message); }
    };
  }

  function orteEditor() {
    let list = (S.user.orte || []).map((o) => ({ ...o }));
    const draw = () => {
      $('#orte').innerHTML = list.map((o, k) => `<div class="ort" data-k="${k}"><button class="small ghost rm" data-rm="${k}" aria-label="Entfernen">✕ Entfernen</button>
        <div class="grid"><div><label>Überschrift</label><input type="text" data-o="titel" value="${esc(o.titel)}" placeholder="z. B. Hof"></div>
        <div><label>Ausbildungsbereich (Kürzel)</label><input type="text" data-o="label" value="${esc(o.label)}" placeholder="z. B. AW"></div></div>
        <label>Adresse</label><input type="text" data-o="adresse" value="${esc(o.adresse)}" placeholder="z. B. Liebauer Straße 14, Bremen">
        <label>Ausbilder/in oder Geselle/in</label><input type="text" data-o="person" value="${esc(o.person)}" placeholder="z. B. Geselle Herr Müller"></div>`).join('')
        || '<p class="muted">Noch keine Arbeitsorte.</p>';
    };
    draw();
    $('#orte').oninput = (e) => { const box = e.target.closest('.ort'); if (box && e.target.dataset.o) list[Number(box.dataset.k)][e.target.dataset.o] = e.target.value; };
    $('#orte').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { list.splice(Number(b.dataset.rm), 1); draw(); } };
    $('#ortadd').onclick = () => { list.push({ titel: '', adresse: '', label: '', person: '' }); draw(); const l = $$('.ort input'); if (l.length) l[l.length - 4].focus(); };
    $('#ortsave').onclick = async (e) => {
      await busy(e.target, async () => {
        try { S.user = (await api('POST', '/api/me', { orte: list })).user; list = S.user.orte.map((o) => ({ ...o })); draw(); errBox($('#oerr'), 'Arbeitsorte gespeichert.', 'ok'); }
        catch (x) { errBox($('#oerr'), x.message); }
      });
    };
  }
  function bausteineEditor() {
    const draw = () => {
      const bs = S.user.bausteine || [];
      $('#bst').innerHTML = bs.map((b, k) => `<div class="bst"><span>${esc(b.text)}</span><button class="small ghost" data-del="${k}">✕</button></div>`).join('') || '<p class="muted">Noch keine Textbausteine.</p>';
    };
    const store = async (list) => { try { S.user = (await api('POST', '/api/me', { bausteine: list })).user; draw(); } catch (x) { toast(x.message); } };
    draw();
    $('#bst').onclick = (e) => { const b = e.target.closest('[data-del]'); if (b) store(S.user.bausteine.filter((_, k) => k !== Number(b.dataset.del))); };
    $('#bf').onsubmit = async (e) => { e.preventDefault(); const t = e.target.t.value.trim(); if (!t) return; await store([...(S.user.bausteine || []), { text: t }]); e.target.reset(); };
  }

  async function folderCard() {
    const el = $('#folder');
    if (!canPickFolder()) {
      el.innerHTML = `<p class="muted">Am Handy öffnet „PDF speichern“ das Teilen-Menü. Dort <strong>„In Dateien sichern“</strong> (iPhone) oder <strong>„Speichern“</strong> (Android) wählen und deinen Ordner aussuchen.</p>
        <p class="muted">Am PC mit Chrome oder Edge kannst du hier einen festen Ordner einstellen. Dann landet jedes PDF automatisch dort.</p>`;
      return;
    }
    const dir = await IDB.get('dir');
    el.innerHTML = `<p>${dir ? `PDFs werden gespeichert in: <strong>${esc(dir.name)}</strong>` : 'Noch kein fester Ordner. PDFs landen im Download-Ordner.'}</p>
      <p class="muted small-t">Gilt nur für dieses Gerät und diesen Browser.</p>
      <div class="actions"><button class="primary" id="pick">${dir ? 'Anderen Ordner wählen' : 'Ordner wählen'}</button>${dir ? '<button id="unpick">Zurücksetzen</button>' : ''}</div>`;
    $('#pick').onclick = async () => {
      try { const h = await window.showDirectoryPicker({ id: 'berichtsheft', mode: 'readwrite' }); await IDB.set('dir', h); toast('Ordner gespeichert.'); folderCard(); }
      catch (e) { if (e.name !== 'AbortError') toast('Ordner konnte nicht gewählt werden.'); }
    };
    const un = $('#unpick'); if (un) un.onclick = async () => { await IDB.del('dir'); folderCard(); };
  }

  function dictTags() {
    return (S.user.woerterbuch || []).map((w) => `<span class="tag">${esc(w)}<button data-del="${esc(w)}" aria-label="Entfernen">×</button></span>`).join('') || '<span class="muted">Noch leer.</span>';
  }
  function bindDict() {
    const refresh = (list) => { S.user.woerterbuch = list; $('#dict').innerHTML = dictTags(); };
    $('#dict').onclick = async (e) => { const b = e.target.closest('[data-del]'); if (!b) return; refresh((await api('POST', '/api/me/dict', { remove: b.dataset.del })).woerterbuch); };
    $('#df').onsubmit = async (e) => {
      e.preventDefault(); const w = e.target.w.value.trim(); if (!w) return;
      try { refresh((await api('POST', '/api/me/dict', { add: w })).woerterbuch); e.target.reset(); } catch (x) { toast(x.message); }
    };
  }

  function signaturePad() {
    const c = $('#pad'), ctx = c.getContext('2d');
    let drawing = false, last = null, empty = true;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; };
    const setEmpty = (v) => { empty = v; $('#padhint').hidden = !v; };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#000'; ctx.lineWidth = 5;
    c.onpointerdown = (e) => { drawing = true; last = pos(e); c.setPointerCapture(e.pointerId); setEmpty(false); ctx.beginPath(); ctx.arc(last.x, last.y, 2.2, 0, 7); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); };
    c.onpointermove = (e) => {
      if (!drawing) return;
      const p = pos(e), mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p;
    };
    c.onpointerup = c.onpointercancel = () => { drawing = false; };
    $('#sigclear').onclick = () => { ctx.clearRect(0, 0, c.width, c.height); setEmpty(true); };
    $('#sigfile').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, c.width, c.height);
        const sc = Math.min(c.width / img.width, c.height / img.height) * 0.95;
        const w = img.width * sc, h = img.height * sc;
        ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
        /* Weissen/hellen Hintergrund entfernen, Tinte schwarz machen. Helligkeit des Papiers wird gemessen,
           damit auch graue Fotos (Schatten, schlechtes Licht) funktionieren. */
        const d = ctx.getImageData(0, 0, c.width, c.height), p = d.data, lum = [];
        for (let i = 0; i < p.length; i += 4) if (p[i + 3] > 0) lum.push(0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]);
        lum.sort((x, y) => x - y);
        const paper = lum.length ? lum[Math.floor(lum.length * 0.9)] : 255;
        const ink = lum.length ? lum[Math.floor(lum.length * 0.01)] : 0;
        const cut = ink + (paper - ink) * 0.55;
        for (let i = 0; i < p.length; i += 4) {
          if (!p[i + 3]) continue;
          const l = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
          const a = l >= cut ? 0 : Math.min(255, Math.round(255 * (cut - l) / Math.max(1, cut - ink) * 1.6));
          p[i] = p[i + 1] = p[i + 2] = 0; p[i + 3] = a;
        }
        ctx.putImageData(d, 0, 0);
        setEmpty(false); URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(f);
      e.target.value = '';
    };
    $('#sigsave').onclick = async (e) => {
      if (empty) return errBox($('#serr'), 'Bitte zuerst im Feld unterschreiben.');
      const png = trimmed(c);
      if (!png) return errBox($('#serr'), 'Keine Unterschrift erkannt.');
      await busy(e.target, async () => {
        try {
          S.user = (await api('POST', '/api/me/signature', { png })).user;
          $('#cursig').innerHTML = `<p>Aktuell hinterlegt:</p><img class="sigimg" src="/api/me/signature?t=${Date.now()}" alt="Unterschrift">`;
          ctx.clearRect(0, 0, c.width, c.height); setEmpty(true); errBox($('#serr'), 'Unterschrift gespeichert.', 'ok');
        } catch (x) { errBox($('#serr'), x.message); }
      });
    };
  }
  function trimmed(c) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const pad = 8; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
    const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
    o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    return o.toDataURL('image/png');
  }

  /* ---------- Admin ---------- */
  async function viewAdmin(tab) {
    const tabs = [['konten', 'Konten'], ['funktionen', 'Funktionen sperren'], ['einstellungen', 'Einstellungen']];
    if (!tabs.some(([k]) => k === tab)) tab = 'konten';
    app.innerHTML = `<div class="tabs">${tabs.map(([k, t]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div><div id="adm"><p class="loading">Lädt …</p></div>`;
    $$('[data-tab]').forEach((b) => { b.onclick = () => { location.hash = '#/admin/' + b.dataset.tab; }; });
    if (tab === 'konten') return adminUsers();
    const data = await api('GET', '/api/admin/settings');
    if (tab === 'funktionen') adminLocks(data); else adminSettings(data.settings, data.bundeslaender);
  }

  /* Fertiger Text zum Weitergeben, z. B. per WhatsApp */
  function zugangsText(name, pw, neu) {
    return [
      'Hallo! 👋',
      neu ? 'Hier ist dein neues Startpasswort für das digitale Berichtsheft:' : 'Hier ist dein Zugang zum digitalen Berichtsheft:',
      '',
      `🌐 ${location.origin}`,
      `👤 Benutzername: ${name}`,
      `🔑 Startpasswort: ${pw}`,
      '',
      '⚠️ Das ist nur dein Startpasswort. Beim ersten Anmelden musst du ein eigenes Passwort festlegen.',
      '',
      neu ? 'Danach geht alles weiter wie gewohnt.' : 'Danach trägst du einmal deine Angaben ein (Name, Firma, Lehrberuf …). Dann schreibst du dort deine Wochenberichte: Rechtschreibung wird geprüft, die Unterschrift eingesetzt, und du bekommst dein fertiges PDF.',
      '',
      'Privates Hilfsprogramm, nicht offiziell und ohne Verbindung zur IHK oder zu Ausbildungsbetrieben.'
    ].join('\n');
  }
  async function showPw(name, pw, neu) {
    const t = zugangsText(name, pw, neu);
    await modal(`<h2>${neu ? 'Neues Startpasswort' : 'Konto angelegt'}</h2>
      <p>Benutzername: <strong>${esc(name)}</strong><br>Startpasswort: <span class="pw">${esc(pw)}</span></p>
      <label>Text zum Weitergeben</label><textarea class="invite" rows="12" readonly>${esc(t)}</textarea>
      <p class="muted small-t">Das Passwort wird nur jetzt angezeigt. Am besten gleich weiterschicken.</p>
      <div class="actions"><button class="primary" data-x="copy">Text kopieren</button><button class="wa" data-x="wa">Per WhatsApp senden</button>
      ${navigator.share ? '<button data-x="share">Teilen …</button>' : ''}<button data-m="ok">Fertig</button></div>`,
    (box) => {
      $('[data-x=copy]', box).onclick = () => copy(t);
      $('[data-x=wa]', box).onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank', 'noopener');
      const sh = $('[data-x=share]', box); if (sh) sh.onclick = () => navigator.share({ text: t }).catch(() => {});
      $('textarea.invite', box).onfocus = (e) => e.target.select();
    });
  }

  async function adminUsers() {
    const { users } = await api('GET', '/api/admin/users');
    const azubis = users.filter((u) => u.role !== 'admin').sort((x, y) => x.username.localeCompare(y.username));
    const admins = users.filter((u) => u.role === 'admin');
    const card = (u) => `<div class="item">
      <div class="main"><strong>${u.vorname || u.nachname ? esc(`${u.vorname} ${u.nachname}`) : '<span class="muted">Noch nicht eingerichtet</span>'} <span class="muted">@${esc(u.username)}</span></strong>
        <span class="muted">${u.firma ? esc(u.firma) : 'Firma –'}</span><br>
        ${u.role === 'admin' ? '' : `<span class="muted">${u.beruf ? esc(u.beruf) : 'Lehrberuf –'}</span><br>`}
        <span class="muted small-t">Dabei ${since(u.created)} · zuletzt aktiv ${ago(u.lastSeen)}${u.role === 'admin' ? '' : ` · ${u.reports} Berichte`}</span>
        ${u.role === 'admin' ? '' : speicherBar(u.speicher)}</div>
      ${u.active ? '' : '<span class="chip bad">Gesperrt</span>'}${u.mustChange ? '<span class="chip warn">Startpasswort</span>' : ''}${u.role === 'admin' ? '<span class="chip brand">Admin</span>' : ''}
      <div class="row">
        <button class="small" data-u="${esc(u.id)}" data-a="edit">Bearbeiten</button>
        <button class="small" data-u="${esc(u.id)}" data-a="pw">Neues Passwort</button>
        ${u.role === 'admin' ? '' : `<button class="small" data-u="${esc(u.id)}" data-a="extend">Frist +30 Tage</button>`}
        ${u.id === S.user.id ? '' : `<button class="small ${u.active ? 'danger' : ''}" data-u="${esc(u.id)}" data-a="active" data-v="${u.active ? '0' : '1'}">${u.active ? 'Sperren' : 'Entsperren'}</button>
        <button class="small danger" data-u="${esc(u.id)}" data-a="delete">Löschen</button>`}
      </div></div>`;
    $('#adm').innerHTML = `<div class="card"><h2>Neues Konto</h2>
      <p class="muted">Nur einen Benutzernamen eingeben. Du bekommst ein kurzes Startpasswort. Beim ersten Anmelden legt die Person ein eigenes Passwort fest und trägt Name, Firma, Lehrberuf und Lehrjahr ein.</p>
      <form id="nf" class="row"><input type="text" name="username" autocapitalize="none" required placeholder="z. B. carlo.w" class="grow">
      <select name="role" class="auto-w"><option value="azubi">Azubi</option><option value="admin">Admin</option></select><button class="primary">Anlegen</button></form>
      <div id="nerr"></div>
      <p class="muted small-t">Tipp: Lege dir für deine eigenen Berichte ein normales Azubi-Konto an. Der Admin-Zugang ist nur zum Verwalten.</p></div>
      ${S.datenschutz && S.datenschutz.name ? '' : '<div class="msg warn">Bitte unter <a href="#/admin/einstellungen">Einstellungen</a> deinen Namen und eine Kontakt-E-Mail für die Datenschutzerklärung eintragen.</div>'}
      <h2>Azubis (${azubis.length})</h2><div class="list">${azubis.map(card).join('') || '<div class="card muted">Noch keine Konten.</div>'}</div>
      <h2 class="mt2">Admins (${admins.length})</h2><div class="list">${admins.map(card).join('')}</div>
      <p class="muted small-t mt2">Aus Datenschutzgründen siehst du hier keine Berichte, nur die Kontodaten und wie viel Speicher belegt ist.</p>`;
    fillBars();
    $('#nf').onsubmit = async (e) => {
      e.preventDefault();
      try { const r = await api('POST', '/api/admin/users', Object.fromEntries(new FormData(e.target))); await showPw(r.user.username, r.password); adminUsers(); }
      catch (x) { errBox($('#nerr'), x.message); }
    };
    $('#adm').onclick = async (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const u = users.find((x) => x.id === b.dataset.u), a = b.dataset.a;
      const body = { id: u.id };
      if (a === 'pw') {
        const res = await modal(`<form><h2>Neues Startpasswort für @${esc(u.username)}?</h2>
          <p>Das bisherige Passwort gilt danach nicht mehr und die Person wird abgemeldet. Beim nächsten Anmelden muss sie ein eigenes Passwort festlegen.</p>
          <label>Zur Bestätigung den Benutzernamen eintippen: <code>${esc(u.username)}</code></label><input type="text" name="confirm" autocapitalize="none" autocomplete="off" required>
          <div class="actions"><button class="primary" data-m="form">Neues Passwort erzeugen</button><button type="button" data-m="no">Abbrechen</button></div></form>`);
        if (!res || typeof res !== 'object') return;
        body.resetPassword = true; body.confirm = res.confirm;
      }
      if (a === 'active') {
        if (b.dataset.v === '0' && await modal(`<h2>@${esc(u.username)} sperren?</h2><p>Die Person wird sofort abgemeldet und kann sich nicht mehr anmelden, bis du sie wieder entsperrst. Ihre Berichte bleiben erhalten.</p><div class="actions"><button class="danger" data-m="y">Sperren</button><button data-m="n">Abbrechen</button></div>`) !== 'y') return;
        body.active = b.dataset.v === '1';
      }
      if (a === 'extend') {
        if (await modal(`<h2>Bearbeitungsfrist verlängern?</h2><p>Alle unterschriebenen Berichte von @${esc(u.username)} sind dann noch 30 Tage ab heute bearbeitbar.</p><div class="actions"><button class="primary" data-m="y">Verlängern</button><button data-m="n">Abbrechen</button></div>`) !== 'y') return;
        body.extendDays = 30;
      }
      if (a === 'delete') {
        const res = await modal(`<form><h2>@${esc(u.username)} endgültig löschen?</h2>
          <p>Das Konto und <strong>alle ${u.reports} Berichte</strong> werden gelöscht. Das kann nicht rückgängig gemacht werden.</p>
          <p class="muted">Tipp: Vorher die Person bitten, unter Einstellungen „Alle Berichte sichern“ zu tippen.</p>
          <label>Zur Bestätigung den Benutzernamen eintippen: <code>${esc(u.username)}</code></label><input type="text" name="confirm" autocapitalize="none" autocomplete="off" required>
          <div class="actions"><button class="danger" data-m="form">Endgültig löschen</button><button type="button" data-m="no">Abbrechen</button></div></form>`);
        if (!res || typeof res !== 'object') return;
        try { await api('POST', '/api/admin/delete', { id: u.id, confirm: res.confirm }); toast('Konto gelöscht.'); adminUsers(); } catch (x) { toast(x.message); }
        return;
      }
      if (a === 'edit') {
        const res = await modal(`<form><h2>@${esc(u.username)} bearbeiten</h2>
          <div class="grid"><div><label>Vorname</label><input type="text" name="vorname" value="${esc(u.vorname)}"></div><div><label>Nachname</label><input type="text" name="nachname" value="${esc(u.nachname)}"></div></div>
          <label>Firma</label><input type="text" name="firma" value="${esc(u.firma)}">
          <label>Lehrberuf</label><input type="text" name="beruf" value="${esc(u.beruf)}">
          ${u.role === 'admin' ? '' : `<label>Speicherplatz in MB</label><input type="number" name="speicherMB" min="1" max="10000" value="${u.speicherMB || ''}" placeholder="leer = Standard für alle">
          <div class="hint">Belegt: ${mb(u.speicher.used)} MB. Leer lassen für den Standard.</div>`}
          <div class="actions"><button class="primary" data-m="form">Speichern</button><button type="button" data-m="no">Abbrechen</button></div></form>`);
        if (!res || typeof res !== 'object') return;
        Object.assign(body, res);
        if ('speicherMB' in res && res.speicherMB === '') body.speicherMB = null;
      }
      try {
        const r = await api('POST', '/api/admin/user', body);
        if (r.password) await showPw(r.user.username, r.password, true);
        else toast('Gespeichert.');
        adminUsers();
      } catch (x) { toast(x.message); }
    };
  }

  function adminLocks({ settings, funktionen }) {
    $('#adm').innerHTML = `<div class="card"><h2>Funktionen sperren</h2>
      <p class="muted">Wenn etwas fehlerhaft ist, kannst du es hier vorübergehend für alle abschalten. Die Nutzer sehen dann deinen Hinweis. Berichte gehen dabei nicht verloren.</p>
      <form id="lf">${Object.entries(funktionen).map(([k, t]) => `<label class="switch"><span>${esc(t)}</span><input type="checkbox" name="${k}" ${settings.gesperrt[k] ? 'checked' : ''}></label>`).join('')}
      <label>Hinweis für die Nutzer</label><input type="text" name="sperrText" value="${esc(settings.sperrText)}" maxlength="200">
      <div id="lerr"></div><div class="actions"><button class="primary">Speichern</button></div></form>
      <p class="muted small-t">Haken = gesperrt. Admins können sich immer anmelden.</p></div>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, g = Object.fromEntries(Object.keys(funktionen).map((k) => [k, f[k].checked]));
      try {
        const s = (await api('POST', '/api/admin/settings', { settings: { gesperrt: g, sperrText: f.sperrText.value } })).settings;
        S.settings.gesperrt = s.gesperrt; S.settings.sperrText = s.sperrText;
        errBox($('#lerr'), Object.values(g).some(Boolean) ? 'Gespeichert. Gesperrt: ' + Object.keys(g).filter((k) => g[k]).map((k) => funktionen[k]).join(', ') : 'Gespeichert. Alles freigegeben.', 'ok');
      } catch (x) { errBox($('#lerr'), x.message); }
    };
  }

  function adminSettings(s, bl) {
    const T = S.settings.typen, vb = s.vorbelegung;
    $('#adm').innerHTML = `<div class="card"><h2>Vorlage</h2><p class="muted">Ausgefüllt wird das Formular „Ausbildungsnachweis (Berichtsheft) – täglich“ der Handelskammer Bremen.</p>
      <div class="actions"><a class="btn" href="/api/blank" target="_blank" rel="noopener">Leere Vorlage ansehen</a></div></div>
      <div class="card"><form id="bf2"><h2>Angaben für die Datenschutzerklärung</h2>
      <p class="muted">Pflicht, sobald andere Personen ihre Daten eintragen. Wird in der <a href="#/datenschutz" target="_blank" rel="noopener">Datenschutzerklärung</a> als Verantwortlicher angezeigt.</p>
      <label>Dein Name</label><input type="text" name="name" value="${esc((s.betreiber || {}).name)}" placeholder="Vorname Nachname">
      <label>Kontakt (E-Mail)</label><input type="text" name="kontakt" value="${esc((s.betreiber || {}).kontakt)}" placeholder="z. B. berichtsheft@deine-mail.de">
      <label>Serverstandort</label><input type="text" name="serverOrt" value="${esc((s.betreiber || {}).serverOrt || 'Deutschland')}">
      <div class="hint">Steht in der Hetzner-Konsole beim Server (z. B. Nürnberg oder Falkenstein = Deutschland, Helsinki = Finnland).</div>
      <div id="berr"></div><div class="actions"><button class="primary">Speichern</button></div></form></div>
      <div class="card"><h2>Rechtschreibprüfung testen</h2><p class="muted">Prüft, ob der Dienst auf dem Server antwortet.</p>
      <div class="actions nomargin"><button id="lttest">Jetzt testen</button></div><div id="ltres"></div></div>
      <div class="card"><form id="gf"><h2>Einstellungen für alle</h2>
      <label>Ausbildungsbereiche (einer pro Zeile)</label><textarea name="bereiche" rows="4">${esc(s.bereiche.join('\n'))}</textarea>
      <div class="hint">Jeder kann zusätzlich eigene Bereiche über seine Arbeitsorte anlegen.</div>
      <label>Bundesland (für Feiertage)</label><select name="bundesland">${Object.entries(bl).map(([k, n]) => `<option value="${k}" ${k === s.bundesland ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <label>Tage im Bericht</label><div>${[0, 1, 2, 3, 4, 5, 6].map((t) => `<label class="inline"><input type="checkbox" name="arbeitstage" value="${t}" ${s.arbeitstage.includes(t) ? 'checked' : ''}> ${KURZ[t]}</label>`).join('')}</div>
      <label>Dateiname der PDFs</label><input type="text" name="dateiname" value="${esc(s.dateiname)}" id="fn">
      <div class="hint">Bausteine: <code>{vorname}</code> <code>{nachname}</code> <code>{nr}</code> <code>{nr3}</code> <code>{kw}</code> <code>{jahr}</code> <code>{von}</code> <code>{bis}</code> <code>{bereich}</code><br>Beispiel: <strong id="fnex"></strong></div>
      <label>Nach dem Unterschreiben noch bearbeitbar (Tage)</label><input type="number" name="bearbeitbarTage" min="1" max="3650" value="${s.bearbeitbarTage}">
      <label>Speicherplatz pro Konto (MB, Standard)</label><input type="number" name="speicherMB" min="1" max="10000" value="${s.speicherMB}">
      <div class="hint">Gilt für alle ohne eigene Grenze. Einzelnen Personen gibst du unter Konten → Bearbeiten mehr oder weniger. Ein Wochenbericht braucht etwa 5–20 KB.</div>
      <h3 class="mt2">Vorausgefüllter Text je Tagesart</h3><div class="hint"><code>{name}</code> wird beim Feiertag durch den Namen ersetzt.</div>
      ${Object.entries(T).map(([k, t]) => `<label>${t}</label><input type="text" name="vb_${k}" value="${esc(vb[k])}">`).join('')}
      <h3 class="mt2">Rechtschreibprüfung</h3>
      <label>Adresse des LanguageTool-Dienstes</label><input type="text" name="ltUrl" value="${esc(s.ltUrl)}" placeholder="leer = eigener Dienst auf dem Server">
      <div class="hint">Leer lassen. Dann bleibt alles auf deinem Server. Abschalten geht unter „Funktionen sperren“.</div>
      <div id="gerr"></div><div class="actions"><button class="primary">Speichern</button></div></form></div>`;
    const ex = () => {
      const v = { vorname: 'Carlo', nachname: 'Witting', nr: '7', nr3: '007', kw: '42', jahr: '2026', von: '12.10.2026', bis: '18.10.2026', bereich: 'AW' };
      $('#fnex').textContent = $('#fn').value.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m).replace(/\s+/g, '_') + '.pdf';
    };
    $('#fn').oninput = ex; ex();
    $('#bf2').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('POST', '/api/admin/settings', { settings: { betreiber: Object.fromEntries(new FormData(e.target)) } });
        S.datenschutz = { ...(S.datenschutz || {}), ...r.settings.betreiber };
        errBox($('#berr'), 'Gespeichert.', 'ok');
      } catch (x) { errBox($('#berr'), x.message); }
    };
    $('#lttest').onclick = async (e) => {
      await busy(e.target, async () => {
        errBox($('#ltres'), 'Teste …', 'info');
        try {
          const r = await api('GET', '/api/admin/ltcheck');
          errBox($('#ltres'), r.ok ? `Funktioniert (${r.treffer} Fehler im Testsatz gefunden, ${r.ms} ms).` : `Nicht erreichbar: ${r.fehler || 'unbekannt'} (Adresse ${r.adresse})`, r.ok ? 'ok' : 'err');
        } catch (x) { errBox($('#ltres'), x.message); }
      });
    };
    $('#gf').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, fd = new FormData(f);
      const b = {
        bereiche: f.bereiche.value.split('\n').map((x) => x.trim()).filter(Boolean), bundesland: f.bundesland.value,
        arbeitstage: fd.getAll('arbeitstage').map(Number), dateiname: f.dateiname.value, bearbeitbarTage: f.bearbeitbarTage.value, speicherMB: f.speicherMB.value,
        ltUrl: f.ltUrl.value, vorbelegung: Object.fromEntries(Object.keys(T).map((k) => [k, f['vb_' + k].value]))
      };
      try {
        const r = (await api('POST', '/api/admin/settings', { settings: b })).settings;
        Object.assign(S.settings, { bereiche: r.bereiche, arbeitstage: r.arbeitstage, bearbeitbarTage: r.bearbeitbarTage, vorbelegung: r.vorbelegung });
        errBox($('#gerr'), 'Gespeichert.', 'ok');
      } catch (x) { errBox($('#gerr'), x.message); }
    };
  }

  boot();
})();
