'use strict';
/* Schreib-KI: macht aus Stichworten einen kurzen Berichtstext im Stil der eigenen fertigen Berichte.
 * Nutzt die Claude-API (Anthropic). Der Schluessel liegt nur auf dem Server (Ordner secret). */
const https = require('https');
const http = require('http');

/* Nur fuer Tests umstellbar (KI_API_BASE=http://127.0.0.1:9999) */
const BASE = new URL(process.env.KI_API_BASE || 'https://api.anthropic.com');
const API_VERSION = '2023-06-01';
const STANDARD_MODELL = 'claude-haiku-5-5';

function anfrage(method, pfad, key, body, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = (BASE.protocol === 'http:' ? http : https).request({
      host: BASE.hostname, port: BASE.port || undefined, path: pfad, method, timeout,
      headers: { 'x-api-key': key, 'anthropic-version': API_VERSION, 'content-type': 'application/json', ...(data ? { 'content-length': data.length } : {}) }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        resolve({ status: res.statusCode, json: j });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/* Falls das eingestellte Modell nicht (mehr) existiert: ein aktuelles Haiku-Modell suchen */
let ersatzModell = null;
async function findeModell(key) {
  if (ersatzModell) return ersatzModell;
  const r = await anfrage('GET', '/v1/models?limit=100', key);
  const ids = ((r.json && r.json.data) || []).map((m) => m.id);
  ersatzModell = ids.find((id) => /haiku/i.test(id)) || ids.find((id) => /sonnet/i.test(id)) || ids[0] || null;
  return ersatzModell;
}

function fehlerText(r) {
  const m = r.json && r.json.error && r.json.error.message ? r.json.error.message : '';
  if (r.status === 401) return 'Der API-Schlüssel ist ungültig.';
  if (r.status === 403) return 'Der API-Schlüssel hat keine Berechtigung.';
  if (r.status === 429) return 'Gerade zu viele Anfragen an die KI. Bitte kurz warten.';
  if (r.status === 529 || r.status === 503) return 'Die KI ist gerade überlastet. Bitte gleich nochmal.';
  if (/credit|billing|balance/i.test(m)) return 'Beim KI-Konto ist kein Guthaben mehr vorhanden.';
  return 'Die KI hat nicht geantwortet' + (m ? ': ' + m : '.');
}

async function nachricht(key, modell, system, user, { temperature = 0.7, maxTokens = 300 } = {}) {
  const body = (m) => ({ model: m, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: user }] });
  let m = modell || STANDARD_MODELL;
  let r = await anfrage('POST', '/v1/messages', key, body(m));
  if (r.status === 404 || (r.status === 400 && r.json && /model/i.test(JSON.stringify(r.json.error || '')))) {
    const neu = await findeModell(key).catch(() => null);
    if (neu && neu !== m) { m = neu; r = await anfrage('POST', '/v1/messages', key, body(m)); }
  }
  if (r.status !== 200) throw new Error(fehlerText(r));
  const text = ((r.json && r.json.content) || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  if (!text) throw new Error('Die KI hat keinen Text geliefert.');
  return { text, modell: m };
}

const TYP_NAME = { betrieb: 'Arbeitstag im Betrieb', schule: 'Berufsschultag', urlaub: 'Urlaub', krank: 'krank', feiertag: 'Feiertag', frei: 'frei' };

/* Hauptfunktion: Stichworte -> Satz */
async function satzBauen({ key, modell, stichworte, typ, bereich, beruf, beispiele, andereTage, vorher, maxZeichen }) {
  const system = [
    'Du hilfst Auszubildenden in Deutschland beim Schreiben ihres Ausbildungsnachweises (Berichtsheft, täglich).',
    'Aus Stichworten oder einem holprigen Text machst du einen kurzen, sauberen Eintrag für einen Tag.',
    'Regeln:',
    '- Übernimm alle Tätigkeiten und Details aus den Stichworten (Werkstücke, Maße, Werkzeuge, Orte, Namen). Erfinde nichts dazu, lass nichts Wichtiges weg.',
    '- Schreibe im gleichen Stil wie die Beispiele der Person (Zeitform, Satzbau, ob mit oder ohne „ich“, Fachbegriffe, Länge). Ohne Beispiele: sachlicher Berichtsstil ohne „ich“, z. B. „Grundplatte angerissen und zwei Fasen gefeilt.“',
    '- Richtige Rechtschreibung, Grammatik, Groß-/Kleinschreibung und Kommas. Fachbegriffe korrekt schreiben.',
    `- Kurz halten: ein bis zwei Sätze, höchstens ${maxZeichen} Zeichen.`,
    '- Gib nur den fertigen Text aus, ohne Anführungszeichen, ohne Erklärung, ohne Aufzählungszeichen.'
  ].join('\n');
  const teile = [];
  if (beruf) teile.push(`Ausbildungsberuf: ${beruf}`);
  teile.push(`Tag: ${TYP_NAME[typ] || 'Arbeitstag'}${bereich ? `, Bereich: ${bereich}` : ''}`);
  if (beispiele.length) teile.push('So hat die Person ihre fertigen Berichte geschrieben (Stil übernehmen, Inhalt und Tippfehler darin NICHT übernehmen):\n' + beispiele.map((b) => '- ' + b).join('\n'));
  if (andereTage.length) teile.push('Andere Tage dieser Woche (nur zur Einordnung, nicht wiederholen):\n' + andereTage.map((b) => '- ' + b).join('\n'));
  if (vorher.length) teile.push('Diese Formulierungen gab es schon. Formuliere den Satzbau deutlich anders, gleicher Inhalt:\n' + vorher.map((b) => '- ' + b).join('\n'));
  teile.push('Stichworte für heute:\n' + stichworte);
  const { text, modell: m } = await nachricht(key, modell, system, teile.join('\n\n'), { temperature: vorher.length ? 1 : 0.6 });
  /* Aufraeumen: Anfuehrungszeichen, Zeilenumbrueche, Aufzaehlungen */
  const sauber = text.replace(/^["„“'»«]+|["“”'»«]+$/g, '').replace(/^\s*[-•*]\s*/gm, '').replace(/\s*\n+\s*/g, ' ').trim();
  return { text: sauber, modell: m };
}

async function testen(key, modell) {
  const t0 = Date.now();
  const r = await satzBauen({ key, modell, stichworte: 'grundplatte angerissen 2 fasen gefeilt werkstatt aufgeräumt', typ: 'betrieb', bereich: '', beruf: '', beispiele: [], andereTage: [], vorher: [], maxZeichen: 200 });
  return { ...r, ms: Date.now() - t0 };
}

module.exports = { satzBauen, testen, STANDARD_MODELL };
