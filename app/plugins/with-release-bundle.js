// Config plugin: bundle the release JS with a fresh Metro cache.
// EXPO_PUBLIC_* values (the API URL) are inlined when a file is transformed, and Metro's transform
// cache can hand back a file inlined with an OLD value: a web export with the https URL still
// contained the http URL of an earlier export until it was re-run with --clear (checked 2026-09-20).
// Gradle runs `expo export:embed` only for release variants (debug builds load JS from Metro),
// so `--reset-cache` costs time only in release builds. See docs/plan/release.md.
const { withAppBuildGradle } = require('expo/config-plugins');

const LINE = 'extraPackagerArgs = ["--reset-cache"] // meritai-release-bundle';

module.exports = function withReleaseBundle(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes('meritai-release-bundle')) return cfg;

    const commented = /^([ \t]*)\/\/[ \t]*extraPackagerArgs[ \t]*=[ \t]*\[\][ \t]*$/m;
    const reactHead = /^react\s*\{[ \t]*$/m;
    if (commented.test(gradle)) gradle = gradle.replace(commented, (_m, indent) => `${indent}${LINE}`);
    else if (reactHead.test(gradle)) gradle = gradle.replace(reactHead, (m) => `${m}\n    ${LINE}`);
    else throw new Error('with-release-bundle: react { } block not found in app/build.gradle');

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
