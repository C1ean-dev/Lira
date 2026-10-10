import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.lira.app',
  appName: 'Lira',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
}

export default config
