'use strict';
/* Datum, Kalenderwoche, Feiertage und das automatische Vorausfuellen einer Woche */

const DAY = 86400000;
const parse = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (s, k) => fmt(new Date(parse(s).getTime() + k * DAY));
const de = (s) => { const [y, m, d] = String(s).split('-'); return `${d}.${m}.${y}`; };
const deShort = (s) => { const [, m, d] = String(s).split('-'); return `${d}.${m}.`; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && fmt(parse(s)) === s;
const weekday = (s) => (parse(s).getUTCDay() + 6) % 7; /* 0 = Montag */
const mondayOf = (s) => addDays(s, -weekday(s));
const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function isoWeek(s) {
  const d = parse(s);
  const thu = new Date(d.getTime() + (3 - weekday(s)) * DAY);
  const jan4 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((thu - jan4) / DAY / 7 - ((jan4.getUTCDay() + 6) % 7 - 3) / 7);
  return { week, year: thu.getUTCFullYear() };
}

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return fmt(new Date(Date.UTC(y, month - 1, day)));
}

const BUNDESLAENDER = {
  BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz', SL: 'Saarland',
  SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen'
};

/* Gesetzliche Feiertage (ohne Feiertage, die nur in einzelnen Gemeinden gelten) */
function holidays(year, land) {
  const e = easter(year), map = new Map();
  const set = (date, name, lands) => { if (!lands || lands.includes(land)) map.set(date, name); };
  set(`${year}-01-01`, 'Neujahr');
  set(`${year}-01-06`, 'Heilige Drei Könige', ['BW', 'BY', 'ST']);
  set(`${year}-03-08`, 'Internationaler Frauentag', year >= 2023 ? ['BE', 'MV'] : ['BE']);
  set(addDays(e, -2), 'Karfreitag');
  set(addDays(e, 1), 'Ostermontag');
  set(`${year}-05-01`, 'Tag der Arbeit');
  set(addDays(e, 39), 'Christi Himmelfahrt');
  set(addDays(e, 50), 'Pfingstmontag');
  set(addDays(e, 60), 'Fronleichnam', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL']);
  set(`${year}-08-15`, 'Mariä Himmelfahrt', ['SL']);
  set(`${year}-09-20`, 'Weltkindertag', ['TH']);
  set(`${year}-10-03`, 'Tag der Deutschen Einheit');
  set(`${year}-10-31`, 'Reformationstag', ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']);
  set(`${year}-11-01`, 'Allerheiligen', ['BW', 'BY', 'NW', 'RP', 'SL']);
  { /* Buss- und Bettag: Mittwoch vor dem 23. November */
    const nov23 = `${year}-11-23`; let k = 1;
    while (weekday(addDays(nov23, -k)) !== 2) k++;
    set(addDays(nov23, -k), 'Buß- und Bettag', ['SN']);
  }
  set(`${year}-12-25`, '1. Weihnachtstag');
  set(`${year}-12-26`, '2. Weihnachtstag');
  return map;
}
function holidayName(s, land) { return holidays(Number(s.slice(0, 4)), land).get(s) || ''; }

/* Laufende Nummer: Woche, in der die Ausbildung beginnt = Nr. 1 */
function reportNr(beginn, weekStart) {
  if (!isDate(beginn)) return 0;
  return Math.round((parse(weekStart) - parse(mondayOf(beginn))) / DAY / 7) + 1;
}
function ausbildungsjahr(beginn, date) {
  if (!isDate(beginn)) return 0;
  const b = parse(beginn), d = parse(date);
  let y = d.getUTCFullYear() - b.getUTCFullYear();
  if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) y--;
  return Math.max(1, y + 1);
}

const TYPEN = { betrieb: 'Betrieb', schule: 'Berufsschule', urlaub: 'Urlaub', krank: 'Krank', feiertag: 'Feiertag', frei: 'Frei' };

function fillText(type, settings, name) {
  const t = (settings.vorbelegung && settings.vorbelegung[type]) || '';
  return t.replace(/\{name\}/g, name || '');
}

/* Neue Woche mit allem, was sich automatisch ausfuellen laesst */
function buildWeek(user, settings, weekStart) {
  const tage = (settings.arbeitstage && settings.arbeitstage.length ? settings.arbeitstage : [0, 1, 2, 3, 4]).slice().sort();
  const schultage = user.schultage || [];
  const days = tage.map((wd) => {
    const date = addDays(weekStart, wd);
    const hol = holidayName(date, settings.bundesland);
    let type = 'betrieb';
    if (hol) type = 'feiertag';
    else if (isDate(user.ende) && date > user.ende) type = 'frei';
    else if (date < user.beginn) type = 'frei';
    else if (schultage.includes(wd)) type = 'schule';
    const hours = type === 'betrieb' ? Number(user.stunden) || 8 : type === 'schule' ? Number(user.schulstunden) || 8 : 0;
    return { date, type, hours, text: fillText(type, settings, hol) };
  });
  return {
    weekStart,
    nr: reportNr(user.beginn, weekStart),
    ausbildungsjahr: ausbildungsjahr(user.beginn, weekStart),
    abteilung: user.abteilung || '',
    bemerkung: '',
    days
  };
}

module.exports = {
  parse, fmt, addDays, de, deShort, isDate, weekday, mondayOf, isoWeek, holidays, holidayName,
  reportNr, ausbildungsjahr, buildWeek, fillText, BUNDESLAENDER, TYPEN, WOCHENTAGE, KURZ
};
