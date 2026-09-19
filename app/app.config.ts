import type { ConfigContext, ExpoConfig } from 'expo/config';

// Build variant: NODE_ENV=production at config time means a production build.
// The Expo CLI already sets NODE_ENV=production (unless it is set) for every production bundle:
// `expo export` / `expo export --platform web`, and `expo export:embed`, which Gradle runs to bundle
// the JS of `assembleRelease`. `expo prebuild` defaults to development, so the release script
// (scripts/build-release.sh, see docs/plan/release.md) sets NODE_ENV=production for prebuild too.
// Evaluated inside the config function: the CLI may load this file once and call it again after
// switching NODE_ENV (`expo export` does), so nothing here may be decided at module load.
function network() {
  const production = process.env.NODE_ENV === 'production';
  // The API base URL is inlined into the JS bundle at build time (EXPO_PUBLIC_*).
  // During development the tablet reaches the PC through `adb reverse tcp:3000 tcp:3000`.
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? (production ? '' : 'http://localhost:3000');
  if (production && !apiUrl.startsWith('https://')) {
    throw new Error(
      `app.config.ts: production build (NODE_ENV=production) needs EXPO_PUBLIC_API_URL to start with https:// ` +
        `(got ${apiUrl ? JSON.stringify(apiUrl) : 'nothing'}). See docs/plan/release.md.`,
    );
  }
  // Cleartext HTTP only outside production (the debug manifest allows it for Metro anyway).
  return { cleartext: !production && apiUrl.startsWith('http://') };
}

// Fonts embedded into the Android app. Names become the native fontFamily (file name without .ttf).
// Only two Noto Sans SC weights (~10.5 MB each): src/theme/fonts.ts maps 500 → 400 and 600/800/900 → 700.
const fonts = [
  'node_modules/@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf',
  'node_modules/@expo-google-fonts/noto-sans-sc/700Bold/NotoSansSC_700Bold.ttf',
  'node_modules/@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf',
  'node_modules/@expo-google-fonts/bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf',
  'node_modules/@expo-google-fonts/dm-mono/500Medium/DMMono_500Medium.ttf',
];

export default ({ config }: ConfigContext): ExpoConfig => {
  const { cleartext } = network();
  return {
    ...config,
    name: 'MeritAI',
    slug: 'meritai',
    version: '0.1.0',
    scheme: 'meritai',
    orientation: 'default',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    backgroundColor: '#F5F4FA',
    android: {
      package: 'com.meritai.app',
      versionCode: 1,
      adaptiveIcon: {
        backgroundColor: '#F5F4FA',
        foregroundImage: './assets/android-icon-foreground.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      // Added by the Expo/RN templates but unused: files come through the system picker (SAF),
      // which needs no storage permission, and nothing draws over other apps.
      blockedPermissions: [
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ],
    },
    web: {
      bundler: 'metro',
      output: 'single',
      favicon: './assets/favicon.png',
      name: 'MeritAI',
      shortName: 'MeritAI',
      themeColor: '#6246EA',
      backgroundColor: '#F5F4FA',
    },
    plugins: [
      'expo-router',
      ['expo-font', { fonts }],
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 96,
          backgroundColor: '#F5F4FA',
          dark: { image: './assets/splash-icon.png', backgroundColor: '#15131E' },
        },
      ],
      'expo-secure-store',
      'expo-localization',
      [
        'expo-build-properties',
        {
          android: {
            // One APK for both 64-bit and older 32-bit phones.
            buildArchs: ['armeabi-v7a', 'arm64-v8a'],
            usesCleartextTraffic: cleartext,
          },
        },
      ],
      './plugins/with-release-signing',
      './plugins/with-release-bundle',
      './plugins/with-android-accent',
    ],
    experiments: { typedRoutes: true },
  };
};
