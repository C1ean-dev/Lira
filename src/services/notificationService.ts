
export type NotificationSoundType = 'knock' | 'message' | 'call'

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx || audioCtx.state === 'closed') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
      if (AudioContextClass) {
        audioCtx = new AudioContextClass()
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }
    return audioCtx
  } catch {
    return null
  }
}

export function playNotificationSound(type: NotificationSoundType = 'message') {
  try {
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime

    if (type === 'knock') {
      const playTap = (time: number, freq: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq, time)
        osc.frequency.exponentialRampToValueAtTime(65, time + 0.08)
        gain.gain.setValueAtTime(0.3, time)
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(time)
        osc.stop(time + 0.09)
      }
      playTap(now, 195)
      playTap(now + 0.13, 165)
    } else if (type === 'message') {
      const playTone = (time: number, freq: number, duration: number, vol: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, time)
        gain.gain.setValueAtTime(vol, time)
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(time)
        osc.stop(time + duration)
      }
      playTone(now, 587.33, 0.28, 0.2)
      playTone(now + 0.09, 880, 0.42, 0.25)
    } else if (type === 'call') {
      const notes = [440, 554.37, 659.25]
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq, now + idx * 0.1)
        gain.gain.setValueAtTime(0.2, now + idx * 0.1)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.1 + 0.35)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now + idx * 0.1)
        osc.stop(now + idx * 0.1 + 0.36)
      })
    }
  } catch (err) {
    console.debug('[NotificationSound] Audio playback ignored:', err)
  }
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
