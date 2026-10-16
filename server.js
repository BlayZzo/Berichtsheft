'use strict';
/*
 * Berichtsheft - digitaler Ausbildungsnachweis
 * Braucht nur Node.js 20 oder neuer, keine Zusatzpakete.
 * Alle Daten liegen in BH_DATA (auf dem Server /var/lib/berichtsheft/data), nie im Programmordner.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const W = require('./lib/weeks');
const { fill, fitDay } = require('./lib/fill');
const { decodePng } = require('./lib/png');

const VERSION = '2.0.0';
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

/* ---------- Daten ---------- */

const DEFAULT_SETTINGS = {
  bundesland: 'HB',
  arbeitstage: [0, 1, 2, 3, 4],
  bereiche: ['AW', 'BBS', 'Betrieb'],
  dateiname: 'Berichtsheft_{nachname}_NR{nr}',
  bearbeitbarTage: 90,
  ltUrl: '',
  ltAus: false,
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
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJson(DB_FILE, db), 50);
}
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
  if (typeof pw !== 'string' || pw.length < 10) return 'Das Passwort braucht mindestens 10 Zeichen.';
  if (pw.length > 200) return 'Das Passwort ist zu lang.';
  return '';
}
function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
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
  if (now - s.last > 60e3) { s.last = now; saveSessionsSoon(); }
  return u;
}
function startSession(res, user) {
  const t = crypto.randomBytes(32).toString('base64url');
  sessions.set(tokenKey(t), { userId: user.id, exp: Date.now() + SESSION_DAYS * 864e5, last: Date.now() });
  saveSessionsSoon();
  res.setHeader('Set-Cookie', `bh_sid=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${SECURE}`);
}
function endSessions(userId, exceptReq) {
  const keep = exceptReq && cookies(exceptReq).bh_sid ? tokenKey(cookies(exceptReq).bh_sid) : null;
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
  if (!code) {
    code = tempPassword();
    fs.writeFileSync(SETUP_FILE, code + '\n', { mode: 0o600 });
  }
  return code;
}

/* ---------- Hilfen ---------- */

const str = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max).trim();
const text = (v, max = 4000) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
const num = (v, min, max, def) => { const x = Number(String(v).replace(',', '.')); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def; };
const heute = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, role: u.role, mustChange: !!u.mustChange,
    vorname: u.vorname, nachname: u.nachname, beginn: u.beginn, ende: u.ende, bereich: u.bereich || '',
    schultage: u.schultage || [], stunden: u.stunden, schulstunden: u.schulstunden, hasSignature: !!u.sig,
    woerterbuch: u.woerterbuch || [], active: u.active
  };
}
const profileMissing = (u) => ['vorname', 'nachname', 'beginn'].filter((k) => !u[k]);

function deadlineOf(r) {
  if (!r.firstSignedAt) return null;
  const base = new Date(r.firstSignedAt).getTime() + (Number(db.settings.bearbeitbarTage) || 90) * 864e5;
  const extra = r.freiBis ? new Date(r.freiBis).getTime() : 0;
  return new Date(Math.max(base, extra)).toISOString();
}
const canEdit = (r) => r.status !== 'abgeschlossen' || Date.now() <= new Date(deadlineOf(r)).getTime();
/* Wie im Papier-Formular: Woche von Montag bis Sonntag */
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

function buildPdf(r, { blank = false } = {}) {
  const done = r.status === 'abgeschlossen';
  const k = nameOf(r);
  const rows = rowsOf(r).map((d) => d && ({ text: d.text, hours: NO_HOURS.has(d.type) && !Number(d.hours) ? null : d.hours }));
  let footer = '';
  if (done) {
    footer = `Digital unterschrieben am ${W.de(r.signedAt.slice(0, 10))}`;
    if (r.korrigiertAm) footer += ` (korrigiert, erstmals ${W.de(r.firstSignedAt.slice(0, 10))})`;
    footer += `  ·  Nr. ${r.nr}  ·  Prüfsumme ${r.hash.slice(0, 16)}`;
  } else if (!blank) footer = 'ENTWURF – noch nicht unterschrieben';
  const pdf = fill(blank ? { days: [] } : {
    name: `${k.vorname} ${k.nachname}`.trim(), ajahr: r.ausbildungsjahr ? String(r.ausbildungsjahr) : '', bereich: r.bereich,
    von: deKurz(r.weekStart), bis: deKurz(lastDay(r)), days: rows,
    sigDate: done ? W.de(r.sigDate) : '', signature: done ? loadSignature(r.sig) : null, seed: r.id + r.signedAt, footer
  });
  return { pdf, name: fileName(r) };
}

function reportView(r) {
  return {
    id: r.id, nr: r.nr, weekStart: r.weekStart, bereich: r.bereich, ausbildungsjahr: r.ausbildungsjahr, days: r.days,
    status: r.status, sigDate: r.sigDate, signedAt: r.signedAt, firstSignedAt: r.firstSignedAt, korrigiertAm: r.korrigiertAm,
    deadline: deadlineOf(r), editable: canEdit(r), file: fileName(r), updated: r.updated,
    kw: W.isoWeek(r.weekStart).week, jahr: W.isoWeek(r.weekStart).year, bis: lastDay(r),
    holidays: r.days.map((d) => W.holidayName(d.date, db.settings.bundesland)),
    fits: fitsOf(r).map((f) => (f ? { fits: f.fits, over: f.over || 0 } : null))
  };
}
function listItem(r) {
  return {
    id: r.id, nr: r.nr, weekStart: r.weekStart, bis: lastDay(r), bereich: r.bereich, status: r.status, signedAt: r.signedAt,
    updated: r.updated, deadline: deadlineOf(r), editable: canEdit(r), file: fileName(r), kw: W.isoWeek(r.weekStart).week
  };
}

/* ---------- Rechtschreibung (LanguageTool) ---------- */

async function spellcheck(user, input) {
  if (db.settings.ltAus) return { off: true, matches: [] };
  const base = (db.settings.ltUrl || LT_DEFAULT).replace(/\/+$/, '');
  const body = new URLSearchParams({ text: input, language: 'de-DE' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let data;
  try {
    const res = await fetch(base + '/v2/check', { method: 'POST', body, signal: ctrl.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (e) {
    return { error: 'Die Rechtschreibprüfung ist gerade nicht erreichbar.', matches: [] };
  } finally { clearTimeout(timer); }
  const dict = new Set((user.woerterbuch || []).map((w) => w.toLowerCase()));
  const matches = (data.matches || []).map((m) => ({
    offset: m.offset, length: m.length, message: m.message, shortMessage: m.shortMessage || '',
    word: input.substr(m.offset, m.length),
    replacements: (m.replacements || []).slice(0, 5).map((x) => x.value),
    typo: m.rule && m.rule.issueType === 'misspelling',
    rule: m.rule ? m.rule.id : ''
  })).filter((m) => !(m.typo && dict.has(m.word.toLowerCase())));
  return { matches };
}

/* ---------- HTTP ---------- */

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
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

function weekParam(v) {
  const s = str(v, 10);
  if (!W.isDate(s)) fail(400, 'Ungültiges Datum.');
  return W.mondayOf(s);
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

/* Routen: [Methode, Pfad, Recht, Funktion]. Recht: null = offen, 'user', 'admin' */
const routes = [];
const route = (m, p, auth, fn) => routes.push({ m, p, auth, fn });

route('GET', '/api/health', null, () => ({ ok: true, version: VERSION }));

route('GET', '/api/state', null, (ctx) => ({
  setup: needsSetup(), user: publicUser(ctx.user), version: VERSION,
  settings: ctx.user ? {
    bundesland: db.settings.bundesland, arbeitstage: db.settings.arbeitstage, typen: W.TYPEN, vorbelegung: db.settings.vorbelegung,
    bearbeitbarTage: db.settings.bearbeitbarTage, bereiche: db.settings.bereiche, ltAus: db.settings.ltAus
  } : null
}));

route('POST', '/api/setup', null, (ctx) => {
  if (!needsSetup()) fail(400, 'Die Einrichtung ist schon erledigt.');
  const ip = 'setup:' + ctx.ip;
  if (limited(ip)) fail(429, 'Zu viele Versuche. Bitte 15 Minuten warten.');
  const code = setupCode(), b = ctx.body;
  if (!code || typeof b.code !== 'string' || b.code.trim().length !== code.length || !crypto.timingSafeEqual(Buffer.from(b.code.trim()), Buffer.from(code))) { failed(ip); fail(403, 'Der Einrichtungs-Code stimmt nicht.'); }
  const username = str(b.username, 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail(400, 'Benutzername: 3 bis 40 Zeichen, nur Buchstaben, Zahlen, Punkt, Minus und Unterstrich.');
  const p = pwProblem(b.password); if (p) fail(400, p);
  const id = crypto.randomUUID();
  const { salt, hash } = hashPw(b.password);
  db.users[id] = { id, username, salt, hash, role: 'admin', active: true, created: new Date().toISOString(), vorname: str(b.vorname, 60), nachname: str(b.nachname, 60), stunden: 7.6, schulstunden: 7.6, schultage: [] };
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
  const ok = u && u.active && checkPw(u, String(ctx.body.password || ''));
  if (!u) hashPw('x'); /* gleiche Rechenzeit, damit man Benutzernamen nicht erraten kann */
  if (!ok) { failed(kIp); failed(kUser); fail(401, 'Benutzername oder Passwort falsch.'); }
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
  if ('vorname' in b) u.vorname = str(b.vorname, 60);
  if ('nachname' in b) u.nachname = str(b.nachname, 60);
  if ('bereich' in b) u.bereich = str(b.bereich, 80);
  if ('beginn' in b) { const v = str(b.beginn, 10); if (v && !W.isDate(v)) fail(400, 'Ausbildungsbeginn ungültig.'); u.beginn = v; }
  if ('ende' in b) { const v = str(b.ende, 10); if (v && !W.isDate(v)) fail(400, 'Ausbildungsende ungültig.'); u.ende = v; }
  if ('schultage' in b) u.schultage = (Array.isArray(b.schultage) ? b.schultage : []).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6).slice(0, 7);
  if ('stunden' in b) u.stunden = num(b.stunden, 0, 24, 8);
  if ('schulstunden' in b) u.schulstunden = num(b.schulstunden, 0, 24, 8);
  save();
  return { user: publicUser(u) };
});

route('POST', '/api/me/signature', 'user', (ctx) => {
  const u = ctx.user;
  if (ctx.body.png === null) { u.sig = ''; save(); return { user: publicUser(u) }; }
  try { u.sig = saveSignature(ctx.body.png); } catch (e) { fail(400, e.message); }
  save();
  return { user: publicUser(u) };
});
route('GET', '/api/me/signature', 'user', (ctx) => {
  if (!ctx.user.sig) fail(404, 'Keine Unterschrift hinterlegt.');
  const file = path.join(SIG_DIR, ctx.user.sig + '.png');
  if (!fs.existsSync(file)) fail(404, 'Keine Unterschrift hinterlegt.');
  return { raw: fs.readFileSync(file), type: 'image/png' };
});

route('POST', '/api/me/dict', 'user', (ctx) => {
  const u = ctx.user;
  u.woerterbuch ||= [];
  const add = str(ctx.body.add, 60), del = str(ctx.body.remove, 60);
  if (add && /^[\p{L}\p{N}.\-/]+$/u.test(add) && !u.woerterbuch.includes(add) && u.woerterbuch.length < 1000) u.woerterbuch.push(add);
  if (del) u.woerterbuch = u.woerterbuch.filter((w) => w !== del);
  save();
  return { woerterbuch: u.woerterbuch };
});

route('POST', '/api/check', 'user', async (ctx) => {
  const t = text(ctx.body.text, 8000);
  if (!t.trim()) return { matches: [] };
  return spellcheck(ctx.user, t);
});

/* ---- Berichte ---- */

const ownReports = (uid) => Object.values(db.reports).filter((r) => r.userId === uid);
function findReport(ctx, id, write) {
  const r = db.reports[str(id, 40)];
  if (!r) fail(404, 'Bericht nicht gefunden.');
  if (r.userId !== ctx.user.id && !(ctx.user.role === 'admin' && !write)) fail(404, 'Bericht nicht gefunden.');
  return r;
}

/* Vorschlag fuer einen neuen Bericht: Woche nach dem letzten Bericht, Nummer = hoechste + 1 */
route('GET', '/api/report/next', 'user', (ctx) => {
  const u = ctx.user, list = ownReports(u.id);
  const thisWeek = W.mondayOf(heute());
  let weekStart = thisWeek, nr = 1;
  if (list.length) {
    const latest = list.reduce((a, b) => (a.weekStart > b.weekStart ? a : b));
    weekStart = W.addDays(latest.weekStart, 7);
    nr = Math.max(...list.map((r) => Number(r.nr) || 0)) + 1;
  } else if (W.isDate(u.beginn)) {
    nr = Math.max(1, W.reportNr(u.beginn, weekStart));
  }
  return { weekStart, nr, bereich: u.bereich || db.settings.bereiche[0] || '', missing: profileMissing(u), hasSignature: !!u.sig };
});

/* Ganze Woche Berufsschule (z. B. Bereich "BBS"): alle normalen Tage als Schultage vorbelegen */
function schoolWeek(days, bereich) {
  if (!/\b(BBS|Berufsschule|Schule)\b/i.test(bereich)) return days;
  return days.map((d) => (d.type === 'betrieb' ? { ...d, type: 'schule', text: W.fillText('schule', db.settings, ''), hours: d.hours } : d));
}

route('POST', '/api/report/new', 'user', (ctx) => {
  const u = ctx.user, b = ctx.body;
  if (profileMissing(u).length) fail(400, 'Bitte zuerst in den Einstellungen Vorname, Nachname und Ausbildungsbeginn eintragen.');
  const ws = W.mondayOf(str(b.weekStart, 10) || heute());
  if (!W.isDate(ws)) fail(400, 'Ungültige Woche.');
  const dup = ownReports(u.id).find((r) => r.weekStart === ws);
  if (dup) return { id: dup.id, existed: true };
  const auto = W.buildWeek(u, db.settings, ws);
  const id = crypto.randomBytes(9).toString('base64url');
  db.reports[id] = {
    id, userId: u.id, weekStart: ws, nr: Math.round(num(b.nr, 1, 9999, 1)), bereich: str(b.bereich, 80),
    ausbildungsjahr: auto.ausbildungsjahr, days: schoolWeek(auto.days, str(b.bereich, 80)), status: 'entwurf',
    created: new Date().toISOString(), updated: new Date().toISOString(), history: []
  };
  saveNow();
  return { id };
});

route('GET', '/api/reports', 'user', (ctx) => {
  const uid = ctx.user.role === 'admin' && ctx.query.get('user') ? ctx.query.get('user') : ctx.user.id;
  if (!db.users[uid]) fail(404, 'Unbekanntes Konto.');
  return { reports: ownReports(uid).sort((a, b) => b.weekStart.localeCompare(a.weekStart)).map(listItem) };
});

route('GET', '/api/report', 'user', (ctx) => ({ report: reportView(findReport(ctx, ctx.query.get('id'))) }));

route('POST', '/api/report/save', 'user', (ctx) => {
  const r = findReport(ctx, ctx.body.id, true), b = ctx.body;
  if (r.status === 'abgeschlossen') fail(409, 'Dieser Bericht ist unterschrieben. Zum Ändern zuerst „Nachträglich bearbeiten“ wählen.');
  if ('nr' in b) r.nr = Math.round(num(b.nr, 1, 9999, r.nr));
  if ('bereich' in b) r.bereich = str(b.bereich, 80);
  if ('days' in b) r.days = cleanDays(b.days, r.weekStart);
  r.updated = new Date().toISOString();
  save();
  return { report: reportView(r) };
});

route('POST', '/api/report/finish', 'user', (ctx) => {
  const u = ctx.user, r = findReport(ctx, ctx.body.id, true);
  if (r.status === 'abgeschlossen') fail(409, 'Der Bericht ist schon unterschrieben.');
  if (!u.sig || !loadSignature(u.sig)) fail(400, 'Bitte zuerst in den Einstellungen deine Unterschrift hinterlegen.');
  const date = str(ctx.body.date, 10) || heute();
  if (!W.isDate(date)) fail(400, 'Bitte ein gültiges Datum für die Unterschrift wählen.');
  if (date > heute()) fail(400, 'Das Datum der Unterschrift darf nicht in der Zukunft liegen.');
  const empty = r.days.filter((d) => (d.type === 'betrieb' || d.type === 'schule') && !d.text.trim().replace(/^Berufsschule:\s*$/, ''));
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

route('POST', '/api/report/reopen', 'user', (ctx) => {
  const r = findReport(ctx, ctx.body.id, true);
  if (r.status !== 'abgeschlossen') fail(400, 'Der Bericht ist nicht unterschrieben.');
  if (!canEdit(r)) fail(403, 'Die Frist zum Bearbeiten ist abgelaufen. Der Admin kann sie verlängern.');
  r.history ||= [];
  r.history.push({ days: r.days, nr: r.nr, bereich: r.bereich, signedAt: r.signedAt, sigDate: r.sigDate, hash: r.hash, kopf: r.kopf, sig: r.sig });
  if (r.history.length > 20) r.history.shift();
  r.status = 'entwurf';
  save();
  return { report: reportView(r) };
});

route('POST', '/api/report/delete', 'user', (ctx) => {
  const r = findReport(ctx, ctx.body.id, true);
  if (r.firstSignedAt) fail(400, 'Unterschriebene Berichte können nicht gelöscht werden.');
  delete db.reports[r.id];
  save();
  return { ok: true };
});

route('GET', '/api/pdf', 'user', (ctx) => {
  const r = findReport(ctx, ctx.query.get('id'));
  const { pdf, name } = buildPdf(r);
  const disp = ctx.query.get('view') === '1' ? 'inline' : 'attachment';
  return { raw: pdf, type: 'application/pdf', headers: { 'Content-Disposition': `${disp}; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}` } };
});

route('GET', '/api/blank', 'user', () => {
  const { pdf } = buildPdf({ days: [], weekStart: heute(), nr: 0, status: 'entwurf' }, { blank: true });
  return { raw: pdf, type: 'application/pdf', headers: { 'Content-Disposition': 'inline; filename="Vorlage.pdf"' } };
});

/* ---- Admin ---- */

route('GET', '/api/admin/users', 'admin', () => ({
  users: Object.values(db.users).map((u) => ({ ...publicUser(u), lastLogin: u.lastLogin || null, reports: ownReports(u.id).length }))
    .sort((a, b) => a.username.localeCompare(b.username))
}));

route('POST', '/api/admin/users', 'admin', (ctx) => {
  const b = ctx.body;
  const username = str(b.username, 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail(400, 'Benutzername: 3 bis 40 Zeichen, nur Buchstaben, Zahlen, Punkt, Minus und Unterstrich.');
  if (Object.values(db.users).some((u) => u.username === username)) fail(400, 'Diesen Benutzernamen gibt es schon.');
  if (b.beginn && !W.isDate(str(b.beginn, 10))) fail(400, 'Ausbildungsbeginn ungültig.');
  const pw = tempPassword(), id = crypto.randomUUID();
  db.users[id] = {
    id, username, ...hashPw(pw), role: b.role === 'admin' ? 'admin' : 'azubi', active: true, mustChange: true, created: new Date().toISOString(),
    vorname: str(b.vorname, 60), nachname: str(b.nachname, 60), beginn: str(b.beginn, 10), schultage: [], stunden: 7.6, schulstunden: 7.6
  };
  save();
  return { user: publicUser(db.users[id]), password: pw };
});

route('POST', '/api/admin/user', 'admin', (ctx) => {
  const b = ctx.body, u = db.users[str(b.id, 60)];
  if (!u) fail(404, 'Unbekanntes Konto.');
  const out = {};
  if (b.resetPassword) { const pw = tempPassword(); Object.assign(u, hashPw(pw)); u.mustChange = true; endSessions(u.id); out.password = pw; }
  if ('active' in b) {
    if (u.id === ctx.user.id && !b.active) fail(400, 'Du kannst dein eigenes Konto nicht sperren.');
    u.active = !!b.active; if (!u.active) endSessions(u.id);
  }
  if ('role' in b) {
    if (u.id === ctx.user.id && b.role !== 'admin') fail(400, 'Du kannst dir die Admin-Rechte nicht selbst nehmen.');
    u.role = b.role === 'admin' ? 'admin' : 'azubi';
  }
  save();
  return { user: publicUser(u), ...out };
});

route('POST', '/api/admin/extend', 'admin', (ctx) => {
  const r = db.reports[str(ctx.body.id, 40)];
  if (!r) fail(404, 'Bericht nicht gefunden.');
  r.freiBis = new Date(Date.now() + num(ctx.body.days, 1, 365, 30) * 864e5).toISOString();
  save();
  return { deadline: deadlineOf(r) };
});

route('GET', '/api/admin/settings', 'admin', () => ({ settings: db.settings, bundeslaender: W.BUNDESLAENDER }));

route('POST', '/api/admin/settings', 'admin', (ctx) => {
  const b = ctx.body.settings || {}, s = db.settings;
  if ('bundesland' in b && W.BUNDESLAENDER[b.bundesland]) s.bundesland = b.bundesland;
  if ('arbeitstage' in b) { const t = (Array.isArray(b.arbeitstage) ? b.arbeitstage : []).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6); s.arbeitstage = [...new Set(t)].sort(); if (!s.arbeitstage.length) s.arbeitstage = [0, 1, 2, 3, 4]; }
  if ('bereiche' in b) { const l = (Array.isArray(b.bereiche) ? b.bereiche : []).map((x) => str(x, 80)).filter(Boolean).slice(0, 20); if (!l.length) fail(400, 'Mindestens ein Bereich wird gebraucht.'); s.bereiche = [...new Set(l)]; }
  if ('dateiname' in b) { const d = str(b.dateiname, 120); if (!d) fail(400, 'Das Namensschema darf nicht leer sein.'); s.dateiname = d; }
  if ('bearbeitbarTage' in b) s.bearbeitbarTage = num(b.bearbeitbarTage, 1, 3650, 90);
  if ('ltUrl' in b) { const v = str(b.ltUrl, 200); if (v && !/^https?:\/\/[^\s]+$/.test(v)) fail(400, 'Adresse der Rechtschreibprüfung ungültig.'); s.ltUrl = v; }
  if ('ltAus' in b) s.ltAus = !!b.ltAus;
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
    if (user && user.mustChange && r.auth && pathname !== '/api/password') fail(403, 'Bitte zuerst ein eigenes Passwort festlegen.');
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
