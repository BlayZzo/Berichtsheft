'use strict';
/* Liest Text mit Position von Seite 1 einer PDF, ohne Zusatzprogramme.
 * Ergebnis wie "pdftotext -bbox": Woerter mit x0/y0/x1/y1 (y von oben) und rot=true fuer gedrehten Text.
 * Unterstuetzt: Objekte und Objekt-Streams, FlateDecode, Form-XObjects, einfache Schriften (WinAnsi,
 * Differences) und Type0/CID-Schriften mit ToUnicode (z. B. Word-Exporte). */
const zlib = require('zlib');
const { Helvetica } = require('./metrics');

/* ---------- Tokenizer / Parser fuer PDF-Objekte ---------- */
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)));
class Ref { constructor(n, g) { this.n = n; this.g = g; } }
class Name { constructor(s) { this.s = s; } }
class Op { constructor(s) { this.s = s; } }

class Lexer {
  constructor(buf, pos = 0) { this.b = buf; this.p = pos; }
  skip() {
    const b = this.b;
    for (;;) {
      while (this.p < b.length && WS.has(b[this.p])) this.p++;
      if (b[this.p] === 37) { while (this.p < b.length && b[this.p] !== 10 && b[this.p] !== 13) this.p++; continue; }
      return;
    }
  }
  token() {
    this.skip();
    const b = this.b;
    if (this.p >= b.length) return undefined;
    const c = b[this.p];
    if (c === 47) { /* /Name */
      let s = ''; this.p++;
      while (this.p < b.length && !WS.has(b[this.p]) && !DELIM.has(b[this.p])) {
        if (b[this.p] === 35 && this.p + 2 < b.length) { s += String.fromCharCode(parseInt(b.toString('latin1', this.p + 1, this.p + 3), 16)); this.p += 3; }
        else s += String.fromCharCode(b[this.p++]);
      }
      return new Name(s);
    }
    if (c === 40) return this.litString();
    if (c === 60) {
      if (b[this.p + 1] === 60) { this.p += 2; return '<<'; }
      return this.hexString();
    }
    if (c === 62 && b[this.p + 1] === 62) { this.p += 2; return '>>'; }
    if (c === 91 || c === 93 || c === 123 || c === 125) { this.p++; return String.fromCharCode(c); }
    let s = '';
    while (this.p < b.length && !WS.has(b[this.p]) && !DELIM.has(b[this.p])) s += String.fromCharCode(b[this.p++]);
    if (!s) { this.p++; return this.token(); }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    return new Op(s);
  }
  litString() {
    const b = this.b, out = [];
    let depth = 1; this.p++;
    while (this.p < b.length) {
      const c = b[this.p++];
      if (c === 92) {
        const d = b[this.p++];
        const map = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
        if (d in map) out.push(map[d]);
        else if (d >= 48 && d <= 55) {
          let v = d - 48;
          for (let k = 0; k < 2 && b[this.p] >= 48 && b[this.p] <= 55; k++) v = v * 8 + b[this.p++] - 48;
          out.push(v & 255);
        } else if (d === 13) { if (b[this.p] === 10) this.p++; } else if (d !== 10) out.push(d);
      } else if (c === 40) { depth++; out.push(c); } else if (c === 41) { if (--depth === 0) break; out.push(c); } else out.push(c);
    }
    return Buffer.from(out);
  }
  hexString() {
    const b = this.b; this.p++;
    let s = '';
    while (this.p < b.length && b[this.p] !== 62) { const ch = String.fromCharCode(b[this.p++]); if (/[0-9a-fA-F]/.test(ch)) s += ch; }
    this.p++;
    if (s.length % 2) s += '0';
    return Buffer.from(s, 'hex');
  }
  /* Ein vollstaendiges Objekt lesen (mit Referenzen "n g R") */
  object(tok = this.token()) {
    if (tok === '<<') {
      const d = {};
      for (;;) {
        const k = this.token();
        if (k === '>>' || k === undefined) return d;
        if (k instanceof Name) d[k.s] = this.object();
      }
    }
    if (tok === '[') {
      const a = [];
      for (;;) {
        const t = this.token();
        if (t === ']' || t === undefined) return a;
        a.push(this.object(t));
      }
    }
    if (typeof tok === 'number' && Number.isInteger(tok)) {
      const save = this.p, t2 = this.token();
      if (typeof t2 === 'number' && Number.isInteger(t2)) {
        const save2 = this.p, t3 = this.token();
        if (t3 instanceof Op && t3.s === 'R') return new Ref(tok, t2);
        this.p = save2;
      }
      this.p = save;
    }
    return tok;
  }
}

/* ---------- Datei: alle Objekte einsammeln (spaetere ueberschreiben fruehere) ---------- */
function ladeObjekte(buf) {
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  const s = buf.toString('latin1');
  let m;
  while ((m = re.exec(s))) {
    const n = Number(m[1]);
    try {
      const lx = new Lexer(buf, m.index + m[0].length);
      const val = lx.object();
      let stream = null;
      lx.skip();
      if (buf.toString('latin1', lx.p, lx.p + 6) === 'stream') {
        let st = lx.p + 6;
        if (buf[st] === 13) st++;
        if (buf[st] === 10) st++;
        let len = val && typeof val.Length === 'number' ? val.Length : -1;
        let end = len >= 0 && st + len <= buf.length && /endstream/.test(buf.toString('latin1', st + len, st + len + 12)) ? st + len : s.indexOf('endstream', st);
        if (end < 0) end = buf.length;
        stream = buf.subarray(st, end);
        re.lastIndex = end;
      }
      objs.set(n, { val, stream });
    } catch { /* kaputtes Objekt ueberspringen */ }
  }
  /* Objekt-Streams auspacken (nur fuer Objekte, die nicht direkt vorkommen oder spaeter stehen) */
  for (const [, o] of [...objs]) {
    if (!o.stream || !o.val || !(o.val.Type instanceof Name) || o.val.Type.s !== 'ObjStm') continue;
    try {
      const data = decode(o.val, o.stream, objs);
      const N = o.val.N, first = o.val.First;
      const head = new Lexer(data, 0), list = [];
      for (let i = 0; i < N; i++) list.push([head.token(), head.token()]);
      for (const [num, off] of list) {
        if (objs.has(num) && !objs.get(num).fromStm) continue;
        const lx = new Lexer(data, first + off);
        objs.set(num, { val: lx.object(), stream: null, fromStm: true });
      }
    } catch { /* ignorieren */ }
  }
  return objs;
}

function aufloesen(v, objs, tiefe = 0) {
  while (v instanceof Ref && tiefe++ < 50) { const o = objs.get(v.n); v = o ? o.val : null; }
  return v;
}
function streamOf(v, objs) {
  if (v instanceof Ref) { const o = objs.get(v.n); return o && o.stream ? decode(o.val, o.stream, objs) : null; }
  return null;
}
function decode(dict, raw, objs) {
  let f = aufloesen(dict.Filter, objs);
  const filters = Array.isArray(f) ? f.map((x) => aufloesen(x, objs)) : f ? [f] : [];
  let data = raw;
  for (const x of filters) {
    const name = x instanceof Name ? x.s : '';
    if (name === 'FlateDecode' || name === 'Fl') {
      try { data = zlib.inflateSync(data); } catch { data = zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }
      const parms = aufloesen(dict.DecodeParms, objs);
      if (parms && parms.Predictor >= 10) data = pngPredictor(data, parms.Columns || 1);
    } else throw new Error('Filter ' + name + ' nicht unterstuetzt');
  }
  return data;
}
function pngPredictor(data, cols) {
  const out = [], row = cols + 1;
  let prev = Buffer.alloc(cols);
  for (let i = 0; i + row <= data.length; i += row) {
    const t = data[i], cur = Buffer.from(data.subarray(i + 1, i + row));
    for (let k = 0; k < cols; k++) {
      const a = k ? cur[k - 1] : 0, b = prev[k], c = k ? prev[k - 1] : 0;
      if (t === 1) cur[k] = (cur[k] + a) & 255; else if (t === 2) cur[k] = (cur[k] + b) & 255;
      else if (t === 3) cur[k] = (cur[k] + ((a + b) >> 1)) & 255;
      else if (t === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); cur[k] = (cur[k] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
    }
    out.push(cur); prev = cur;
  }
  return Buffer.concat(out);
}

/* ---------- Schriften ---------- */
const CP1252 = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030, 0x8a: 0x160, 0x8b: 0x2039, 0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153, 0x9e: 0x17e, 0x9f: 0x178 };
const winAnsi = (c) => String.fromCharCode(CP1252[c] || c);
const GLYPH = {
  space: ' ', period: '.', comma: ',', colon: ':', semicolon: ';', hyphen: '-', endash: '–', emdash: '—', slash: '/', parenleft: '(', parenright: ')',
  quoteright: '’', quoteleft: '‘', quotedbl: '"', quotesingle: "'", exclam: '!', question: '?', ampersand: '&', percent: '%', plus: '+', equal: '=',
  adieresis: 'ä', odieresis: 'ö', udieresis: 'ü', Adieresis: 'Ä', Odieresis: 'Ö', Udieresis: 'Ü', germandbls: 'ß', bullet: '•', degree: '°',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', underscore: '_', at: '@', numbersign: '#',
  quotedblbase: '„', quotedblleft: '“', quotedblright: '”', euro: '€', section: '§', ellipsis: '…', asterisk: '*', bracketleft: '[', bracketright: ']'
};
const glyphName = (n) => GLYPH[n] || (n.length === 1 ? n : /^uni([0-9A-F]{4})$/i.test(n) ? String.fromCharCode(parseInt(n.slice(3), 16)) : '');

function parseCMap(data) {
  const map = new Map();
  let bytes = 2;
  const s = data.toString('latin1');
  const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(s);
  if (cs) bytes = cs[1].length / 2;
  const hex = (h) => parseInt(h, 16);
  const uni = (h) => { let out = ''; for (let i = 0; i + 4 <= h.length; i += 4) out += String.fromCharCode(hex(h.slice(i, i + 4))); return out; };
  for (const blk of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(hex(m[1]), uni(m[2]));
  }
  for (const blk of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const a = hex(m[1]), b = hex(m[2]);
      if (b - a > 65535) continue;
      if (m[3][0] === '[') {
        const list = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => uni(x[1]));
        for (let c = a; c <= b; c++) map.set(c, list[c - a] || '');
      } else {
        const base = m[3].slice(1, -1), last = hex(base.slice(-4));
        for (let c = a; c <= b; c++) map.set(c, uni(base.slice(0, -4)) + String.fromCharCode(last + c - a));
      }
    }
  }
  return { map, bytes };
}

function ladeSchrift(ref, objs, cache) {
  const key = ref instanceof Ref ? ref.n : null;
  if (key !== null && cache.has(key)) return cache.get(key);
  const d = aufloesen(ref, objs) || {};
  const sub = d.Subtype instanceof Name ? d.Subtype.s : '';
  const base = d.BaseFont instanceof Name ? d.BaseFont.s : '';
  const font = { type0: sub === 'Type0', bytes: 1, uni: null, width: () => 500, enc: null };
  const tu = streamOf(d.ToUnicode, objs);
  if (tu) { const cm = parseCMap(tu); font.uni = cm.map; if (font.type0) font.bytes = cm.bytes; }
  if (font.type0) {
    font.bytes = font.uni ? font.bytes : 2;
    const desc = aufloesen((aufloesen(d.DescendantFonts, objs) || [])[0], objs) || {};
    const dw = typeof desc.DW === 'number' ? desc.DW : 1000, W = new Map();
    const arr = aufloesen(desc.W, objs) || [];
    for (let i = 0; i < arr.length;) {
      const a = aufloesen(arr[i], objs), b = aufloesen(arr[i + 1], objs);
      if (Array.isArray(b)) { b.forEach((w, k) => W.set(a + k, aufloesen(w, objs))); i += 2; }
      else { const w = aufloesen(arr[i + 2], objs); for (let c = a; c <= b && c - a < 65536; c++) W.set(c, w); i += 3; }
    }
    font.width = (c) => (W.has(c) ? W.get(c) : dw);
  } else {
    const first = d.FirstChar || 0, widths = aufloesen(d.Widths, objs);
    const std = /Helvetica/.test(base) ? (/Bold/.test(base) ? require('./metrics')['Helvetica-Bold'] : Helvetica) : null;
    font.width = (c) => {
      if (Array.isArray(widths) && c - first >= 0 && c - first < widths.length) return aufloesen(widths[c - first], objs) || 0;
      if (std && c >= 32 && std[c - 32] > 0) return std[c - 32];
      return 500;
    };
    const enc = aufloesen(d.Encoding, objs);
    if (enc && !(enc instanceof Name) && Array.isArray(enc.Differences)) {
      const diff = new Map(); let code = 0;
      for (const x of enc.Differences) { if (typeof x === 'number') code = x; else if (x instanceof Name) diff.set(code++, glyphName(x.s)); }
      font.enc = diff;
    }
  }
  font.text = (c) => {
    if (font.uni && font.uni.has(c)) return font.uni.get(c);
    if (font.enc && font.enc.has(c)) return font.enc.get(c);
    if (font.type0) return '';
    return winAnsi(c);
  };
  if (key !== null) cache.set(key, font);
  return font;
}

/* ---------- Seite auswerten ---------- */
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function ersteSeite(objs) {
  let root = null;
  for (const [, o] of objs) { const v = o.val; if (v && v.Type instanceof Name && v.Type.s === 'Catalog') root = v; }
  let node = root ? aufloesen(root.Pages, objs) : null;
  const erbe = {};
  for (let i = 0; node && i < 30; i++) {
    for (const k of ['Resources', 'MediaBox']) if (node[k]) erbe[k] = node[k];
    if (node.Type instanceof Name && node.Type.s === 'Page') return { page: node, ...erbe };
    const kids = aufloesen(node.Kids, objs);
    node = kids && kids.length ? aufloesen(kids[0], objs) : null;
  }
  /* Ohne Katalog: erste Seite suchen */
  for (const [, o] of objs) { const v = o.val; if (v && v.Type instanceof Name && v.Type.s === 'Page') return { page: v, Resources: v.Resources, MediaBox: v.MediaBox }; }
  return null;
}

function inhalt(page, objs) {
  const c = page.Contents;
  const list = Array.isArray(aufloesen(c, objs)) ? aufloesen(c, objs) : [c];
  return Buffer.concat(list.map((r) => { const s = streamOf(r, objs); return s ? Buffer.concat([s, Buffer.from('\n')]) : Buffer.alloc(0); }));
}

function pdfWoerter(pdf) {
  const objs = ladeObjekte(pdf);
  for (const [, o] of objs) if (o.val && o.val.Encrypt) throw new Error('Die PDF ist verschlüsselt.');
  const tr = [...objs.values()].find((o) => o.val && o.val.Encrypt);
  if (tr) throw new Error('Die PDF ist verschlüsselt.');
  const p = ersteSeite(objs);
  if (!p) throw new Error('Keine Seite gefunden.');
  const mb = aufloesen(p.MediaBox, objs) || [0, 0, 595, 842];
  const H = (aufloesen(mb[3], objs) || 842) - (aufloesen(mb[1], objs) || 0), W = (aufloesen(mb[2], objs) || 595) - (aufloesen(mb[0], objs) || 0);
  const glyphs = [], fontCache = new Map();

  function run(data, res, ctm0, depth) {
    if (depth > 6) return;
    res = aufloesen(res, objs) || {};
    const fonts = aufloesen(res.Font, objs) || {}, xobj = aufloesen(res.XObject, objs) || {};
    const lx = new Lexer(data, 0), stack = [];
    let gs = { ctm: ctm0 }, gstack = [];
    let tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0];
    let font = null, fs = 0, tc = 0, tw = 0, th = 1, tl = 0, rise = 0;
    const show = (str) => {
      if (!font) return;
      const step = font.bytes;
      for (let i = 0; i + step <= str.length; i += step) {
        const code = step === 2 ? str.readUInt16BE(i) : str[i];
        const ch = font.text(code), w = font.width(code) / 1000;
        const isSpace = step === 1 && code === 32;
        const trm = mul([fs * th, 0, 0, fs, 0, rise], mul(tm, gs.ctm));
        const [x, y] = apply(trm, 0, 0), [x2, y2] = apply(trm, w, 0), [xu, yu] = apply(trm, 0, 1);
        glyphs.push({ ch, x, y, x2, y2, ux: xu - x, uy: yu - y });
        const adv = (w * fs + tc + (isSpace ? tw : 0)) * th;
        tm = mul([1, 0, 0, 1, adv, 0], tm);
      }
    };
    for (let guard = 0; guard < 2e6; guard++) {
      const t = lx.token();
      if (t === undefined) break;
      if (!(t instanceof Op)) {
        if (t === '[') { const a = []; for (;;) { const x = lx.token(); if (x === ']' || x === undefined) break; a.push(x === '<<' ? lx.object('<<') : x); } stack.push(a); }
        else if (t === '<<') stack.push(lx.object('<<'));
        else stack.push(t);
        continue;
      }
      const a = stack.splice(0), op = t.s;
      switch (op) {
        case 'q': gstack.push(gs); gs = { ...gs }; break;
        case 'Q': gs = gstack.pop() || gs; break;
        case 'cm': if (a.length >= 6) gs.ctm = mul(a.slice(-6), gs.ctm); break;
        case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm; break;
        case 'Tf': font = fonts[a[0] && a[0].s] ? ladeSchrift(fonts[a[0].s], objs, fontCache) : null; fs = a[1] || 0; break;
        case 'Tc': tc = a[0] || 0; break;
        case 'Tw': tw = a[0] || 0; break;
        case 'Tz': th = (a[0] ?? 100) / 100; break;
        case 'TL': tl = a[0] || 0; break;
        case 'Ts': rise = a[0] || 0; break;
        case 'Td': tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], tlm); tm = tlm; break;
        case 'TD': tl = -(a[1] || 0); tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], tlm); tm = tlm; break;
        case 'Tm': if (a.length >= 6) { tlm = a.slice(-6); tm = tlm; } break;
        case 'T*': tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; break;
        case 'Tj': if (Buffer.isBuffer(a[0])) show(a[0]); break;
        case "'": tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; if (Buffer.isBuffer(a[0])) show(a[0]); break;
        case '"': tw = a[0]; tc = a[1]; tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; if (Buffer.isBuffer(a[2])) show(a[2]); break;
        case 'TJ':
          for (const x of a[0] || []) {
            if (Buffer.isBuffer(x)) show(x);
            else if (typeof x === 'number') {
              const adv = -x / 1000 * fs * th;
              if (x < -180 && glyphs.length) glyphs.push({ gap: true }); /* grosse Luecke = Wortgrenze */
              tm = mul([1, 0, 0, 1, adv, 0], tm);
            }
          }
          break;
        case 'Do': {
          const ref = xobj[a[0] && a[0].s];
          const o = ref instanceof Ref ? objs.get(ref.n) : null;
          if (o && o.val && o.val.Subtype instanceof Name && o.val.Subtype.s === 'Form' && o.stream) {
            try {
              const m = Array.isArray(o.val.Matrix) ? o.val.Matrix.map((v) => aufloesen(v, objs)) : [1, 0, 0, 1, 0, 0];
              run(decode(o.val, o.stream, objs), o.val.Resources || res, mul(m, gs.ctm), depth + 1);
            } catch { /* Form ueberspringen */ }
          }
          break;
        }
        case 'BI': { /* Inline-Bild ueberspringen */
          const s = data.indexOf('EI', lx.p);
          lx.p = s < 0 ? data.length : s + 2;
          break;
        }
        default: break;
      }
    }
  }
  run(inhalt(p.page, objs), p.Resources, [1, 0, 0, 1, 0, 0], 0);

  /* Glyphen zu Woertern zusammenfassen */
  const words = [];
  let cur = null;
  const close = () => { if (cur && cur.t.trim()) words.push(cur); cur = null; };
  for (const g of glyphs) {
    if (g.gap) { close(); continue; }
    if (!g.ch || /\s/.test(g.ch)) { close(); continue; }
    const len = Math.hypot(g.ux, g.uy) || 1;            /* Schrifthoehe */
    const dir = Math.atan2(g.y2 - g.y, g.x2 - g.x);      /* Schreibrichtung */
    if (cur) {
      const ex = cur.endX - g.x, ey = cur.endY - g.y, dist = Math.hypot(ex, ey);
      if (Math.abs(dir - cur.dir) > 0.1 || dist > len * 0.25) close();
    }
    const top = [g.x + g.ux * 0.95, g.y + g.uy * 0.95], bot = [g.x - g.ux * 0.05, g.y - g.uy * 0.05];
    const pts = [top, bot, [g.x2 + g.ux * 0.95, g.y2 + g.uy * 0.95], [g.x2 - g.ux * 0.05, g.y2 - g.uy * 0.05]];
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => H - q[1]);
    if (!cur) cur = { t: '', x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, dir, rot: Math.abs(dir) > 0.2 };
    cur.t += g.ch;
    cur.x0 = Math.min(cur.x0, ...xs); cur.x1 = Math.max(cur.x1, ...xs);
    cur.y0 = Math.min(cur.y0, ...ys); cur.y1 = Math.max(cur.y1, ...ys);
    cur.endX = g.x2; cur.endY = g.y2;
  }
  close();
  return { words: words.map(({ t, x0, y0, x1, y1, rot }) => ({ t, x0, y0, x1, y1, rot })), w: W, h: H };
}

module.exports = { pdfWoerter };
