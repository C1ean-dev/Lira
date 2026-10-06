import { Capacitor } from '@capacitor/core'

/**
 * Returns true if running in Android (either native Capacitor or Android browser/WebView)
 */
export const isAndroid = (): boolean => {
  if (typeof window === 'undefined') return false
  try {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      return true
    }
  } catch {}
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
}
