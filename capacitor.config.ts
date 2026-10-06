import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.lira.app',
  appName: 'Lira',
  webDir: 'dist',
  android: {
    // The app is served from https://localhost inside the WebView; PeerJS/WebRTC
    // signalling still goes out over the network.
    allowMixedContent: false,
  },
}

export default config
