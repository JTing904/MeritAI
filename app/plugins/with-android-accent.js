// Config plugin: native Android widgets (the text cursor and selection handles) use the theme's
// colorAccent, which defaults to teal. Point it at the app's grape instead, with the dark-theme grape
// under values-night so they match in both themes.
const { AndroidConfig, withAndroidColors, withAndroidColorsNight, withAndroidStyles } = require('expo/config-plugins');

const LIGHT = '#6246EA';
const DARK = '#6A52F0';

function setAccent(colors, value) {
  return AndroidConfig.Colors.assignColorValue(colors, { name: 'colorAccent', value });
}

module.exports = function withAndroidAccent(config) {
  config = withAndroidColors(config, (c) => {
    c.modResults = setAccent(c.modResults, LIGHT);
    return c;
  });
  config = withAndroidColorsNight(config, (c) => {
    c.modResults = setAccent(c.modResults, DARK);
    return c;
  });
  config = withAndroidStyles(config, (c) => {
    c.modResults = AndroidConfig.Styles.assignStylesValue(c.modResults, {
      add: true,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
      name: 'colorAccent',
      value: '@color/colorAccent',
    });
    return c;
  });
  return config;
};
