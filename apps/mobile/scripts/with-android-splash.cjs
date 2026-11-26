const { AndroidConfig, withAndroidStyles } = require('expo/config-plugins');

// Android 12 draws its own starting window before the legacy windowBackground.
module.exports = function withAndroidSplash(config) {
  return withAndroidStyles(config, (mod) => {
    for (const [name, value, targetApi] of [
      ['android:windowSplashScreenBackground', '@color/splashscreen_background', 31],
      ['android:windowSplashScreenAnimatedIcon', '@drawable/splashscreen_logo', 31],
      ['android:statusBarColor', '@color/splashscreen_background'],
    ]) {
      mod.modResults = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
        parent: { name: 'Theme.App.SplashScreen' },
        name,
        value,
        targetApi,
        add: true,
      });
    }
    return mod;
  });
};
