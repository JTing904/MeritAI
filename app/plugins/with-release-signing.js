// Config plugin: sign release builds with the MeritAI release keystore.
// `expo prebuild --clean` regenerates android/, so the signing setup must live here, not in a hand edit.
// The keystore path and passwords come from Gradle properties in the user-level
// %USERPROFILE%\.gradle\gradle.properties (never from this repo):
//   MERITAI_RELEASE_STORE_FILE, MERITAI_RELEASE_STORE_PASSWORD,
//   MERITAI_RELEASE_KEY_ALIAS, MERITAI_RELEASE_KEY_PASSWORD
// Without them every release task FAILS (GradleException naming the missing properties); it never
// falls back to the debug key silently. For a local test build only, pass
// -PmeritaiAllowDebugSignedRelease=true to sign the release APK with the debug key.
// The generated Gradle code only names the properties; it never prints their values.
// See docs/plan/release.md.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// meritai-release-signing';

// Evaluated before `android { ... }`. A property counts as missing when absent or blank.
const preamble = `${MARKER}: release signing properties (values are never printed)
def meritaiReleaseSigningProps = ['MERITAI_RELEASE_STORE_FILE', 'MERITAI_RELEASE_STORE_PASSWORD', 'MERITAI_RELEASE_KEY_ALIAS', 'MERITAI_RELEASE_KEY_PASSWORD']
def meritaiReleaseSigningMissing = meritaiReleaseSigningProps.findAll { !(findProperty(it)?.toString()?.trim()) }
def meritaiAllowDebugSignedRelease = (findProperty('meritaiAllowDebugSignedRelease') ?: 'false').toString().toBoolean()

`;

const releaseConfig = `${MARKER}
        release {
            if (meritaiReleaseSigningMissing.isEmpty()) {
                storeFile file(findProperty('MERITAI_RELEASE_STORE_FILE'))
                storePassword findProperty('MERITAI_RELEASE_STORE_PASSWORD')
                keyAlias findProperty('MERITAI_RELEASE_KEY_ALIAS')
                keyPassword findProperty('MERITAI_RELEASE_KEY_PASSWORD')
            }
        }
        debug {`;

// Appended at the end: a check every release variant depends on (preReleaseBuild is the first task
// of the variant, validateSigningRelease runs just before signing). Debug builds never run it.
const check = `
${MARKER}: fail release builds without the release key
def meritaiCheckReleaseSigning = tasks.register('meritaiCheckReleaseSigning') {
    def missing = meritaiReleaseSigningMissing
    def allowDebug = meritaiAllowDebugSignedRelease
    doLast { task ->
        if (missing.isEmpty()) return
        if (allowDebug) {
            task.logger.warn('MeritAI: this release build is signed with the DEBUG key (-PmeritaiAllowDebugSignedRelease=true). Local testing only: never publish this APK.')
            return
        }
        throw new GradleException(
            "MeritAI release signing is not configured: missing Gradle properties \${missing.join(', ')}. " +
            'Set them in ~/.gradle/gradle.properties (see docs/plan/release.md). ' +
            'For a local test build only, pass -PmeritaiAllowDebugSignedRelease=true to sign with the debug key.')
    }
}
tasks.configureEach { t ->
    if (t.name == 'preReleaseBuild' || t.name == 'validateSigningRelease') t.dependsOn(meritaiCheckReleaseSigning)
}
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    const androidHead = /^android\s*\{/m;
    if (!androidHead.test(gradle)) throw new Error('with-release-signing: android { } block not found in app/build.gradle');
    gradle = gradle.replace(androidHead, (m) => `${preamble}${m}`);

    const signingHead = /signingConfigs\s*\{\s*debug\s*\{/;
    if (!signingHead.test(gradle)) throw new Error('with-release-signing: signingConfigs.debug not found in app/build.gradle');
    gradle = gradle.replace(signingHead, `signingConfigs {\n        ${releaseConfig}`);

    // Inside buildTypes.release: the release key, or the debug key only when explicitly allowed.
    // With properties missing and no opt-in, it points at the (empty) release config and the check fails first.
    const releaseType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!releaseType.test(gradle)) throw new Error('with-release-signing: buildTypes.release signingConfig not found');
    gradle = gradle.replace(
      releaseType,
      '$1signingConfig((meritaiReleaseSigningMissing.isEmpty() || !meritaiAllowDebugSignedRelease) ? signingConfigs.release : signingConfigs.debug)',
    );

    cfg.modResults.contents = `${gradle.trimEnd()}\n${check}`;
    return cfg;
  });
};
