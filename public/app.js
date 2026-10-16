'use strict';
/* Berichtsheft - Oberflaeche (ohne Zusatzbibliotheken) */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const app = $('#app');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  let S = { user: null, settings: null, setup: false };

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
  const deTime = (iso) => iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' Uhr' : '';

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  function modal(html, onOpen) {
    $('#modal-box').innerHTML = html; $('#modal').hidden = false;
    return new Promise((resolve) => {
      const done = (v) => { $('#modal').hidden = true; $('#modal-box').innerHTML = ''; resolve(v); };
      $('#modal-box').onclick = (e) => { const b = e.target.closest('[data-m]'); if (b) { e.preventDefault(); done(b.dataset.m === 'form' ? Object.fromEntries(new FormData($('#modal-box form'))) : b.dataset.m); } };
      $('#modal').onclick = (e) => { if (e.target.id === 'modal') done(null); };
      if (onOpen) onOpen($('#modal-box'));
    });
  }
  const errBox = (el, msg, kind = 'err') => { if (el) { el.innerHTML = msg ? `<div class="msg ${kind}">${esc(msg)}</div>` : ''; } };
  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } finally { if (btn) btn.disabled = false; }
  }

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
    if (!res.ok) return toast('PDF konnte nicht erstellt werden.');
    const blob = await res.blob();
    const name = r.file;
    /* 1. Fester Ordner (Chrome/Edge am PC) */
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
    /* 2. Handy: Teilen-Menue, dort "In Dateien sichern" und Ordner waehlen */
    const file = new File([blob], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    /* 3. Normaler Download */
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------- Navigation ---------- */
  function nav() {
    const top = $('#top');
    if (!S.user || S.user.mustChange) { top.hidden = !S.user; $('#nav').innerHTML = ''; return; }
    top.hidden = false;
    const r = location.hash.split('/')[1] || '';
    const on = (k) => (k === 'berichte' ? (r === '' || r === 'bericht') : r === k);
    const items = [['berichte', '▤', 'Berichte', '#/'], ['einstellungen', '⚙', 'Einstellungen', '#/einstellungen']];
    if (S.user.role === 'admin') items.push(['admin', '★', 'Admin', '#/admin']);
    $('#nav').innerHTML = items.map(([k, ic, t, h]) => `<a href="${h}" class="${on(k) ? 'on' : ''}"><span class="ic">${ic}</span>${t}</a>`).join('') +
      `<a href="#" data-logout><span class="ic">⏻</span>Abmelden</a>`;
  }
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-logout]')) return;
    e.preventDefault();
    await flushSave();
    await api('POST', '/api/logout').catch(() => {});
    S.user = null; location.hash = ''; render();
  });

  async function boot() {
    try { S = { ...S, ...(await api('GET', '/api/state')) }; }
    catch { app.innerHTML = '<div class="card narrow"><div class="msg err">Server nicht erreichbar.</div></div>'; return; }
    render();
  }
  window.addEventListener('hashchange', async () => { await flushSave(); render(); });

  function render() {
    app.oninput = app.onchange = app.onclick = app.onfocusout = null;
    nav();
    window.scrollTo(0, 0);
    if (S.setup) return viewSetup();
    if (!S.user) return viewLogin();
    if (S.user.mustChange) return viewForcePw();
    const [, r, a, b] = location.hash.split('/');
    if (r === 'bericht' && a) return viewReport(a);
    if (r === 'einstellungen') return viewSettings();
    if (r === 'admin' && S.user.role === 'admin') return viewAdmin(a || 'konten', b);
    return viewHome();
  }

  /* ---------- Einrichtung / Anmeldung ---------- */
  function viewSetup() {
    app.innerHTML = `<div class="card narrow">
      <h1>Ersteinrichtung</h1>
      <p class="muted">Lege das Admin-Konto an. Den Einrichtungs-Code zeigt das Einrichtungsskript an. Er steht auch auf dem Server in <code>/var/lib/berichtsheft/secret/setup-code.txt</code>.</p>
      <form id="f">
        <label>Einrichtungs-Code</label><input type="text" name="code" autocomplete="off" required>
        <div class="grid"><div><label>Vorname</label><input type="text" name="vorname" required></div><div><label>Nachname</label><input type="text" name="nachname" required></div></div>
        <label>Benutzername</label><input type="text" name="username" autocomplete="username" autocapitalize="none" required>
        <label>Passwort (mindestens 10 Zeichen)</label><input type="password" name="password" autocomplete="new-password" required minlength="10">
        <div id="err"></div>
        <div class="actions"><button class="primary">Admin anlegen</button></div>
      </form></div>`;
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/setup', Object.fromEntries(new FormData(e.target))); location.hash = '#/einstellungen'; await boot(); }
      catch (x) { errBox($('#err'), x.message); }
    };
  }
  function viewLogin() {
    app.innerHTML = `<div class="card narrow">
      <h1>Anmelden</h1><p class="muted">Digitaler Ausbildungsnachweis</p>
      <form id="f">
        <label>Benutzername</label><input type="text" name="username" autocomplete="username" autocapitalize="none" required>
        <label>Passwort</label><input type="password" name="password" autocomplete="current-password" required>
        <div id="err"></div>
        <div class="actions"><button class="primary">Anmelden</button></div>
      </form></div>`;
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      await busy($('button', e.target), async () => {
        try { await api('POST', '/api/login', Object.fromEntries(new FormData(e.target))); await boot(); }
        catch (x) { errBox($('#err'), x.message); }
      });
    };
  }
  function pwForm(title, hint) {
    return `<form id="pwf"><h2>${title}</h2>${hint ? `<p class="muted">${hint}</p>` : ''}
      <label>Bisheriges Passwort</label><input type="password" name="old" autocomplete="current-password" required>
      <label>Neues Passwort (mindestens 10 Zeichen)</label><input type="password" name="new" autocomplete="new-password" minlength="10" required>
      <label>Neues Passwort wiederholen</label><input type="password" name="new2" autocomplete="new-password" minlength="10" required>
      <div id="pwerr"></div><div class="actions"><button class="primary">Passwort ändern</button></div></form>`;
  }
  function bindPw(after) {
    $('#pwf').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (f.new !== f.new2) return errBox($('#pwerr'), 'Die neuen Passwörter stimmen nicht überein.');
      try { await api('POST', '/api/password', f); e.target.reset(); after(); }
      catch (x) { errBox($('#pwerr'), x.message); }
    };
  }
  function viewForcePw() {
    app.innerHTML = `<div class="card narrow">${pwForm('Eigenes Passwort festlegen', 'Du hast ein vorläufiges Passwort bekommen. Bitte lege jetzt dein eigenes fest.')}</div>`;
    bindPw(async () => { toast('Passwort geändert.'); location.hash = '#/einstellungen'; await boot(); });
  }

  /* ---------- Startseite: neuer Bericht + letzte Berichte ---------- */
  function statusChip(r) {
    if (r.status === 'abgeschlossen') return r.editable ? '<span class="chip ok">Unterschrieben</span>' : '<span class="chip">Archiviert</span>';
    return '<span class="chip warn">In Arbeit</span>';
  }
  async function viewHome() {
    app.innerHTML = '<p class="loading">Lädt …</p>';
    const [{ reports }, next] = await Promise.all([api('GET', '/api/reports'), api('GET', '/api/report/next')]);
    let html = '';
    if (next.missing.length) html += `<div class="msg warn">Bitte zuerst in den <a href="#/einstellungen">Einstellungen</a> Vorname, Nachname und Ausbildungsbeginn eintragen.</div>`;
    else if (!next.hasSignature) html += `<div class="msg warn">Noch keine Unterschrift hinterlegt. Das geht in den <a href="#/einstellungen">Einstellungen</a>.</div>`;
    html += `<button class="primary big" id="newbtn" ${next.missing.length ? 'disabled' : ''}><span class="plus">+</span> Neuer Wochenbericht</button>
      <h2 class="mt2">Meine Berichte</h2>
      <div class="list">${reports.map((r) => `<a class="item link" href="#/bericht/${esc(r.id)}">
        <div class="nr">${r.nr}</div>
        <div class="main"><strong>KW ${r.kw} · ${deShort(r.weekStart)} – ${de(r.bis)}</strong>
        <span class="muted">${esc(r.bereich || '–')}${r.status === 'abgeschlossen' ? ' · unterschrieben ' + de(r.signedAt.slice(0, 10)) : ''}</span></div>
        ${statusChip(r)}</a>`).join('') || '<div class="card muted">Noch keine Berichte. Tippe oben auf „Neuer Wochenbericht“.</div>'}</div>`;
    app.innerHTML = html;
    const btn = $('#newbtn'); if (btn) btn.onclick = () => newReport(next);
  }

  async function newReport(next) {
    const bereiche = S.settings.bereiche || [];
    const res = await modal(`<form><h2>Neuer Wochenbericht</h2>
      <label>Woche (ein beliebiger Tag der Woche)</label><input type="date" name="weekStart" value="${next.weekStart}" required>
      <p class="muted" id="wk"></p>
      <label>Nummer</label><input type="number" name="nr" min="1" max="9999" value="${next.nr}" required>
      <p class="muted">Wird automatisch fortlaufend vergeben. Nur ändern, wenn es nötig ist.</p>
      <label>Ausbildungsbereich</label><select name="bereich">${bereiche.map((b) => `<option ${b === next.bereich ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
      <div class="actions"><button class="primary" data-m="form">Bericht anlegen</button><button type="button" data-m="cancel">Abbrechen</button></div></form>`,
    (box) => {
      const inp = $('input[name=weekStart]', box), wk = $('#wk', box);
      const upd = () => { if (inp.value) { const m = monday(inp.value); wk.textContent = `Woche vom ${de(m)} bis ${de(addDays(m, 6))}`; } };
      inp.oninput = upd; upd();
    });
    if (!res || typeof res !== 'object') return;
    try {
      const r = await api('POST', '/api/report/new', res);
      if (r.existed) toast('Für diese Woche gibt es schon einen Bericht.');
      location.hash = '#/bericht/' + r.id;
    } catch (x) { toast(x.message); }
  }

  /* ---------- Bericht (sieht aus wie das Formular) ---------- */
  const R = { id: null, rep: null, dirty: false, saveTimer: null, saving: null, checks: {}, checkTimers: {}, ignored: new Set() };
  const editable = () => R.rep && R.rep.status !== 'abgeschlossen';
  function fillText(type, hol) { return ((S.settings.vorbelegung || {})[type] || '').replace(/\{name\}/g, hol || ''); }

  async function viewReport(id) {
    R.id = id; R.checks = {}; R.dirty = false;
    app.innerHTML = '<p class="loading">Lädt …</p>';
    try { R.rep = (await api('GET', '/api/report?id=' + encodeURIComponent(id))).report; }
    catch (x) { app.innerHTML = `<div class="msg err">${esc(x.message)}</div><a href="#/">Zurück</a>`; return; }
    if (R.id !== id) return;
    drawReport();
    if (editable()) R.rep.days.forEach((d, i) => { if (d.text.trim()) runCheck(i); });
  }

  function drawReport() {
    const r = R.rep, ed = editable(), u = S.user;
    const bereiche = [...new Set([...(S.settings.bereiche || []), r.bereich].filter(Boolean))];
    let html = `<div class="toprow"><a href="#/" class="back">‹ Berichte</a><span class="spacer"></span>${statusChip(r)}</div>`;
    if (r.status === 'abgeschlossen') {
      html += `<div class="card done"><p><strong>Unterschrieben</strong> mit Datum ${de(r.sigDate)}${r.korrigiertAm ? ' (korrigiert)' : ''}</p>
        <p class="muted fname">${esc(r.file)}</p>
        <div class="actions"><button class="primary" data-act="save">PDF speichern</button><a class="btn" href="/api/pdf?id=${esc(r.id)}&view=1" target="_blank" rel="noopener">Ansehen</a>
        ${r.editable ? '<button data-act="reopen">Nachträglich bearbeiten</button>' : ''}</div>
        <p class="muted">${r.editable ? `Noch bearbeitbar bis ${de(r.deadline.slice(0, 10))}.` : 'Die Bearbeitungsfrist ist abgelaufen. Nur der Admin kann sie verlängern.'}</p></div>`;
    }
    html += `<div class="sheet">
      <div class="sheet-head"><div><div class="sheet-title">Ausbildungsnachweis (Berichtsheft)</div><div class="muted">täglich · KW ${r.kw}/${r.jahr}</div></div>
        <label class="nrbox">Nr.${ed ? `<input type="number" min="1" max="9999" data-f="nr" value="${r.nr}">` : `<b>${r.nr}</b>`}</label></div>
      <table class="hdr"><tbody>
        <tr><th>Name des/der Auszubildenden</th><td colspan="3">${esc(u.vorname)} ${esc(u.nachname)}</td></tr>
        <tr><th>Ausbildungsjahr</th><td>${r.ausbildungsjahr}</td><th>Ausbildungs&shy;bereich</th>
          <td>${ed ? `<select data-f="bereich">${bereiche.map((b) => `<option ${b === r.bereich ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>` : esc(r.bereich)}</td></tr>
        <tr><th>Ausbildungswoche vom</th><td>${de(r.weekStart)}</td><th>bis</th><td>${de(r.bis)}</td></tr>
      </tbody></table>
      <div class="days"><div class="dhead"><span></span><span>Betriebliche Tätigkeiten, Unterweisungen, Unterricht, Themen der Berufsschule</span><span>Std.</span></div>
      ${r.days.map((d, i) => dayRow(d, i, ed)).join('')}</div>`;
    if (ed) {
      html += `<div class="sigrow"><div><label>Datum</label><input type="date" id="sigdate" value="${today()}" max="${today()}"></div>
        <div class="sigprev">${u.hasSignature ? `<img src="/api/me/signature?t=${Date.now()}" alt="Unterschrift">` : '<a href="#/einstellungen">Unterschrift hinterlegen</a>'}</div>
        <div class="siglabel muted">Datum, Unterschrift Auszubildende/r</div></div>`;
    }
    html += '</div>';
    if (ed) {
      html += `<div class="card actionsbar"><span class="savestate" id="savestate">Gespeichert ✓</span><span class="spacer"></span>
        ${r.firstSignedAt ? '' : '<button class="small danger" data-act="delete">Löschen</button>'}
        <a class="btn" href="/api/pdf?id=${esc(r.id)}&view=1" target="_blank" rel="noopener">Vorschau</a>
        <button class="primary" data-act="finish">Prüfen & unterschreiben</button><div id="finerr" class="full"></div></div>`;
    }
    app.innerHTML = html;
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
        ${ed ? `<textarea data-i="${i}" data-k="text" spellcheck="true" lang="de" rows="4" placeholder="Was hast du an diesem Tag gemacht?">${esc(d.text)}</textarea>`
      : `<div class="readonly">${esc(d.text) || '&nbsp;'}</div>`}
        <div class="fit" id="fit-${i}">${fit && !fit.fits ? fitMsg(fit) : ''}</div>
        <div class="issues" id="iss-${i}"></div>
      </div>
      <div class="dhours">${ed ? `<input type="number" data-i="${i}" data-k="hours" min="0" max="24" step="0.1" value="${d.hours}" aria-label="Stunden">` : esc(String(d.hours).replace('.', ','))}</div>
    </div>`;
  }
  const fitMsg = (f) => `<span class="toolong">Zu lang für das Feld im Formular (${f.over} Zeile${f.over === 1 ? '' : 'n'} zu viel) – bitte etwas kürzen.</span>`;

  function bindReport() {
    app.onclick = async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'save') return busy(b, () => savePdf(R.rep));
      if (act === 'reopen') return reopen();
      if (act === 'delete') return del();
      if (act === 'finish') return finish(b);
      if (act === 'fix') return applyFix(Number(b.dataset.i), Number(b.dataset.m), b.dataset.v);
      if (act === 'ignore') { R.ignored.add(b.dataset.key); renderIssues(Number(b.dataset.i)); return; }
      if (act === 'dict') return addDict(b.dataset.word);
    };
    if (!editable()) return;
    app.oninput = (e) => {
      const el = e.target;
      if (el.dataset.f === 'nr') { R.rep.nr = Number(el.value) || R.rep.nr; markDirty(); return; }
      if (el.dataset.i === undefined) return;
      const i = Number(el.dataset.i), day = R.rep.days[i];
      if (el.dataset.k === 'text') { day.text = el.value; markDirty(); scheduleCheck(i); }
      if (el.dataset.k === 'hours') { day.hours = Number(el.value) || 0; markDirty(); }
    };
    app.onchange = (e) => {
      const el = e.target;
      if (el.dataset.f === 'bereich') { R.rep.bereich = el.value; markDirty(true); return; }
      if (el.dataset.k !== 'type') return;
      const i = Number(el.dataset.i), day = R.rep.days[i], old = day.type, hol = R.rep.holidays[i];
      day.type = el.value;
      if (!day.text.trim() || day.text === fillText(old, hol)) day.text = fillText(day.type, hol);
      day.hours = day.type === 'betrieb' ? Number(S.user.stunden) || 7.6 : day.type === 'schule' ? Number(S.user.schulstunden) || 7.6 : 0;
      $('#day-' + i).outerHTML = dayRow(day, i, true);
      markDirty(true); runCheck(i);
    };
    /* Beim Verlassen eines Feldes sofort speichern und pruefen */
    app.onfocusout = (e) => {
      const k = e.target.dataset && e.target.dataset.k;
      if (k === 'text') runCheck(Number(e.target.dataset.i));
      if (R.dirty) save();
    };
  }

  function markDirty(now) {
    R.dirty = true;
    const s = $('#savestate'); if (s) s.textContent = 'Wird gespeichert …';
    clearTimeout(R.saveTimer);
    R.saveTimer = setTimeout(() => save(), now ? 50 : 1500);
  }
  async function save() {
    clearTimeout(R.saveTimer);
    if (!R.dirty || !R.rep) return;
    if (R.saving) { await R.saving; if (!R.dirty) return; }
    R.dirty = false;
    const rep = R.rep;
    R.saving = api('POST', '/api/report/save', { id: rep.id, nr: rep.nr, bereich: rep.bereich, days: rep.days }).then((res) => {
      if (R.rep !== rep) return;
      rep.fits = res.report.fits; rep.file = res.report.file;
      rep.days.forEach((d, i) => { const f = rep.fits[wd(d.date)], el = $('#fit-' + i); if (el) el.innerHTML = f && !f.fits ? fitMsg(f) : ''; });
      const s = $('#savestate'); if (s && !R.dirty) s.textContent = 'Gespeichert ✓';
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
  function scheduleCheck(i) { clearTimeout(R.checkTimers[i]); R.checkTimers[i] = setTimeout(() => runCheck(i), 1800); }
  async function runCheck(i) {
    clearTimeout(R.checkTimers[i]);
    const day = R.rep && R.rep.days[i];
    if (!day || S.settings.ltAus) return null;
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
  function renderIssues(i) {
    const box = $('#iss-' + i); if (!box) return;
    const c = R.checks[i];
    if (!c || c.text !== R.rep.days[i].text) { box.innerHTML = ''; return; }
    if (c.error) { box.innerHTML = `<div class="muted">${esc(c.error)}</div>`; return; }
    const list = openIssues(i);
    if (!list.length) { box.innerHTML = c.text.trim() ? '<div class="checkok">✓ Rechtschreibung und Grammatik in Ordnung</div>' : ''; return; }
    box.innerHTML = list.map((m) => {
      const idx = c.matches.indexOf(m);
      const a = Math.max(0, m.offset - 25), b = Math.min(c.text.length, m.offset + m.length + 25);
      const ctx = (a > 0 ? '…' : '') + esc(c.text.slice(a, m.offset)) + '<mark>' + esc(c.text.substr(m.offset, m.length)) + '</mark>' + esc(c.text.slice(m.offset + m.length, b)) + (b < c.text.length ? '…' : '');
      return `<div class="issue"><div>${esc(m.message)}</div><div class="ctx">${ctx}</div><div class="sug">
        ${m.replacements.map((v) => `<button class="fix" data-act="fix" data-i="${i}" data-m="${idx}" data-v="${esc(v)}">${esc(v) || '(entfernen)'}</button>`).join('')}
        <button data-act="ignore" data-i="${i}" data-key="${esc(keyOf(m))}">So lassen</button>
        ${m.typo ? `<button data-act="dict" data-word="${esc(m.word)}">Ins Wörterbuch</button>` : ''}</div></div>`;
    }).join('');
  }
  function applyFix(i, mi, value) {
    const c = R.checks[i], day = R.rep.days[i];
    if (!c || c.text !== day.text) return runCheck(i);
    const m = c.matches[mi];
    day.text = day.text.slice(0, m.offset) + value + day.text.slice(m.offset + m.length);
    const ta = $(`textarea[data-i="${i}"]`); if (ta) ta.value = day.text;
    markDirty(true);
    runCheck(i);
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
      const long = R.rep.days.findIndex((d) => { const f = R.rep.fits[wd(d.date)]; return f && !f.fits; });
      if (long >= 0) { $('#day-' + long).scrollIntoView({ behavior: 'smooth', block: 'center' }); return errBox(errEl, `${TAGE[wd(R.rep.days[long].date)]}: zu viel Text für das Feld. Bitte etwas kürzen.`); }
      btn.textContent = 'Prüfe …';
      let open = 0, failedCheck = false;
      if (!S.settings.ltAus) {
        const results = await Promise.all(R.rep.days.map((_, i) => runCheck(i)));
        results.forEach((c, i) => { if (!c) return; if (c.error) failedCheck = true; open += (openIssues(i) || []).length; });
      }
      btn.textContent = 'Prüfen & unterschreiben';
      if (open) {
        const first = R.rep.days.findIndex((_, i) => (openIssues(i) || []).length);
        const ch = await modal(`<h2>Noch ${open} Hinweis${open > 1 ? 'e' : ''}</h2><p>Die Prüfung hat noch etwas gefunden. Unter jedem Tag kannst du auswählen, was geändert werden soll, oder „So lassen“ tippen.</p>
          <div class="actions"><button class="primary" data-m="fix">Zu den Hinweisen</button><button data-m="go">Trotzdem unterschreiben</button></div>`);
        if (ch !== 'go') { if (first >= 0) $('#day-' + first).scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      } else if (failedCheck) {
        const ch = await modal('<h2>Prüfung nicht erreichbar</h2><p>Die Rechtschreibprüfung antwortet gerade nicht. Trotzdem unterschreiben?</p><div class="actions"><button data-m="go" class="primary">Trotzdem unterschreiben</button><button data-m="no">Abbrechen</button></div>');
        if (ch !== 'go') return;
      }
      const ok = await modal(`<h2>Unterschreiben</h2><p>Der Bericht Nr. ${R.rep.nr} wird mit deiner Unterschrift und dem Datum <strong>${de(date)}</strong> versehen und als PDF erstellt.</p>
        <p><img class="sigimg" src="/api/me/signature?t=${Date.now()}" alt="Deine Unterschrift"></p>
        <p class="muted">Danach noch ${S.settings.bearbeitbarTage} Tage nachträglich bearbeitbar.</p>
        <div class="actions"><button class="ok" data-m="yes">Unterschreiben</button><button data-m="no">Abbrechen</button></div>`);
      if (ok !== 'yes') return;
      try {
        R.rep = (await api('POST', '/api/report/finish', { id: R.rep.id, date })).report;
        drawReport();
        toast('Fertig! Jetzt nur noch speichern.');
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
    const ok = await modal(`<h2>Bericht löschen?</h2><p>Bericht Nr. ${R.rep.nr} wird endgültig gelöscht.</p><div class="actions"><button class="danger" data-m="yes">Löschen</button><button data-m="no">Abbrechen</button></div>`);
    if (ok !== 'yes') return;
    try { R.dirty = false; await api('POST', '/api/report/delete', { id: R.rep.id }); R.rep = null; location.hash = '#/'; } catch (x) { toast(x.message); }
  }

  /* ---------- Einstellungen ---------- */
  async function viewSettings() {
    const u = S.user, bereiche = S.settings.bereiche || [];
    app.innerHTML = `
      <div class="card"><h1>Einstellungen</h1><p class="muted">Diese Angaben werden in jeden neuen Bericht automatisch eingetragen.</p>
      <form id="pf">
        <div class="grid"><div><label>Vorname</label><input type="text" name="vorname" value="${esc(u.vorname)}" required></div>
        <div><label>Nachname</label><input type="text" name="nachname" value="${esc(u.nachname)}" required></div></div>
        <div class="grid"><div><label>Ausbildungsbeginn</label><input type="date" name="beginn" value="${esc(u.beginn)}" required></div>
        <div><label>Ausbildungsende (optional)</label><input type="date" name="ende" value="${esc(u.ende)}"></div></div>
        <label>Üblicher Ausbildungsbereich</label><select name="bereich">${bereiche.map((b) => `<option ${b === u.bereich ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
        <label>Feste Berufsschultage</label><div>${[0, 1, 2, 3, 4, 5].map((t) => `<label class="inline"><input type="checkbox" name="schultage" value="${t}" ${u.schultage.includes(t) ? 'checked' : ''}> ${KURZ[t]}</label>`).join('')}</div>
        <div class="grid"><div><label>Stunden pro Arbeitstag</label><input type="number" name="stunden" min="0" max="24" step="0.1" value="${u.stunden ?? 7.6}"></div>
        <div><label>Stunden pro Schultag</label><input type="number" name="schulstunden" min="0" max="24" step="0.1" value="${u.schulstunden ?? 7.6}"></div></div>
        <div id="perr"></div><div class="actions"><button class="primary">Speichern</button></div></form></div>

      <div class="card"><h2>Unterschrift</h2>
        <p class="muted">Wird beim Unterschreiben mit Datum in den Bericht gesetzt, jedes Mal leicht anders platziert wie von Hand. Mit dem Finger oder der Maus unterschreiben oder ein Foto deiner Unterschrift auf weißem Papier hochladen.</p>
        <div id="cursig">${u.hasSignature ? `<p>Aktuell hinterlegt:</p><img class="sigimg" src="/api/me/signature?t=${Date.now()}" alt="Unterschrift">` : '<div class="msg warn">Noch keine Unterschrift hinterlegt.</div>'}</div>
        <div class="sigpad mt"><canvas id="pad" width="900" height="300"></canvas><div class="base"></div><div class="hint" id="padhint">Hier unterschreiben</div></div>
        <div class="actions"><button class="primary" id="sigsave">Unterschrift speichern</button><button id="sigclear">Feld leeren</button>
        <label class="btn nomargin">Bild hochladen<input type="file" id="sigfile" accept="image/*" hidden></label></div><div id="serr"></div></div>

      <div class="card"><h2>Speicherort für PDFs</h2><div id="folder"></div></div>

      <div class="card"><h2>Mein Wörterbuch</h2><p class="muted">Fachwörter, die die Rechtschreibprüfung nicht als Fehler melden soll.</p>
        <div class="tags" id="dict">${dictTags()}</div>
        <form id="df" class="row"><input type="text" name="w" placeholder="Wort hinzufügen" class="grow"><button>Hinzufügen</button></form></div>

      <div class="card">${pwForm('Passwort ändern')}</div>
      <p class="muted center">Angemeldet als <strong>${esc(u.username)}</strong>${u.role === 'admin' ? ' (Admin)' : ''}</p>`;

    $('#pf').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target), body = Object.fromEntries(fd);
      body.schultage = fd.getAll('schultage').map(Number);
      try { S.user = (await api('POST', '/api/me', body)).user; toast('Gespeichert.'); errBox($('#perr'), ''); }
      catch (x) { errBox($('#perr'), x.message); }
    };
    bindPw(() => toast('Passwort geändert.'));
    bindDict();
    signaturePad();
    folderCard();
  }

  async function folderCard() {
    const el = $('#folder');
    if (!canPickFolder()) {
      el.innerHTML = `<p class="muted">Auf dem Handy öffnet „PDF speichern“ das Teilen-Menü. Dort <strong>„In Dateien sichern“</strong> (iPhone) bzw. <strong>„Speichern“</strong> (Android) wählen und deinen Ordner aussuchen.</p>
        <p class="muted">Am PC mit Chrome oder Edge kannst du hier einen festen Ordner einstellen. Dann landet jedes PDF automatisch dort.</p>`;
      return;
    }
    const dir = await IDB.get('dir');
    el.innerHTML = `<p>${dir ? `PDFs werden gespeichert in: <strong>${esc(dir.name)}</strong>` : 'Noch kein fester Ordner. PDFs landen im Download-Ordner.'}</p>
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
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1a2a6c'; ctx.lineWidth = 5;
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
        /* Weisses Papier durchsichtig machen, Tinte bleibt */
        const d = ctx.getImageData(0, 0, c.width, c.height), p = d.data;
        for (let i = 0; i < p.length; i += 4) {
          const l = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
          if (l > 170) p[i + 3] = 0; else p[i + 3] = Math.min(p[i + 3], Math.round(255 * (170 - l) / 90) + 60);
        }
        ctx.putImageData(d, 0, 0);
        setEmpty(false); URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(f);
      e.target.value = '';
    };
    $('#sigsave').onclick = async (e) => {
      if (empty) return errBox($('#serr'), 'Bitte zuerst unterschreiben.');
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
  async function viewAdmin(tab, arg) {
    const tabs = [['konten', 'Konten'], ['einstellungen', 'Einstellungen']];
    app.innerHTML = `<div class="tabs">${tabs.map(([k, t]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div><div id="adm"><p class="loading">Lädt …</p></div>`;
    $$('[data-tab]').forEach((b) => { b.onclick = () => { location.hash = '#/admin/' + b.dataset.tab; }; });
    if (tab === 'konten' && arg) return adminUserReports(arg);
    if (tab === 'konten') return adminUsers();
    const { settings, bundeslaender } = await api('GET', '/api/admin/settings');
    adminSettings(settings, bundeslaender);
  }

  async function adminUsers() {
    const { users } = await api('GET', '/api/admin/users');
    $('#adm').innerHTML = `<div class="card"><h2>Neues Konto</h2>
      <form id="nf"><div class="grid"><div><label>Vorname</label><input type="text" name="vorname"></div><div><label>Nachname</label><input type="text" name="nachname"></div></div>
      <div class="grid"><div><label>Benutzername</label><input type="text" name="username" autocapitalize="none" required></div><div><label>Ausbildungsbeginn</label><input type="date" name="beginn"></div></div>
      <label>Rolle</label><select name="role"><option value="azubi">Azubi</option><option value="admin">Admin</option></select>
      <div id="nerr"></div><div class="actions"><button class="primary">Konto anlegen</button></div></form></div>
      <div class="list">${users.map((u) => `<div class="item"><div class="main"><strong>${esc(u.vorname)} ${esc(u.nachname)} <span class="muted">@${esc(u.username)}</span></strong>
        <span class="muted">${u.role === 'admin' ? 'Admin' : 'Azubi'} · ${u.reports} Berichte · ${u.lastLogin ? 'zuletzt ' + deTime(u.lastLogin) : 'noch nie angemeldet'}</span></div>
        ${u.active ? '' : '<span class="chip bad">Gesperrt</span>'}
        <a class="btn small" href="#/admin/konten/${esc(u.id)}">Berichte</a>
        <button class="small" data-u="${esc(u.id)}" data-a="pw">Neues Passwort</button>
        ${u.id === S.user.id ? '' : `<button class="small" data-u="${esc(u.id)}" data-a="role" data-v="${u.role === 'admin' ? 'azubi' : 'admin'}">${u.role === 'admin' ? 'Admin entziehen' : 'Zum Admin'}</button>
        <button class="small ${u.active ? 'danger' : ''}" data-u="${esc(u.id)}" data-a="active" data-v="${u.active ? '0' : '1'}">${u.active ? 'Sperren' : 'Entsperren'}</button>`}</div>`).join('')}</div>`;
    const showPw = (name, pw) => modal(`<h2>Zugangsdaten</h2><p>Adresse: <strong>${esc(location.host)}</strong><br>Benutzername: <strong>${esc(name)}</strong></p><p>Vorläufiges Passwort:</p><p><span class="pw">${esc(pw)}</span></p>
      <p class="muted">Wird nur jetzt angezeigt. Beim ersten Anmelden muss ein eigenes Passwort gewählt werden.</p><div class="actions"><button class="primary" data-m="ok">Notiert</button></div>`);
    $('#nf').onsubmit = async (e) => {
      e.preventDefault();
      try { const r = await api('POST', '/api/admin/users', Object.fromEntries(new FormData(e.target))); await showPw(r.user.username, r.password); adminUsers(); }
      catch (x) { errBox($('#nerr'), x.message); }
    };
    $('#adm').onclick = async (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const body = { id: b.dataset.u }, a = b.dataset.a;
      if (a === 'pw') { if (await modal('<h2>Neues Passwort erzeugen?</h2><p>Das alte Passwort gilt dann nicht mehr.</p><div class="actions"><button class="primary" data-m="y">Ja</button><button data-m="n">Abbrechen</button></div>') !== 'y') return; body.resetPassword = true; }
      if (a === 'role') body.role = b.dataset.v;
      if (a === 'active') body.active = b.dataset.v === '1';
      try { const r = await api('POST', '/api/admin/user', body); if (r.password) await showPw(r.user.username, r.password); adminUsers(); } catch (x) { toast(x.message); }
    };
  }

  async function adminUserReports(id) {
    const [{ users }, { reports }] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/reports?user=' + encodeURIComponent(id))]);
    const u = users.find((x) => x.id === id);
    $('#adm').innerHTML = `<div class="card"><a href="#/admin/konten">‹ Alle Konten</a><h2 class="mt">${esc(u ? u.vorname + ' ' + u.nachname : '')}</h2><p class="muted">${reports.length} Berichte</p></div>
      <div class="list">${reports.map((r) => `<div class="item"><div class="nr">${r.nr}</div><div class="main"><strong>KW ${r.kw} · ${deShort(r.weekStart)} – ${de(r.bis)}</strong>
        <span class="muted">${esc(r.bereich)} · ${r.status === 'abgeschlossen' ? 'unterschrieben ' + de(r.signedAt.slice(0, 10)) + (r.editable ? ', bearbeitbar bis ' + de(r.deadline.slice(0, 10)) : ', Frist abgelaufen') : 'in Arbeit'}</span></div>
        ${statusChip(r)}<a class="btn small primary" href="/api/pdf?id=${esc(r.id)}">PDF</a>
        ${r.status === 'abgeschlossen' ? `<button class="small" data-ext="${esc(r.id)}">Frist +30 Tage</button>` : ''}</div>`).join('') || '<div class="card muted">Noch keine Berichte.</div>'}</div>`;
    $('#adm').onclick = async (e) => {
      const b = e.target.closest('[data-ext]'); if (!b) return;
      try { await api('POST', '/api/admin/extend', { id: b.dataset.ext, days: 30 }); toast('Frist verlängert.'); adminUserReports(id); } catch (x) { toast(x.message); }
    };
  }

  function adminSettings(s, bl) {
    const T = S.settings.typen, vb = s.vorbelegung;
    $('#adm').innerHTML = `<div class="card"><h2>Vorlage</h2><p class="muted">Ausgefüllt wird das Formular „Ausbildungsnachweis (Berichtsheft) – täglich“ der Handelskammer Bremen.</p>
      <div class="actions"><a class="btn" href="/api/blank" target="_blank" rel="noopener">Leere Vorlage ansehen</a></div></div>
      <div class="card"><form id="gf"><h2>Einstellungen</h2>
      <label>Ausbildungsbereiche (einer pro Zeile)</label><textarea name="bereiche" rows="4">${esc(s.bereiche.join('\n'))}</textarea>
      <label>Bundesland (für Feiertage)</label><select name="bundesland">${Object.entries(bl).map(([k, n]) => `<option value="${k}" ${k === s.bundesland ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <label>Tage im Bericht</label><div>${[0, 1, 2, 3, 4, 5, 6].map((t) => `<label class="inline"><input type="checkbox" name="arbeitstage" value="${t}" ${s.arbeitstage.includes(t) ? 'checked' : ''}> ${KURZ[t]}</label>`).join('')}</div>
      <label>Dateiname der PDFs</label><input type="text" name="dateiname" value="${esc(s.dateiname)}" id="fn">
      <p class="muted">Bausteine: <code>{vorname}</code> <code>{nachname}</code> <code>{nr}</code> <code>{nr3}</code> (mit Nullen) <code>{kw}</code> <code>{jahr}</code> <code>{von}</code> <code>{bis}</code> <code>{bereich}</code><br>Beispiel: <strong id="fnex"></strong></p>
      <label>Nach dem Unterschreiben noch bearbeitbar (Tage)</label><input type="number" name="bearbeitbarTage" min="1" max="3650" value="${s.bearbeitbarTage}">
      <h3 class="mt2">Vorausgefüllter Text je Tagesart</h3><p class="muted"><code>{name}</code> wird beim Feiertag durch den Namen ersetzt.</p>
      ${Object.entries(T).map(([k, t]) => `<label>${t}</label><input type="text" name="vb_${k}" value="${esc(vb[k])}">`).join('')}
      <h3 class="mt2">Rechtschreibprüfung</h3>
      <label class="inline"><input type="checkbox" name="ltAus" ${s.ltAus ? 'checked' : ''}> Prüfung ausschalten</label>
      <label>Adresse des LanguageTool-Dienstes</label><input type="text" name="ltUrl" value="${esc(s.ltUrl)}" placeholder="leer = eigener Dienst auf dem Server">
      <div id="gerr"></div><div class="actions"><button class="primary">Speichern</button></div></form></div>`;
    const ex = () => {
      const v = { vorname: S.user.vorname || 'Max', nachname: S.user.nachname || 'Muster', nr: '7', nr3: '007', kw: '42', jahr: '2026', von: '12.10.2026', bis: '18.10.2026', bereich: 'AW' };
      $('#fnex').textContent = $('#fn').value.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m).replace(/\s+/g, '_') + '.pdf';
    };
    $('#fn').oninput = ex; ex();
    $('#gf').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, fd = new FormData(f);
      const b = {
        bereiche: f.bereiche.value.split('\n').map((x) => x.trim()).filter(Boolean), bundesland: f.bundesland.value,
        arbeitstage: fd.getAll('arbeitstage').map(Number), dateiname: f.dateiname.value, bearbeitbarTage: f.bearbeitbarTage.value,
        ltAus: f.ltAus.checked, ltUrl: f.ltUrl.value, vorbelegung: Object.fromEntries(Object.keys(T).map((k) => [k, f['vb_' + k].value]))
      };
      try {
        const r = (await api('POST', '/api/admin/settings', { settings: b })).settings;
        Object.assign(S.settings, { bereiche: r.bereiche, bundesland: r.bundesland, arbeitstage: r.arbeitstage, bearbeitbarTage: r.bearbeitbarTage, ltAus: r.ltAus, vorbelegung: r.vorbelegung });
        errBox($('#gerr'), 'Gespeichert.', 'ok');
      } catch (x) { errBox($('#gerr'), x.message); }
    };
  }

  boot();
})();
