# Release build (Android APK + web)

How to build a MeritAI release: a signed Android APK published on GitHub Releases, and the web export.
Hardening items A29–A34 (`docs/plan/hardening.md`); audit findings H1, H2, L1, L7, M7 (`docs/plan/audit/summary-app.md`).

## What makes a build "production"

**`NODE_ENV=production` at config time** is the production variant (`app/app.config.ts`). Then:

- `EXPO_PUBLIC_API_URL` must start with `https://`. Otherwise evaluating the config throws, and the build stops.
- The main Android manifest gets `android:usesCleartextTraffic="false"`. Cleartext HTTP is allowed only outside production, and the debug manifest always allows it for Metro.

Who sets `NODE_ENV=production`:

| Step | NODE_ENV | Guard applies |
| --- | --- | --- |
| `expo export` / `expo export --platform web` | set to `production` by the Expo CLI (forced) | yes, automatically |
| `expo export:embed` (Gradle runs it to bundle the JS of `assembleRelease`) | `production` by the CLI | yes, automatically |
| `expo prebuild` (writes the manifest) | defaults to `development` | only when you set it, so the release script sets `NODE_ENV=production` |
| `expo start` (Metro for the dev client) | `development` | no |

So a release APK or web build can't be bundled with an `http://` API URL. The release script also runs prebuild in production, so the manifest never allows cleartext.

## Signing key (keystore)

- Keystore: `C:\Users\user\.meritai\meritai-release.jks`, outside the repo. `.gitignore` ignores `*.jks`, `*.keystore`, `*.apk`, `*.aab` and `credentials*.json`.
- The path, alias and passwords are Gradle properties in the user-level `%USERPROFILE%\.gradle\gradle.properties`, never in the repo:
  `MERITAI_RELEASE_STORE_FILE`, `MERITAI_RELEASE_STORE_PASSWORD`, `MERITAI_RELEASE_KEY_ALIAS`, `MERITAI_RELEASE_KEY_PASSWORD`.
- `app/plugins/with-release-signing.js` writes the signing config into `android/app/build.gradle` at prebuild.
  - If any of the four properties is missing or blank, every release build **fails** with a GradleException that names the missing properties. It no longer falls back to the debug key.
  - Debug builds are not affected.
- For a local test build only, `./gradlew assembleRelease -PmeritaiAllowDebugSignedRelease=true` signs the release APK with the debug key and prints a warning.
  - Never publish such an APK. The release script refuses to run if this opt-in is set.
  - That build still needs an `https://` API URL, because the JS bundling step runs in production.
  - To test against the local server on the tablet, use the debug/dev-client build instead.

**Owner (A34, M7): losing the keystore or its passwords means no app update can ever be installed over the existing app.** Every user would have to uninstall and reinstall, which deletes their local data. So:

1. Keep **two offline, encrypted backups** of `meritai-release.jks`, for example:
   - two USB drives in different places,
   - each holding a VeraCrypt volume or a 7-Zip AES-256 archive with a strong passphrase.
2. Back up **the passwords and the alias** as well, stored separately from the keystore backups: a password manager plus a paper copy in a safe place.
3. Check once a year that a backup opens and that `keytool -list -v -keystore <backup copy>` shows the same SHA-256 fingerprint.
4. Publish the signing certificate's SHA-256 fingerprint in the README and in every GitHub Release, so people can check a downloaded APK. Get it from the `apksigner` output below.

## Build the release APK (one script)

Before you start:
- Stop Metro, since prebuild + Gradle hang it.
- Bump `version` and `android.versionCode` in `app/app.config.ts`. An update installs over the old app only with a higher `versionCode`.

```bash
# Git Bash, from the repo root
EXPO_PUBLIC_API_URL=https://<api-host> \
MERITAI_RELEASE_CERT_SHA256=<published fingerprint, optional> \
bash app/scripts/build-release.sh
```

What `app/scripts/build-release.sh` does, with one environment for every step:

1. **Checks the environment.**
   - Requires an `https://` `EXPO_PUBLIC_API_URL` and exports `NODE_ENV=production`.
   - Clears any `ORG_GRADLE_PROJECT_meritaiAllowDebugSignedRelease`.
   - Defaults `ANDROID_HOME` to `%LOCALAPPDATA%\Android\Sdk`, `JAVA_HOME` to Android Studio's `jbr`, and `JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true` (Gradle downloads fail over IPv6 on the build PC).
2. **Checks the signing properties.** It confirms that the four `MERITAI_RELEASE_*` property names are present and non-empty in `~/.gradle/gradle.properties`, without printing the values, and that `meritaiAllowDebugSignedRelease=true` is not set there.
3. **Runs prebuild:** `CI=1 npx expo prebuild --platform android --clean --no-install`. This regenerates `app/android` from `app.config.ts` and the plugins.
4. **Runs Gradle:** `./gradlew assembleRelease` in `app/android`.
   - Gradle bundles the JS with `expo export:embed --reset-cache` (`app/plugins/with-release-bundle.js`).
   - The fresh cache matters because Metro's transform cache can reuse a file inlined with an old `EXPO_PUBLIC_API_URL`. This happened on 2026-09-20: a web export with an https URL still contained the http URL from the export before it.
5. **Verifies the APK** (`app/android/app/build/outputs/apk/release/app-release.apk`):
   - `apksigner verify --print-certs`. Fails if the signer is `CN=Android Debug`, or if the SHA-256 differs from `MERITAI_RELEASE_CERT_SHA256` when that is given.
   - `aapt2 dump permissions`. Fails if SYSTEM_ALERT_WINDOW or READ/WRITE_EXTERNAL_STORAGE is present.
   - The manifest. Fails if `usesCleartextTraffic=true`.
   - The JS bundle. It must contain the https API URL and no `http://…:3000` dev address.
   - Finally it prints the APK's SHA-256 (for the release notes) and the signer's SHA-256.

Afterwards:
- Restart Metro.
- The release and debug builds have different signatures, so uninstall one before installing the other on the tablet.

Manual signature check at any time:

```bash
"$LOCALAPPDATA/Android/Sdk/build-tools/36.0.0/apksigner.bat" verify --print-certs app/android/app/build/outputs/apk/release/app-release.apk
```

Publish:
1. Create a GitHub Release tagged `v<version>`.
2. Attach `app-release.apk`, renamed `meritai-<version>.apk`.
3. Paste the APK SHA-256 and the signer certificate SHA-256 into the notes.
4. Never commit APKs: `*.apk` and `*.aab` are ignored.

## Web export

```bash
cd app
EXPO_PUBLIC_API_URL=https://<api-host> npx expo export --platform web --clear
```

- `expo export` forces `NODE_ENV=production`, so the https guard applies automatically. Without an `https://` URL, the export stops with `app.config.ts: production build (NODE_ENV=production) needs EXPO_PUBLIC_API_URL to start with https://`.
- Always pass `--clear`, for the stale-cache reason above.
- The output goes to `app/dist/`, which is ignored.

## Size notes

- Only two Noto Sans SC weights are bundled: 400 and 700, about 10.5 MB each uncompressed.
- `app/src/theme/fonts.ts` maps weight 500 to the 400 file, and 600/800/900 to the 700 file. The web font link loads the same two weights.
- Dropping the 500 and 900 files removes 21.1 MB of font data. The fonts are deflated inside the APK, so the APK itself shrinks by about **13.4 MB**: 6.77 MB + 6.62 MB compressed, measured in the current debug APK.
