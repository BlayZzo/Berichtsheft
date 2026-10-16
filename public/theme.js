/* Hell/Dunkel sofort setzen, bevor die Seite gezeichnet wird (kein Aufblitzen) */
(function () {
  try {
    var t = localStorage.getItem('bh-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* ohne Speicher gilt die Einstellung des Geraets */ }
})();
