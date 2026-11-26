import { fontScaleMap } from './webPreferences';

// Restore theme, font size and motion before the first paint. Serialize the
// same font scale used after hydration to keep saved sizes from shifting.
export const appearanceBootstrap = `(function () {
  try {
    var preferences = JSON.parse(localStorage.getItem('campus-web-preferences') || 'null');
    var appearance = preferences && preferences.appearance;
    var root = document.documentElement;
    var theme = appearance && appearance.theme;
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    root.setAttribute('data-reduced-motion', appearance && appearance.animations === false ? 'true' : 'false');
    var fontSize = appearance && appearance.fontSize;
    var scale = ${JSON.stringify(fontScaleMap)}[fontSize === 'small' || fontSize === 'large' ? fontSize : 'medium'];
    var tokens = { body: '--font-body-size', bodySm: '--font-body-sm-size', h1: '--font-h1-size', h2: '--font-h2-size', h3: '--font-h3-size', label: '--font-label-size', labelSm: '--font-label-sm-size' };
    Object.keys(tokens).forEach(function (name) { root.style.setProperty(tokens[name], scale[name]); });
  } catch (error) {}
})();`;
