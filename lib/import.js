'use strict';
/* Alte Berichtshefte (fertige PDFs auf dem IHK-Formular "Ausbildungsnachweis - taeglich") einlesen.
 * Liest Woerter mit Position ueber pdftotext (poppler-utils) und ordnet sie den Feldern und den
 * 7 Tageszeilen zu. Funktioniert mit Word-Exporten und mit PDFs aus diesem Programm. */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pdfWoerter } = require('./pdftext');

const TAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
/* Zeilenmitten (y von oben) der eigenen Vorlage, falls im PDF keine Tagesnamen gefunden werden */
const STANDARD_MITTEN = [252, 323, 394, 466, 537, 597, 653];

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/* Eingebauter Leser zuerst (keine Zusatzprogramme noetig); pdftotext nur als Ersatz, falls vorhanden */
async function woerterAus(pdf) {
  if (!Buffer.isBuffer(pdf) || pdf.length < 100 || !pdf.toString('latin1', 0, 1024).includes('%PDF-')) throw new Error('Das ist keine PDF-Datei.');
  let eigen = null, fehler = null;
  try { eigen = pdfWoerter(pdf); } catch (e) { fehler = e; }
  if (eigen && eigen.words.length > 20) return eigen;
  try { return await popplerWoerter(pdf); } catch (e) {
    if (eigen) return eigen;
    throw new Error(fehler && /verschlüsselt/.test(fehler.message) ? fehler.message : 'Die PDF konnte nicht gelesen werden.');
  }
}

function popplerWoerter(pdf) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), 'bh-import-' + crypto.randomBytes(8).toString('hex') + '.pdf');
    fs.writeFileSync(tmp, pdf, { mode: 0o600 });
    execFile('pdftotext', ['-f', '1', '-l', '1', '-bbox', tmp, '-'], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      fs.unlink(tmp, () => {});
      if (err) return reject(new Error(err.code === 'ENOENT' ? 'Das Einlesen von PDFs ist auf dem Server noch nicht eingerichtet (pdftotext fehlt).' : 'Die PDF konnte nicht gelesen werden.'));
      const page = /<page width="([\d.]+)" height="([\d.]+)"/.exec(out);
      const words = [];
      for (const m of out.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/word>/g)) {
        const [x0, y0, x1, y1] = m.slice(1, 5).map(Number);
        words.push({ x0, y0, x1, y1, t: unxml(m[5]) });
      }
      resolve({ words, w: page ? Number(page[1]) : 595, h: page ? Number(page[2]) : 842 });
    });
  });
}

/* Woerter zu Textzeilen zusammenfassen (gleiche Hoehe) */
function zeilen(words) {
  const sorted = words.slice().sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const out = [];
  for (const w of sorted) {
    const z = out.find((l) => Math.abs(l.y0 - w.y0) < 3);
    if (z) z.words.push(w); else out.push({ y0: w.y0, words: [w] });
  }
  for (const z of out) z.words.sort((a, b) => a.x0 - b.x0);
  return out.sort((a, b) => a.y0 - b.y0);
}

/* Datum "12.10.26" oder "12.10.2026" -> "2026-10-12" */
function isoDatum(s) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(String(s).trim());
  if (!m) return '';
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  const t = new Date(d + 'T12:00:00Z');
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d ? '' : d;
}

function nrAusDateiname(name) {
  const m = /NR[\s._-]*(\d{1,4})/i.exec(String(name || '')) || /(\d{1,4})(?=\D*$)/.exec(String(name || '').replace(/\.pdf$/i, ''));
  return m ? Number(m[1]) : null;
}

async function liesBericht(pdf, dateiname) {
  const { words: alle } = await woerterAus(pdf);
  if (!alle.length) throw new Error('In der PDF ist kein Text zu finden (eingescannt?). Bitte den Bericht neu anlegen und abtippen.');
  /* Waagerechte Woerter (Text) und senkrechte (gedrehte Tagesnamen am linken Rand) trennen */
  const mitRichtung = alle.some((w) => 'rot' in w);
  let flach = mitRichtung ? alle.filter((w) => !w.rot) : alle.filter((w) => w.y1 - w.y0 <= 16 || w.x1 - w.x0 > w.y1 - w.y0);
  const hoch = alle.filter((w) => !flach.includes(w));
  /* Kurze gedrehte Reste (z. B. aus Word-Textfeldern): genau eine Zeilenhoehe breit und allein auf ihrer Hoehe */
  const hs = flach.map((w) => w.y1 - w.y0).sort((a, b) => a - b), H = hs[Math.floor(hs.length / 2)] || 11;
  const breitWieZeile = (w) => Math.abs((w.x1 - w.x0) - H) < 0.6;
  flach = flach.filter((w) => !(breitWieZeile(w) && Math.abs((w.y1 - w.y0) - H) > 0.25));
  flach = flach.filter((w) => !breitWieZeile(w) || flach.some((o) => o !== w && Math.abs(o.y0 - w.y0) < 1 && !breitWieZeile(o)));

  /* Kopf: Werte rechts neben den Beschriftungen */
  const nach = (label, maxX = 1e9) => {
    const l = flach.find((w) => w.t.replace(/:$/, '') === label);
    if (!l) return '';
    return flach.filter((w) => Math.abs(w.y0 - l.y0) < 3 && w.x0 > l.x1 + 2 && w.x0 < maxX && !/:$/.test(w.t))
      .sort((a, b) => a.x0 - b.x0).map((w) => w.t);
  };
  const nameZeile = flach.find((w) => /^Auszubildenden:?$/.test(w.t));
  const name = nameZeile ? flach.filter((w) => Math.abs(w.y0 - nameZeile.y0) < 3 && w.x0 > nameZeile.x1 + 2).sort((a, b) => a.x0 - b.x0).map((w) => w.t).join(' ') : '';
  const bereichLabel = flach.find((w) => /^Ausbildungsbereich:?$/.test(w.t));
  const ajahr = (nach('Ausbildungsjahr', bereichLabel ? bereichLabel.x0 : 1e9) || []).join(' ');
  const bereich = (nach('Ausbildungsbereich') || []).join(' ');
  const bisLabel = flach.find((w) => /^bis:?$/.test(w.t));
  const vom = (nach('vom', bisLabel ? bisLabel.x0 : 1e9) || []).map(isoDatum).find(Boolean) || '';
  const bis = (nach('bis') || []).map(isoDatum).find(Boolean) || '';

  /* Tageszeilen: Mitte jeder Zeile aus den gefundenen Tagesnamen, fehlende gleichmaessig ergaenzt */
  const gefunden = [];
  TAGE.forEach((t, i) => {
    const w = hoch.find((x) => x.t === t && x.x0 < 110) || flach.find((x) => x.t === t && x.x0 < 110);
    if (w) gefunden.push([i, (w.y0 + w.y1) / 2]);
  });
  let mitten;
  if (gefunden.length >= 2) {
    const n = gefunden.length, sx = gefunden.reduce((s, [i]) => s + i, 0), sy = gefunden.reduce((s, [, y]) => s + y, 0);
    const sxx = gefunden.reduce((s, [i]) => s + i * i, 0), sxy = gefunden.reduce((s, [i, y]) => s + i * y, 0);
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
    mitten = TAGE.map((_, i) => { const g = gefunden.find(([k]) => k === i); return g ? g[1] : a + b * i; });
  } else mitten = STANDARD_MITTEN;
  const grenzen = mitten.map((m, i) => {
    const vor = i ? (mitten[i - 1] + m) / 2 : m - (mitten[1] - mitten[0]) / 2;
    const nachG = i < 6 ? (m + mitten[i + 1]) / 2 : m + (mitten[6] - mitten[5]) / 2;
    return [vor, nachG];
  });

  /* Spalten: Text zwischen Tagesspalte und Stundenspalte */
  const stundenLabel = flach.find((w) => w.t === 'Stunden');
  const stundenX = stundenLabel ? stundenLabel.x0 - 8 : 480;
  const textX = 95;
  const tage = grenzen.map(([y0, y1]) => {
    const im = flach.filter((w) => (w.y0 + w.y1) / 2 > y0 && (w.y0 + w.y1) / 2 < y1);
    const txt = zeilen(im.filter((w) => w.x0 >= textX && w.x1 <= stundenX + 6))
      .map((z) => z.words.map((w) => w.t).join(' ')).join(' ')
      .replace(/\s+/g, ' ').replace(/(\w)- (\p{Ll})/gu, '$1$2').trim();
    const std = im.filter((w) => w.x0 >= stundenX - 4).map((w) => Number(w.t.replace(',', '.'))).find((v) => Number.isFinite(v) && v >= 0 && v <= 24);
    /* Striche, Punkte o. Ae. am Wochenende zaehlen als leer */
    const leer = !/[\p{L}\p{N}]/u.test(txt);
    return { text: leer ? '' : txt, hours: std ?? null };
  });

  return { name, ausbildungsjahr: Number(ajahr) || null, bereich, vom, bis, nr: nrAusDateiname(dateiname), tage };
}

module.exports = { liesBericht, nrAusDateiname, isoDatum };
