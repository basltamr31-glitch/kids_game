import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.meadowlark.littlealpinedays',
  appName: 'Little Alpine Days',
  webDir: 'dist',
  // Offline-first: everything is bundled, nothing is fetched at runtime.
  server: { androidScheme: 'https' },
  android: {
    allowMixedContent: false,
    backgroundColor: '#8FC4E8',
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#8FC4E8',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#8FC4E8',
      showSpinner: false,
    },
  },
};

export default config;
