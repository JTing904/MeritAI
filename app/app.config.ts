import type { ConfigContext, ExpoConfig } from 'expo/config';

// The API base URL is inlined into the JS bundle at build time (EXPO_PUBLIC_*).
// During development the tablet reaches the PC through `adb reverse tcp:3000 tcp:3000`.
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const cleartext = apiUrl.startsWith('http://');

// Fonts embedded into the Android app. Names become the native fontFamily (file name without .ttf).
const fonts = [
  'node_modules/@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf',
  'node_modules/@expo-google-fonts/noto-sans-sc/500Medium/NotoSansSC_500Medium.ttf',
  'node_modules/@expo-google-fonts/noto-sans-sc/700Bold/NotoSansSC_700Bold.ttf',
  'node_modules/@expo-google-fonts/noto-sans-sc/900Black/NotoSansSC_900Black.ttf',
  'node_modules/@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf',
  'node_modules/@expo-google-fonts/bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf',
  'node_modules/@expo-google-fonts/dm-mono/500Medium/DMMono_500Medium.ttf',
];

export default ({ config }: ConfigContext): ExpoConfig => ({
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
  ],
  experiments: { typedRoutes: true },
});
