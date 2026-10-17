'use strict';
/*
 * Fuellt die Original-Vorlage "Ausbildungsnachweis (Berichtsheft) - taeglich" der Handelskammer Bremen aus.
 * Die Vorlage bleibt unveraendert, Text und Unterschrift werden als zusaetzliche Ebene darueber gelegt
 * (PDF-Inkrement-Update, keine Zusatzpakete noetig).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { wrap, textWidth, pdfString } = require('./pdf');

const TPL = fs.readFileSync(path.join(__dirname, 'vorlage', 'ihk-bremen-taeglich.pdf'));
const META = JSON.parse(fs.readFileSync(path.join(__dirname, 'vorlage', 'ihk-bremen-taeglich.json'), 'utf8'));
const START_XREF = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(TPL.toString('latin1', TPL.length - 64))[1]);

/* Feldpositionen der Vorlage in PDF-Punkten [x1, y1, x2, y2] (Ursprung unten links) */
const F = {
  name: [223, 731, 538, 750],
  ajahr: [223, 711, 283, 730],
  bereich: [386, 711, 538, 730],
  von: [223, 690, 283, 709],
  bis: [311, 690, 538, 709],
  rows: [[572, 642], [501, 570], [429, 499], [358, 428], [286, 356], [229, 285], [172, 227]],
  textX: [97, 488],
  hoursX: [490, 537]
};
const SIZES = [11, 10.5, 10, 9.5, 9, 8.5, 8, 7.5, 7];
const PAD = 3;

const num = (v) => (Math.round(v * 100) / 100).toString();

/* Wie passt ein Text in das Feld eines Tages? Liefert Schriftgroesse und Zeilen, oder fits=false */
function fitDay(text, rowIndex) {
  const [y1, y2] = F.rows[rowIndex];
  const w = F.textX[1] - F.textX[0] - 2 * PAD, h = y2 - y1 - 2 * PAD;
  for (const size of SIZES) {
    const lines = wrap(String(text || '').trim(), size, false, w);
    if (lines.length * size * 1.17 <= h + 0.5) return { fits: true, size, lines };
  }
  const size = SIZES[SIZES.length - 1];
  const lines = wrap(String(text || '').trim(), size, false, w);
  const max = Math.floor((h + 0.5) / (size * 1.17));
  return { fits: false, size, lines: lines.slice(0, max), over: lines.length - max };
}
function fitsAll(days) { return days.map((d) => (d ? fitDay(d.text, d.row).fits : true)); }

/* Kleiner reproduzierbarer Zufall pro Bericht, damit die Unterschrift nicht jedes Mal identisch aussieht */
function rng(seed) {
  let h = crypto.createHash('sha256').update(String(seed)).digest();
  let i = 0;
  return () => { if (i >= 28) { h = crypto.createHash('sha256').update(h).digest(); i = 0; } const v = h.readUInt32BE(i) / 2 ** 32; i += 4; return v; };
}

/* Einstellbare Groesse/Lage von Unterschrift und Datum (pro Konto) */
const LAYOUT_DEFAULT = { sigGroesse: 100, sigX: 0, sigY: 0, datumGroesse: 10.5 };
const LAYOUT_RANGE = { sigGroesse: [40, 200], sigX: [-60, 120], sigY: [-6, 30], datumGroesse: [7, 14] };
function cleanLayout(l) {
  const out = { ...LAYOUT_DEFAULT };
  for (const k of Object.keys(LAYOUT_RANGE)) {
    const v = Number(l && l[k]);
    if (Number.isFinite(v)) out[k] = Math.min(LAYOUT_RANGE[k][1], Math.max(LAYOUT_RANGE[k][0], Math.round(v * 2) / 2));
  }
  return out;
}

function fill({ name, ajahr, bereich, von, bis, days, sigDate, signature, seed, footer, layout }) {
  const L = cleanLayout(layout);
  const ops = [];
  const text = (x, y, s, size = 10, bold = false, gray = 0) =>
    ops.push(`BT ${num(gray)} g /${bold ? 'BhF2' : 'BhF1'} ${num(size)} Tf ${num(x)} ${num(y)} Td ${pdfString(s)} Tj ET`);
  const field = (r, s, size = 11) => {
    let t = String(s || ''), sz = size;
    while (sz > 7 && textWidth(t, sz) > r[2] - r[0] - 2 * PAD) sz -= 0.5;
    text(r[0] + PAD + 1, r[1] + (r[3] - r[1] - sz * 0.7) / 2, t, sz);
  };
  field(F.name, name);
  field(F.ajahr, ajahr);
  field(F.bereich, bereich);
  field(F.von, von);
  field(F.bis, bis);

  days.forEach((d, i) => {
    if (!d) return;
    const [y1, y2] = F.rows[i];
    const fit = fitDay(d.text, i);
    const lh = fit.size * 1.17;
    fit.lines.forEach((line, k) => text(F.textX[0] + PAD + 1, y2 - PAD - fit.size * 0.85 - k * lh, line, fit.size));
    if (d.hours !== null && d.hours !== undefined && d.hours !== '') {
      const h = String(Math.round(Number(d.hours) * 100) / 100).replace('.', ',');
      text((F.hoursX[0] + F.hoursX[1]) / 2 - textWidth(h, 11) / 2, y2 - PAD - 10, h, 11);
    }
  });

  /* Datum und Unterschrift ueber der Linie "Datum, Unterschrift Auszubildende/r" (Linie bei y=119, x 71-291) */
  const objs = [];
  let sigName = '';
  if (sigDate) text(73, 121 + L.datumGroesse * 0.28, sigDate, L.datumGroesse);
  if (signature) {
    const r = rng(seed);
    const maxW = 140 * L.sigGroesse / 100, maxH = 44 * L.sigGroesse / 100;
    const base = Math.min(maxW / signature.width, maxH / signature.height);
    const sc = base * (0.9 + r() * 0.12);
    const w = signature.width * sc, h = signature.height * sc;
    const ang = (r() - 0.5) * 5 * Math.PI / 180;       /* +-2,5 Grad */
    const cx = 140 + L.sigX + w / 2 + (r() - 0.5) * 12;           /* etwas nach links/rechts */
    const cy = 121 + L.sigY + h / 2 + (r() - 0.5) * 3;            /* minimal hoch/runter, bleibt auf der Linie */
    const cos = Math.cos(ang), sin = Math.sin(ang);
    /* Drehung um die Mitte: Bild (0..1) -> skalieren, um Mitte verschieben, drehen, an Zielposition */
    const a = w * cos, b = w * sin, c = -h * sin, d = h * cos;
    const e = cx - (a * 0.5 + c * 0.5), f = cy - (b * 0.5 + d * 0.5);
    sigName = 'BhSig';
    ops.push(`q ${num(a)} ${num(b)} ${num(c)} ${num(d)} ${num(e)} ${num(f)} cm /BhSig Do Q`);
    objs.push({ key: 'smask', body: stream(`/Type /XObject /Subtype /Image /Width ${signature.width} /Height ${signature.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, zlib.deflateSync(signature.alpha)) });
    objs.push({ key: 'img', body: (ids) => stream(`/Type /XObject /Subtype /Image /Width ${signature.width} /Height ${signature.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${ids.smask} 0 R /Filter /FlateDecode`, zlib.deflateSync(Buffer.alloc(signature.rgb.length))) }); /* Unterschrift immer schwarz */
  }
  if (footer) text(539 - textWidth(footer, 6.5), 40, footer, 6.5, false, 0.45);

  /* ---- Inkrement-Update an die Vorlage anhaengen ---- */
  objs.push({ key: 'f1', body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' });
  objs.push({ key: 'f2', body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>' });
  objs.push({ key: 'open', body: stream('', Buffer.from('q\n', 'latin1')) });
  objs.push({ key: 'close', body: stream('', Buffer.from('\nQ\n', 'latin1')) });
  objs.push({ key: 'overlay', body: stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1'))) });

  const ids = {};
  let next = META.size;
  for (const o of objs) ids[o.key] = next++;
  const inner = (s) => s.trim().replace(/^<<|>>$/g, '');
  const orig = META.contents.trim().replace(/^\[|\]$/g, '');
  const res = [
    `/Font << ${inner(META.fonts)} /BhF1 ${ids.f1} 0 R /BhF2 ${ids.f2} 0 R >>`,
    `/XObject << ${inner(META.xobjects)}${sigName ? ` /BhSig ${ids.img} 0 R` : ''} >>`,
    ...Object.entries(META.resOther).map(([k, v]) => `${k} ${v}`)
  ].join('\n');
  const page = `<< ${inner(META.rest)}\n/Contents [ ${ids.open} 0 R ${orig} ${ids.close} 0 R ${ids.overlay} 0 R ]\n/Resources << ${res} >> >>`;

  const parts = [TPL, Buffer.from('\n', 'latin1')];
  let off = TPL.length + 1;
  const entries = [];
  const put = (id, body) => {
    const b = Buffer.concat([Buffer.from(`${id} 0 obj\n`, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
    entries.push([id, off]); off += b.length; parts.push(b);
  };
  for (const o of objs) put(ids[o.key], typeof o.body === 'function' ? o.body(ids) : o.body);
  put(META.page, page);
  entries.sort((x, y) => x[0] - y[0]);
  let x = 'xref\n';
  for (const [id, o] of entries) x += `${id} 1\n${String(o).padStart(10, '0')} 00000 n \n`;
  x += `trailer\n<< /Size ${next} /Root ${META.root} 0 R${META.info ? ` /Info ${META.info} 0 R` : ''} /Prev ${START_XREF} >>\nstartxref\n${off}\n%%EOF\n`;
  parts.push(Buffer.from(x, 'latin1'));
  return Buffer.concat(parts);
}

function stream(dict, data) {
  return Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);
}

module.exports = { cleanLayout, LAYOUT_DEFAULT, LAYOUT_RANGE, fill, fitDay, fitsAll, ROWS: F.rows.length };
