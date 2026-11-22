import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdvancedAudioTab } from '../../components/settings/AdvancedAudioTab'
import { AudioDevicesTab } from '../../components/settings/AudioDevicesTab'
import { MultiEngineAudioPlayer } from '../../components/settings/MultiEngineAudioPlayer'
import { useMediaStore } from '../../store/useMediaStore'
import { MediaManager } from '../../media/MediaManager'
import { MicCalibrator } from '../../media/MicCalibrator'

vi.mock('../../store/useMediaStore', async () => {
  const actual = await vi.importActual<typeof import('../../store/useMediaStore')>('../../store/useMediaStore')
  return {
    ...actual,
    useMediaStore: Object.assign(
      (select: (state: ReturnType<typeof actual.useMediaStore.getState>) => unknown) =>
        select(actual.useMediaStore.getState()),
      actual.useMediaStore
    ),
  }
})

const originalState = useMediaStore.getState()

const baseDeviceProps = {
  inputDevices: [],
  outputDevices: [],
  videoDevices: [],
  isPlayingTestSound: false,
  onPlayTestSound: () => {},
}

describe('Microphone analysis vs Input Sensitivity (Auto Gate) separation', () => {
  beforeEach(() => {
    useMediaStore.setState({
      ...originalState,
      selectedAudioInput: 'mic-1',
      sensitivityMode: 'auto',
      manualSensitivityThreshold: 20,
      autoThresholdPercent: 3,
      audioProcessorMode: 'rnnoise',
      hasUserChosenProcessorMode: false,
      isNoiseSuppressionEnabled: true,
      rnnoiseStatus: 'ready',
      deepFilterStatus: 'idle',
      micCalibrations: {
        'mic-1': {
          noiseFloorDb: -52.2,
          peakRmsDb: -28.0,
          snrDb: 24.2,
          recommendedMode: 'rnnoise',
          recommendedSensitivity: 3,
          calibratedAt: 1000,
        },
      },
    })
  })

  afterEach(() => {
    useMediaStore.setState(originalState)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps AudioDevicesTab Auto mode focused on real-time adaptation without nudging to Manual', () => {
    const html = renderToStaticMarkup(<AudioDevicesTab {...baseDeviceProps} />)

    expect(html).toContain('Corte atual: ~3%')
    expect(html).not.toContain('Calibração recomendou')
    expect(html).not.toContain('Mudar para Manual')
  })

  it('explains continuous DeepFilterNet suppression when DeepFilterNet is active in Auto mode', () => {
    useMediaStore.setState({
      audioProcessorMode: 'deepfilter',
      hasUserChosenProcessorMode: true,
      deepFilterStatus: 'ready',
    })
    const html = renderToStaticMarkup(<AudioDevicesTab {...baseDeviceProps} />)

    expect(html).toContain('DeepFilterNet remove o ruído continuamente')
    expect(html).toContain('Detecção: ~3%')
    expect(html).not.toContain('Mudar para Manual')
  })

  it('offers the calibrated manual threshold suggestion only in Manual mode', () => {
    useMediaStore.setState({
      sensitivityMode: 'manual',
      manualSensitivityThreshold: 20,
    })
    const html = renderToStaticMarkup(<AudioDevicesTab {...baseDeviceProps} />)

    expect(html).toContain('Usar sugerido (3%)')
  })

  it('keeps AdvancedAudioTab in Auto mode aligned with real-time gate without forcing Manual', () => {
    const html = renderToStaticMarkup(<AdvancedAudioTab />)

    expect(html).toContain('Análise de Microfone &amp; Supressão')
    expect(html).toContain('5 segundos')
    expect(html).not.toContain('3 segundos')
    expect(html).toContain('Ajustada em tempo real pelo modo Automático')
    expect(html).not.toContain('Aplicar no Gate (Ativar Manual)')
    expect(html).not.toContain('(Gate em Automático)')
  })

  it('shows the suggested manual gate action in AdvancedAudioTab when the user is in Manual mode', () => {
    useMediaStore.setState({
      sensitivityMode: 'manual',
      manualSensitivityThreshold: 20,
    })
    const html = renderToStaticMarkup(<AdvancedAudioTab />)

    expect(html).toContain('Gate manual sugerido:')
    expect(html).toContain('3%')
    expect(html).toContain('Aplicar no Gate')
    expect(html).not.toContain('Ativar Manual')
  })

  it('displays Gate: Automático vs Gate Manual cleanly in MultiEngineAudioPlayer', () => {
    const samples = {
      deepfilter: { audioUrl: 'blob:df' },
      rnnoise: { audioUrl: 'blob:rn' },
      classic: { audioUrl: 'blob:cl' },
    }

    const autoHtml = renderToStaticMarkup(
      <MultiEngineAudioPlayer
        recommendedMode="rnnoise"
        recommendedSensitivity={3}
        gateMode="auto"
        activeMode="rnnoise"
        samples={samples}
        onApplyEngine={() => {}}
      />
    )
    expect(autoHtml).toContain('Gate: Automático')
    expect(autoHtml).not.toContain('Gate Manual:')

    const manualHtml = renderToStaticMarkup(
      <MultiEngineAudioPlayer
        recommendedMode="rnnoise"
        recommendedSensitivity={12}
        gateMode="manual"
        activeMode="rnnoise"
        samples={samples}
        onApplyEngine={() => {}}
      />
    )
    expect(manualHtml).toContain('Gate Manual: 12%')
  })

  it('does not overwrite sensitivityMode or manualSensitivityThreshold during calibrateMicrophone', async () => {
    const calibrateSpy = vi.spyOn(MicCalibrator.prototype, 'calibrate').mockResolvedValue({
      noiseFloorDb: -40,
      peakRmsDb: -18,
      snrDb: 22,
      recommendedMode: 'deepfilter',
      recommendedSensitivity: 12,
      gateMode: 'auto',
      durationMs: 5000,
    })

    const updateSensitivitySpy = vi.spyOn(MediaManager.getInstance(), 'updateSensitivity')
    useMediaStore.setState({
      selectedAudioInput: 'mic-1',
      sensitivityMode: 'auto',
      manualSensitivityThreshold: 25,
    })

    const result = await MediaManager.getInstance().calibrateMicrophone({} as MediaStream, 5000)

    expect(calibrateSpy).toHaveBeenCalledWith(
      expect.anything(),
      5000,
      expect.any(Function),
      { gateMode: 'auto' }
    )
    expect(result.gateMode).toBe('auto')
    expect(result.recommendedSensitivity).toBe(12)
    expect(useMediaStore.getState().sensitivityMode).toBe('auto')
    expect(useMediaStore.getState().manualSensitivityThreshold).toBe(25)
    expect(updateSensitivitySpy).not.toHaveBeenCalled()
  })
})

describe('Legacy calibration migration in persisted store', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('normalizes legacy persisted calibrations from the old dB formula onto the linear RMS scale', async () => {
    vi.resetModules()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'lira_audio_settings'
          ? JSON.stringify({
              micCalibrations: {
                'legacy-mic': {
                  noiseFloorDb: -52.2,
                  peakRmsDb: -28.0,
                  snrDb: 24.2,
                  recommendedMode: 'rnnoise',
                  recommendedSensitivity: 30,
                  calibratedAt: 123,
                },
              },
            })
          : null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })

    const { useMediaStore: freshStore } = await vi.importActual<typeof import('../../store/useMediaStore')>(
      '../../store/useMediaStore'
    )
    expect(freshStore.getState().micCalibrations['legacy-mic'].recommendedSensitivity).toBe(3)
  })
})
