import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { loadSeasonalSound, seasonalSoundUrl } from '../../utils/seasonalSoundLibrary'
import { playSoundEffect, setSoundEffectsOptionsProvider, _resetSoundEffectsForTesting, SOUND_EFFECT_LABELS, type SoundEffectsOptions } from '../../utils/soundEffects'

const param = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() })
class TestContext {
  static instances: TestContext[] = []
  state = 'running'
  currentTime = 1
  destination = {}
  decodeAudioData = vi.fn(async () => ({ duration: .8 }))
  createGain = vi.fn(() => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() }))
  createBufferSource = vi.fn(() => ({ buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), onended: null as null | (() => void) }))
  createOscillator = vi.fn(() => ({ type: 'sine', frequency: param(), connect: vi.fn(), start: vi.fn(), stop: vi.fn() }))
  constructor(public options?: { sinkId?: string }) { TestContext.instances.push(this) }
}
const response = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })
const asContext = (ctx: TestContext) => ctx as unknown as AudioContext
let options: SoundEffectsOptions

beforeEach(() => {
  TestContext.instances = []
  _resetSoundEffectsForTesting()
  vi.stubGlobal('window', { AudioContext: TestContext, location: new URL('http://localhost:5173/') })
  vi.stubGlobal('fetch', vi.fn(async () => response()))
  options = { enabled: true, volume: 80, soundTheme: 'halloween', selectedAudioOutput: 'headphones' }
  setSoundEffectsOptionsProvider(() => options)
})
afterEach(() => { _resetSoundEffectsForTesting(); setSoundEffectsOptionsProvider(null); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('seasonal audio assets', () => {
  it('ships a different, audible, unclipped stereo WAV for every seasonal event', () => {
    const hashes = new Set<string>()
    for (const theme of ['halloween', 'christmas']) for (const type of Object.keys(SOUND_EFFECT_LABELS)) {
      const wav = fs.readFileSync(`public/sounds/seasonal/${theme}/${type}.wav`)
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
      expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
      expect(wav.readUInt16LE(20)).toBe(1)
      expect(wav.readUInt16LE(22)).toBe(2)
      expect(wav.readUInt32LE(24)).toBe(44100)
      expect(wav.readUInt16LE(34)).toBe(16)
      const duration = (wav.length - 44) / 4 / 44100
      expect(duration).toBeGreaterThan(.25)
      // Longer recognizable musical phrases belong to joins/live/call events;
      // frequent controls and messages remain short notification cues.
      const limit = ['user_join', 'live_start', 'call'].includes(type) ? 3 : 1.6
      expect(duration).toBeLessThan(limit)
      let energy = 0, peak = 0
      for (let i = 44; i < wav.length; i += 2) {
        const value = wav.readInt16LE(i) / 32768
        energy += value * value
        peak = Math.max(peak, Math.abs(value))
      }
      expect(Math.sqrt(energy / ((wav.length - 44) / 2))).toBeGreaterThan(.07)
      expect(peak).toBeLessThan(.8)
      expect(wav.readInt16LE(44)).toBe(0)
      expect(wav.readInt16LE(wav.length - 2)).toBe(0)
      hashes.add(crypto.createHash('sha256').update(wav).digest('hex'))
    }
    expect(hashes.size).toBe(22)
  })

  it('resolves the same assets for installed Electron and a web app under a base path', () => {
    vi.stubGlobal('window', { location: new URL('file:///C:/Lira/dist/index.html') })
    expect(seasonalSoundUrl('halloween', 'mute')).toBe('file:///C:/Lira/dist/sounds/seasonal/halloween/mute.wav?v=festive-2')
    vi.stubEnv('BASE_URL', '/lira/')
    vi.stubGlobal('window', { location: new URL('https://example.test/lira/') })
    expect(seasonalSoundUrl('christmas', 'call')).toBe('https://example.test/lira/sounds/seasonal/christmas/call.wav?v=festive-2')
  })
})

describe('seasonal playback', () => {
  it('plays the recorded theme through the configured output and frees its nodes', async () => {
    playSoundEffect('user_join', true)
    const ctx = TestContext.instances[0]
    await vi.waitFor(() => expect(ctx.createBufferSource).toHaveBeenCalledOnce())
    expect(ctx.options).toEqual({ sinkId: 'headphones' })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/halloween/user_join.wav'))
    const source = ctx.createBufferSource.mock.results[0].value
    expect(source.start).toHaveBeenCalledWith(1)
    expect(ctx.createGain.mock.results[0].value.gain.setValueAtTime).toHaveBeenLastCalledWith(expect.closeTo(.28), 1)
    source.onended?.()
    expect(source.disconnect).toHaveBeenCalledOnce()
    expect(ctx.createGain.mock.results[0].value.disconnect).toHaveBeenCalledOnce()
    expect(ctx.createOscillator).not.toHaveBeenCalled()
  })

  it('reuses concurrent decodes and retries an asset after a loading error', async () => {
    const ctx = new TestContext()
    const first = loadSeasonalSound(asContext(ctx), 'christmas', 'message')
    expect(loadSeasonalSound(asContext(ctx), 'christmas', 'message')).toBe(first)
    await first
    expect(fetch).toHaveBeenCalledOnce()
    expect(ctx.decodeAudioData).toHaveBeenCalledOnce()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    await expect(loadSeasonalSound(asContext(ctx), 'halloween', 'call')).rejects.toThrow('offline')
    await loadSeasonalSound(asContext(ctx), 'halloween', 'call')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it.each(['disabled', 'volume', 'theme'] as const)('cancels a pending sound when %s changes during loading', async change => {
    let finish!: (value: ReturnType<typeof response>) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve })))
    playSoundEffect('unmute')
    const ctx = TestContext.instances[0]
    if (change === 'disabled') options.enabled = false
    if (change === 'volume') options.volume = 0
    if (change === 'theme') options.soundTheme = 'christmas'
    finish(response())
    await vi.waitFor(() => expect(ctx.createGain.mock.results[0].value.disconnect).toHaveBeenCalledOnce())
    expect(ctx.createBufferSource).not.toHaveBeenCalled()
    expect(ctx.createOscillator).not.toHaveBeenCalled()
  })

  it('falls back to synthesis when the bundled WAV cannot load', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('missing file'))
    playSoundEffect('mute')
    await vi.waitFor(() => expect(TestContext.instances[0].createOscillator).toHaveBeenCalled())
    expect(TestContext.instances[0].createBufferSource).not.toHaveBeenCalled()
  })
})
