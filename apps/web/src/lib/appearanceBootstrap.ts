// Apply only the validated theme before the first paint. Other preferences
// are normalized by AppearancePreferences after hydration.
export const appearanceBootstrap = `(function(){try{var p=JSON.parse(localStorage.getItem('campus-web-preferences')||'null');var t=p&&p.appearance&&p.appearance.theme;if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}})();`;
