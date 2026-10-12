import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  playSoundEffect,
  SoundEffectType,
  SoundTheme,
  SOUND_EFFECT_LABELS,
  SOUND_THEMES,
  getSeasonalThemeForDate,
  resolveEffectiveSoundTheme,
  _resetSoundEffectsForTesting,
} from '../../utils/soundEffects'
import { useMediaStore } from '../../store/useMediaStore'
import { useGameStore } from '../../store/useGameStore'
import { AudioDevicesTab } from '../../components/settings/AudioDevicesTab'

class MockAudioNode {
  connect() {
    return this
  }
  disconnect() {}
}

class MockAudioParam {
  value = 1
  setValueAtTime() {
    return this
  }
  linearRampToValueAtTime() {
    return this
  }
  exponentialRampToValueAtTime() {
    return this
  }
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam()
}

class MockOscillatorNode extends MockAudioNode {
  type = 'sine'
  frequency = new MockAudioParam()
  start() {}
  stop() {}
}

class MockAudioContext {
  state = 'running'
  currentTime = 0.5
  destination = new MockAudioNode()
  createGain() {
    return new MockGainNode()
  }
  createOscillator() {
    return new MockOscillatorNode()
  }
  async resume() {}
  async close() {}
  async setSinkId() {}
}

describe('Sound Effects System', () => {
  const originalAudioContext = (globalThis as any).AudioContext

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).AudioContext = MockAudioContext
    _resetSoundEffectsForTesting()

    useMediaStore.setState({
      soundEffectsEnabled: true,
      soundEffectsVolume: 80,
      soundTheme: 'auto',
      isMuted: true,
      isDeafened: false,
      isScreenSharing: false,
      selectedAudioOutput: 'default',
    })

    useGameStore.setState({
      localPlayer: {
        id: 'local-test-id',
        name: 'Tester',
        currentZoneId: null,
      } as any,
      callStates: {},
    })
  })

  afterEach(() => {
    ;(globalThis as any).AudioContext = originalAudioContext
    _resetSoundEffectsForTesting()
  })

  it('synthesizes all 8 sound effect types without throwing errors', () => {
    const types: SoundEffectType[] = [
      'mute',
      'unmute',
      'deafen',
      'undeafen',
      'user_join',
      'user_leave',
      'live_start',
      'live_stop',
    ]

    types.forEach((type) => {
      expect(() => playSoundEffect(type, true)).not.toThrow()
    })
  })

  it('respects soundEffectsEnabled: false unless force is true', () => {
    const spy = vi.spyOn(MockAudioContext.prototype, 'createGain')

    useMediaStore.setState({ soundEffectsEnabled: false })
    playSoundEffect('unmute', false)
    expect(spy).not.toHaveBeenCalled()

    playSoundEffect('unmute', true)
    expect(spy).toHaveBeenCalled()
  })

  it('suppresses user_join and user_leave sounds when user is deafened', () => {
    const spy = vi.spyOn(MockAudioContext.prototype, 'createGain')

    useMediaStore.setState({ isDeafened: true })
    playSoundEffect('user_join', false)
    playSoundEffect('user_leave', false)
    expect(spy).not.toHaveBeenCalled()

    playSoundEffect('undeafen', false)
    expect(spy).toHaveBeenCalled()
  })

  it('triggers mute and unmute audio cues in useMediaStore', () => {
    useMediaStore.setState({ isMuted: true })
    const spy = vi.spyOn(MockAudioContext.prototype, 'createGain')

    useMediaStore.getState().setMuted(false)
    expect(useMediaStore.getState().isMuted).toBe(false)
    expect(spy).toHaveBeenCalled()

    spy.mockClear()
    useMediaStore.getState().toggleMute()
    expect(useMediaStore.getState().isMuted).toBe(true)
    expect(spy).toHaveBeenCalled()
  })

  it('triggers deafen and undeafen audio cues in useMediaStore', () => {
    useMediaStore.setState({ isDeafened: false })
    const spy = vi.spyOn(MockAudioContext.prototype, 'createGain')

    useMediaStore.getState().toggleDeafen()
    expect(useMediaStore.getState().isDeafened).toBe(true)
    expect(spy).toHaveBeenCalled()

    spy.mockClear()
    useMediaStore.getState().setDeafened(false)
    expect(useMediaStore.getState().isDeafened).toBe(false)
    expect(spy).toHaveBeenCalled()
  })

  it('triggers live_start and live_stop cues in useMediaStore', () => {
    useMediaStore.setState({ isScreenSharing: false })
    const spy = vi.spyOn(MockAudioContext.prototype, 'createGain')

    useMediaStore.getState().setScreenSharing(true)
    expect(useMediaStore.getState().isScreenSharing).toBe(true)
    expect(spy).toHaveBeenCalled()

    spy.mockClear()
    useMediaStore.getState().setScreenSharing(false)
    expect(useMediaStore.getState().isScreenSharing).toBe(false)
    expect(spy).toHaveBeenCalled()
  })

  it('triggers user_join and user_leave when local player enters or leaves a zone', () => {
    const spy = vi.spyOn(MockAudioContext.prototype, 'createGain')

    useGameStore.getState().setCurrentZoneId('zone-meeting')
    expect(useGameStore.getState().localPlayer.currentZoneId).toBe('zone-meeting')
    expect(spy).toHaveBeenCalled()

    spy.mockClear()
    useGameStore.getState().setCurrentZoneId(null)
    expect(useGameStore.getState().localPlayer.currentZoneId).toBeNull()
    expect(spy).toHaveBeenCalled()
  })

  it('triggers user_join when remote peer connects and user_leave when peer disconnects while in zone', () => {
    useGameStore.setState({
      localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: 'zone-1' },
      callStates: {},
    })

    const spy = vi.spyOn(MockAudioContext.prototype, 'createGain')

    useGameStore.getState().setCallState('peer-alex', 'connected')
    expect(useGameStore.getState().callStates['peer-alex']).toBe('connected')
    expect(spy).toHaveBeenCalled()

    spy.mockClear()
    useGameStore.getState().setCallState('peer-alex', 'idle')
    expect(useGameStore.getState().callStates['peer-alex']).toBeUndefined()
    expect(spy).toHaveBeenCalled()
  })

  it('clamps soundEffectsVolume between 0 and 100', () => {
    const { setSoundEffectsVolume } = useMediaStore.getState()

    setSoundEffectsVolume(150)
    expect(useMediaStore.getState().soundEffectsVolume).toBe(100)

    setSoundEffectsVolume(-20)
    expect(useMediaStore.getState().soundEffectsVolume).toBe(0)

    setSoundEffectsVolume(65)
    expect(useMediaStore.getState().soundEffectsVolume).toBe(65)
  })

  it('renders Efeitos Sonoros section with labels and preview buttons in AudioDevicesTab', () => {
    const html = renderToStaticMarkup(
      React.createElement(AudioDevicesTab, {
        inputDevices: [],
        outputDevices: [],
        videoDevices: [],
        isPlayingTestSound: false,
        onPlayTestSound: () => {},
      })
    )

    expect(html).toContain('Efeitos Sonoros')
    expect(html).toContain('Testar Sons de Ação')
    expect(html).toContain('Volume dos Efeitos')

    Object.values(SOUND_EFFECT_LABELS).forEach(({ label }) => {
      expect(html).toContain(label)
    })
  })

  it('detects seasonal themes according to date correctly', () => {
    // October (Halloween)
    expect(getSeasonalThemeForDate(new Date(2026, 9, 11))).toBe('halloween')
    expect(getSeasonalThemeForDate(new Date(2026, 9, 31))).toBe('halloween')
    expect(getSeasonalThemeForDate(new Date(2026, 10, 2))).toBe('halloween')

    // December / Early January (Christmas holiday season)
    expect(getSeasonalThemeForDate(new Date(2026, 11, 15))).toBe('christmas')
    expect(getSeasonalThemeForDate(new Date(2026, 11, 25))).toBe('christmas')
    expect(getSeasonalThemeForDate(new Date(2026, 11, 31))).toBe('christmas')
    expect(getSeasonalThemeForDate(new Date(2027, 0, 3))).toBe('christmas')

    // Standard / Default period
    expect(getSeasonalThemeForDate(new Date(2026, 4, 15))).toBe('default')
  })

  it('resolves effective sound theme with auto and explicit overrides', () => {
    const octDate = new Date(2026, 9, 15)
    expect(resolveEffectiveSoundTheme('auto', octDate)).toBe('halloween')
    expect(resolveEffectiveSoundTheme(undefined, octDate)).toBe('halloween')

    // User can manually switch to Christmas even during Halloween!
    expect(resolveEffectiveSoundTheme('christmas', octDate)).toBe('christmas')
    expect(resolveEffectiveSoundTheme('default', octDate)).toBe('default')
    expect(resolveEffectiveSoundTheme('halloween', octDate)).toBe('halloween')
  })

  it('synthesizes all 8 sound effect types in all seasonal themes without throwing', () => {
    const types: SoundEffectType[] = [
      'mute',
      'unmute',
      'deafen',
      'undeafen',
      'user_join',
      'user_leave',
      'live_start',
      'live_stop',
    ]

    const themes: SoundTheme[] = ['default', 'halloween', 'christmas']

    themes.forEach((theme) => {
      useMediaStore.setState({ soundTheme: theme })
      types.forEach((type) => {
        expect(() => playSoundEffect(type, true)).not.toThrow()
      })
    })
  })

  it('allows switching sound themes in useMediaStore', () => {
    const { setSoundTheme } = useMediaStore.getState()

    setSoundTheme('halloween')
    expect(useMediaStore.getState().soundTheme).toBe('halloween')

    setSoundTheme('christmas')
    expect(useMediaStore.getState().soundTheme).toBe('christmas')

    setSoundTheme('auto')
    expect(useMediaStore.getState().soundTheme).toBe('auto')
  })

  it('renders sound theme switch buttons in AudioDevicesTab', () => {
    const html = renderToStaticMarkup(
      React.createElement(AudioDevicesTab, {
        inputDevices: [],
        outputDevices: [],
        videoDevices: [],
        isPlayingTestSound: false,
        onPlayTestSound: () => {},
      })
    )

    expect(html).toContain('Tema dos Efeitos (Sons por Data)')
    expect(html).toContain('Automático')
    expect(html).toContain('Halloween')
    expect(html).toContain('Natal')
    expect(html).toContain('Padrão')
    expect(html).not.toContain('Ano Novo')
  })
})
