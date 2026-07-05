import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.thisara.bujetsecure',
  appName: 'Bujet Secure',
  webDir: 'dist',
  server: {
    url: "http://192.168.8.160:3000/mobile/",
    cleartext: true,
    allowNavigation: ['192.168.*.*', '10.*.*.*', '172.16.*.*']
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
    keyboardResize: "native"
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;
