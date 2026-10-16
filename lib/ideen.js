'use strict';
/*
 * Ideen fuer einen Tag: Saetze aus den eigenen frueheren Berichten, die zum Text und zur Woche passen,
 * dazu ein paar allgemeine Anfaenge. Alles laeuft auf dem eigenen Server, es wird nichts verschickt.
 */

const STOP = new Set(('aber alle allem allen aller alles also auch auf aus bei beim bin bis dann dass dem den der des die dies diese diesem diesen dieser '
  + 'doch dort durch ein eine einem einen einer eines etwa fuer für gegen hat hatte hier ich ihm ihn ihr im in ist jede jedem jeden jeder '
  + 'kann kein keine mal man mehr mit muss nach nicht noch nun nur ob oder ohne sehr sein seine sich sie sind so sowie sowohl über um und '
  + 'uns unter vom von vor war wie wir wird wurde wurden zum zur zwei drei heute danach dabei weiter wieder gemacht').split(' '));

const ALLGEMEIN = {
  betrieb: [
    'Arbeitsplatz aufgeräumt und Werkzeug gereinigt',
    'Werkstücke vermessen und Maße kontrolliert',
    'Unterweisung zur Arbeitssicherheit erhalten',
    'Material und Werkzeug für den nächsten Arbeitsschritt vorbereitet',
    'Arbeitsschritte mit dem Ausbilder besprochen',
    'Zeichnung gelesen und den Arbeitsablauf geplant',
    'Maschine gereinigt und gewartet',
    'Fehler am Werkstück festgestellt und nachgearbeitet'
  ],
  schule: [
    'Lernfeld : ',
    'Test geschrieben in ',
    'Mathematik: Aufgaben zu ',
    'Arbeitsblätter bearbeitet und im Unterricht besprochen',
    'Gruppenarbeit zum Thema ',
    'Präsentation vorbereitet zum Thema ',
    'Deutsch: ',
    'Politik: '
  ]
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (s) => norm(s).split(' ').filter((w) => w.length >= 4 && !STOP.has(w));
/* Wortstamm grob: Endungen abschneiden, damit "gefeilt"/"feilen" oder "Bohrer"/"Bohrung" zusammenpassen */
const stem = (w) => w.replace(/(ungen|ung|en|er|es|em|e|n|s|t)$/u, '').slice(0, 7);

function phrases(text) {
  const out = [];
  for (let s of String(text || '').split(/(?<=[.!?;])\s+|\n+/)) {
    s = s.trim().replace(/[.;]+$/, '');
    if (!s) continue;
    if (s.length > 150) out.push(...s.split(/,\s+|\s+sowie\s+/).map((x) => x.trim()));
    else out.push(s);
  }
  return out.filter((s) => s.length >= 12 && s.length <= 160 && !/^(urlaub|feiertag|arbeitsunfähig|krank)/i.test(s));
}

function ideas({ text, type, bereich, week, history }) {
  const ctx = new Map();
  const add = (s, w) => { for (const x of words(s)) { const k = stem(x); ctx.set(k, (ctx.get(k) || 0) + w); } };
  add(text, 3);
  for (const t of week || []) add(t, 1);
  const have = norm(text) + ' ' + (week || []).map(norm).join(' ');

  const seen = new Set(), scored = [];
  const n = (history || []).length;
  (history || []).forEach((h, idx) => {
    for (const p of phrases(h.text)) {
      const key = norm(p);
      if (seen.has(key) || have.includes(key)) continue;
      seen.add(key);
      let score = 0;
      for (const w of new Set(words(p).map(stem))) score += ctx.get(w) || 0;
      if (h.type !== type && score === 0) continue; /* Schulsaetze nicht fuer Arbeitstage vorschlagen und umgekehrt */
      if (h.type === type) score += 1.5;
      if (bereich && h.bereich === bereich) score += 1;
      score += (idx / Math.max(1, n)) * 1.2; /* neuere Berichte etwas bevorzugen */
      scored.push({ text: p, quelle: `aus Bericht Nr. ${h.nr}`, score });
    }
  });
  scored.sort((a, b) => b.score - a.score);
  const out = scored.slice(0, 6).map(({ text: t, quelle }) => ({ text: t, quelle }));
  for (const g of ALLGEMEIN[type] || []) {
    if (out.length >= 9) break;
    if (!have.includes(norm(g)) || !norm(g)) out.push({ text: g, quelle: 'Anfang', luecke: /[:\s]$/.test(g) });
  }
  return out;
}

module.exports = { ideas };
