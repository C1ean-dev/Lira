export type SoundEffectType =
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'user_join'
  | 'user_leave'
  | 'live_start'
  | 'live_stop'

export interface SoundEffectsOptions {
  enabled?: boolean
  volume?: number
  isDeafened?: boolean
  selectedAudioOutput?: string
}

let optionsProvider: (() => SoundEffectsOptions) | null = null

export function setSoundEffectsOptionsProvider(provider: (() => SoundEffectsOptions) | null): void {
  optionsProvider = provider
}

let audioCtx: AudioContext | null = null
const lastPlayedTimestamps: Partial<Record<SoundEffectType, number>> = {}

export function _resetSoundEffectsForTesting(): void {
  audioCtx = null
  for (const k in lastPlayedTimestamps) {
    delete lastPlayedTimestamps[k as SoundEffectType]
  }
}

function getAudioContext(): AudioContext | null {
  try {
    const AudioContextClass =
      (typeof window !== 'undefined' && ((window as any).AudioContext || (window as any).webkitAudioContext)) ||
      (typeof globalThis !== 'undefined' && ((globalThis as any).AudioContext || (globalThis as any).webkitAudioContext)) ||
      null
    if (!AudioContextClass) return null

    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioContextClass()
    }
    if (!audioCtx) return null
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }

    const selectedSink = optionsProvider?.()?.selectedAudioOutput
    if (
      selectedSink &&
      typeof (audioCtx as any).setSinkId === 'function' &&
      (audioCtx as any).sinkId !== selectedSink
    ) {
      ;(audioCtx as any)
        .setSinkId(selectedSink === 'default' ? '' : selectedSink)
        .catch(() => {})
    }

    return audioCtx
  } catch {
    return null
  }
}

export const SOUND_EFFECT_LABELS: Record<SoundEffectType, { label: string; icon: string }> = {
  mute: { label: 'Microfone Mutado', icon: '🔇' },
  unmute: { label: 'Microfone Ativado', icon: '🎙️' },
  deafen: { label: 'Áudio Ensurdecido', icon: '🔕' },
  undeafen: { label: 'Áudio Restaurado', icon: '🔔' },
  user_join: { label: 'Entrada na Chamada', icon: '🚪' },
  user_leave: { label: 'Saída da Chamada', icon: '🚶' },
  live_start: { label: 'Início da Live', icon: '📺' },
  live_stop: { label: 'Fim da Live', icon: '⏹️' },
}

const THROTTLE_MS: Record<SoundEffectType, number> = {
  mute: 100,
  unmute: 100,
  deafen: 100,
  undeafen: 100,
  user_join: 450,
  user_leave: 450,
  live_start: 350,
  live_stop: 350,
}

export function playSoundEffect(type: SoundEffectType, force: boolean = false): void {
  try {
    const options = optionsProvider ? optionsProvider() : undefined
    if (!force && options && options.enabled === false) {
      return
    }

    if (!force && options && options.isDeafened && (type === 'user_join' || type === 'user_leave')) {
      return
    }

    const nowMs = Date.now()
    const lastPlayed = lastPlayedTimestamps[type] || 0
    const throttleLimit = THROTTLE_MS[type] || 120
    if (!force && nowMs - lastPlayed < throttleLimit) {
      return
    }
    lastPlayedTimestamps[type] = nowMs

    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const rawVol = options && typeof options.volume === 'number' ? options.volume : 80
    const baseVolume = (rawVol / 100) * 0.35

    if (baseVolume <= 0.001) return

    const masterGain = ctx.createGain()
    masterGain.gain.setValueAtTime(baseVolume, now)
    masterGain.connect(ctx.destination)

    switch (type) {
      case 'mute': {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(380, now)
        osc.frequency.exponentialRampToValueAtTime(240, now + 0.1)

        gain.gain.setValueAtTime(0, now)
        gain.gain.linearRampToValueAtTime(0.7, now + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)

        osc.connect(gain)
        gain.connect(masterGain)
        osc.start(now)
        osc.stop(now + 0.13)
        break
      }

      case 'unmute': {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(260, now)
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.12)

        gain.gain.setValueAtTime(0, now)
        gain.gain.linearRampToValueAtTime(0.8, now + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14)

        osc.connect(gain)
        gain.connect(masterGain)
        osc.start(now)
        osc.stop(now + 0.15)
        break
      }

      case 'deafen': {
        const osc1 = ctx.createOscillator()
        const gain1 = ctx.createGain()
        osc1.type = 'triangle'
        osc1.frequency.setValueAtTime(440, now)
        gain1.gain.setValueAtTime(0.6, now)
        gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)
        osc1.connect(gain1)
        gain1.connect(masterGain)
        osc1.start(now)
        osc1.stop(now + 0.1)

        const osc2 = ctx.createOscillator()
        const gain2 = ctx.createGain()
        osc2.type = 'triangle'
        osc2.frequency.setValueAtTime(220, now + 0.08)
        gain2.gain.setValueAtTime(0.8, now + 0.08)
        gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
        osc2.connect(gain2)
        gain2.connect(masterGain)
        osc2.start(now + 0.08)
        osc2.stop(now + 0.23)
        break
      }

      case 'undeafen': {
        const osc1 = ctx.createOscillator()
        const gain1 = ctx.createGain()
        osc1.type = 'sine'
        osc1.frequency.setValueAtTime(260, now)
        gain1.gain.setValueAtTime(0.6, now)
        gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)
        osc1.connect(gain1)
        gain1.connect(masterGain)
        osc1.start(now)
        osc1.stop(now + 0.1)

        const osc2 = ctx.createOscillator()
        const gain2 = ctx.createGain()
        osc2.type = 'sine'
        osc2.frequency.setValueAtTime(520, now + 0.08)
        gain2.gain.setValueAtTime(0.7, now + 0.08)
        gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
        osc2.connect(gain2)
        gain2.connect(masterGain)
        osc2.start(now + 0.08)
        osc2.stop(now + 0.23)
        break
      }

      case 'user_join': {
        const notes = [
          { freq: 523.25, time: now, dur: 0.16, vol: 0.5 },
          { freq: 659.25, time: now + 0.07, dur: 0.18, vol: 0.6 },
          { freq: 783.99, time: now + 0.14, dur: 0.28, vol: 0.7 },
        ]

        notes.forEach(({ freq, time, dur, vol }) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(freq, time)
          gain.gain.setValueAtTime(0, time)
          gain.gain.linearRampToValueAtTime(vol, time + 0.015)
          gain.gain.exponentialRampToValueAtTime(0.0001, time + dur)

          osc.connect(gain)
          gain.connect(masterGain)
          osc.start(time)
          osc.stop(time + dur + 0.01)
        })
        break
      }

      case 'user_leave': {
        const notes = [
          { freq: 783.99, time: now, dur: 0.14, vol: 0.6 },
          { freq: 587.33, time: now + 0.08, dur: 0.26, vol: 0.5 },
        ]

        notes.forEach(({ freq, time, dur, vol }) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(freq, time)
          gain.gain.setValueAtTime(0, time)
          gain.gain.linearRampToValueAtTime(vol, time + 0.015)
          gain.gain.exponentialRampToValueAtTime(0.0001, time + dur)

          osc.connect(gain)
          gain.connect(masterGain)
          osc.start(time)
          osc.stop(time + dur + 0.01)
        })
        break
      }

      case 'live_start': {
        const notes = [
          { freq: 392.0, time: now, dur: 0.12, vol: 0.4 },
          { freq: 523.25, time: now + 0.06, dur: 0.14, vol: 0.5 },
          { freq: 659.25, time: now + 0.12, dur: 0.25, vol: 0.6 },
        ]

        notes.forEach(({ freq, time, dur, vol }) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'triangle'
          osc.frequency.setValueAtTime(freq, time)
          gain.gain.setValueAtTime(0, time)
          gain.gain.linearRampToValueAtTime(vol, time + 0.012)
          gain.gain.exponentialRampToValueAtTime(0.0001, time + dur)

          osc.connect(gain)
          gain.connect(masterGain)
          osc.start(time)
          osc.stop(time + dur + 0.01)
        })
        break
      }

      case 'live_stop': {
        const notes = [
          { freq: 659.25, time: now, dur: 0.12, vol: 0.5 },
          { freq: 392.0, time: now + 0.07, dur: 0.22, vol: 0.4 },
        ]

        notes.forEach(({ freq, time, dur, vol }) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'triangle'
          osc.frequency.setValueAtTime(freq, time)
          gain.gain.setValueAtTime(0, time)
          gain.gain.linearRampToValueAtTime(vol, time + 0.012)
          gain.gain.exponentialRampToValueAtTime(0.0001, time + dur)

          osc.connect(gain)
          gain.connect(masterGain)
          osc.start(time)
          osc.stop(time + dur + 0.01)
        })
        break
      }
    }
  } catch (err) {}
}
