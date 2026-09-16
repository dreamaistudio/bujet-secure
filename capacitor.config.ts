import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.thisara.budgetsecure',
  appName: 'Budget Secure',
  webDir: 'dist',
  backgroundColor: '#09090b',
  android: {
    backgroundColor: '#09090b',
    allowMixedContent: false
  }
};

export default config;
