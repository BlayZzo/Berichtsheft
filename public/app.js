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
  function modal(html) {
    $('#modal-box').innerHTML = html; $('#modal').hidden = false;
    return new Promise((resolve) => {
      const done = (v) => { $('#modal').hidden = true; $('#modal-box').innerHTML = ''; resolve(v); };
      $('#modal-box').onclick = (e) => { const b = e.target.closest('[data-m]'); if (b) done(b.dataset.m); };
      $('#modal').onclick = (e) => { if (e.target.id === 'modal') done(null); };
    });
  }
  const errBox = (el, msg, kind = 'err') => { if (el) { el.innerHTML = msg ? `<div class="msg ${kind}">${esc(msg)}</div>` : ''; } };
  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } finally { if (btn) btn.disabled = false; }
  }

  /* ---------- Navigation ---------- */
  function nav() {
    const top = $('#top');
    if (!S.user || S.user.mustChange) { top.hidden = !S.user; $('#nav').innerHTML = ''; return; }
    top.hidden = false;
    const r = location.hash.split('/')[1] || 'woche';
    const items = [['woche', '✎', 'Woche'], ['archiv', '▤', 'Berichte'], ['einstellungen', '⚙', 'Einstellungen']];
    if (S.user.role === 'admin') items.push(['admin', '★', 'Admin']);
    $('#nav').innerHTML = items.map(([k, ic, t]) => `<a href="#/${k}" class="${r === k ? 'on' : ''}"><span class="ic">${ic}</span>${t}</a>`).join('') +
      `<a href="#" data-act="logout"><span class="ic">⎋</span>Abmelden</a>`;
  }
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act="logout"]');
    if (!a) return;
    e.preventDefault();
    await flushSave();
    await api('POST', '/api/logout').catch(() => {});
    S.user = null; location.hash = ''; render();
  });

  async function boot() {
    try {
      const st = await api('GET', '/api/state');
      S = { ...S, ...st };
    } catch { app.innerHTML = '<div class="card narrow"><div class="msg err">Server nicht erreichbar.</div></div>'; return; }
    render();
  }
  window.addEventListener('hashchange', () => { flushSave(); render(); });

  function render() {
    app.oninput = app.onchange = app.onclick = app.onfocusout = null;
    nav();
    if (S.setup) return viewSetup();
    if (!S.user) return viewLogin();
    if (S.user.mustChange) return viewForcePw();
    const [, r, a, b] = location.hash.split('/');
    if (r === 'archiv') return viewArchive();
    if (r === 'einstellungen') return viewSettings();
    if (r === 'admin' && S.user.role === 'admin') return viewAdmin(a || 'konten', b);
    return viewWeek(a && /^\d{4}-\d{2}-\d{2}$/.test(a) ? monday(a) : monday(today()));
  }

  /* ---------- Einrichtung / Anmeldung ---------- */
  function viewSetup() {
    app.innerHTML = `<div class="card narrow">
      <h1>Ersteinrichtung</h1>
      <p class="muted">Lege das Admin-Konto an. Den Einrichtungs-Code findest du auf dem Server in <code>/var/lib/berichtsheft/secret/setup-code.txt</code> (lokal im Konsolenfenster).</p>
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
      const f = Object.fromEntries(new FormData(e.target));
      try { await api('POST', '/api/setup', f); location.hash = '#/einstellungen'; await boot(); }
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
      const btn = $('button', e.target);
      await busy(btn, async () => {
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
    app.innerHTML = `<div class="card narrow">${pwForm('Eigenes Passwort festlegen', 'Du hast ein vorläufiges Passwort vom Admin bekommen. Bitte lege jetzt dein eigenes fest.')}</div>`;
    bindPw(async () => { toast('Passwort geändert.'); location.hash = '#/einstellungen'; await boot(); });
  }

  /* ---------- Woche ---------- */
  const WK = { ws: null, data: null, model: null, status: 'neu', saveTimer: null, saving: null, dirty: false, checks: {}, checkTimers: {}, ignored: new Set() };

  function fillText(type, hol) { return ((S.settings.vorbelegung || {})[type] || '').replace(/\{name\}/g, hol || ''); }
  function holidayOf(date) {
    const i = (WK.data.auto ? WK.data.auto.days : []).findIndex((d) => d.date === date);
    return i >= 0 ? WK.data.holidays[i] : '';
  }

  async function viewWeek(ws) {
    await flushSave();
    WK.ws = ws; WK.checks = {}; WK.dirty = false;
    app.innerHTML = '<p class="loading">Lädt …</p>';
    let data;
    try { data = await api('GET', '/api/week?start=' + ws); } catch (x) { app.innerHTML = `<div class="msg err">${esc(x.message)}</div>`; return; }
    if (WK.ws !== ws) return;
    WK.data = data;
    const r = data.report;
    WK.status = r ? r.status : 'neu';
    WK.model = r ? { days: r.days.map((d) => ({ ...d })), abteilung: r.abteilung, bemerkung: r.bemerkung || '' }
      : data.auto ? { days: data.auto.days, abteilung: data.auto.abteilung, bemerkung: '' } : null;
    drawWeek();
    if (WK.model && editable()) WK.model.days.forEach((d, i) => { if (d.text.trim()) runCheck(i, true); });
  }
  const editable = () => WK.status !== 'abgeschlossen';

  function drawWeek() {
    const d = WK.data, ws = d.weekStart, last = addDays(ws, 4);
    const r = d.report;
    const chip = WK.status === 'abgeschlossen' ? '<span class="chip ok">Abgeschlossen</span>' : WK.status === 'entwurf' ? (r && r.firstSignedAt ? '<span class="chip warn">Wird korrigiert</span>' : '<span class="chip warn">Entwurf</span>') : '<span class="chip">Neu</span>';
    let html = `<div class="card"><div class="weekbar">
        <button data-w="${addDays(ws, -7)}" aria-label="Vorherige Woche">‹</button>
        <div class="title"><strong>KW ${d.kw} / ${d.jahr}</strong><span class="muted">${deShort(ws)} – ${de(last)}</span></div>
        <button data-w="${addDays(ws, 7)}" aria-label="Nächste Woche">›</button></div>
        <div class="row mt">${chip}${WK.model && d.auto ? `<span class="muted">Nr. ${d.auto.nr} · ${d.auto.ausbildungsjahr}. Ausbildungsjahr</span>` : ''}
        <span class="spacer"></span><input type="date" id="jump" class="auto" value="${ws}"><button class="small" data-w="${monday(today())}">Heute</button></div></div>`;

    if (d.missing.length) {
      html += `<div class="card"><h2>Fast geschafft</h2><p>Bitte trage zuerst in den <a href="#/einstellungen">Einstellungen</a> deinen Namen und den Ausbildungsbeginn ein. Danach wird jede Woche automatisch vorausgefüllt.</p></div>`;
      app.innerHTML = html; bindWeekNav(); return;
    }
    if (d.auto && d.auto.nr < 1) {
      html += `<div class="card"><p>Diese Woche liegt vor deinem Ausbildungsbeginn.</p></div>`;
      app.innerHTML = html; bindWeekNav(); return;
    }
    const ed = editable();
    if (!d.hasSignature && ed) html += `<div class="msg warn">Du hast noch keine Unterschrift hinterlegt. Das geht unter <a href="#/einstellungen">Einstellungen</a>.</div>`;
    if (r && r.status === 'abgeschlossen') {
      html += `<div class="card"><p><strong>Unterschrieben am ${deTime(r.signedAt)}</strong>${r.korrigiertAm ? ' (korrigiert)' : ''}</p>
        <div class="actions"><a class="btn primary" href="/api/pdf?id=${esc(r.id)}">PDF herunterladen</a><a class="btn" href="/api/pdf?id=${esc(r.id)}&view=1" target="_blank" rel="noopener">Ansehen</a>
        ${r.editable ? `<button data-act="reopen">Nachträglich bearbeiten</button>` : ''}</div>
        <p class="muted">${r.editable ? `Bearbeitbar bis ${de(r.deadline.slice(0, 10))}.` : 'Die Bearbeitungsfrist ist abgelaufen. Nur der Admin kann sie verlängern.'}</p></div>`;
    }
    WK.model.days.forEach((day, i) => { html += dayHtml(day, i, ed); });
    html += `<div class="card"><h3>Bemerkungen <span class="muted">(optional, erscheint nur wenn ausgefüllt)</span></h3>
      ${ed ? `<textarea data-f="bemerkung" rows="3" spellcheck="true" lang="de">${esc(WK.model.bemerkung)}</textarea>` : `<div class="readonly">${esc(WK.model.bemerkung) || '<span class="muted">–</span>'}</div>`}
      <label>Abteilung in dieser Woche</label>
      ${ed ? `<input type="text" data-f="abteilung" value="${esc(WK.model.abteilung)}">` : `<div class="readonly">${esc(WK.model.abteilung) || '–'}</div>`}</div>`;
    if (ed) {
      html += `<div class="card"><div class="row"><span class="savestate" id="savestate">${WK.status === 'neu' ? 'Noch nicht gespeichert' : 'Gespeichert'}</span><span class="spacer"></span>
        ${r ? `<a class="btn" href="/api/pdf?id=${esc(r.id)}&view=1" target="_blank" rel="noopener" id="preview">Vorschau</a>` : ''}
        <button class="primary" data-act="finish">Prüfen & unterschreiben</button></div><div id="finerr"></div></div>`;
    }
    app.innerHTML = html;
    bindWeekNav();
    if (ed) bindWeekEdit();
    else $$('[data-act=reopen]').forEach((b) => { b.onclick = reopen; });
  }

  function dayHtml(day, i, ed) {
    const hol = holidayOf(day.date);
    const types = S.settings.typen;
    const head = `<div class="dayhead"><h3>${TAGE[wd(day.date)]}, ${deShort(day.date)}</h3>
      ${hol ? `<span class="hol">${esc(hol)}</span>` : ''}
      ${ed ? `<select data-i="${i}" data-k="type" aria-label="Art des Tages">${Object.entries(types).map(([k, t]) => `<option value="${k}" ${k === day.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input type="number" data-i="${i}" data-k="hours" min="0" max="24" step="0.25" value="${day.hours}" aria-label="Stunden"> <span class="muted">Std.</span>`
      : `<span class="chip">${types[day.type]}</span><span class="muted">${String(day.hours).replace('.', ',')} Std.</span>`}</div>`;
    const body = ed
      ? `<textarea data-i="${i}" data-k="text" spellcheck="true" lang="de" placeholder="Was hast du heute gemacht?">${esc(day.text)}</textarea><div class="issues" id="iss-${i}"></div>`
      : `<div class="readonly">${esc(day.text) || '<span class="muted">–</span>'}</div>`;
    return `<div class="card daycard t-${day.type}" id="day-${i}">${head}${body}</div>`;
  }

  function bindWeekNav() {
    $$('[data-w]').forEach((b) => { b.onclick = () => { location.hash = '#/woche/' + b.dataset.w; }; });
    const j = $('#jump'); if (j) j.onchange = () => { if (j.value) location.hash = '#/woche/' + monday(j.value); };
  }

  function bindWeekEdit() {
    app.oninput = (e) => {
      const el = e.target;
      if (el.dataset.f) { WK.model[el.dataset.f] = el.value; markDirty(); return; }
      if (el.dataset.i === undefined) return;
      const i = Number(el.dataset.i), day = WK.model.days[i];
      if (el.dataset.k === 'text') { day.text = el.value; markDirty(); scheduleCheck(i); }
      if (el.dataset.k === 'hours') { day.hours = Number(el.value) || 0; markDirty(); }
    };
    app.onchange = (e) => {
      const el = e.target;
      if (el.dataset.k !== 'type') return;
      const i = Number(el.dataset.i), day = WK.model.days[i], old = day.type, hol = holidayOf(day.date);
      day.type = el.value;
      if (!day.text.trim() || day.text === fillText(old, hol)) day.text = fillText(day.type, hol);
      day.hours = day.type === 'betrieb' ? Number(S.user.stunden) || 8 : day.type === 'schule' ? Number(S.user.schulstunden) || 8 : 0;
      const card = $('#day-' + i);
      card.outerHTML = dayHtml(day, i, true);
      markDirty(); renderIssues(i);
    };
    app.onfocusout = ((e) => { if (e.target.dataset && e.target.dataset.k === 'text') runCheck(Number(e.target.dataset.i)); });
    app.onclick = (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'finish') return finish(b);
      if (act === 'fix') return applyFix(Number(b.dataset.i), Number(b.dataset.m), b.dataset.v);
      if (act === 'ignore') { WK.ignored.add(b.dataset.key); renderIssues(Number(b.dataset.i)); return; }
      if (act === 'dict') return addDict(b.dataset.word, Number(b.dataset.i));
    };
  }

  function markDirty() {
    WK.dirty = true;
    const s = $('#savestate'); if (s) s.textContent = 'Änderungen …';
    clearTimeout(WK.saveTimer);
    WK.saveTimer = setTimeout(() => save(), 1200);
  }
  async function save() {
    clearTimeout(WK.saveTimer);
    if (!WK.dirty || !WK.model) return;
    if (WK.saving) { await WK.saving; if (!WK.dirty) return; }
    WK.dirty = false;
    const ws = WK.ws, body = { weekStart: ws, days: WK.model.days, abteilung: WK.model.abteilung, bemerkung: WK.model.bemerkung };
    WK.saving = api('POST', '/api/week', body).then((res) => {
      if (WK.ws === ws) {
        const first = WK.status === 'neu';
        WK.status = res.report.status; WK.data.report = res.report;
        const s = $('#savestate'); if (s) s.textContent = 'Gespeichert ✓';
        if (first && !$('#preview')) { const fin = $('[data-act=finish]'); if (fin) fin.insertAdjacentHTML('beforebegin', `<a class="btn" href="/api/pdf?id=${esc(res.report.id)}&view=1" target="_blank" rel="noopener" id="preview">Vorschau</a>`); }
      }
    }).catch((x) => {
      WK.dirty = true;
      const s = $('#savestate'); if (s) s.textContent = 'Nicht gespeichert: ' + x.message;
    }).finally(() => { WK.saving = null; });
    return WK.saving;
  }
  async function flushSave() { if (WK.dirty) await save(); else if (WK.saving) await WK.saving; }
  window.addEventListener('beforeunload', (e) => { if (WK.dirty) { save(); e.preventDefault(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

  /* ---- Rechtschreibung ---- */
  function scheduleCheck(i) {
    clearTimeout(WK.checkTimers[i]);
    WK.checkTimers[i] = setTimeout(() => runCheck(i), 1800);
  }
  async function runCheck(i, quiet) {
    clearTimeout(WK.checkTimers[i]);
    const day = WK.model && WK.model.days[i];
    if (!day || S.settings.ltAus) return null;
    const t = day.text;
    if (WK.checks[i] && WK.checks[i].text === t) return WK.checks[i];
    if (!t.trim()) { WK.checks[i] = { text: t, matches: [] }; renderIssues(i); return WK.checks[i]; }
    try {
      const res = await api('POST', '/api/check', { text: t });
      if (!WK.model || WK.model.days[i] !== day) return null;
      WK.checks[i] = { text: t, matches: res.matches || [], error: res.error, off: res.off };
    } catch (x) { WK.checks[i] = { text: t, matches: [], error: x.message }; }
    if (day.text === t) renderIssues(i, quiet);
    return WK.checks[i];
  }
  const keyOf = (m) => m.word.toLowerCase() + '|' + m.rule;
  function openIssues(i) {
    const c = WK.checks[i];
    if (!c || c.text !== WK.model.days[i].text) return null;
    return c.matches.filter((m) => !WK.ignored.has(keyOf(m)));
  }
  function renderIssues(i) {
    const box = $('#iss-' + i); if (!box) return;
    const c = WK.checks[i];
    if (!c || c.text !== WK.model.days[i].text) { box.innerHTML = ''; return; }
    if (c.error) { box.innerHTML = `<div class="muted">${esc(c.error)}</div>`; return; }
    const list = openIssues(i);
    if (!list.length) { box.innerHTML = c.text.trim() ? '<div class="checkok">✓ Rechtschreibung und Grammatik geprüft</div>' : ''; return; }
    box.innerHTML = list.map((m) => {
      const idx = c.matches.indexOf(m);
      const a = Math.max(0, m.offset - 25), b = Math.min(c.text.length, m.offset + m.length + 25);
      const ctx = (a > 0 ? '…' : '') + esc(c.text.slice(a, m.offset)) + '<mark>' + esc(c.text.substr(m.offset, m.length)) + '</mark>' + esc(c.text.slice(m.offset + m.length, b)) + (b < c.text.length ? '…' : '');
      return `<div class="issue"><div>${esc(m.message)}</div><div class="ctx">${ctx}</div><div class="sug">
        ${m.replacements.map((v) => `<button class="fix" data-act="fix" data-i="${i}" data-m="${idx}" data-v="${esc(v)}">${esc(v) || '(entfernen)'}</button>`).join('')}
        <button data-act="ignore" data-i="${i}" data-key="${esc(keyOf(m))}">Ignorieren</button>
        ${m.typo ? `<button data-act="dict" data-i="${i}" data-word="${esc(m.word)}">Ins Wörterbuch</button>` : ''}</div></div>`;
    }).join('');
  }
  function applyFix(i, mi, value) {
    const c = WK.checks[i], day = WK.model.days[i];
    if (!c || c.text !== day.text) return runCheck(i);
    const m = c.matches[mi];
    day.text = day.text.slice(0, m.offset) + value + day.text.slice(m.offset + m.length);
    const ta = $(`textarea[data-i="${i}"]`); if (ta) ta.value = day.text;
    markDirty();
    runCheck(i);
  }
  async function addDict(word, i) {
    try { const r = await api('POST', '/api/me/dict', { add: word }); S.user.woerterbuch = r.woerterbuch; } catch (x) { return toast(x.message); }
    Object.values(WK.checks).forEach((c) => { c.matches = c.matches.filter((m) => !(m.typo && m.word.toLowerCase() === word.toLowerCase())); });
    WK.model.days.forEach((_, k) => renderIssues(k));
    toast(`„${word}“ steht jetzt in deinem Wörterbuch.`);
  }

  async function finish(btn) {
    const errEl = $('#finerr'); errBox(errEl, '');
    await busy(btn, async () => {
      WK.dirty = true; await save();
      if (WK.dirty) return errBox(errEl, 'Speichern hat nicht geklappt. Bitte noch einmal versuchen.');
      if (!WK.data.hasSignature) return errBox(errEl, 'Bitte zuerst in den Einstellungen deine Unterschrift hinterlegen.');
      btn.textContent = 'Prüfe …';
      let open = 0, failedCheck = false;
      if (!S.settings.ltAus) {
        const results = await Promise.all(WK.model.days.map((_, i) => runCheck(i)));
        results.forEach((c, i) => { if (!c) return; if (c.error) failedCheck = true; open += (openIssues(i) || []).length; });
      }
      btn.textContent = 'Prüfen & unterschreiben';
      if (open) {
        const first = WK.model.days.findIndex((_, i) => (openIssues(i) || []).length);
        const ch = await modal(`<h2>Noch ${open} Hinweis${open > 1 ? 'e' : ''}</h2><p>Die Rechtschreib- und Grammatikprüfung hat noch etwas gefunden. Am besten korrigierst du das vorher. Fachwörter kannst du ins Wörterbuch aufnehmen.</p>
          <div class="actions"><button class="primary" data-m="fix">Zum Korrigieren</button><button data-m="go">Trotzdem abschließen</button></div>`);
        if (ch !== 'go') { if (first >= 0) $('#day-' + first).scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      } else if (failedCheck) {
        const ch = await modal(`<h2>Prüfung nicht erreichbar</h2><p>Die Rechtschreibprüfung antwortet gerade nicht. Möchtest du trotzdem abschließen?</p><div class="actions"><button data-m="go" class="primary">Trotzdem abschließen</button><button data-m="no">Abbrechen</button></div>`);
        if (ch !== 'go') return;
      }
      const ok = await modal(`<h2>Bericht abschließen</h2><p>Der Bericht wird mit deiner Unterschrift und dem heutigen Datum (${de(today())}) versehen.</p>
        <p><img class="sigimg" src="/api/me/signature?t=${Date.now()}" alt="Deine Unterschrift"></p>
        <p class="muted">Danach kannst du ihn noch ${S.settings.bearbeitbarTage} Tage lang nachträglich bearbeiten.</p>
        <div class="actions"><button class="ok" data-m="yes">Unterschreiben</button><button data-m="no">Abbrechen</button></div>`);
      if (ok !== 'yes') return;
      try {
        const res = await api('POST', '/api/week/finish', { weekStart: WK.ws });
        toast('Abgeschlossen: ' + res.file);
        WK.status = 'abgeschlossen';
        await viewWeek(WK.ws);
      } catch (x) { errBox(errEl, x.message); }
    });
  }
  async function reopen() {
    const ok = await modal(`<h2>Nachträglich bearbeiten?</h2><p>Der Bericht wird wieder zum Entwurf. Nach dem Ändern musst du ihn erneut unterschreiben. Im PDF steht dann, dass er korrigiert wurde.</p>
      <div class="actions"><button class="primary" data-m="yes">Bearbeiten</button><button data-m="no">Abbrechen</button></div>`);
    if (ok !== 'yes') return;
    try { await api('POST', '/api/week/reopen', { weekStart: WK.ws }); await viewWeek(WK.ws); } catch (x) { toast(x.message); }
  }

  /* ---------- Archiv ---------- */
  function reportItem(r, admin) {
    const chip = r.status === 'abgeschlossen' ? (r.editable ? '<span class="chip ok">Abgeschlossen</span>' : '<span class="chip">Archiviert</span>') : '<span class="chip warn">Entwurf</span>';
    return `<div class="item"><div class="main"><strong>Nr. ${r.nr} · ${deShort(r.weekStart)} – ${de(addDays(r.weekStart, 4))}</strong>
      <span class="muted">${r.status === 'abgeschlossen' ? 'Unterschrieben ' + de(r.signedAt.slice(0, 10)) + (r.editable ? ' · bearbeitbar bis ' + de(r.deadline.slice(0, 10)) : '') : 'noch nicht abgeschlossen'}</span>
      <div class="muted fname">${esc(r.file)}</div></div>${chip}
      ${admin ? '' : `<a class="btn small" href="#/woche/${r.weekStart}">Öffnen</a>`}
      <a class="btn small primary" href="/api/pdf?id=${esc(r.id)}">PDF</a>
      ${admin && r.status === 'abgeschlossen' ? `<button class="small" data-ext="${esc(r.id)}">Frist +30 Tage</button>` : ''}</div>`;
  }
  async function viewArchive() {
    app.innerHTML = '<p class="loading">Lädt …</p>';
    const { reports } = await api('GET', '/api/reports');
    app.innerHTML = `<div class="card"><h1>Meine Berichte</h1><p class="muted">${reports.length} Bericht${reports.length === 1 ? '' : 'e'}. Abgeschlossene Berichte bleiben dauerhaft gespeichert.</p></div>
      <div class="list">${reports.map((r) => reportItem(r)).join('') || '<div class="card muted">Noch keine Berichte. Fang unter „Woche“ an.</div>'}</div>`;
  }

  /* ---------- Einstellungen ---------- */
  async function viewSettings() {
    const u = S.user;
    const tage = [0, 1, 2, 3, 4, 5];
    app.innerHTML = `
      <div class="card"><h1>Einstellungen</h1><p class="muted">Diese Angaben werden in jeden Bericht automatisch eingetragen.</p>
      <form id="pf">
        <div class="grid"><div><label>Vorname</label><input type="text" name="vorname" value="${esc(u.vorname)}" required></div>
        <div><label>Nachname</label><input type="text" name="nachname" value="${esc(u.nachname)}" required></div></div>
        <div class="grid"><div><label>Ausbildungsberuf</label><input type="text" name="beruf" value="${esc(u.beruf)}" placeholder="${esc(S.settings.beruf || 'z. B. Fachinformatiker/in')}"></div>
        <div><label>Abteilung</label><input type="text" name="abteilung" value="${esc(u.abteilung)}"></div></div>
        <div class="grid"><div><label>Ausbildungsbeginn</label><input type="date" name="beginn" value="${esc(u.beginn)}" required></div>
        <div><label>Ausbildungsende (optional)</label><input type="date" name="ende" value="${esc(u.ende)}"></div></div>
        <label>Feste Berufsschultage</label><div>${tage.map((t) => `<label class="inline"><input type="checkbox" name="schultage" value="${t}" ${u.schultage.includes(t) ? 'checked' : ''}> ${KURZ[t]}</label>`).join('')}</div>
        <div class="grid"><div><label>Stunden pro Arbeitstag</label><input type="number" name="stunden" min="0" max="24" step="0.25" value="${u.stunden ?? 8}"></div>
        <div><label>Stunden pro Schultag</label><input type="number" name="schulstunden" min="0" max="24" step="0.25" value="${u.schulstunden ?? 8}"></div></div>
        <div id="perr"></div><div class="actions"><button class="primary">Speichern</button></div></form></div>

      <div class="card"><h2>Unterschrift</h2>
        <p class="muted">Wird beim Abschließen mit Datum in den Bericht eingesetzt. Mit dem Finger oder der Maus unterschreiben, oder ein Foto deiner Unterschrift auf weißem Papier hochladen.</p>
        <div id="cursig">${u.hasSignature ? `<p>Aktuell hinterlegt:</p><img class="sigimg" src="/api/me/signature?t=${Date.now()}" alt="Unterschrift">` : '<div class="msg warn">Noch keine Unterschrift hinterlegt.</div>'}</div>
        <div class="sigpad mt"><canvas id="pad" width="900" height="300"></canvas><div class="base"></div><div class="hint" id="padhint">Hier unterschreiben</div></div>
        <div class="actions"><button class="primary" id="sigsave">Unterschrift speichern</button><button id="sigclear">Feld leeren</button>
        <label class="btn nomargin">Bild hochladen<input type="file" id="sigfile" accept="image/*" hidden></label></div><div id="serr"></div></div>

      <div class="card"><h2>Mein Wörterbuch</h2><p class="muted">Fachwörter, die die Rechtschreibprüfung nicht als Fehler melden soll.</p>
        <div class="tags" id="dict">${dictTags()}</div>
        <form id="df" class="row"><input type="text" name="w" placeholder="Wort hinzufügen" class="grow"><button>Hinzufügen</button></form></div>

      <div class="card">${pwForm('Passwort ändern')}</div>
      <p class="muted center">Angemeldet als <strong>${esc(u.username)}</strong>${u.role === 'admin' ? ' (Admin)' : ''}</p>`;

    $('#pf').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd); body.schultage = fd.getAll('schultage').map(Number);
      try { const r = await api('POST', '/api/me', body); S.user = r.user; toast('Gespeichert.'); errBox($('#perr'), ''); }
      catch (x) { errBox($('#perr'), x.message); }
    };
    bindPw(() => toast('Passwort geändert.'));
    bindDict();
    signaturePad();
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
        /* Weisses Papier durchsichtig machen, Tinte dunkel lassen */
        const d = ctx.getImageData(0, 0, c.width, c.height), p = d.data;
        for (let i = 0; i < p.length; i += 4) {
          const l = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
          if (l > 170) p[i + 3] = 0; else { p[i + 3] = Math.min(p[i + 3], Math.round(255 * (170 - l) / 90) + 60); }
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
          const r = await api('POST', '/api/me/signature', { png }); S.user = r.user;
          $('#cursig').innerHTML = `<p>Aktuell hinterlegt:</p><img class="sigimg" src="/api/me/signature?t=${Date.now()}" alt="Unterschrift">`;
          ctx.clearRect(0, 0, c.width, c.height); setEmpty(true); errBox($('#serr'), 'Unterschrift gespeichert.', 'ok');
        } catch (x) { errBox($('#serr'), x.message); }
      });
    };
  }
  function trimmed(c) {
    const ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data;
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
    const tabs = [['konten', 'Konten'], ['vorlage', 'Vorlage'], ['allgemein', 'Allgemein']];
    app.innerHTML = `<div class="tabs">${tabs.map(([k, t]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div><div id="adm"><p class="loading">Lädt …</p></div>`;
    $$('[data-tab]').forEach((b) => { b.onclick = () => { location.hash = '#/admin/' + b.dataset.tab; }; });
    if (tab === 'konten' && arg) return adminUserReports(arg);
    if (tab === 'konten') return adminUsers();
    const { settings, bundeslaender } = await api('GET', '/api/admin/settings');
    if (tab === 'vorlage') adminTemplate(settings); else adminGeneral(settings, bundeslaender);
  }

  async function adminUsers() {
    const { users } = await api('GET', '/api/admin/users');
    $('#adm').innerHTML = `<div class="card"><h2>Neues Konto</h2>
      <form id="nf"><div class="grid"><div><label>Vorname</label><input type="text" name="vorname"></div><div><label>Nachname</label><input type="text" name="nachname"></div></div>
      <div class="grid"><div><label>Benutzername</label><input type="text" name="username" autocapitalize="none" required></div><div><label>Ausbildungsbeginn</label><input type="date" name="beginn"></div></div>
      <div class="grid"><div><label>Ausbildungsberuf</label><input type="text" name="beruf"></div><div><label>Rolle</label><select name="role"><option value="azubi">Azubi</option><option value="admin">Admin</option></select></div></div>
      <div id="nerr"></div><div class="actions"><button class="primary">Konto anlegen</button></div></form></div>
      <div class="list">${users.map((u) => `<div class="item"><div class="main"><strong>${esc(u.vorname)} ${esc(u.nachname)} <span class="muted">@${esc(u.username)}</span></strong>
        <span class="muted">${u.role === 'admin' ? 'Admin' : 'Azubi'} · ${u.reports} Berichte · ${u.lastLogin ? 'zuletzt ' + deTime(u.lastLogin) : 'noch nie angemeldet'}</span></div>
        ${u.active ? '' : '<span class="chip bad">Gesperrt</span>'}
        <a class="btn small" href="#/admin/konten/${esc(u.id)}">Berichte</a>
        <button class="small" data-u="${esc(u.id)}" data-a="pw">Neues Passwort</button>
        ${u.id === S.user.id ? '' : `<button class="small" data-u="${esc(u.id)}" data-a="role" data-v="${u.role === 'admin' ? 'azubi' : 'admin'}">${u.role === 'admin' ? 'Admin entziehen' : 'Zum Admin'}</button>
        <button class="small ${u.active ? 'danger' : ''}" data-u="${esc(u.id)}" data-a="active" data-v="${u.active ? '0' : '1'}">${u.active ? 'Sperren' : 'Entsperren'}</button>`}</div>`).join('')}</div>`;
    const showPw = (name, pw) => modal(`<h2>Zugangsdaten</h2><p>Benutzername: <strong>${esc(name)}</strong></p><p>Vorläufiges Passwort:</p><p><span class="pw">${esc(pw)}</span></p>
      <p class="muted">Wird nur jetzt angezeigt. Beim ersten Anmelden muss ein eigenes Passwort gewählt werden.</p><div class="actions"><button class="primary" data-m="ok">Notiert</button></div>`);
    $('#nf').onsubmit = async (e) => {
      e.preventDefault();
      try { const r = await api('POST', '/api/admin/users', Object.fromEntries(new FormData(e.target))); await showPw(r.user.username, r.password); adminUsers(); }
      catch (x) { errBox($('#nerr'), x.message); }
    };
    $('#adm').onclick = async (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const id = b.dataset.u, a = b.dataset.a;
      const body = { id };
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
      <div class="list">${reports.map((r) => reportItem(r, true)).join('') || '<div class="card muted">Noch keine Berichte.</div>'}</div>`;
    $('#adm').onclick = async (e) => {
      const b = e.target.closest('[data-ext]'); if (!b) return;
      try { await api('POST', '/api/admin/extend', { id: b.dataset.ext, days: 30 }); toast('Frist verlängert.'); adminUserReports(id); } catch (x) { toast(x.message); }
    };
  }

  function adminTemplate(s) {
    const v = s.vorlage, vb = s.vorbelegung, T = S.settings.typen;
    $('#adm').innerHTML = `<div class="card"><h2>Blanko-Vorlage</h2><p class="muted">So sieht jeder Bericht aus. Name, Woche, Nummer, Ausbildungsjahr und Betrieb werden automatisch eingesetzt.</p>
      <form id="tf">
        <label>Überschrift</label><input type="text" name="titel" value="${esc(v.titel)}">
        <label>Untertitel</label><input type="text" name="untertitel" value="${esc(v.untertitel)}">
        <label>Spaltenüberschrift Tätigkeiten</label><input type="text" name="spalteTaetigkeit" value="${esc(v.spalteTaetigkeit)}">
        <label>Überschrift Bemerkungen</label><input type="text" name="bemerkungTitel" value="${esc(v.bemerkungTitel)}">
        <label>Text über den Unterschriften</label><textarea name="hinweis" rows="3">${esc(v.hinweis)}</textarea>
        <div class="grid"><div><label>Beschriftung Unterschrift Azubi</label><input type="text" name="unterschriftAzubi" value="${esc(v.unterschriftAzubi)}"></div>
        <div><label>Beschriftung Unterschrift Ausbilder</label><input type="text" name="unterschriftAusbilder" value="${esc(v.unterschriftAusbilder)}"></div></div>
        <label class="inline"><input type="checkbox" name="stundenZeigen" ${v.stundenZeigen ? 'checked' : ''}> Stundenspalte anzeigen</label>
        <label class="inline"><input type="checkbox" name="ausbilderFeld" ${v.ausbilderFeld ? 'checked' : ''}> Unterschriftsfeld für Ausbilder (zum Unterschreiben auf Papier)</label>
        <h3 class="mt2">Vorausgefüllter Text je Tagesart</h3><p class="muted"><code>{name}</code> wird beim Feiertag durch den Namen des Feiertags ersetzt.</p>
        ${Object.entries(T).map(([k, t]) => `<label>${t}</label><input type="text" name="vb_${k}" value="${esc(vb[k])}">`).join('')}
        <div id="terr"></div>
        <div class="actions"><button class="primary">Speichern</button><a class="btn" href="/api/admin/preview" target="_blank" rel="noopener">Vorschau als PDF</a></div></form></div>`;
    $('#tf').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, vorlage = {}, vorbelegung = {};
      for (const k of ['titel', 'untertitel', 'spalteTaetigkeit', 'bemerkungTitel', 'hinweis', 'unterschriftAzubi', 'unterschriftAusbilder']) vorlage[k] = f[k].value;
      vorlage.stundenZeigen = f.stundenZeigen.checked; vorlage.ausbilderFeld = f.ausbilderFeld.checked;
      for (const k of Object.keys(T)) vorbelegung[k] = f['vb_' + k].value;
      try { await api('POST', '/api/admin/settings', { settings: { vorlage, vorbelegung } }); S.settings.vorbelegung = vorbelegung; errBox($('#terr'), 'Gespeichert. Gilt für alle Berichte, die ab jetzt abgeschlossen werden.', 'ok'); }
      catch (x) { errBox($('#terr'), x.message); }
    };
  }

  function adminGeneral(s, bl) {
    $('#adm').innerHTML = `<div class="card"><h2>Allgemein</h2><form id="gf">
      <label>Ausbildungsbetrieb</label><input type="text" name="betrieb" value="${esc(s.betrieb)}">
      <div class="grid"><div><label>Ausbilder/in</label><input type="text" name="ausbilder" value="${esc(s.ausbilder)}"></div>
      <div><label>Ausbildungsberuf (Standard)</label><input type="text" name="beruf" value="${esc(s.beruf)}"></div></div>
      <label>Bundesland (für Feiertage)</label><select name="bundesland">${Object.entries(bl).map(([k, n]) => `<option value="${k}" ${k === s.bundesland ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <label>Arbeitstage im Bericht</label><div>${[0, 1, 2, 3, 4, 5, 6].map((t) => `<label class="inline"><input type="checkbox" name="arbeitstage" value="${t}" ${s.arbeitstage.includes(t) ? 'checked' : ''}> ${KURZ[t]}</label>`).join('')}</div>
      <label>Dateiname der PDFs</label><input type="text" name="dateiname" value="${esc(s.dateiname)}" id="fn">
      <p class="muted">Bausteine: <code>{vorname}</code> <code>{nachname}</code> <code>{nr}</code> <code>{nr3}</code> (mit Nullen, z. B. 007) <code>{kw}</code> <code>{jahr}</code> <code>{von}</code> <code>{bis}</code> <code>{ajahr}</code><br>Beispiel: <strong id="fnex"></strong></p>
      <label>Nach dem Abschließen noch bearbeitbar (Tage)</label><input type="number" name="bearbeitbarTage" min="1" max="3650" value="${s.bearbeitbarTage}">
      <h3 class="mt2">Rechtschreibprüfung</h3>
      <label class="inline"><input type="checkbox" name="ltAus" ${s.ltAus ? 'checked' : ''}> Prüfung ausschalten</label>
      <label>Adresse des LanguageTool-Dienstes</label><input type="text" name="ltUrl" value="${esc(s.ltUrl)}" placeholder="leer = eigener Dienst auf dem Server">
      <p class="muted">Leer lassen für den eigenen Dienst (die Texte verlassen dann deinen Server nicht).</p>
      <div id="gerr"></div><div class="actions"><button class="primary">Speichern</button></div></form></div>`;
    const ex = () => {
      const v = { vorname: S.user.vorname || 'Max', nachname: S.user.nachname || 'Muster', nr: '7', nr3: '007', kw: '42', jahr: '2026', von: '12.10.2026', bis: '16.10.2026', ajahr: '1', beruf: 'Beruf' };
      $('#fnex').textContent = $('#fn').value.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m).replace(/\s+/g, '_') + '.pdf';
    };
    $('#fn').oninput = ex; ex();
    $('#gf').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target), b = Object.fromEntries(fd);
      b.arbeitstage = fd.getAll('arbeitstage').map(Number); b.ltAus = !!fd.get('ltAus');
      try {
        const r = await api('POST', '/api/admin/settings', { settings: b });
        Object.assign(S.settings, { bundesland: r.settings.bundesland, arbeitstage: r.settings.arbeitstage, bearbeitbarTage: r.settings.bearbeitbarTage, ltAus: r.settings.ltAus, betrieb: r.settings.betrieb, beruf: r.settings.beruf });
        errBox($('#gerr'), 'Gespeichert.', 'ok');
      } catch (x) { errBox($('#gerr'), x.message); }
    };
  }

  boot();
})();
