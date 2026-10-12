export type SoundEffectType =
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'user_join'
  | 'user_leave'
  | 'live_start'
  | 'live_stop'

export type SoundTheme = 'auto' | 'default' | 'halloween' | 'christmas' | 'new_year'
export type ResolvedSoundTheme = 'default' | 'halloween' | 'christmas' | 'new_year'

export interface SoundThemeInfo {
  id: SoundTheme
  name: string
  label: string
  icon: string
  description: string
  seasonLabel?: string
}

export const SOUND_THEMES: Record<SoundTheme, SoundThemeInfo> = {
  auto: {
    id: 'auto',
    name: 'Automático',
    label: 'Automático (Data)',
    icon: '📅',
    description: 'Alterna sons conforme a data atual (Halloween em Outubro, Natal em Dezembro, etc.)',
  },
  default: {
    id: 'default',
    name: 'Padrão',
    label: 'Padrão',
    icon: '🔔',
    description: 'Sons clássicos e equilibrados da Lira',
  },
  halloween: {
    id: 'halloween',
    name: 'Halloween',
    label: 'Halloween',
    icon: '🎃',
    description: 'Timbres misteriosos, órgão gótico e acordes fantasmagóricos',
    seasonLabel: 'Outubro (Dia das Bruxas)',
  },
  christmas: {
    id: 'christmas',
    name: 'Natal',
    label: 'Natal',
    icon: '🎄',
    description: 'Sinos natalinos, celesta cristalina e acordes festivos de inverno',
    seasonLabel: 'Dezembro (Boas Festas)',
  },
  new_year: {
    id: 'new_year',
    name: 'Ano Novo',
    label: 'Ano Novo',
    icon: '🎆',
    description: 'Fanfarra brilhante, sintetizadores de celebração e festividades',
    seasonLabel: 'Virada de Ano',
  },
}

export function getSeasonalThemeForDate(date: Date = new Date()): ResolvedSoundTheme {
  const month = date.getMonth() // 0 = Jan, 9 = Out, 11 = Dez
  const day = date.getDate()

  // Halloween: todo mês de outubro (mês 9) até 3 de novembro
  if (month === 9 || (month === 10 && day <= 3)) {
    return 'halloween'
  }

  // Natal: 1º a 26 de dezembro (mês 11)
  if (month === 11 && day <= 26) {
    return 'christmas'
  }

  // Ano Novo: 27 de dezembro a 6 de janeiro
  if ((month === 11 && day >= 27) || (month === 0 && day <= 6)) {
    return 'new_year'
  }

  return 'default'
}

export function resolveEffectiveSoundTheme(
  theme?: SoundTheme,
  date: Date = new Date()
): ResolvedSoundTheme {
  if (!theme || theme === 'auto') {
    return getSeasonalThemeForDate(date)
  }
  return theme
}

export interface SoundEffectsOptions {
  enabled?: boolean
  volume?: number
  isDeafened?: boolean
  selectedAudioOutput?: string
  soundTheme?: SoundTheme
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

    const selectedSink = optionsProvider?.()?.selectedAudioOutput
    const targetSink = !selectedSink || selectedSink === 'default' ? '' : selectedSink

    if (!audioCtx || audioCtx.state === 'closed') {
      try {
        audioCtx = new AudioContextClass(targetSink ? { sinkId: targetSink } : undefined)
      } catch {
        audioCtx = new AudioContextClass()
      }
    }
    if (!audioCtx) return null
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }

    const currentSink =
      typeof (audioCtx as any).sinkId === 'string'
        ? (audioCtx as any).sinkId
        : ((audioCtx as any).sinkId?.deviceId ?? '')
    if (typeof (audioCtx as any).setSinkId === 'function' && currentSink !== targetSink) {
      ;(audioCtx as any).setSinkId(targetSink).catch(() => {})
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

/* Helper to play a synthesized tone with gain envelope */
function playTone(
  ctx: AudioContext,
  masterGain: GainNode,
  opts: {
    type?: OscillatorType
    freq: number
    endFreq?: number
    time: number
    dur: number
    vol: number
    attack?: number
  }
) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = opts.type || 'sine'
  osc.frequency.setValueAtTime(opts.freq, opts.time)
  if (opts.endFreq !== undefined && opts.endFreq !== opts.freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.endFreq), opts.time + opts.dur)
  }

  const attack = opts.attack ?? 0.012
  gain.gain.setValueAtTime(0, opts.time)
  gain.gain.linearRampToValueAtTime(opts.vol, opts.time + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, opts.time + opts.dur)

  osc.connect(gain)
  gain.connect(masterGain)
  osc.start(opts.time)
  osc.stop(opts.time + opts.dur + 0.01)
}

/* Helper for holiday bell tones: fundamental + crystalline metallic overtone */
function playBellNote(
  ctx: AudioContext,
  masterGain: GainNode,
  freq: number,
  time: number,
  dur: number,
  vol: number
) {
  // Fundamental bell tone
  playTone(ctx, masterGain, {
    type: 'sine',
    freq,
    time,
    dur,
    vol: vol * 0.85,
    attack: 0.006,
  })
  // Sparkling metallic harmonic (2.76x frequency creates authentic bell timbre)
  playTone(ctx, masterGain, {
    type: 'sine',
    freq: freq * 2.76,
    time,
    dur: dur * 0.7,
    vol: vol * 0.22,
    attack: 0.004,
  })
}

function playDefaultSound(ctx: AudioContext, masterGain: GainNode, type: SoundEffectType, now: number): void {
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
}

function playHalloweenSound(ctx: AudioContext, masterGain: GainNode, type: SoundEffectType, now: number): void {
  switch (type) {
    case 'mute': {
      // Descida fantasmagórica em trítono misterioso (A4 -> Eb4) com batimento espectral
      playTone(ctx, masterGain, {
        type: 'triangle',
        freq: 440.0,
        endFreq: 311.13,
        time: now,
        dur: 0.14,
        vol: 0.65,
      })
      playTone(ctx, masterGain, {
        type: 'sine',
        freq: 444.0,
        endFreq: 315.0,
        time: now,
        dur: 0.14,
        vol: 0.35,
      })
      break
    }

    case 'unmute': {
      // Feitiço / Shimmer místico ascendente (D4 -> F4 -> A4)
      playTone(ctx, masterGain, {
        type: 'triangle',
        freq: 293.66,
        endFreq: 440.0,
        time: now,
        dur: 0.13,
        vol: 0.65,
      })
      playTone(ctx, masterGain, {
        type: 'sine',
        freq: 587.33,
        endFreq: 698.46,
        time: now + 0.04,
        dur: 0.14,
        vol: 0.45,
      })
      break
    }

    case 'deafen': {
      // Sino de cripta gótica / portão de catacumba
      playTone(ctx, masterGain, {
        type: 'triangle',
        freq: 164.81,
        time: now,
        dur: 0.12,
        vol: 0.6,
      })
      playTone(ctx, masterGain, {
        type: 'triangle',
        freq: 110.0,
        endFreq: 82.0,
        time: now + 0.06,
        dur: 0.25,
        vol: 0.75,
      })
      break
    }

    case 'undeafen': {
      // Caixa de música de mansão mal-assombrada despertando
      playTone(ctx, masterGain, { type: 'sine', freq: 587.33, time: now, dur: 0.09, vol: 0.55 })
      playTone(ctx, masterGain, { type: 'sine', freq: 698.46, time: now + 0.05, dur: 0.11, vol: 0.6 })
      playTone(ctx, masterGain, { type: 'triangle', freq: 880.0, time: now + 0.11, dur: 0.2, vol: 0.7 })
      break
    }

    case 'user_join': {
      // Arpejo gótico de mansão assombrada (D menor: D4 -> F4 -> A4 -> D5)
      const notes = [
        { freq: 293.66, time: now, dur: 0.14, vol: 0.55, type: 'triangle' as OscillatorType },
        { freq: 349.23, time: now + 0.07, dur: 0.16, vol: 0.6, type: 'triangle' as OscillatorType },
        { freq: 440.0, time: now + 0.14, dur: 0.18, vol: 0.65, type: 'sine' as OscillatorType },
        { freq: 587.33, time: now + 0.22, dur: 0.3, vol: 0.75, type: 'sine' as OscillatorType },
      ]
      notes.forEach((n) => playTone(ctx, masterGain, n))
      break
    }

    case 'user_leave': {
      // Fantasma desvanecendo suavemente na névoa
      playTone(ctx, masterGain, {
        type: 'sine',
        freq: 698.46,
        endFreq: 293.66,
        time: now,
        dur: 0.25,
        vol: 0.65,
      })
      playTone(ctx, masterGain, {
        type: 'triangle',
        freq: 349.23,
        endFreq: 146.83,
        time: now + 0.02,
        dur: 0.26,
        vol: 0.45,
      })
      break
    }

    case 'live_start': {
      // Órgão gótico dramático de Drácula (Acorde D Menor com harmônicos ricos)
      playTone(ctx, masterGain, { type: 'triangle', freq: 146.83, time: now, dur: 0.35, vol: 0.45 })
      playTone(ctx, masterGain, { type: 'triangle', freq: 220.0, time: now, dur: 0.35, vol: 0.5 })
      playTone(ctx, masterGain, { type: 'sine', freq: 349.23, time: now, dur: 0.35, vol: 0.55 })
      playTone(ctx, masterGain, { type: 'sine', freq: 440.0, time: now, dur: 0.35, vol: 0.65 })
      break
    }

    case 'live_stop': {
      // Cadência final de órgão gótico
      playTone(ctx, masterGain, { type: 'sine', freq: 349.23, time: now, dur: 0.12, vol: 0.55 })
      playTone(ctx, masterGain, { type: 'triangle', freq: 293.66, time: now + 0.07, dur: 0.15, vol: 0.5 })
      playTone(ctx, masterGain, { type: 'triangle', freq: 146.83, time: now + 0.13, dur: 0.28, vol: 0.6 })
      break
    }
  }
}

function playChristmasSound(ctx: AudioContext, masterGain: GainNode, type: SoundEffectType, now: number): void {
  switch (type) {
    case 'mute': {
      // Toque suave de sino de prata (E6)
      playBellNote(ctx, masterGain, 1318.51, now, 0.15, 0.7)
      break
    }

    case 'unmute': {
      // Sino natalino ascendente alegre (C6 -> G6)
      playBellNote(ctx, masterGain, 1046.5, now, 0.12, 0.65)
      playBellNote(ctx, masterGain, 1567.98, now + 0.06, 0.18, 0.75)
      break
    }

    case 'deafen': {
      // Sino suave de neve de inverno (G5 -> E5)
      playBellNote(ctx, masterGain, 783.99, now, 0.13, 0.65)
      playBellNote(ctx, masterGain, 659.25, now + 0.07, 0.18, 0.7)
      break
    }

    case 'undeafen': {
      // Celesta natalina de despertar (C5 -> G5 -> C6)
      playBellNote(ctx, masterGain, 523.25, now, 0.12, 0.6)
      playBellNote(ctx, masterGain, 783.99, now + 0.06, 0.14, 0.65)
      playBellNote(ctx, masterGain, 1046.5, now + 0.12, 0.24, 0.75)
      break
    }

    case 'user_join': {
      // Motivo clássico de Jingle Bells! (E5 - E5 - E5 com timbre autêntico de trenó)
      playBellNote(ctx, masterGain, 659.25, now, 0.11, 0.65)
      playBellNote(ctx, masterGain, 659.25, now + 0.12, 0.11, 0.65)
      playBellNote(ctx, masterGain, 659.25, now + 0.24, 0.32, 0.8)
      break
    }

    case 'user_leave': {
      // Sinos de inverno suaves em cadência descendente (G5 -> E5 -> C5)
      playBellNote(ctx, masterGain, 783.99, now, 0.12, 0.65)
      playBellNote(ctx, masterGain, 659.25, now + 0.08, 0.14, 0.6)
      playBellNote(ctx, masterGain, 523.25, now + 0.16, 0.26, 0.7)
      break
    }

    case 'live_start': {
      // Fanfarra de carrilhão de Natal festivo (G4 -> C5 -> E5 -> G5 -> C6)
      playBellNote(ctx, masterGain, 392.0, now, 0.12, 0.5)
      playBellNote(ctx, masterGain, 523.25, now + 0.06, 0.14, 0.55)
      playBellNote(ctx, masterGain, 659.25, now + 0.12, 0.16, 0.6)
      playBellNote(ctx, masterGain, 783.99, now + 0.18, 0.18, 0.65)
      playBellNote(ctx, masterGain, 1046.5, now + 0.24, 0.32, 0.75)
      break
    }

    case 'live_stop': {
      // Resolução de caixinha de música de Natal
      playBellNote(ctx, masterGain, 783.99, now, 0.12, 0.6)
      playBellNote(ctx, masterGain, 659.25, now + 0.08, 0.14, 0.55)
      playBellNote(ctx, masterGain, 523.25, now + 0.15, 0.28, 0.65)
      break
    }
  }
}

function playNewYearSound(ctx: AudioContext, masterGain: GainNode, type: SoundEffectType, now: number): void {
  switch (type) {
    case 'mute': {
      playTone(ctx, masterGain, {
        type: 'triangle',
        freq: 523.25,
        endFreq: 329.63,
        time: now,
        dur: 0.12,
        vol: 0.65,
      })
      break
    }

    case 'unmute': {
      playTone(ctx, masterGain, {
        type: 'sine',
        freq: 329.63,
        endFreq: 659.25,
        time: now,
        dur: 0.14,
        vol: 0.75,
      })
      break
    }

    case 'deafen': {
      playTone(ctx, masterGain, {
        type: 'triangle',
        freq: 587.33,
        endFreq: 293.66,
        time: now,
        dur: 0.15,
        vol: 0.7,
      })
      break
    }

    case 'undeafen': {
      playTone(ctx, masterGain, { type: 'sine', freq: 293.66, time: now, dur: 0.08, vol: 0.6 })
      playTone(ctx, masterGain, { type: 'sine', freq: 587.33, time: now + 0.06, dur: 0.1, vol: 0.65 })
      playTone(ctx, masterGain, { type: 'triangle', freq: 880.0, time: now + 0.12, dur: 0.2, vol: 0.75 })
      break
    }

    case 'user_join': {
      // Fanfarra brilhante de celebração (F4 -> A4 -> C5 -> F5)
      playTone(ctx, masterGain, { type: 'triangle', freq: 349.23, time: now, dur: 0.12, vol: 0.55 })
      playTone(ctx, masterGain, { type: 'triangle', freq: 440.0, time: now + 0.07, dur: 0.14, vol: 0.6 })
      playTone(ctx, masterGain, { type: 'sine', freq: 523.25, time: now + 0.14, dur: 0.16, vol: 0.65 })
      playTone(ctx, masterGain, { type: 'sine', freq: 698.46, time: now + 0.21, dur: 0.3, vol: 0.75 })
      break
    }

    case 'user_leave': {
      // Corneta de festa em descida comemorativa
      playTone(ctx, masterGain, {
        type: 'sine',
        freq: 698.46,
        endFreq: 440.0,
        time: now,
        dur: 0.22,
        vol: 0.65,
      })
      break
    }

    case 'live_start': {
      // Fanfarra de contagem da virada
      playTone(ctx, masterGain, { type: 'triangle', freq: 523.25, time: now, dur: 0.12, vol: 0.5 })
      playTone(ctx, masterGain, { type: 'triangle', freq: 783.99, time: now + 0.07, dur: 0.14, vol: 0.6 })
      playTone(ctx, masterGain, { type: 'sine', freq: 1046.5, time: now + 0.14, dur: 0.3, vol: 0.75 })
      break
    }

    case 'live_stop': {
      playTone(ctx, masterGain, { type: 'sine', freq: 1046.5, time: now, dur: 0.12, vol: 0.6 })
      playTone(ctx, masterGain, { type: 'triangle', freq: 783.99, time: now + 0.07, dur: 0.14, vol: 0.55 })
      playTone(ctx, masterGain, { type: 'triangle', freq: 523.25, time: now + 0.14, dur: 0.25, vol: 0.65 })
      break
    }
  }
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

    const effectiveTheme = resolveEffectiveSoundTheme(options?.soundTheme)

    switch (effectiveTheme) {
      case 'halloween':
        playHalloweenSound(ctx, masterGain, type, now)
        break
      case 'christmas':
        playChristmasSound(ctx, masterGain, type, now)
        break
      case 'new_year':
        playNewYearSound(ctx, masterGain, type, now)
        break
      case 'default':
      default:
        playDefaultSound(ctx, masterGain, type, now)
        break
    }
  } catch (err) {}
}
