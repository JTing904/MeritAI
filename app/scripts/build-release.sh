#!/usr/bin/env bash
# Build the signed MeritAI release APK in one go: prebuild + Gradle with the SAME environment,
# then check the signature, the manifest and the inlined API URL. Steps and background:
# docs/plan/release.md.
#
# Usage (Git Bash, from anywhere; stop Metro first, since prebuild + Gradle hang it):
#   EXPO_PUBLIC_API_URL=https://api.example.com bash app/scripts/build-release.sh
# Optional:
#   MERITAI_RELEASE_CERT_SHA256=<published SHA-256 fingerprint>  fail unless the APK is signed with it
#
# The signing values live only in ~/.gradle/gradle.properties (MERITAI_RELEASE_*). This script checks
# that the property NAMES are there and never prints their values.
set -euo pipefail

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- 1. Environment (the same for prebuild and Gradle) ------------------------------------------
: "${EXPO_PUBLIC_API_URL:?Set EXPO_PUBLIC_API_URL to the https:// API URL, e.g. EXPO_PUBLIC_API_URL=https://api.example.com}"
case "$EXPO_PUBLIC_API_URL" in
  https://*) ;;
  *) die "EXPO_PUBLIC_API_URL must start with https:// (got \"$EXPO_PUBLIC_API_URL\")" ;;
esac
export EXPO_PUBLIC_API_URL
# app.config.ts treats NODE_ENV=production as the production variant: https-only API URL, no cleartext.
export NODE_ENV=production
# Never let a debug-signed opt-in leak into a real release (Gradle reads ORG_GRADLE_PROJECT_* as -P).
unset ORG_GRADLE_PROJECT_meritaiAllowDebugSignedRelease || true

export ANDROID_HOME="${ANDROID_HOME:-${LOCALAPPDATA:-$HOME/AppData/Local}/Android/Sdk}"
if [ -z "${JAVA_HOME:-}" ] && [ -d "/c/Program Files/Android/Android Studio/jbr" ]; then
  export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"
fi
# Gradle downloads fail over IPv6 on the build PC.
export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:--Djava.net.preferIPv4Stack=true}"
# Unix-style copy of the SDK path for this script (ANDROID_HOME itself stays as Gradle expects it).
SDK_DIR="$(cygpath -u "$ANDROID_HOME" 2>/dev/null || printf '%s' "$ANDROID_HOME")"
[ -d "$SDK_DIR" ] || die "Android SDK not found at ANDROID_HOME=$ANDROID_HOME"
[ -n "${JAVA_HOME:-}" ] || die "Set JAVA_HOME (Android Studio's jbr)"

# --- 2. Signing properties present (names only) -------------------------------------------------
GRADLE_PROPS="${GRADLE_USER_HOME:-$HOME/.gradle}/gradle.properties"
[ -f "$GRADLE_PROPS" ] || die "$GRADLE_PROPS not found: the MERITAI_RELEASE_* signing properties live there"
for name in MERITAI_RELEASE_STORE_FILE MERITAI_RELEASE_STORE_PASSWORD MERITAI_RELEASE_KEY_ALIAS MERITAI_RELEASE_KEY_PASSWORD; do
  grep -Eq "^[[:space:]]*${name}[[:space:]]*[=:][[:space:]]*[^[:space:]]" "$GRADLE_PROPS" \
    || die "Gradle property $name is missing or empty in $GRADLE_PROPS (see docs/plan/release.md)"
done
if grep -Eq '^[[:space:]]*meritaiAllowDebugSignedRelease[[:space:]]*[=:][[:space:]]*true' "$GRADLE_PROPS"; then
  die "meritaiAllowDebugSignedRelease=true is set in $GRADLE_PROPS: remove it before a real release"
fi

# --- 3. Prebuild (regenerates app/android from app.config.ts + plugins) -------------------------
say "Prebuild (NODE_ENV=production, EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL)"
cd "$APP_DIR"
CI=1 npx expo prebuild --platform android --clean --no-install

# --- 4. Gradle release build (bundles the JS with a fresh Metro cache, see with-release-bundle) -----
say "Gradle assembleRelease"
cd "$APP_DIR/android"
./gradlew assembleRelease

APK="$APP_DIR/android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || die "APK not found at $APK"

# --- 5. Verify ----------------------------------------------------------------------------------
BUILD_TOOLS="$(ls -d "$SDK_DIR"/build-tools/*/ | sort -V | tail -n 1)"
APKSIGNER="${BUILD_TOOLS}apksigner"; [ -f "$APKSIGNER" ] || APKSIGNER="${BUILD_TOOLS}apksigner.bat"
AAPT2="${BUILD_TOOLS}aapt2";         [ -f "$AAPT2" ] || AAPT2="${BUILD_TOOLS}aapt2.exe"

say "Signature (apksigner verify --print-certs)"
CERTS="$("$APKSIGNER" verify --print-certs "$APK")" || die "apksigner verify failed"
printf '%s\n' "$CERTS"
# Here-strings, not `printf | grep -q`: an early grep exit would trip pipefail.
if grep -q 'CN=Android Debug' <<<"$CERTS"; then
  die "The APK is signed with the DEBUG key. Do not publish it."
fi
SHA256="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<<"$CERTS" | tr -d '[:space:]:' | tr 'A-F' 'a-f')"
if [ -n "${MERITAI_RELEASE_CERT_SHA256:-}" ]; then
  EXPECTED="$(printf '%s' "$MERITAI_RELEASE_CERT_SHA256" | tr -d '[:space:]:' | tr 'A-F' 'a-f')"
  [ "$SHA256" = "$EXPECTED" ] || die "Signer SHA-256 $SHA256 does not match MERITAI_RELEASE_CERT_SHA256"
  echo "Signer matches the published fingerprint."
fi

say "Manifest"
PERMS="$("$AAPT2" dump permissions "$APK")"
printf '%s\n' "$PERMS"
for p in SYSTEM_ALERT_WINDOW READ_EXTERNAL_STORAGE WRITE_EXTERNAL_STORAGE; do
  if grep -q "android.permission.$p'" <<<"$PERMS"; then die "Blocked permission $p is in the APK"; fi
done
MANIFEST="$("$AAPT2" dump xmltree --file AndroidManifest.xml "$APK")"
if grep -q 'usesCleartextTraffic([^)]*)=true' <<<"$MANIFEST"; then
  die "usesCleartextTraffic=true in the release manifest"
fi
echo "No blocked permissions; cleartext traffic off."

say "Inlined API URL"
BUNDLE="$(mktemp)"; trap 'rm -f "$BUNDLE"' EXIT
unzip -p "$APK" assets/index.android.bundle >"$BUNDLE"
grep -aqF "$EXPO_PUBLIC_API_URL" "$BUNDLE" \
  || die "The JS bundle does not contain $EXPO_PUBLIC_API_URL (stale Metro cache?)"
echo "The JS bundle contains $EXPO_PUBLIC_API_URL."
if grep -aqE 'http://[A-Za-z0-9.-]+:3000' "$BUNDLE"; then
  die "The JS bundle contains an http://...:3000 dev API address"
fi

say "Done"
ls -l "$APK"
echo "SHA-256 of the APK file (for the GitHub Release notes):"
sha256sum "$APK"
echo "Signer certificate SHA-256: $SHA256"
echo "Restart Metro before going back to the dev client (prebuild + Gradle hang it)."
