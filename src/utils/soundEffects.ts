export type SoundEffectType =
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'user_join'
  | 'user_leave'
  | 'live_start'
  | 'live_stop'

export type SoundTheme = 'auto' | 'default' | 'halloween' | 'christmas'
export type ResolvedSoundTheme = 'default' | 'halloween' | 'christmas'

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
    description: 'Alterna sons conforme a data atual (Halloween em Outubro, Natal em Dezembro)',
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
    description: 'Timbres de terror, gemidos fantasmagóricos, órgão gótico e suspense',
    seasonLabel: 'Outubro (Dia das Bruxas)',
  },
  christmas: {
    id: 'christmas',
    name: 'Natal',
    label: 'Natal',
    icon: '🎄',
    description: 'Sinos natalinos prateados, celesta e trenó com Jingle Bells',
    seasonLabel: 'Dezembro (Boas Festas)',
  },
}

export function getSeasonalThemeForDate(date: Date = new Date()): ResolvedSoundTheme {
  const month = date.getMonth() // 0 = Jan, 9 = Out, 11 = Dez
  const day = date.getDate()

  // Halloween: todo mês de outubro (mês 9) até 3 de novembro
  if (month === 9 || (month === 10 && day <= 3)) {
    return 'halloween'
  }

  // Natal: todo mês de dezembro (mês 11) até 6 de janeiro
  if (month === 11 || (month === 0 && day <= 6)) {
    return 'christmas'
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

/* Helper para sintetizar tom com envelope e pitch glide */
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

/* Helper para timbres de terror fantasmagórico: batimento de fase detuned e ressonância espectral */
function playGhostVoice(
  ctx: AudioContext,
  masterGain: GainNode,
  opts: {
    freq: number
    endFreq?: number
    time: number
    dur: number
    vol: number
    detuneHz?: number
    wave?: OscillatorType
  }
) {
  const wave = opts.wave || 'triangle'
  const detune = opts.detuneHz ?? 3.5

  // Oscilador primário com corpo espectral
  playTone(ctx, masterGain, {
    type: wave,
    freq: opts.freq,
    endFreq: opts.endFreq,
    time: opts.time,
    dur: opts.dur,
    vol: opts.vol * 0.75,
    attack: 0.02,
  })

  // Oscilador secundário com leve detune para criar batimento de fase fantasmagórico (tremor de fantasma)
  const secondaryEnd = opts.endFreq !== undefined ? opts.endFreq + detune : undefined
  playTone(ctx, masterGain, {
    type: 'sine',
    freq: opts.freq + detune,
    endFreq: secondaryEnd,
    time: opts.time,
    dur: opts.dur,
    vol: opts.vol * 0.45,
    attack: 0.025,
  })
}

/* Helper para sinos natalinos reais: física acústica de sino com parciais metálicos */
function playChristmasBell(
  ctx: AudioContext,
  masterGain: GainNode,
  freq: number,
  time: number,
  dur: number,
  vol: number
) {
  // Tom fundamental puro
  playTone(ctx, masterGain, {
    type: 'sine',
    freq,
    time,
    dur,
    vol: vol * 0.7,
    attack: 0.005,
  })

  // Terça menor parcial do sino (1.2x - dulçor característico de sino de bronze/prata)
  playTone(ctx, masterGain, {
    type: 'sine',
    freq: freq * 1.2,
    time,
    dur: dur * 0.8,
    vol: vol * 0.25,
    attack: 0.004,
  })

  // Sobreagudo metálico de ataque (2.76x - ressonância de sino de trenó/igreja)
  playTone(ctx, masterGain, {
    type: 'sine',
    freq: freq * 2.76,
    time,
    dur: dur * 0.6,
    vol: vol * 0.3,
    attack: 0.003,
  })

  // Brilho cristalino de neve (5.4x)
  playTone(ctx, masterGain, {
    type: 'sine',
    freq: freq * 5.4,
    time,
    dur: dur * 0.35,
    vol: vol * 0.15,
    attack: 0.002,
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

/* Síntese autêntica de Terror e Fantasma para o Halloween, mantendo a função sonora dos originais */
function playHalloweenSound(ctx: AudioContext, masterGain: GainNode, type: SoundEffectType, now: number): void {
  switch (type) {
    case 'mute': {
      // Baseado na descida original: sussurro fantasmagórico descendo na escuridão com tremor de medo
      playGhostVoice(ctx, masterGain, {
        freq: 392.0, // G4
        endFreq: 196.0, // G3 (descida de oitava)
        time: now,
        dur: 0.18,
        vol: 0.85,
        detuneHz: 4.5,
      })
      // Sub-grave cavernoso que se dissipa no silêncio
      playTone(ctx, masterGain, {
        type: 'sine',
        freq: 110.0,
        endFreq: 55.0,
        time: now,
        dur: 0.2,
        vol: 0.6,
      })
      break
    }

    case 'unmute': {
      // Baseado na subida original: uivo espectral de fantasma despertando do túmulo
      playGhostVoice(ctx, masterGain, {
        freq: 196.0, // G3
        endFreq: 440.0, // A4
        time: now,
        dur: 0.16,
        vol: 0.85,
        detuneHz: 4.0,
      })
      // Shimmer espectral sobreagudo de aparição
      playTone(ctx, masterGain, {
        type: 'sine',
        freq: 587.33,
        endFreq: 783.99,
        time: now + 0.04,
        dur: 0.16,
        vol: 0.45,
        attack: 0.02,
      })
      break
    }

    case 'deafen': {
      // Baseado nos 2 tons descendentes originais: portão de cripta batendo e silêncio mortal
      // 1º tom: sino fúnebre em trítono amaldiçoado (220 Hz + 311 Hz)
      playTone(ctx, masterGain, {
        type: 'triangle',
        freq: 220.0,
        time: now,
        dur: 0.14,
        vol: 0.65,
      })
      playTone(ctx, masterGain, {
        type: 'sine',
        freq: 311.13, // Trítono / diabolus in musica
        time: now,
        dur: 0.12,
        vol: 0.5,
      })
      // 2º tom (0.08s depois): baque profundo de caixão / lápide selada
      playTone(ctx, masterGain, {
        type: 'triangle',
        freq: 123.47,
        endFreq: 55.0,
        time: now + 0.08,
        dur: 0.28,
        vol: 0.9,
      })
      break
    }

    case 'undeafen': {
      // Baseado nos 2 tons ascendentes originais: maldição quebrada / ressurreição auditiva
      // 1º tom: sino sobrenatural grave
      playGhostVoice(ctx, masterGain, {
        freq: 246.94,
        time: now,
        dur: 0.12,
        vol: 0.65,
      })
      // 2º tom (0.08s depois): caixinha de música espectral ressoando alto
      playGhostVoice(ctx, masterGain, {
        freq: 587.33,
        endFreq: 880.0,
        time: now + 0.08,
        dur: 0.22,
        vol: 0.75,
      })
      break
    }

    case 'user_join': {
      // Baseado no arpejo ascendente original de 3 notas: relógio assombrado e fantasma entrando na sala!
      // Acorde menor de mansão assombrada (D menor com trítono de puro terror):
      const notes = [
        { freq: 293.66, time: now, dur: 0.14, vol: 0.65, type: 'triangle' as OscillatorType }, // D4
        { freq: 349.23, time: now + 0.07, dur: 0.16, vol: 0.7, type: 'triangle' as OscillatorType }, // F4 (terça menor)
        { freq: 415.3, time: now + 0.15, dur: 0.2, vol: 0.75, type: 'triangle' as OscillatorType }, // Ab4 (trítono assustador)
        { freq: 587.33, time: now + 0.22, dur: 0.32, vol: 0.85, type: 'sine' as OscillatorType }, // D5 (eco fantasma)
      ]
      notes.forEach((n) => playTone(ctx, masterGain, n))
      // Eco sub-grave de aparição
      playTone(ctx, masterGain, {
        type: 'sine',
        freq: 73.42,
        time: now,
        dur: 0.35,
        vol: 0.5,
      })
      break
    }

    case 'user_leave': {
      // Baseado nos 2 tons descendentes originais: suspiro de fantasma se esvaindo na névoa
      playTone(ctx, masterGain, {
        type: 'sine',
        freq: 880.0,
        endFreq: 349.23,
        time: now,
        dur: 0.3,
        vol: 0.7,
      })
      playGhostVoice(ctx, masterGain, {
        freq: 587.33,
        endFreq: 220.0,
        time: now + 0.05,
        dur: 0.28,
        vol: 0.6,
      })
      break
    }

    case 'live_start': {
      // Baseado na fanfarra ascendente original: órgão gótico monumental de Drácula!
      // Acorde grandioso de órgão com graves, terças menores e brilho majestoso
      playTone(ctx, masterGain, { type: 'triangle', freq: 73.42, time: now, dur: 0.38, vol: 0.6 }) // Pedal D2
      playTone(ctx, masterGain, { type: 'triangle', freq: 146.83, time: now, dur: 0.38, vol: 0.65 }) // D3
      playTone(ctx, masterGain, { type: 'triangle', freq: 220.0, time: now + 0.04, dur: 0.35, vol: 0.65 }) // A3
      playTone(ctx, masterGain, { type: 'sine', freq: 349.23, time: now + 0.08, dur: 0.35, vol: 0.7 }) // F4
      playTone(ctx, masterGain, { type: 'sine', freq: 587.33, time: now + 0.14, dur: 0.4, vol: 0.8 }) // D5
      break
    }

    case 'live_stop': {
      // Baseado nos 2 tons descendentes originais: encerramento sombrio de órgão gótico
      playTone(ctx, masterGain, { type: 'sine', freq: 349.23, time: now, dur: 0.14, vol: 0.65 })
      playTone(ctx, masterGain, { type: 'triangle', freq: 220.0, time: now + 0.08, dur: 0.18, vol: 0.6 })
      playTone(ctx, masterGain, { type: 'triangle', freq: 146.83, time: now + 0.14, dur: 0.32, vol: 0.75 })
      break
    }
  }
}

/* Síntese autêntica natalina: sinos de prata, celesta festiva e o motivo inconfundível de Jingle Bells */
function playChristmasSound(ctx: AudioContext, masterGain: GainNode, type: SoundEffectType, now: number): void {
  switch (type) {
    case 'mute': {
      // Toque suave descendente de sino de prata na neve
      playChristmasBell(ctx, masterGain, 1318.51, now, 0.16, 0.75) // E6
      playChristmasBell(ctx, masterGain, 987.77, now + 0.05, 0.18, 0.65) // B5
      break
    }

    case 'unmute': {
      // Brilho cristalino ascendente de sino natalino
      playChristmasBell(ctx, masterGain, 1046.5, now, 0.14, 0.7) // C6
      playChristmasBell(ctx, masterGain, 1567.98, now + 0.06, 0.22, 0.85) // G6
      break
    }

    case 'deafen': {
      // 2 sinos suaves e acolhedores de inverno (G5 -> E5)
      playChristmasBell(ctx, masterGain, 783.99, now, 0.14, 0.7)
      playChristmasBell(ctx, masterGain, 659.25, now + 0.08, 0.22, 0.75)
      break
    }

    case 'undeafen': {
      // 2 sinos alegres de despertar de Natal (E5 -> C6)
      playChristmasBell(ctx, masterGain, 659.25, now, 0.14, 0.7)
      playChristmasBell(ctx, masterGain, 1046.5, now + 0.08, 0.26, 0.8)
      break
    }

    case 'user_join': {
      // O clássico e inconfundível motivo de Jingle Bells! (E5 - E5 - E5 com sinos de trenó autênticos)
      playChristmasBell(ctx, masterGain, 659.25, now, 0.12, 0.75)
      playChristmasBell(ctx, masterGain, 659.25, now + 0.12, 0.12, 0.75)
      playChristmasBell(ctx, masterGain, 659.25, now + 0.24, 0.35, 0.9)
      break
    }

    case 'user_leave': {
      // Cadência descendente de canção natalina (G5 -> E5 -> C5)
      playChristmasBell(ctx, masterGain, 783.99, now, 0.14, 0.7)
      playChristmasBell(ctx, masterGain, 659.25, now + 0.08, 0.16, 0.65)
      playChristmasBell(ctx, masterGain, 523.25, now + 0.16, 0.28, 0.75)
      break
    }

    case 'live_start': {
      // Grandiosa cascata de carrilhão de catedral de Natal (G4 -> C5 -> E5 -> G5 -> C6)
      playChristmasBell(ctx, masterGain, 392.0, now, 0.14, 0.55)
      playChristmasBell(ctx, masterGain, 523.25, now + 0.06, 0.16, 0.6)
      playChristmasBell(ctx, masterGain, 659.25, now + 0.12, 0.18, 0.65)
      playChristmasBell(ctx, masterGain, 783.99, now + 0.18, 0.22, 0.75)
      playChristmasBell(ctx, masterGain, 1046.5, now + 0.25, 0.35, 0.85)
      break
    }

    case 'live_stop': {
      // Resolução delicada de caixinha de música de Natal
      playChristmasBell(ctx, masterGain, 783.99, now, 0.14, 0.65)
      playChristmasBell(ctx, masterGain, 659.25, now + 0.08, 0.16, 0.6)
      playChristmasBell(ctx, masterGain, 523.25, now + 0.16, 0.3, 0.7)
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
      case 'default':
      default:
        playDefaultSound(ctx, masterGain, type, now)
        break
    }
  } catch (err) {}
}
