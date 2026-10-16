'use strict';
/* Kleiner PDF-Schreiber ohne Zusatzpakete: Text (Helvetica, mit Umlauten), Linien, Flaechen, PNG-Bilder */
const zlib = require('zlib');
const METRICS = require('./metrics');

const A4 = { w: 595.28, h: 841.89 };

/* Unicode -> Windows-1252 */
const TO_CP = new Map();
{
  const HIGH = '€\0‚ƒ„…†‡ˆ‰Š‹Œ\0Ž\0\0‘’“”•–—˜™š›œ\0žŸ';
  for (let c = 32; c < 256; c++) {
    if (c >= 0x7f && c < 0xa0) { const ch = HIGH[c - 0x80]; if (ch && ch !== '\0') TO_CP.set(ch, c); continue; }
    TO_CP.set(String.fromCharCode(c), c);
  }
  /* Haeufige Zeichen, die es in WinAnsi nicht gibt, sinnvoll ersetzen */
  for (const [a, b] of [['−', '-'], ['‐', '-'], ['‑', '-'], [' ', ' '], [' ', ' '], [' ', ' '], ['→', '->'], ['✓', 'x'], ['✔', 'x']]) TO_CP.set(a, TO_CP.get(b) ?? b.charCodeAt(0));
}
function cpBytes(str) {
  const out = [];
  for (const ch of String(str).normalize('NFC')) {
    if (ch === '\t') { out.push(32, 32); continue; }
    const v = TO_CP.get(ch);
    if (v === undefined) out.push(63); else if (typeof v === 'number') out.push(v); else for (const c of v) out.push(TO_CP.get(c) ?? 63);
  }
  return out;
}
function pdfString(str) {
  let s = '(';
  for (const b of cpBytes(str)) {
    if (b === 40 || b === 41 || b === 92) s += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) s += '\\' + b.toString(8).padStart(3, '0');
    else s += String.fromCharCode(b);
  }
  return s + ')';
}
function infoString(str) {
  const b = Buffer.from('﻿' + str, 'utf16le');
  for (let i = 0; i < b.length; i += 2) { const t = b[i]; b[i] = b[i + 1]; b[i + 1] = t; }
  return '<' + b.toString('hex') + '>';
}
const n = (v) => (Math.round(v * 100) / 100).toString();

function textWidth(str, size, bold) {
  const w = METRICS[bold ? 'Helvetica-Bold' : 'Helvetica'];
  let sum = 0;
  for (const b of cpBytes(str)) sum += b >= 32 ? w[b - 32] : 0;
  return sum * size / 1000;
}

/* Bricht Text auf eine Breite um. Absaetze bleiben erhalten, zu lange Woerter werden geteilt. */
function wrap(str, size, bold, maxW) {
  const lines = [];
  for (const para of String(str || '').replace(/\r/g, '').split('\n')) {
    const words = para.split(/ +/);
    let line = '';
    for (let word of words) {
      const test = line ? line + ' ' + word : word;
      if (textWidth(test, size, bold) <= maxW) { line = test; continue; }
      if (line) lines.push(line);
      line = '';
      while (textWidth(word, size, bold) > maxW) {
        let k = word.length - 1;
        while (k > 1 && textWidth(word.slice(0, k) + '-', size, bold) > maxW) k--;
        lines.push(word.slice(0, k) + '-');
        word = word.slice(k);
      }
      line = word;
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

class Pdf {
  constructor() { this.pages = []; this.images = []; this.page = null; }
  addPage() { this.page = { ops: [], images: new Set() }; this.pages.push(this.page); return this.page; }
  color(rgb, stroke) { return rgb.map((c) => n(c / 255)).join(' ') + (stroke ? ' RG' : ' rg'); }
  /* y ist hier immer von oben gemessen */
  text(x, y, str, size = 10, bold = false, rgb = [20, 20, 20]) {
    this.page.ops.push(`BT ${this.color(rgb)} /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(x)} ${n(A4.h - y - size * 0.8)} Td ${pdfString(str)} Tj ET`);
  }
  textRight(xRight, y, str, size, bold, rgb) { this.text(xRight - textWidth(str, size, bold), y, str, size, bold, rgb); }
  line(x1, y1, x2, y2, width = 0.6, rgb = [60, 60, 60]) {
    this.page.ops.push(`${this.color(rgb, true)} ${n(width)} w ${n(x1)} ${n(A4.h - y1)} m ${n(x2)} ${n(A4.h - y2)} l S`);
  }
  rect(x, y, w, h, { fill, stroke, width = 0.6 } = {}) {
    let op = '';
    if (fill) op += this.color(fill) + ' ';
    if (stroke) op += this.color(stroke, true) + ` ${n(width)} w `;
    op += `${n(x)} ${n(A4.h - y - h)} ${n(w)} ${n(h)} re ` + (fill && stroke ? 'B' : fill ? 'f' : 'S');
    this.page.ops.push(op);
  }
  addImage(img) { this.images.push(img); return this.images.length - 1; }
  image(idx, x, y, w, h) {
    this.page.images.add(idx);
    this.page.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(A4.h - y - h)} cm /Im${idx} Do Q`);
  }
  build(info = {}) {
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const stream = (dict, data) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);
    const catalog = add(null), pagesId = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imgIds = this.images.map((img) => {
      const smask = add(stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, zlib.deflateSync(img.alpha)));
      return add(stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${smask} 0 R /Filter /FlateDecode`, zlib.deflateSync(img.rgb)));
    });
    const kids = this.pages.map((p) => {
      const content = add(stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(p.ops.join('\n'), 'latin1'))));
      const xo = [...p.images].map((i) => `/Im${i} ${imgIds[i]} 0 R`).join(' ');
      return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Contents ${content} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xo ? ` /XObject << ${xo} >>` : ''} >> >>`);
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const d = new Date(), p2 = (v) => String(v).padStart(2, '0');
    const date = `D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const infoId = add(`<< /Title ${infoString(info.title || '')} /Author ${infoString(info.author || '')} /Producer ${infoString('Berichtsheft')} /CreationDate (${date}) >>`);

    const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let off = parts[0].length;
    const xref = [];
    objs.forEach((body, i) => {
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
      xref.push(off); off += b.length; parts.push(b);
    });
    let tail = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of xref) tail += String(o).padStart(10, '0') + ' 00000 n \n';
    tail += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${infoId} 0 R >>\nstartxref\n${off}\n%%EOF\n`;
    parts.push(Buffer.from(tail, 'latin1'));
    return Buffer.concat(parts);
  }
}

module.exports = { Pdf, A4, textWidth, wrap };
