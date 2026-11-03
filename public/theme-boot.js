// Aplica a aparência salva ANTES da primeira pintura (evita piscar o tema errado).
(function () {
  var DEFAULTS = { theme: 'dark', font: 'sans', accent: 'green', fontSize: 16, density: 'comfortable', motion: true };
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  function apply(appearance) {
    var a = Object.assign({}, DEFAULTS, appearance || {});
    var root = document.documentElement;
    var theme = a.theme === 'system' ? (media && media.matches ? 'light' : 'dark') : a.theme;
    root.dataset.theme = theme;
    root.dataset.font = a.font;
    root.dataset.accent = a.accent;
    root.dataset.density = a.density;
    root.dataset.motion = a.motion ? 'on' : 'off';
    root.style.setProperty('--fs', Math.min(20, Math.max(14, Number(a.fontSize) || 16)) + 'px');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#faf8f5' : '#0c0e12');
    return a;
  }

  var saved = {};
  try { saved = (JSON.parse(localStorage.getItem('ia.settings')) || {}).appearance || {}; } catch (e) { /* storage bloqueado */ }

  window.APPEARANCE_DEFAULTS = DEFAULTS;
  window.applyAppearance = apply;
  apply(saved);
})();
