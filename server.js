'use strict';
/*
 * Berichtsheft - digitaler Ausbildungsnachweis
 * Privates Hilfsprogramm. Nicht offiziell und ohne Verbindung zur Handelskammer Bremen oder zu Ausbildungsbetrieben.
 * Braucht nur Node.js 20 oder neuer, keine Zusatzpakete.
 * Alle Daten liegen in BH_DATA (auf dem Server /var/lib/berichtsheft/data), nie im Programmordner.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const W = require('./lib/weeks');
const { fill, fitDay } = require('./lib/fill');
const { decodePng, encodePng } = require('./lib/png');
const { ideas } = require('./lib/ideen');
const { zip } = require('./lib/zip');

const VERSION = '3.10.0';
const PORT = Number(process.env.PORT) || 8090;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.BH_DATA ? path.resolve(process.env.BH_DATA) : path.join(ROOT, 'data');
const SECRET = process.env.BH_SECRET ? path.resolve(process.env.BH_SECRET) : path.join(path.dirname(DATA), 'secret');
const SECURE = process.env.BH_SECURE === '1' ? '; Secure' : '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const LT_DEFAULT = process.env.LT_URL || 'http://127.0.0.1:8081';
const SIG_DIR = path.join(DATA, 'sig');
const DB_FILE = path.join(DATA, 'db.json');
const SESS_FILE = path.join(DATA, 'sessions.json');
const SESSION_DAYS = 14;
const IDLE_HOURS = 12;

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

/* Funktionen, die der Admin voruebergehend sperren kann */
const FUNKTIONEN = {
  login: 'Anmelden (für alle außer Admins)',
  neu: 'Neue Berichte anlegen',
  bearbeiten: 'Berichte schreiben und speichern',
  pruefung: 'Rechtschreibprüfung',
  ideen: 'Ideen-Vorschläge',
  unterschreiben: 'Unterschreiben',
  pdf: 'PDF herunterladen'
};

/* ---------- Daten ---------- */

const DEFAULT_SETTINGS = {
  bundesland: 'HB',
  arbeitstage: [0, 1, 2, 3, 4],
  bereiche: ['AW', 'BBS', 'Betrieb'],
  dateiname: 'Berichtsheft_{nachname}_NR{nr}',
  bearbeitbarTage: 90,
  ltUrl: '',
  gesperrt: {},
  speicherMB: 20,
  betreiber: { name: '', kontakt: '', serverOrt: 'Deutschland' },
  sperrText: 'Diese Funktion ist gerade wegen Wartung gesperrt. Bitte später noch einmal versuchen.',
  vorbelegung: {
    betrieb: '',
    schule: '',
    urlaub: 'Urlaub',
    krank: 'Arbeitsunfähig (krank)',
    feiertag: 'Feiertag: {name}',
    frei: ''
  }
};

fs.mkdirSync(SIG_DIR, { recursive: true });
fs.mkdirSync(SECRET, { recursive: true, mode: 0o700 });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function merge(def, val) {
  if (!val || typeof val !== 'object' || Array.isArray(def)) return val === undefined ? def : val;
  const out = { ...def };
  for (const k of Object.keys(val)) out[k] = def && typeof def[k] === 'object' && !Array.isArray(def[k]) && def[k] ? merge(def[k], val[k]) : val[k];
  return out;
}

const db = readJson(DB_FILE, { users: {}, reports: {}, settings: {} });
db.users ||= {}; db.reports ||= {};
db.settings = merge(DEFAULT_SETTINGS, db.settings || {});
/* Abteilung, Standort und Arbeitsweise werden nicht mehr erfasst: vorhandene Angaben loeschen (Datensparsamkeit) */
for (const u of Object.values(db.users)) { delete u.arbeitsplatz; delete u.standort; delete u.abteilung; delete u.arbeitsart; delete u.endJahr; delete u.endeHinweisGesehen; }
let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeJson(DB_FILE, db), 50); }
function saveNow() { clearTimeout(saveTimer); writeJson(DB_FILE, db); }
process.on('SIGTERM', () => { saveNow(); saveSessions(); process.exit(0); });
process.on('SIGINT', () => { saveNow(); saveSessions(); process.exit(0); });

/* ---------- Passwoerter und Sitzungen ---------- */

function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex') };
}
function checkPw(user, pw) {
  const { hash } = hashPw(pw, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}
function pwProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Das Passwort braucht mindestens 8 Zeichen.';
  if (pw.length > 200) return 'Das Passwort ist zu lang.';
  return '';
}
/* Kurzes Start-Passwort ohne verwechselbare Zeichen, z. B. "kp4m-x7ra" */
function tempPassword() {
  const abc = 'abcdefghkmnpqrstuvwxyz23456789';
  let s = '';
  for (const b of crypto.randomBytes(8)) s += abc[b % abc.length];
  return s.slice(0, 4) + '-' + s.slice(4);
}
function setupCodeNew() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(12)) s += abc[b % abc.length];
  return s;
}

const sessions = new Map(Object.entries(readJson(SESS_FILE, {})));
let sessTimer = null;
function saveSessions() { writeJson(SESS_FILE, Object.fromEntries(sessions)); }
function saveSessionsSoon() { clearTimeout(sessTimer); sessTimer = setTimeout(saveSessions, 500); }
const tokenKey = (t) => crypto.createHash('sha256').update(t).digest('hex');

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch {} }
  }
  return out;
}
function currentUser(req) {
  const t = cookies(req).bh_sid;
  if (!t) return null;
  const key = tokenKey(t), s = sessions.get(key);
  if (!s) return null;
  const now = Date.now();
  if (s.exp < now || now - s.last > IDLE_HOURS * 3600e3) { sessions.delete(key); saveSessionsSoon(); return null; }
  const u = db.users[s.userId];
  if (!u || !u.active) { sessions.delete(key); saveSessionsSoon(); return null; }
  if (now - s.last > 60e3) { s.last = now; saveSessionsSoon(); u.lastSeen = new Date(now).toISOString(); save(); }
  return u;
}
function startSession(res, user) {
  const t = crypto.randomBytes(32).toString('base64url');
  sessions.set(tokenKey(t), { userId: user.id, exp: Date.now() + SESSION_DAYS * 864e5, last: Date.now() });
  saveSessionsSoon();
  user.lastSeen = new Date().toISOString();
  res.setHeader('Set-Cookie', `bh_sid=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${SECURE}`);
}
function endSessions(userId, exceptReq) {
  const c = exceptReq && cookies(exceptReq).bh_sid;
  const keep = c ? tokenKey(c) : null;
  for (const [k, s] of sessions) if (s.userId === userId && k !== keep) sessions.delete(k);
  saveSessionsSoon();
}

/* Schutz gegen Passwort-Raten */
const attempts = new Map();
function limited(key) {
  const now = Date.now(), list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60e3);
  attempts.set(key, list);
  return list.length >= 8;
}
function failed(key) { (attempts.get(key) || attempts.set(key, []).get(key)).push(Date.now()); }
setInterval(() => { const now = Date.now(); for (const [k, l] of attempts) if (!l.some((t) => now - t < 15 * 60e3)) attempts.delete(k); }, 10 * 60e3).unref();

function clientIp(req) {
  if (TRUST_PROXY) { const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (f) return f; }
  return req.socket.remoteAddress || '';
}

/* ---------- Einrichtung ---------- */

const SETUP_FILE = path.join(SECRET, 'setup-code.txt');
const needsSetup = () => !Object.values(db.users).some((u) => u.role === 'admin');
function setupCode() {
  if (!needsSetup()) return null;
  let code = '';
  try { code = fs.readFileSync(SETUP_FILE, 'utf8').trim(); } catch {}
  if (!code) { code = setupCodeNew(); fs.writeFileSync(SETUP_FILE, code + '\n', { mode: 0o600 }); }
  return code;
}

/* ---------- Hilfen ---------- */

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

const str = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max).trim();
const text = (v, max = 4000) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
const num = (v, min, max, def) => { const x = Number(String(v).replace(',', '.')); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def; };
const heute = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
const newId = () => crypto.randomBytes(6).toString('base64url');

function gesperrt(key, user) {
  if (user && user.role === 'admin' && key === 'login') return;
  if (db.settings.gesperrt && db.settings.gesperrt[key]) fail(503, `${FUNKTIONEN[key]}: ${db.settings.sperrText}`);
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, role: u.role, mustChange: !!u.mustChange, created: u.created,
    vorname: u.vorname || '', nachname: u.nachname || '', firma: u.firma || '',
    beruf: u.beruf || '', lehrjahr: u.lehrjahr || '',
    genau: u.genau !== false, theme: u.theme || 'auto', speicher: speicherInfo(u),
    bereich: u.bereich || '', schultage: u.schultage || [], stunden: u.stunden ?? 7.6, schulstunden: u.schulstunden ?? 7.6,
    hasSignature: !!u.sig, woerterbuch: u.woerterbuch || [], orte: u.orte || [], bausteine: u.bausteine || [],
    tutorialDone: !!u.tutorialDone, active: u.active
  };
}
/* Pflichtangaben: Azubis brauchen Name, Firma, Standort und Lehrjahr */
const PFLICHT = ['vorname', 'nachname', 'firma', 'beruf', 'lehrjahr', 'datenschutzAm'];
const profileMissing = (u) => (u.role === 'admin' ? [] : PFLICHT.filter((k) => !u[k]));


/* ---------- Speicherplatz pro Konto (nur die Groesse wird gezaehlt, nicht der Inhalt angesehen) ---------- */
const MB = 1024 * 1024;
const sigSizes = new Map();
function sigSize(id) {
  if (!id) return 0;
  if (!sigSizes.has(id)) { try { sigSizes.set(id, fs.statSync(path.join(SIG_DIR, id + '.png')).size); } catch { sigSizes.set(id, 0); } }
  return sigSizes.get(id);
}
function usageOf(u) {
  let bytes = Buffer.byteLength(JSON.stringify({ o: u.orte, b: u.bausteine, w: u.woerterbuch }));
  const sigs = new Set([u.sig]);
  for (const r of Object.values(db.reports)) {
    if (r.userId !== u.id) continue;
    bytes += Buffer.byteLength(JSON.stringify(r));
    sigs.add(r.sig);
    for (const h of r.history || []) sigs.add(h.sig);
  }
  for (const s of sigs) bytes += sigSize(s);
  return bytes;
}
const quotaOf = (u) => (u.speicherMB ? Number(u.speicherMB) : Number(db.settings.speicherMB) || 20) * MB;
function speicherInfo(u) {
  const used = usageOf(u), quota = quotaOf(u);
  return { used, quota, eigen: !!u.speicherMB, prozent: Math.min(100, Math.round(100 * used / quota)) };
}
/* Aenderung ausfuehren; wenn das Konto danach ueber der Grenze ist und mehr belegt als vorher: zuruecknehmen */
function mitSpeicher(u, change, undo) {
  if (u.role === 'admin') return change();
  const before = usageOf(u);
  const out = change();
  const after = usageOf(u);
  if (after > quotaOf(u) && after > before) {
    undo();
    fail(507, `Dein Speicherplatz ist voll (${(quotaOf(u) / MB).toLocaleString('de-DE')} MB). Bitte beim Admin mehr Speicher anfragen.`);
  }
  return out;
}

function deadlineOf(r) {
  if (!r.firstSignedAt) return null;
  const base = new Date(r.firstSignedAt).getTime() + (Number(db.settings.bearbeitbarTage) || 90) * 864e5;
  const extra = r.freiBis ? new Date(r.freiBis).getTime() : 0;
  return new Date(Math.max(base, extra)).toISOString();
}
const canEdit = (r) => r.status !== 'abgeschlossen' || Date.now() <= new Date(deadlineOf(r)).getTime();
/* Wie im Papier-Formular: Woche immer von Montag bis Sonntag */
const lastDay = (r) => W.addDays(r.weekStart, 6);
const deKurz = (s) => W.de(s).replace(/\.(\d{2})(\d{2})$/, '.$2');

function nameOf(r) {
  const k = r.status === 'abgeschlossen' && r.kopf ? r.kopf : db.users[r.userId] || {};
  return { vorname: k.vorname || '', nachname: k.nachname || '' };
}
function fileName(r) {
  const k = nameOf(r), iso = W.isoWeek(r.weekStart);
  const vars = {
    vorname: k.vorname, nachname: k.nachname, nr: String(r.nr), nr3: String(r.nr).padStart(3, '0'),
    kw: String(iso.week).padStart(2, '0'), jahr: String(iso.year), von: W.de(r.weekStart), bis: W.de(lastDay(r)),
    ajahr: String(r.ausbildungsjahr || ''), bereich: r.bereich || ''
  };
  let name = (db.settings.dateiname || DEFAULT_SETTINGS.dateiname).replace(/\{(\w+)\}/g, (m, key) => vars[key] ?? m);
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '_').slice(0, 150) || 'Bericht';
  return name + '.pdf';
}
function asciiName(name) {
  return name.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss').replace(/[^\x20-\x7e]/g, '_');
}
function contentHash(r) {
  const c = JSON.stringify({ k: r.kopf, d: r.days, b: r.bereich, n: r.nr, j: r.ausbildungsjahr, s: r.signedAt, t: r.sigDate, g: r.sig });
  return crypto.createHash('sha256').update(c).digest('hex');
}

function saveSignature(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Bitte die Unterschrift als Bild (PNG) senden.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 600 * 1024) throw new Error('Das Unterschriftsbild ist zu groß.');
  const img = decodePng(buf);
  if (img.width < 20 || img.height < 10) throw new Error('Das Unterschriftsbild ist zu klein.');
  let ink = 0;
  for (let i = 0; i < img.alpha.length; i++) if (img.alpha[i] > 40 && img.rgb[i * 3] + img.rgb[i * 3 + 1] + img.rgb[i * 3 + 2] < 600) ink++;
  if (ink < 30) throw new Error('Auf dem Bild ist keine Unterschrift zu erkennen.');
  const id = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
  fs.writeFileSync(path.join(SIG_DIR, id + '.png'), buf, { mode: 0o600 });
  return id;
}
function loadSignature(id) {
  if (!id || !/^[a-f0-9]{32}$/.test(id)) return null;
  try { return decodePng(fs.readFileSync(path.join(SIG_DIR, id + '.png'))); } catch { return null; }
}

/* Tage auf die 7 Zeilen der Vorlage (Mo-So) verteilen */
function rowsOf(r) {
  const rows = [null, null, null, null, null, null, null];
  for (const d of r.days) rows[W.weekday(d.date)] = d;
  return rows;
}
const NO_HOURS = new Set(['urlaub', 'krank', 'feiertag', 'frei']);
function fitsOf(r) { return rowsOf(r).map((d, i) => (d ? fitDay(d.text, i) : null)); }

function buildPdf(r, { blank = false, preview = null } = {}) {
  const done = r.status === 'abgeschlossen';
  const k = nameOf(r);
  /* Leere Tage (z. B. ein ungenutzter Sonntag) bleiben im Formular ganz leer, auch ohne Stunden */
  const rows = rowsOf(r).map((d) => d && ({ text: d.text, hours: !d.text.trim() || (NO_HOURS.has(d.type) && !Number(d.hours)) ? null : d.hours }));
  let footer = '';
  if (done) {
    footer = `Digital unterschrieben am ${W.de(r.signedAt.slice(0, 10))}`;
    if (r.korrigiertAm) footer += ` (korrigiert, erstmals ${W.de(r.firstSignedAt.slice(0, 10))})`;
    footer += `  ·  Nr. ${r.nr}  ·  Prüfsumme ${r.hash.slice(0, 16)}`;
  } else if (preview) footer = 'VORSCHAU – so sieht der Bericht nach dem Unterschreiben aus';
  else if (!blank) footer = 'ENTWURF – noch nicht unterschrieben';
  const pdf = fill(blank ? { days: [] } : {
    name: `${k.vorname} ${k.nachname}`.trim(), ajahr: r.ausbildungsjahr ? String(r.ausbildungsjahr) : '', bereich: r.bereich,
    von: deKurz(r.weekStart), bis: deKurz(lastDay(r)), days: rows,
    sigDate: done ? W.de(r.sigDate) : preview ? W.de(preview.date) : '',
    signature: done ? loadSignature(r.sig) : preview ? loadSignature(preview.sig) : null,
    seed: r.id + (r.signedAt || preview && preview.date), footer
  });
  return { pdf, name: fileName(r) };
}

function reportView(r) {
  const iso = W.isoWeek(r.weekStart);
  return {
    id: r.id, nr: r.nr, weekStart: r.weekStart, bis: lastDay(r), bereich: r.bereich, ausbildungsjahr: r.ausbildungsjahr, days: r.days,
    status: r.status, sigDate: r.sigDate, signedAt: r.signedAt, firstSignedAt: r.firstSignedAt, korrigiertAm: r.korrigiertAm,
    deadline: deadlineOf(r), editable: canEdit(r), file: fileName(r), updated: r.updated, kw: iso.week, jahr: iso.year,
    holidays: r.days.map((d) => W.holidayName(d.date, db.settings.bundesland)),
    fits: fitsOf(r).map((f) => (f ? { fits: f.fits, over: f.over || 0 } : null))
  };
}
function listItem(r) {
  return {
    id: r.id, nr: r.nr, weekStart: r.weekStart, bis: lastDay(r), bereich: r.bereich, status: r.status, signedAt: r.signedAt,
    updated: r.updated, deadline: deadlineOf(r), editable: canEdit(r), file: fileName(r), kw: W.isoWeek(r.weekStart).week,
    filled: r.days.filter((d) => d.text.trim()).length, total: r.days.length
  };
}

/* ---------- Rechtschreibung (LanguageTool) ---------- */

/* Art des Hinweises fuer die Farbe: Rechtschreibung, Grammatik, Zeichensetzung, Stil */
function artOf(m) {
  const cat = (m.rule && m.rule.category && m.rule.category.id) || '', type = (m.rule && m.rule.issueType) || '';
  if (type === 'misspelling' || cat === 'TYPOS' || cat === 'CASING' || cat === 'COMPOUNDING') return 'rs';
  if (cat === 'PUNCTUATION' || cat === 'TYPOGRAPHY' || type === 'typographical') return 'zs';
  if (['STYLE', 'REDUNDANCY', 'COLLOQUIALISMS', 'REPETITIONS', 'REPETITIONS_STYLE', 'EMPFOHLENE_RECHTSCHREIBUNG'].includes(cat) || type === 'style') return 'st';
  return 'gr';
}

let lastLtError = '';
/* Auf kleinen Servern: Pruefungen nacheinander statt gleichzeitig, und gleiche Texte nicht doppelt pruefen */
let ltQueue = Promise.resolve();
const ltCache = new Map();
async function ltRequest(text, level, timeoutMs = 45000) {
  const base = (db.settings.ltUrl || LT_DEFAULT).replace(/\/+$/, '');
  const key = level + '|' + text;
  if (ltCache.has(key)) { const v = ltCache.get(key); ltCache.delete(key); ltCache.set(key, v); return v; }
  const run = async () => {
    const body = new URLSearchParams({ text, language: 'de-DE' });
    if (level) body.set('level', level);
    /* Zusaetzlich: fehlendes Satzzeichen am Ende pruefen (ist in LanguageTool sonst aus) */
    body.set('enabledRules', 'PUNCTUATION_PARAGRAPH_END');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(base + '/v2/check', { method: 'POST', body, signal: ctrl.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      ltCache.set(key, data);
      if (ltCache.size > 400) ltCache.delete(ltCache.keys().next().value);
      return data;
    } catch (e) {
      lastLtError = `${new Date().toISOString()} ${base}: ${e.name === 'AbortError' ? `keine Antwort nach ${Math.round(timeoutMs / 1000)} s` : e.message}${e.cause ? ' (' + (e.cause.code || e.cause.message) + ')' : ''}`;
      throw e;
    } finally { clearTimeout(timer); }
  };
  const p = ltQueue.then(run, run);
  ltQueue = p.catch(() => {});
  return p;
}
/* Nach dem Start einmal "aufwaermen", damit die erste echte Pruefung schnell ist */
setTimeout(() => ltRequest('Das ist ein kurzer Test zum Aufwärmen.', '', 180000).catch(() => {}), 15000).unref();

async function spellcheck(user, input) {
  let data;
  try { data = await ltRequest(input, user.genau === false ? '' : 'picky'); }
  catch { return { error: 'Die Rechtschreibprüfung ist gerade nicht erreichbar.', matches: [] }; }
  const dict = new Set((user.woerterbuch || []).map((w) => w.toLowerCase()));
  const matches = (data.matches || []).map((m) => ({
    offset: m.offset, length: m.length, message: m.message, shortMessage: m.shortMessage || '',
    word: input.substr(m.offset, m.length),
    replacements: (m.replacements || []).slice(0, 5).map((x) => x.value),
    typo: !!(m.rule && m.rule.issueType === 'misspelling'),
    art: artOf(m),
    rule: m.rule ? m.rule.id : ''
  })).filter((m) => !(m.typo && dict.has(m.word.toLowerCase())));
  /* Eigene Pruefungen fuer Berichtshefte, falls LanguageTool sie nicht meldet */
  for (const e of eigeneRegeln(input)) {
    if (!matches.some((m) => e.offset < m.offset + Math.max(1, m.length) && m.offset < e.offset + Math.max(1, e.length))) matches.push(e);
  }
  matches.sort((a, b) => a.offset - b.offset);
  return { matches };
}

/* Einfache, sichere Zusatzregeln: Satzzeichen am Ende, grosser Anfang, Leerzeichen um Satzzeichen */
function eigeneRegeln(t) {
  const out = [];
  const add = (offset, length, message, rep, art = 'zs') => out.push({ offset, length, message, shortMessage: '', word: t.substr(offset, length), replacements: rep, typo: false, art, rule: 'BH_' + out.length });
  for (const para of paragraphs(t)) {
    const { start, text } = para;
    const trimmed = text.replace(/\s+$/, '');
    if (!trimmed) continue;
    /* Satzzeichen am Ende eines Absatzes */
    if (trimmed.length > 15 && !/[.!?:;)"“”»…]$/.test(trimmed)) {
      const lastWord = /(\S+)$/.exec(trimmed);
      add(start + trimmed.length - lastWord[1].length, lastWord[1].length, 'Am Ende des Satzes fehlt ein Punkt.', [lastWord[1] + '.']);
    }
    /* Absatz beginnt klein */
    const first = /^\s*(\p{Ll})(\p{L}*)/u.exec(text);
    if (first && !/^(z\.|d\.|u\.|ca\.|bzw\.|evtl\.|ggf\.|inkl\.)/.test(text.trim())) {
      const off = start + first.index + first[0].length - first[1].length - first[2].length;
      add(off, first[1].length + first[2].length, 'Ein Satz beginnt mit einem Großbuchstaben.', [first[1].toUpperCase() + first[2]], 'rs');
    }
  }
  /* Leerzeichen vor Komma oder Punkt */
  for (const m of t.matchAll(/(\S)( +)([,.;:!?])(?=\s|$)/g)) add(m.index + 1, m[2].length + 1, 'Vor einem Satzzeichen steht kein Leerzeichen.', [m[3]]);
  /* Fehlendes Leerzeichen nach Komma (aber nicht bei Zahlen wie 7,6) */
  for (const m of t.matchAll(/(\p{L}),(\p{L})/gu)) add(m.index + 1, 1, 'Nach einem Komma folgt ein Leerzeichen.', [', ']);
  /* Doppelte Leerzeichen */
  for (const m of t.matchAll(/(\S)( {2,})(\S)/g)) add(m.index + 1, m[2].length, 'Doppeltes Leerzeichen.', [' ']);
  return out;
}
function paragraphs(t) {
  const out = []; let pos = 0;
  for (const line of t.split('\n')) { out.push({ start: pos, text: line }); pos += line.length + 1; }
  return out;
}

/* ---------- HTTP ---------- */

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': 'no-store', ...extra });
  res.end(data);
}
function readBody(req, limit = 1.5e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Zu viele Daten.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Ungültige Daten.')); }
    });
    req.on('error', reject);
  });
}

const MIME = { '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
  fs.readFile(file, (err, data) => {
    if (err) {
      if (!path.extname(rel)) return serveStatic(req, res, '/');
      return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
    }
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
  });
}

function cleanDays(input, weekStart) {
  if (!Array.isArray(input) || input.length > 7) fail(400, 'Ungültige Tage.');
  const seen = new Set();
  return input.map((d) => {
    const date = str(d.date, 10);
    if (!W.isDate(date) || W.mondayOf(date) !== weekStart || seen.has(date)) fail(400, 'Ungültiger Tag.');
    seen.add(date);
    const type = W.TYPEN[d.type] ? d.type : 'betrieb';
    return { date, type, hours: num(d.hours, 0, 24, 0), text: text(d.text) };
  }).sort((a, b) => a.date.localeCompare(b.date));
}
function cleanOrte(list) {
  if (!Array.isArray(list)) fail(400, 'Ungültige Arbeitsorte.');
  return list.slice(0, 50).map((o) => ({
    id: /^[A-Za-z0-9_-]{4,20}$/.test(o.id || '') ? o.id : newId(),
    titel: str(o.titel, 60), adresse: str(o.adresse, 120), label: str(o.label, 40), person: str(o.person, 80)
  })).filter((o) => o.titel || o.adresse || o.label || o.person);
}
function cleanBausteine(list) {
  if (!Array.isArray(list)) fail(400, 'Ungültige Textbausteine.');
  const seen = new Set();
  return list.slice(0, 200).map((b) => ({ id: /^[A-Za-z0-9_-]{4,20}$/.test(b.id || '') ? b.id : newId(), text: str(b.text, 300) }))
    .filter((b) => b.text && !seen.has(b.text) && seen.add(b.text));
}

/* Routen. Recht: null = offen, 'user' = angemeldet, 'azubi' = eigenes Berichtsheft, 'admin' */
const routes = [];
const route = (m, p, auth, fn) => routes.push({ m, p, auth, fn });

route('GET', '/api/health', null, (ctx) => (ctx.user || ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ctx.req.socket.remoteAddress) && !ctx.req.headers['x-forwarded-for'] ? { ok: true, version: VERSION } : { ok: true }));

route('GET', '/api/state', null, (ctx) => ({
  setup: needsSetup(), user: publicUser(ctx.user), version: ctx.user ? VERSION : undefined, missing: ctx.user ? profileMissing(ctx.user) : [],
  /* Fuer die Datenschutzerklaerung, die auch ohne Anmeldung lesbar sein muss */
  datenschutz: { ...db.settings.betreiber, bearbeitbarTage: db.settings.bearbeitbarTage },
  settings: ctx.user ? {
    arbeitstage: db.settings.arbeitstage, typen: W.TYPEN, vorbelegung: db.settings.vorbelegung,
    bearbeitbarTage: db.settings.bearbeitbarTage, bereiche: db.settings.bereiche,
    gesperrt: db.settings.gesperrt || {}, sperrText: db.settings.sperrText, funktionen: FUNKTIONEN
  } : null
}));

route('POST', '/api/setup', null, (ctx) => {
  if (!needsSetup()) fail(400, 'Die Einrichtung ist schon erledigt.');
  const ip = 'setup:' + ctx.ip;
  if (limited(ip)) fail(429, 'Zu viele Versuche. Bitte 15 Minuten warten.');
  const code = setupCode(), b = ctx.body;
  const given = String(b.code || '').trim().toUpperCase();
  if (!code || given.length !== code.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(code))) { failed(ip); fail(403, 'Der Einrichtungs-Code stimmt nicht.'); }
  const username = str(b.username, 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail(400, 'Benutzername: 3 bis 40 Zeichen, nur Kleinbuchstaben, Zahlen, Punkt, Minus und Unterstrich.');
  const p = pwProblem(b.password); if (p) fail(400, p);
  const id = crypto.randomUUID();
  db.users[id] = { id, username, ...hashPw(b.password), role: 'admin', active: true, created: new Date().toISOString(), vorname: 'Admin', nachname: '' };
  saveNow();
  try { fs.unlinkSync(SETUP_FILE); } catch {}
  startSession(ctx.res, db.users[id]);
  return { ok: true };
});

route('POST', '/api/login', null, (ctx) => {
  const username = str(ctx.body.username, 40).toLowerCase();
  const kIp = 'ip:' + ctx.ip, kUser = 'u:' + username;
  if (limited(kIp) || limited(kUser)) fail(429, 'Zu viele Fehlversuche. Bitte 15 Minuten warten.');
  const u = Object.values(db.users).find((x) => x.username === username);
  const ok = u && checkPw(u, String(ctx.body.password || ''));
  if (!u) hashPw('x'); /* gleiche Rechenzeit, damit man Benutzernamen nicht erraten kann */
  if (!ok) { failed(kIp); failed(kUser); fail(401, 'Benutzername oder Passwort falsch.'); }
  if (!u.active) fail(403, 'Dieses Konto ist gesperrt. Bitte beim Admin melden.');
  gesperrt('login', u);
  attempts.delete(kUser);
  u.lastLogin = new Date().toISOString(); save();
  startSession(ctx.res, u);
  return { ok: true };
});

route('POST', '/api/logout', null, (ctx) => {
  const t = cookies(ctx.req).bh_sid;
  if (t) { sessions.delete(tokenKey(t)); saveSessionsSoon(); }
  ctx.res.setHeader('Set-Cookie', `bh_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${SECURE}`);
  return { ok: true };
});

route('POST', '/api/password', 'user', (ctx) => {
  const u = ctx.user, b = ctx.body;
  if (!checkPw(u, String(b.old || ''))) fail(400, 'Das bisherige Passwort stimmt nicht.');
  const p = pwProblem(b.new); if (p) fail(400, p);
  if (b.new === b.old) fail(400, 'Bitte ein neues Passwort wählen.');
  Object.assign(u, hashPw(b.new)); u.mustChange = false; save();
  endSessions(u.id, ctx.req);
  return { ok: true };
});

route('POST', '/api/me', 'user', (ctx) => {
  const u = ctx.user, b = ctx.body;
  for (const k of ['vorname', 'nachname']) if (k in b) { const v = str(b[k], 60); if (!v && u.role !== 'admin') fail(400, 'Vorname und Nachname sind Pflichtfelder.'); u[k] = v; }
  const NAMEN = { firma: 'Firma', beruf: 'Lehrberuf' };
  for (const k of Object.keys(NAMEN)) if (k in b) { const v = str(b[k], 120); if (!v && u.role !== 'admin') fail(400, `${NAMEN[k]} ist ein Pflichtfeld.`); u[k] = v; }
  if ('genau' in b) u.genau = !!b.genau;
  if ('theme' in b && ['auto', 'light', 'dark'].includes(b.theme)) u.theme = b.theme;
  if (b.datenschutzOk === true || b.datenschutzOk === 'on') u.datenschutzAm = new Date().toISOString();
  if ('lehrjahr' in b) u.lehrjahr = Math.round(num(b.lehrjahr, 1, 4, 1));
  if ('bereich' in b) u.bereich = str(b.bereich, 40);
  if ('schultage' in b) u.schultage = (Array.isArray(b.schultage) ? b.schultage : []).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6).slice(0, 7);
  if ('stunden' in b) u.stunden = num(b.stunden, 0, 24, 7.6);
  if ('schulstunden' in b) u.schulstunden = num(b.schulstunden, 0, 24, 7.6);
  const old = { orte: u.orte, bausteine: u.bausteine };
  mitSpeicher(u, () => {
    if ('orte' in b) u.orte = cleanOrte(b.orte);
    if ('bausteine' in b) u.bausteine = cleanBausteine(b.bausteine);
  }, () => Object.assign(u, old));
  if ('tutorialDone' in b) u.tutorialDone = !!b.tutorialDone;
  save();
  return { user: publicUser(u), missing: profileMissing(u) };
});

route('POST', '/api/me/signature', 'azubi', (ctx) => {
  const u = ctx.user;
  if (ctx.body.png === null) { u.sig = ''; save(); return { user: publicUser(u) }; }
  const old = u.sig;
  let id;
  try { id = saveSignature(ctx.body.png); } catch (e) { fail(400, e.message); }
  mitSpeicher(u, () => { u.sig = id; }, () => { u.sig = old; });
  save();
  return { user: publicUser(u) };
});
route('GET', '/api/me/signature', 'azubi', (ctx) => {
  const file = ctx.user.sig && path.join(SIG_DIR, ctx.user.sig + '.png');
  if (!file || !fs.existsSync(file)) fail(404, 'Keine Unterschrift hinterlegt.');
  /* Immer in Schwarz anzeigen, so wie sie auch im PDF erscheint */
  const img = decodePng(fs.readFileSync(file));
  return { raw: encodePng({ ...img, rgb: Buffer.alloc(img.rgb.length) }), type: 'image/png' };
});

route('POST', '/api/me/dict', 'azubi', (ctx) => {
  const u = ctx.user;
  u.woerterbuch ||= [];
  const add = str(ctx.body.add, 60), del = str(ctx.body.remove, 60);
  if (add && /^[\p{L}\p{N}.\-/]+$/u.test(add) && !u.woerterbuch.includes(add) && u.woerterbuch.length < 1000) mitSpeicher(u, () => u.woerterbuch.push(add), () => u.woerterbuch.pop());
  if (del) u.woerterbuch = u.woerterbuch.filter((w) => w !== del);
  save();
  return { woerterbuch: u.woerterbuch };
});

route('POST', '/api/check', 'azubi', async (ctx) => {
  gesperrt('pruefung');
  const t = text(ctx.body.text, 8000);
  if (!t.trim()) return { matches: [] };
  return spellcheck(ctx.user, t);
});

/* ---- Berichte ---- */

const ownReports = (uid) => Object.values(db.reports).filter((r) => r.userId === uid);
function findReport(ctx, id) {
  const r = db.reports[str(id, 40)];
  if (!r || r.userId !== ctx.user.id) fail(404, 'Bericht nicht gefunden.');
  return r;
}

/* Vorschlag fuer einen neuen Bericht: diese Woche (oder die nach dem letzten Bericht), Nummer = hoechste + 1 */
route('GET', '/api/report/next', 'azubi', (ctx) => {
  const u = ctx.user, list = ownReports(u.id);
  const thisWeek = W.mondayOf(heute());
  const taken = new Set(list.map((r) => r.weekStart));
  let weekStart = thisWeek;
  if (taken.has(weekStart)) { while (taken.has(weekStart)) weekStart = W.addDays(weekStart, 7); }
  const nr = list.length ? Math.max(...list.map((r) => Number(r.nr) || 0)) + 1 : 1;
  return { weekStart, thisWeek, nr, bereich: u.bereich || db.settings.bereiche[0] || '', taken: [...taken], hasSignature: !!u.sig };
});

/* Ganze Woche Berufsschule (z. B. Bereich "BBS"): alle normalen Tage als Schultage vorbelegen */
function schoolWeek(days, bereich) {
  if (!/\b(BBS|Berufsschule|Schule)\b/i.test(bereich)) return days;
  return days.map((d) => (d.type === 'betrieb' ? { ...d, type: 'schule', text: W.fillText('schule', db.settings, '') } : d));
}

route('POST', '/api/report/new', 'azubi', (ctx) => {
  gesperrt('neu');
  const u = ctx.user, b = ctx.body;
  if (profileMissing(u).length) fail(400, 'Bitte zuerst in den Einstellungen deine Angaben vervollständigen.');
  const d = str(b.weekStart, 10) || heute();
  if (!W.isDate(d)) fail(400, 'Bitte ein gültiges Datum wählen.');
  const ws = W.mondayOf(d);
  const dup = ownReports(u.id).find((r) => r.weekStart === ws);
  if (dup) return { id: dup.id, existed: true };
  const auto = W.buildWeek(u, db.settings, ws);
  const bereich = str(b.bereich, 40);
  const id = crypto.randomBytes(9).toString('base64url');
  mitSpeicher(u, () => {
    db.reports[id] = {
      id, userId: u.id, weekStart: ws, nr: Math.round(num(b.nr, 1, 9999, 1)), bereich,
      ausbildungsjahr: Number(u.lehrjahr) || 1, days: schoolWeek(auto.days, bereich), status: 'entwurf',
      created: new Date().toISOString(), updated: new Date().toISOString(), history: []
    };
  }, () => { delete db.reports[id]; });
  saveNow();
  return { id };
});

route('GET', '/api/reports', 'azubi', (ctx) => ({
  reports: ownReports(ctx.user.id).sort((a, b) => b.weekStart.localeCompare(a.weekStart)).map(listItem)
}));

route('GET', '/api/report', 'azubi', (ctx) => ({ report: reportView(findReport(ctx, ctx.query.get('id'))) }));

route('POST', '/api/report/save', 'azubi', (ctx) => {
  gesperrt('bearbeiten');
  const r = findReport(ctx, ctx.body.id), b = ctx.body;
  if (r.status === 'abgeschlossen') fail(409, 'Dieser Bericht ist unterschrieben. Zum Ändern zuerst „Nachträglich bearbeiten“ wählen.');
  const old = { nr: r.nr, bereich: r.bereich, ausbildungsjahr: r.ausbildungsjahr, days: r.days };
  const days = 'days' in b ? cleanDays(b.days, r.weekStart) : r.days;
  mitSpeicher(ctx.user, () => {
    if ('nr' in b) r.nr = Math.round(num(b.nr, 1, 9999, r.nr));
    if ('bereich' in b) r.bereich = str(b.bereich, 40);
    if ('ausbildungsjahr' in b) r.ausbildungsjahr = Math.round(num(b.ausbildungsjahr, 1, 4, r.ausbildungsjahr));
    r.days = days;
  }, () => Object.assign(r, old));
  r.updated = new Date().toISOString();
  save();
  return { report: reportView(r) };
});

route('POST', '/api/ideas', 'azubi', (ctx) => {
  gesperrt('ideen');
  const r = findReport(ctx, ctx.body.id);
  const i = Math.round(num(ctx.body.day, 0, 6, 0));
  const day = r.days[i];
  if (!day) fail(400, 'Unbekannter Tag.');
  const current = text(ctx.body.text ?? day.text, 4000);
  /* Die anderen Tage dieser Woche (so wie gerade auf dem Bildschirm) bestimmen, was passt, und werden nicht doppelt vorgeschlagen */
  const week = Array.isArray(ctx.body.week) ? ctx.body.week.slice(0, 7).map((t) => text(t, 4000)) : r.days.filter((_, k) => k !== i).map((d) => d.text);
  const history = ownReports(ctx.user.id).filter((x) => x.id !== r.id).sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .flatMap((x) => x.days.map((d) => ({ text: d.text, type: d.type, bereich: x.bereich, nr: x.nr })));
  return { ideas: ideas({ text: current, type: day.type, bereich: r.bereich, week, history }) };
});

route('POST', '/api/report/finish', 'azubi', (ctx) => {
  gesperrt('unterschreiben');
  const u = ctx.user, r = findReport(ctx, ctx.body.id);
  if (r.status === 'abgeschlossen') fail(409, 'Der Bericht ist schon unterschrieben.');
  if (!u.sig || !loadSignature(u.sig)) fail(400, 'Bitte zuerst in den Einstellungen deine Unterschrift hinterlegen.');
  const date = str(ctx.body.date, 10) || heute();
  if (!W.isDate(date)) fail(400, 'Bitte ein gültiges Datum für die Unterschrift wählen.');
  if (date > heute()) fail(400, 'Das Datum der Unterschrift darf nicht in der Zukunft liegen.');
  const empty = r.days.filter((d) => (d.type === 'betrieb' || d.type === 'schule') && !d.text.trim() && W.weekday(d.date) < 5);
  if (empty.length) fail(400, `Bitte noch ausfüllen: ${empty.map((d) => W.KURZ[W.weekday(d.date)] + ' ' + W.deShort(d.date)).join(', ')}`);
  const long = fitsOf(r).map((f, i) => (f && !f.fits ? W.KURZ[i] : null)).filter(Boolean);
  if (long.length) fail(400, `Zu viel Text für das Feld: ${long.join(', ')}. Bitte etwas kürzen.`);
  const now = new Date().toISOString();
  r.status = 'abgeschlossen';
  r.signedAt = now;
  r.sigDate = date;
  r.firstSignedAt ||= now;
  if (r.firstSignedAt !== now) r.korrigiertAm = now;
  r.kopf = { vorname: u.vorname, nachname: u.nachname };
  r.sig = u.sig;
  r.hash = contentHash(r);
  saveNow();
  return { report: reportView(r) };
});

route('POST', '/api/report/reopen', 'azubi', (ctx) => {
  gesperrt('bearbeiten');
  const r = findReport(ctx, ctx.body.id);
  if (r.status !== 'abgeschlossen') fail(400, 'Der Bericht ist nicht unterschrieben.');
  if (!canEdit(r)) fail(403, 'Die Frist zum Bearbeiten ist abgelaufen. Der Admin kann sie verlängern.');
  r.history ||= [];
  r.history.push({ days: r.days, nr: r.nr, bereich: r.bereich, signedAt: r.signedAt, sigDate: r.sigDate, hash: r.hash, kopf: r.kopf, sig: r.sig });
  if (r.history.length > 20) r.history.shift();
  r.status = 'entwurf';
  save();
  return { report: reportView(r) };
});

route('POST', '/api/report/delete', 'azubi', (ctx) => {
  const r = findReport(ctx, ctx.body.id);
  if (r.firstSignedAt) fail(400, 'Unterschriebene Berichte können nicht gelöscht werden.');
  delete db.reports[r.id];
  save();
  return { ok: true };
});

route('GET', '/api/pdf', 'azubi', (ctx) => {
  gesperrt('pdf');
  const r = findReport(ctx, ctx.query.get('id'));
  /* Vorschau eines Entwurfs mit Unterschrift und gewaehltem Datum, damit man sieht, wie es aussehen wird */
  let preview = null;
  if (r.status !== 'abgeschlossen' && ctx.query.get('preview') === '1') {
    const d = str(ctx.query.get('date'), 10);
    preview = { date: W.isDate(d) ? d : heute(), sig: ctx.user.sig };
  }
  const { pdf, name } = buildPdf(r, { preview });
  const disp = ctx.query.get('view') === '1' ? 'inline' : 'attachment';
  return { raw: pdf, type: 'application/pdf', headers: { 'Content-Disposition': `${disp}; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}` } };
});

/* Alle eigenen Berichte als PDFs in einer ZIP-Datei sichern */
route('GET', '/api/export', 'azubi', (ctx) => {
  gesperrt('pdf');
  const list = ownReports(ctx.user.id).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  if (!list.length) fail(404, 'Noch keine Berichte vorhanden.');
  const seen = new Set();
  const files = list.map((r) => {
    let { pdf, name } = buildPdf(r);
    if (r.status !== 'abgeschlossen') name = name.replace(/\.pdf$/, '_ENTWURF.pdf');
    let n = name, k = 2;
    while (seen.has(n)) n = name.replace(/\.pdf$/, `_${k++}.pdf`);
    seen.add(n);
    return { name: n, data: pdf };
  });
  const u = ctx.user, file = `Berichtsheft_${(u.nachname || u.username).replace(/[^\p{L}\p{N}_-]+/gu, '_')}_alle_${heute()}.zip`;
  return { raw: zip(files), type: 'application/zip', headers: { 'Content-Disposition': `attachment; filename="${asciiName(file)}"; filename*=UTF-8''${encodeURIComponent(file)}` } };
});

route('GET', '/api/blank', 'user', () => {
  const { pdf } = buildPdf({ days: [], weekStart: heute(), nr: 0, status: 'entwurf' }, { blank: true });
  return { raw: pdf, type: 'application/pdf', headers: { 'Content-Disposition': 'inline; filename="Vorlage.pdf"' } };
});

/* ---- Admin: sieht nur die Konten, keine Berichte ---- */

function adminUserView(u) {
  return {
    id: u.id, username: u.username, role: u.role, active: u.active, mustChange: !!u.mustChange,
    vorname: u.vorname || '', nachname: u.nachname || '', firma: u.firma || '',
    beruf: u.beruf || '',
    speicher: speicherInfo(u), speicherMB: u.speicherMB || null, created: u.created, lastSeen: u.lastSeen || u.lastLogin || null, reports: ownReports(u.id).length
  };
}

route('GET', '/api/admin/users', 'admin', () => ({
  users: Object.values(db.users).map(adminUserView).sort((a, b) => (a.role === b.role ? a.username.localeCompare(b.username) : a.role === 'admin' ? -1 : 1))
}));

route('POST', '/api/admin/users', 'admin', (ctx) => {
  const username = str(ctx.body.username, 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail(400, 'Benutzername: 3 bis 40 Zeichen, nur Kleinbuchstaben, Zahlen, Punkt, Minus und Unterstrich.');
  if (Object.values(db.users).some((u) => u.username === username)) fail(400, 'Diesen Benutzernamen gibt es schon.');
  const pw = tempPassword(), id = crypto.randomUUID();
  db.users[id] = {
    id, username, ...hashPw(pw), role: ctx.body.role === 'admin' ? 'admin' : 'azubi', active: true, mustChange: true,
    created: new Date().toISOString(), schultage: [], stunden: 7.6, schulstunden: 7.6
  };
  save();
  return { user: adminUserView(db.users[id]), password: pw };
});

route('POST', '/api/admin/user', 'admin', (ctx) => {
  const b = ctx.body, u = db.users[str(b.id, 60)];
  if (!u) fail(404, 'Unbekanntes Konto.');
  const out = {};
  if (b.resetPassword) {
    if (str(b.confirm, 40).toLowerCase() !== u.username) fail(400, 'Zur Bestätigung bitte den Benutzernamen genau eintippen.');
    const pw = tempPassword(); Object.assign(u, hashPw(pw)); u.mustChange = true; endSessions(u.id); out.password = pw;
  }
  if ('active' in b) {
    if (u.id === ctx.user.id && !b.active) fail(400, 'Du kannst dein eigenes Konto nicht sperren.');
    u.active = !!b.active; if (!u.active) endSessions(u.id);
  }
  for (const k of ['vorname', 'nachname']) if (k in b) u[k] = str(b[k], 60);
  for (const k of ['firma', 'beruf']) if (k in b) u[k] = str(b[k], 120);
  if ('speicherMB' in b) { const v = b.speicherMB === null || b.speicherMB === '' ? null : num(b.speicherMB, 1, 10000, null); u.speicherMB = v; }
  if (b.extendDays) {
    const until = new Date(Date.now() + num(b.extendDays, 1, 365, 30) * 864e5).toISOString();
    for (const r of ownReports(u.id)) if (r.firstSignedAt) r.freiBis = until;
    out.extendedUntil = until;
  }
  save();
  return { user: adminUserView(u), ...out };
});

/* Konto endgueltig loeschen. Bestaetigung durch Eintippen des Benutzernamens. */
route('POST', '/api/admin/delete', 'admin', (ctx) => {
  const u = db.users[str(ctx.body.id, 60)];
  if (!u) fail(404, 'Unbekanntes Konto.');
  if (u.id === ctx.user.id) fail(400, 'Du kannst dein eigenes Admin-Konto nicht löschen.');
  if (str(ctx.body.confirm, 40).toLowerCase() !== u.username) fail(400, 'Zur Bestätigung bitte den Benutzernamen genau eintippen.');
  const sigs = new Set([u.sig]);
  for (const r of ownReports(u.id)) { sigs.add(r.sig); for (const h of r.history || []) sigs.add(h.sig); delete db.reports[r.id]; }
  endSessions(u.id);
  delete db.users[u.id];
  /* Unterschriften loeschen, die sonst niemand mehr braucht */
  const used = new Set(Object.values(db.users).map((x) => x.sig));
  for (const r of Object.values(db.reports)) { used.add(r.sig); for (const h of r.history || []) used.add(h.sig); }
  for (const s of sigs) if (s && !used.has(s)) { try { fs.unlinkSync(path.join(SIG_DIR, s + '.png')); } catch {} sigSizes.delete(s); }
  saveNow();
  return { ok: true };
});

/* Rechtschreibpruefung testen (fuer die Fehlersuche im Admin-Bereich) */
route('GET', '/api/admin/ltcheck', 'admin', async (ctx) => {
  const t0 = Date.now();
  const r = await spellcheck({}, 'Das ist ein Tset mit einem Feler.');
  return { ok: !r.error, ms: Date.now() - t0, treffer: (r.matches || []).length, fehler: r.error ? lastLtError : '', adresse: (db.settings.ltUrl || LT_DEFAULT) };
});

route('GET', '/api/admin/settings', 'admin', () => ({ settings: db.settings, bundeslaender: W.BUNDESLAENDER, funktionen: FUNKTIONEN }));

route('POST', '/api/admin/settings', 'admin', (ctx) => {
  const b = ctx.body.settings || {}, s = db.settings;
  if ('bundesland' in b && W.BUNDESLAENDER[b.bundesland]) s.bundesland = b.bundesland;
  if ('arbeitstage' in b) { const t = (Array.isArray(b.arbeitstage) ? b.arbeitstage : []).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6); s.arbeitstage = [...new Set(t)].sort(); if (!s.arbeitstage.length) s.arbeitstage = [0, 1, 2, 3, 4]; }
  if ('bereiche' in b) { const l = (Array.isArray(b.bereiche) ? b.bereiche : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 20); if (!l.length) fail(400, 'Mindestens ein Bereich wird gebraucht.'); s.bereiche = [...new Set(l)]; }
  if ('dateiname' in b) { const d = str(b.dateiname, 120); if (!d) fail(400, 'Das Namensschema darf nicht leer sein.'); s.dateiname = d; }
  if ('bearbeitbarTage' in b) s.bearbeitbarTage = num(b.bearbeitbarTage, 1, 3650, 90);
  if ('ltUrl' in b) { const v = str(b.ltUrl, 200); if (v && !/^https?:\/\/[^\s]+$/.test(v)) fail(400, 'Adresse der Rechtschreibprüfung ungültig.'); s.ltUrl = v; }
  if (b.gesperrt && typeof b.gesperrt === 'object') s.gesperrt = Object.fromEntries(Object.keys(FUNKTIONEN).map((k) => [k, !!b.gesperrt[k]]));
  if ('speicherMB' in b) s.speicherMB = num(b.speicherMB, 1, 10000, 20);
  if (b.betreiber && typeof b.betreiber === 'object') {
    s.betreiber = { name: str(b.betreiber.name, 120), kontakt: str(b.betreiber.kontakt, 160), serverOrt: str(b.betreiber.serverOrt, 60) || 'Deutschland' };
  }
  if ('sperrText' in b) s.sperrText = str(b.sperrText, 200) || DEFAULT_SETTINGS.sperrText;
  if (b.vorbelegung) for (const k of Object.keys(W.TYPEN)) if (k in b.vorbelegung) s.vorbelegung[k] = str(b.vorbelegung[k], 200);
  save();
  return { settings: s };
});

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Nicht erlaubt', 'text/plain; charset=utf-8');
    return serveStatic(req, res, pathname);
  }
  try {
    const r = routes.find((x) => x.m === req.method && x.p === pathname);
    if (!r) fail(404, 'Unbekannte Anfrage.');
    /* Schutz vor fremden Seiten: Aenderungen nur mit eigenem Kopf */
    if (req.method !== 'GET' && req.headers['x-bh'] !== '1') fail(403, 'Anfrage abgelehnt.');
    const user = currentUser(req);
    if (r.auth && !user) fail(401, 'Bitte anmelden.');
    if (r.auth === 'admin' && user.role !== 'admin') fail(403, 'Nur für Admins.');
    if (r.auth === 'azubi' && user.role === 'admin') fail(403, 'Der Admin-Zugang hat kein eigenes Berichtsheft. Bitte mit dem persönlichen Konto anmelden.');
    if (user && r.auth && user.role !== 'admin' && db.settings.gesperrt && db.settings.gesperrt.login) fail(503, `${FUNKTIONEN.login}: ${db.settings.sperrText}`);
    if (user && user.mustChange && r.auth && pathname !== '/api/password') fail(403, 'Bitte zuerst ein eigenes Passwort festlegen.');
    if (user && r.auth === 'azubi' && profileMissing(user).length && !['/api/report/next', '/api/reports'].includes(pathname)) fail(403, 'Bitte zuerst deine Angaben vervollständigen.');
    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await r.fn({ req, res, user, body: body && typeof body === 'object' ? body : {}, query: url.searchParams, ip: clientIp(req) });
    if (out && out.raw) return send(res, 200, out.raw, out.type, out.headers || {});
    send(res, 200, out || { ok: true });
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(new Date().toISOString(), pathname, e);
    if (!res.headersSent) send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Interner Fehler.' });
  }
}

http.createServer(handle).listen(PORT, HOST, () => {
  console.log(`Berichtsheft ${VERSION} läuft auf http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  const code = setupCode();
  if (code) console.log(`Noch kein Admin. Einrichtungs-Code: ${code}  (steht auch in ${SETUP_FILE})`);
});
