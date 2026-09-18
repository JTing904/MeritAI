// Config plugin: sign release builds with the MeritAI release keystore.
// `expo prebuild --clean` regenerates android/, so the signing setup must live here, not in a hand edit.
// The keystore path and passwords come from Gradle properties in the user-level
// %USERPROFILE%\.gradle\gradle.properties (never from this repo):
//   MERITAI_RELEASE_STORE_FILE, MERITAI_RELEASE_STORE_PASSWORD,
//   MERITAI_RELEASE_KEY_ALIAS, MERITAI_RELEASE_KEY_PASSWORD
// Without them, release builds fall back to the debug key (fine for local testing only).
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// meritai-release-signing';

const releaseConfig = `${MARKER}
        release {
            if (project.hasProperty('MERITAI_RELEASE_STORE_FILE')) {
                storeFile file(MERITAI_RELEASE_STORE_FILE)
                storePassword MERITAI_RELEASE_STORE_PASSWORD
                keyAlias MERITAI_RELEASE_KEY_ALIAS
                keyPassword MERITAI_RELEASE_KEY_PASSWORD
            }
        }
        debug {`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    const signingHead = /signingConfigs\s*\{\s*debug\s*\{/;
    if (!signingHead.test(gradle)) throw new Error('with-release-signing: signingConfigs.debug not found in app/build.gradle');
    gradle = gradle.replace(signingHead, `signingConfigs {\n        ${releaseConfig}`);

    // Inside buildTypes.release, swap the debug signing config for the release one when available.
    const releaseType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!releaseType.test(gradle)) throw new Error('with-release-signing: buildTypes.release signingConfig not found');
    gradle = gradle.replace(
      releaseType,
      "$1signingConfig project.hasProperty('MERITAI_RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
