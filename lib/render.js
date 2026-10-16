'use strict';
/* Baut aus einem Wochenbericht das fertige PDF */
const { Pdf, A4, wrap, textWidth } = require('./pdf');
const W = require('./weeks');

const M = 42;                 /* Seitenrand */
const RIGHT = A4.w - M;
const GREY = [110, 110, 110], LINE = [150, 150, 150], HEAD = [236, 238, 242];

function render({ report, kopf, vorlage, signature, footer }) {
  const v = vorlage;
  const pdf = new Pdf();
  const iso = W.isoWeek(report.weekStart);
  const last = report.days.length ? report.days[report.days.length - 1].date : report.weekStart;
  let sigIdx = -1;
  if (signature) sigIdx = pdf.addImage(signature);

  let y = 0;
  const pages = [];
  const newPage = () => { pdf.addPage(); pages.push(pdf.page); y = M; };

  /* ---- Kopf ---- */
  newPage();
  pdf.text(M, y, v.titel || 'Ausbildungsnachweis', 17, true);
  pdf.textRight(RIGHT, y, `Nr. ${report.nr}`, 17, true);
  y += 22;
  if (v.untertitel) { pdf.text(M, y, v.untertitel, 9, false, GREY); y += 14; }
  y += 4;

  const colW = (RIGHT - M) / 2, rowH = 30;
  const fields = [
    ['Name, Vorname', `${kopf.nachname}, ${kopf.vorname}`],
    ['Ausbildungsberuf', kopf.beruf],
    ['Ausbildungsbetrieb', kopf.betrieb],
    ['Abteilung', report.abteilung || kopf.abteilung || '–'],
    ['Ausbildungswoche', `${W.de(report.weekStart)} bis ${W.de(last)}  (KW ${iso.week}/${iso.year})`],
    ['Ausbildungsjahr', `${report.ausbildungsjahr}. Ausbildungsjahr`]
  ];
  if (kopf.ausbilder) fields.push(['Ausbilder/in', kopf.ausbilder], ['', '']);
  for (let i = 0; i < fields.length; i += 2) {
    for (let j = 0; j < 2; j++) {
      const [label, value] = fields[i + j];
      const x = M + j * colW;
      pdf.rect(x, y, colW, rowH, { stroke: LINE });
      if (label) {
        pdf.text(x + 6, y + 4, label, 7.5, false, GREY);
        const line = wrap(value || '', 10, false, colW - 12)[0] || '';
        pdf.text(x + 6, y + 15, line, 10);
      }
    }
    y += rowH;
  }
  y += 14;

  /* ---- Tabelle ---- */
  const cTag = 78, cStd = v.stundenZeigen === false ? 0 : 46;
  const cText = RIGHT - M - cTag - cStd;
  const size = 9.5, lh = 12.6, pad = 6;
  const tableHead = () => {
    pdf.rect(M, y, RIGHT - M, 20, { fill: HEAD, stroke: LINE });
    pdf.text(M + pad, y + 6, 'Tag', 8.5, true);
    pdf.text(M + cTag + pad, y + 6, v.spalteTaetigkeit || 'Tätigkeiten', 8.5, true);
    if (cStd) pdf.textRight(RIGHT - pad, y + 6, 'Std.', 8.5, true);
    y += 20;
  };
  const bottom = A4.h - M - 26; /* Platz fuer die Fusszeile */
  tableHead();

  const rows = report.days.map((d) => {
    const label = [W.KURZ[W.weekday(d.date)] + ', ' + W.deShort(d.date), W.TYPEN[d.type] || ''];
    const text = d.text || (d.type !== 'betrieb' && d.type !== 'schule' ? W.TYPEN[d.type] : '');
    return { label, lines: wrap(text, size, false, cText - 2 * pad), hours: d.hours };
  });
  if (report.bemerkung && report.bemerkung.trim()) {
    rows.push({ label: [v.bemerkungTitel || 'Bemerkungen'], lines: wrap(report.bemerkung, size, false, cText - 2 * pad), hours: null });
  }

  for (const row of rows) {
    let lines = row.lines.length ? row.lines : [''];
    let first = true;
    while (lines.length) {
      const minH = first ? Math.max(row.label.length * 11 + 2 * pad, 40) : 0;
      let fit = Math.floor((bottom - y - 2 * pad) / lh);
      if (fit < 1 || (first && bottom - y < Math.min(minH, lines.length * lh + 2 * pad))) {
        newPage(); tableHead(); fit = Math.floor((bottom - y - 2 * pad) / lh);
      }
      const part = lines.slice(0, fit);
      lines = lines.slice(fit);
      const h = Math.max(part.length * lh + 2 * pad - 2, lines.length ? 0 : minH);
      pdf.rect(M, y, RIGHT - M, h, { stroke: LINE });
      pdf.line(M + cTag, y, M + cTag, y + h, 0.6, LINE);
      if (cStd) pdf.line(RIGHT - cStd, y, RIGHT - cStd, y + h, 0.6, LINE);
      const label = first ? row.label : [row.label[0], 'Fortsetzung'];
      label.forEach((t, k) => pdf.text(M + pad, y + pad + k * 11, t, k ? 8 : 9, !k, k ? GREY : [20, 20, 20]));
      part.forEach((t, k) => pdf.text(M + cTag + pad, y + pad + k * lh, t, size));
      if (cStd && first && row.hours !== null) pdf.textRight(RIGHT - pad, y + pad, fmtHours(row.hours), size);
      y += h;
      first = false;
    }
  }
  if (cStd) {
    if (y + 20 > bottom) { newPage(); }
    const total = report.days.reduce((s, d) => s + (Number(d.hours) || 0), 0);
    pdf.rect(M, y, RIGHT - M, 20, { fill: HEAD, stroke: LINE });
    pdf.text(M + pad, y + 6, 'Gesamtstunden der Woche', 9, true);
    pdf.textRight(RIGHT - pad, y + 6, fmtHours(total), 9, true);
    y += 20;
  }

  /* ---- Hinweis und Unterschriften ---- */
  const hinweis = v.hinweis ? wrap(v.hinweis, 8.5, false, RIGHT - M) : [];
  const blockH = 16 + hinweis.length * 11 + 92;
  if (y + blockH > bottom) newPage(); else y += 16;
  hinweis.forEach((t) => { pdf.text(M, y, t, 8.5, false, GREY); y += 11; });
  y += 14;

  const sigW = (RIGHT - M - 30) / 2, lineY = y + 58;
  const box = (x, label, date, withSig) => {
    if (date) pdf.text(x, lineY - 14, W.de(date), 10);
    if (withSig && sigIdx >= 0) {
      const maxW = sigW - 78, maxH = 52;
      const sc = Math.min(maxW / signature.width, maxH / signature.height);
      const w = signature.width * sc, h = signature.height * sc;
      pdf.image(sigIdx, x + 74, lineY - h - 2, w, h);
    }
    pdf.line(x, lineY, x + sigW, lineY, 0.7, [40, 40, 40]);
    pdf.text(x, lineY + 4, label, 7.5, false, GREY);
  };
  box(M, v.unterschriftAzubi || 'Datum, Unterschrift Auszubildende/r', report.signedAt ? report.signedAt.slice(0, 10) : '', !!report.signedAt);
  if (v.ausbilderFeld !== false) box(M + sigW + 30, v.unterschriftAusbilder || 'Datum, Unterschrift Ausbilder/in', '', false);
  if (report.korrigiertAm) {
    pdf.text(M, lineY + 18, `Nachträglich korrigiert am ${W.de(report.korrigiertAm.slice(0, 10))} (erstmals abgeschlossen am ${W.de(report.firstSignedAt.slice(0, 10))}).`, 7.5, false, GREY);
  }

  /* ---- Fusszeile auf jeder Seite ---- */
  pages.forEach((p, i) => {
    pdf.page = p;
    const t = `${footer}  ·  Seite ${i + 1} von ${pages.length}`;
    pdf.line(M, A4.h - M - 12, RIGHT, A4.h - M - 12, 0.4, [200, 200, 200]);
    pdf.text(M, A4.h - M - 6, t, 7, false, [140, 140, 140]);
  });

  return pdf.build({ title: `${v.titel || 'Ausbildungsnachweis'} Nr. ${report.nr}`, author: `${kopf.vorname} ${kopf.nachname}` });
}

function fmtHours(h) {
  const v = Number(h) || 0;
  return (Math.round(v * 100) / 100).toString().replace('.', ',');
}

module.exports = { render, textWidth };
