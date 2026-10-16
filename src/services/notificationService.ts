import { playSoundEffect } from '../utils/soundEffects'

export type NotificationSoundType = 'knock' | 'message' | 'call'

export function playNotificationSound(type: NotificationSoundType = 'message') {
  playSoundEffect(type)
}

export interface NativeNotificationOptions {
  title: string
  body: string
  soundType?: NotificationSoundType
  tag?: string
  actions?: Array<{ type: 'button'; text: string }>
  onAction?: (actionIndex: number) => void
  onClick?: () => void
}

const actionCallbacks = new Map<string, { onAction?: (index: number) => void; onClick?: () => void }>()

if (typeof window !== 'undefined' && (window as any).electronAPI?.onNotificationAction) {
  ;(window as any).electronAPI.onNotificationAction(
    (event: { tag?: string; action: 'click' | 'button'; buttonIndex?: number }) => {
      if (!event.tag) return
      const entry = actionCallbacks.get(event.tag)
      if (!entry) return

      if (event.action === 'click') {
        entry.onClick?.()
      } else if (event.action === 'button' && event.buttonIndex !== undefined) {
        entry.onAction?.(event.buttonIndex)
      }
      actionCallbacks.delete(event.tag)
    }
  )
}

export async function sendNotification(options: NativeNotificationOptions) {
  if (options.soundType) {
    playNotificationSound(options.soundType)
  }

  const isWindowActive =
    typeof document !== 'undefined' && typeof document.hasFocus === 'function'
      ? document.hasFocus() && !document.hidden
      : false
  if (isWindowActive) {
    return
  }

  const tag = options.tag || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  if (options.onAction || options.onClick) {
    actionCallbacks.set(tag, {
      onAction: options.onAction,
      onClick: options.onClick,
    })
    setTimeout(() => actionCallbacks.delete(tag), 30000)
  }

  const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : undefined
  if (electronAPI?.showNativeNotification) {
    try {
      await electronAPI.showNativeNotification({
        title: options.title,
        body: options.body,
        sound: false,
        tag,
        actions: options.actions,
      })
      return
    } catch (err) {
      console.warn('[NotificationService] Electron notification error:', err)
    }
  }

  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      try {
        const notif = new Notification(options.title, {
          body: options.body,
          icon: '/favicon.ico',
          tag,
          silent: true,
        })
        notif.onclick = () => {
          window.focus()
          options.onClick?.()
          notif.close()
        }
      } catch (e) {
        console.debug('[NotificationService] Web notification fallback error:', e)
      }
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().catch(() => {})
    }
  }
}
