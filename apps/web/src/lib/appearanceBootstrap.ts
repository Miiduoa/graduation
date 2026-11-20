// Restore theme and motion before the first paint. AppearancePreferences
// normalizes the remaining preferences after hydration.
export const appearanceBootstrap = `(function () {
  try {
    var preferences = JSON.parse(localStorage.getItem('campus-web-preferences') || 'null');
    var appearance = preferences && preferences.appearance;
    var root = document.documentElement;
    var theme = appearance && appearance.theme;
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    root.setAttribute('data-reduced-motion', appearance && appearance.animations === false ? 'true' : 'false');
  } catch (error) {}
})();`;
