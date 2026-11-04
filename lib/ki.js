'use strict';
/* Schreib-KI: macht aus Stichworten einen kurzen Berichtstext im Stil der eigenen fertigen Berichte.
 * Mehrere Anbieter: Groq und Google Gemini (kostenloser Zugang) oder Anthropic Claude (kostenpflichtig).
 * Groq und Gemini werden ueber die OpenAI-kompatible Schnittstelle angesprochen.
 * Der Schluessel liegt nur auf dem Server (Ordner secret). */
const https = require('https');
const http = require('http');

const ANBIETER = {
  groq: {
    name: 'Groq (kostenlos)', art: 'openai', base: 'https://api.groq.com/openai/v1', modell: 'llama-3.3-70b-versatile',
    konsole: 'console.groq.com', schluessel: /^gsk_[A-Za-z0-9]{20,}$/, beispiel: 'gsk_…',
    bevorzugt: [/llama-3\.3-70b/, /gpt-oss-120b/, /llama-4/, /70b/]
  },
  gemini: {
    name: 'Google Gemini (kostenlos)', art: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', modell: 'gemini-2.5-flash',
    konsole: 'aistudio.google.com', schluessel: /^AIza[0-9A-Za-z_-]{30,}$/, beispiel: 'AIza…',
    bevorzugt: [/^gemini-[\d.]+-flash$/, /^gemini-.*flash(?!.*(lite|image|tts|live|audio|thinking|preview))/, /flash/]
  },
  anthropic: {
    name: 'Anthropic Claude (kostenpflichtig)', art: 'anthropic', base: 'https://api.anthropic.com/v1', modell: 'claude-haiku-5-5',
    konsole: 'console.anthropic.com', schluessel: /^sk-ant-[A-Za-z0-9_-]{20,}$/, beispiel: 'sk-ant-…',
    bevorzugt: [/haiku/, /sonnet/]
  }
};
const STANDARD_ANBIETER = 'groq';

/* Nur fuer Tests umstellbar (KI_API_BASE=http://127.0.0.1:9999): ersetzt Rechner und Port, der Pfad bleibt */
function zielUrl(base, pfad) {
  const u = new URL(base + pfad);
  if (process.env.KI_API_BASE) { const o = new URL(process.env.KI_API_BASE); u.protocol = o.protocol; u.host = o.host; }
  return u;
}

function anfrage(method, url, headers, body, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = (url.protocol === 'http:' ? http : https).request(url, {
      method, timeout,
      headers: { 'content-type': 'application/json', ...headers, ...(data ? { 'content-length': data.length } : {}) }
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

const kopf = (a, key) => (a.art === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { authorization: 'Bearer ' + key });

function fehlerMeldung(r) {
  const e = r.json && (Array.isArray(r.json) ? r.json[0] && r.json[0].error : r.json.error);
  const m = e ? (typeof e === 'string' ? e : e.message || '') : '';
  if (r.status === 401 || r.status === 403 || /api key not valid|invalid api key|invalid x-api-key/i.test(m)) return 'Der API-Schlüssel ist ungültig oder hat keine Berechtigung.';
  if (r.status === 429) return 'Das kostenlose Limit ist gerade erreicht. Bitte in ein paar Minuten nochmal.';
  if (r.status === 503 || r.status === 529) return 'Die KI ist gerade überlastet. Bitte gleich nochmal.';
  if (/credit|billing|balance|quota/i.test(m)) return 'Beim KI-Konto ist das Kontingent oder Guthaben aufgebraucht.';
  return 'Die KI hat nicht geantwortet' + (m ? ': ' + String(m).slice(0, 200) : ` (Fehler ${r.status}).`);
}
const modellFehler = (r) => r.status === 404 || ((r.status === 400 || r.status === 422) && /model/i.test(JSON.stringify((r.json && r.json.error) || r.json || '')));

/* Falls das eingestellte Modell nicht (mehr) existiert: ein passendes aus der Liste des Anbieters nehmen */
const ersatz = new Map();
async function findeModell(a, key) {
  if (ersatz.has(a.base)) return ersatz.get(a.base);
  const r = await anfrage('GET', zielUrl(a.base, a.art === 'anthropic' ? '/models?limit=100' : '/models'), kopf(a, key));
  const ids = ((r.json && r.json.data) || []).map((m) => String(m.id || '').replace(/^models\//, '')).filter(Boolean);
  let id = null;
  for (const re of a.bevorzugt) { id = ids.find((x) => re.test(x)); if (id) break; }
  id ||= ids[0] || null;
  ersatz.set(a.base, id);
  return id;
}

async function einmal(a, key, modell, system, user, temperature, maxTokens) {
  if (a.art === 'anthropic') {
    const r = await anfrage('POST', zielUrl(a.base, '/messages'), kopf(a, key), { model: modell, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: user }] });
    const text = r.status === 200 ? ((r.json && r.json.content) || []).filter((c) => c.type === 'text').map((c) => c.text).join('') : '';
    return { r, text };
  }
  const r = await anfrage('POST', zielUrl(a.base, '/chat/completions'), kopf(a, key), {
    model: modell, max_tokens: maxTokens, temperature,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  });
  const msg = r.status === 200 && r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message;
  return { r, text: msg ? String(msg.content || '') : '' };
}

async function nachricht({ anbieter, key, modell }, system, user, { temperature = 0.7, maxTokens = 400 } = {}) {
  const a = ANBIETER[anbieter] || ANBIETER[STANDARD_ANBIETER];
  let m = modell || a.modell;
  let { r, text } = await einmal(a, key, m, system, user, temperature, maxTokens);
  if (modellFehler(r)) {
    const neu = await findeModell(a, key).catch(() => null);
    if (neu && neu !== m) { m = neu; ({ r, text } = await einmal(a, key, m, system, user, temperature, maxTokens)); }
  }
  if (r.status !== 200) throw new Error(fehlerMeldung(r));
  /* Manche Modelle schreiben ihre Ueberlegungen in <think>…</think> davor */
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!text) throw new Error('Die KI hat keinen Text geliefert.');
  return { text, modell: m };
}

const TYP_NAME = { betrieb: 'Arbeitstag im Betrieb', schule: 'Berufsschultag', urlaub: 'Urlaub', krank: 'krank', feiertag: 'Feiertag', frei: 'frei' };

/* Hauptfunktion: Stichworte -> Satz */
async function satzBauen({ zugang, stichworte, typ, bereich, beruf, beispiele, andereTage, vorher, maxZeichen }) {
  const system = [
    'Du hilfst Auszubildenden in Deutschland beim Schreiben ihres Ausbildungsnachweises (Berichtsheft, täglich).',
    'Aus Stichworten oder einem holprigen Text machst du einen kurzen, sauberen Eintrag für einen Tag. Antworte immer auf Deutsch.',
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
  const { text, modell } = await nachricht(zugang, system, teile.join('\n\n'), { temperature: vorher.length ? 1 : 0.6 });
  /* Aufraeumen: Anfuehrungszeichen, Zeilenumbrueche, Aufzaehlungen */
  const sauber = text.replace(/^["„“'»«]+|["“”'»«]+$/g, '').replace(/^\s*[-•*]\s*/gm, '').replace(/\s*\n+\s*/g, ' ').trim();
  return { text: sauber, modell };
}

async function testen(zugang) {
  const t0 = Date.now();
  const r = await satzBauen({ zugang, stichworte: 'grundplatte angerisen 2 fasen gefeilt werkstat aufgeräumt', typ: 'betrieb', bereich: '', beruf: '', beispiele: [], andereTage: [], vorher: [], maxZeichen: 200 });
  return { ...r, ms: Date.now() - t0 };
}

module.exports = { satzBauen, testen, ANBIETER, STANDARD_ANBIETER };
