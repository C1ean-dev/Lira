import { describe, it, expect, beforeEach } from 'vitest'
import { useMediaStore } from '../store/useMediaStore'

describe('Audio & Media Store - Expected Behaviors', () => {
  beforeEach(() => {
    // Reset store state before each test
    useMediaStore.setState({
      selectedAudioInput: 'default',
      selectedAudioOutput: 'default',
      inputVolume: 100,
      outputVolume: 100,
      sensitivityMode: 'auto',
      manualSensitivityThreshold: 20,
      echoCancellation: true,
      autoGainControl: true,
      isNoiseSuppressionEnabled: true,
      screenShareAudioVolume: 100,
      duckingEnabled: true,
      isMuted: true,
      isCameraOff: true,
      isScreenSharing: false,
      isGridCallOpen: false,
      isSettingsModalOpen: false,
      localAudioLevel: 0,
      isGateOpen: false,
      isTestingMic: false,
      peerStreams: {},
      peerScreenStreams: {},
    })
  })

  it('should initialize with expected default audio settings', () => {
    const state = useMediaStore.getState()
    expect(state.inputVolume).toBe(100)
    expect(state.outputVolume).toBe(100)
    expect(state.sensitivityMode).toBe('auto')
    expect(state.manualSensitivityThreshold).toBe(20)
    expect(state.echoCancellation).toBe(true)
    expect(state.autoGainControl).toBe(true)
    expect(state.isNoiseSuppressionEnabled).toBe(true)
    expect(state.screenShareAudioVolume).toBe(100)
    expect(state.duckingEnabled).toBe(true)
    expect(state.isMuted).toBe(true)
    expect(state.isCameraOff).toBe(true)
    expect(state.audioProcessorMode).toBe('rnnoise')
  })

  it('should update input volume (microphone gain) correctly', () => {
    const { setInputVolume } = useMediaStore.getState()
    setInputVolume(150)
    expect(useMediaStore.getState().inputVolume).toBe(150)

    setInputVolume(0)
    expect(useMediaStore.getState().inputVolume).toBe(0)

    setInputVolume(200)
    expect(useMediaStore.getState().inputVolume).toBe(200)
  })

  it('should update output volume (master remote audio) correctly', () => {
    const { setOutputVolume } = useMediaStore.getState()
    setOutputVolume(75)
    expect(useMediaStore.getState().outputVolume).toBe(75)

    setOutputVolume(0)
    expect(useMediaStore.getState().outputVolume).toBe(0)
  })

  it('should switch between automatic and manual sensitivity modes', () => {
    const { setSensitivityMode, setManualSensitivityThreshold } = useMediaStore.getState()
    
    // Switch to manual mode
    setSensitivityMode('manual')
    expect(useMediaStore.getState().sensitivityMode).toBe('manual')

    // Adjust threshold
    setManualSensitivityThreshold(45)
    expect(useMediaStore.getState().manualSensitivityThreshold).toBe(45)

    // Switch back to auto mode
    setSensitivityMode('auto')
    expect(useMediaStore.getState().sensitivityMode).toBe('auto')
  })

  it('should toggle microphone mute state', () => {
    const { toggleMute, setMuted } = useMediaStore.getState()
    expect(useMediaStore.getState().isMuted).toBe(true)

    toggleMute()
    expect(useMediaStore.getState().isMuted).toBe(false)

    toggleMute()
    expect(useMediaStore.getState().isMuted).toBe(true)

    setMuted(false)
    expect(useMediaStore.getState().isMuted).toBe(false)
  })

  it('should toggle camera state', () => {
    const { toggleCamera, setCameraOff } = useMediaStore.getState()
    expect(useMediaStore.getState().isCameraOff).toBe(true)

    toggleCamera()
    expect(useMediaStore.getState().isCameraOff).toBe(false)

    toggleCamera()
    expect(useMediaStore.getState().isCameraOff).toBe(true)

    setCameraOff(false)
    expect(useMediaStore.getState().isCameraOff).toBe(false)
  })

  it('should toggle noise suppression DSP filter', () => {
    const { toggleNoiseSuppression } = useMediaStore.getState()
    expect(useMediaStore.getState().isNoiseSuppressionEnabled).toBe(true)

    toggleNoiseSuppression()
    expect(useMediaStore.getState().isNoiseSuppressionEnabled).toBe(false)

    toggleNoiseSuppression()
    expect(useMediaStore.getState().isNoiseSuppressionEnabled).toBe(true)
  })

  it('should update screen share audio volume and anti-echo voice ducking toggle', () => {
    const { setScreenShareAudioVolume, setDuckingEnabled } = useMediaStore.getState()
    
    setScreenShareAudioVolume(65)
    expect(useMediaStore.getState().screenShareAudioVolume).toBe(65)

    setDuckingEnabled(false)
    expect(useMediaStore.getState().duckingEnabled).toBe(false)

    setDuckingEnabled(true)
    expect(useMediaStore.getState().duckingEnabled).toBe(true)
  })

  it('should update real-time local audio level and gate open status', () => {
    const { setLocalAudioLevel } = useMediaStore.getState()
    
    setLocalAudioLevel(0.42, true, 18)
    expect(useMediaStore.getState().localAudioLevel).toBe(0.42)
    expect(useMediaStore.getState().isGateOpen).toBe(true)
    expect(useMediaStore.getState().autoThresholdPercent).toBe(18)

    setLocalAudioLevel(0.01, false, 12)
    expect(useMediaStore.getState().localAudioLevel).toBe(0.01)
    expect(useMediaStore.getState().isGateOpen).toBe(false)
    expect(useMediaStore.getState().autoThresholdPercent).toBe(12)
  })

  it('should handle microphone test mode toggle', () => {
    const { setIsTestingMic } = useMediaStore.getState()
    expect(useMediaStore.getState().isTestingMic).toBe(false)

    setIsTestingMic(true)
    expect(useMediaStore.getState().isTestingMic).toBe(true)

    setIsTestingMic(false)
    expect(useMediaStore.getState().isTestingMic).toBe(false)
  })

  it('should open and close audio settings modal', () => {
    const { setSettingsModalOpen } = useMediaStore.getState()
    expect(useMediaStore.getState().isSettingsModalOpen).toBe(false)

    setSettingsModalOpen(true)
    expect(useMediaStore.getState().isSettingsModalOpen).toBe(true)

    setSettingsModalOpen(false)
    expect(useMediaStore.getState().isSettingsModalOpen).toBe(false)
  })

  it('should manage remote peer streams properly', () => {
    const { setPeerStream, removePeerStream, clearAllPeerStreams } = useMediaStore.getState()
    const fakeStreamA = {} as MediaStream
    const fakeStreamB = {} as MediaStream

    setPeerStream('peer-1', fakeStreamA)
    setPeerStream('peer-2', fakeStreamB)

    expect(useMediaStore.getState().peerStreams['peer-1']).toBe(fakeStreamA)
    expect(useMediaStore.getState().peerStreams['peer-2']).toBe(fakeStreamB)

    removePeerStream('peer-1')
    expect(useMediaStore.getState().peerStreams['peer-1']).toBeUndefined()
    expect(useMediaStore.getState().peerStreams['peer-2']).toBe(fakeStreamB)

    clearAllPeerStreams()
    expect(Object.keys(useMediaStore.getState().peerStreams).length).toBe(0)
  })

  it('should adjust and calculate individual participant volumes for viewers', () => {
    const { setParticipantVolume, getEffectiveParticipantVolume, setOutputVolume } = useMediaStore.getState()

    // Default 100% volume
    expect(getEffectiveParticipantVolume('presenter-1')).toBe(1)

    // Set presenter volume to 60%
    setParticipantVolume('presenter-1', 60)
    expect(useMediaStore.getState().participantVolumes['presenter-1']).toBe(60)
    expect(getEffectiveParticipantVolume('presenter-1')).toBeCloseTo(0.6, 2)

    // Mute presenter (0%)
    setParticipantVolume('presenter-1', 0)
    expect(getEffectiveParticipantVolume('presenter-1')).toBe(0)

    // Unmute to 80% with master output at 50%
    setOutputVolume(50)
    setParticipantVolume('presenter-1', 80)
    // 0.5 * 0.8 = 0.4
    expect(getEffectiveParticipantVolume('presenter-1')).toBeCloseTo(0.4, 2)
  })

  it('should manage live buffer delay settings', () => {
    const { setLiveBufferDelay } = useMediaStore.getState()

    // Default or set to 500ms (was 3000ms — tightened to fix voice lag)
    setLiveBufferDelay(500)
    expect(useMediaStore.getState().liveBufferDelay).toBe(500)

    // Clamps to min 1ms (true minimum) and max 1500ms
    setLiveBufferDelay(0)
    expect(useMediaStore.getState().liveBufferDelay).toBe(1)

    setLiveBufferDelay(8000)
    expect(useMediaStore.getState().liveBufferDelay).toBe(1500)
  })

  it('setAdaptiveBuffers should persist audio+video WITHOUT dispatching live-buffer-changed (no event clobber)', () => {
    // Regression test: DynamicBufferManager applies (video,audio) straight
    // to the peer connections and then persists. If persisting re-dispatched
    // the legacy event, PeerManager would re-apply a video-only value and
    // wipe the adaptive audio number on every 1.5s tick.
    const dispatched: any[] = []
    const prevWindow = (globalThis as any).window
    const prevCE = (globalThis as any).CustomEvent
    ;(globalThis as any).window = {
      dispatchEvent: (e: any) => {
        dispatched.push(e)
        return true
      },
    }
    if (typeof (globalThis as any).CustomEvent === 'undefined') {
      ;(globalThis as any).CustomEvent = class {
        type: string
        detail: any
        constructor(t: string, init?: any) {
          this.type = t
          this.detail = init?.detail
        }
      }
    }
    try {
      // Control: the user-slider path MUST still dispatch.
      useMediaStore.getState().setLiveBufferDelay(400)
      expect(dispatched.length).toBe(1)
      expect(dispatched[0].detail).toBe(400)

      dispatched.length = 0
      useMediaStore.getState().setAdaptiveBuffers(50, 300, 12, 1)
      expect(dispatched.length).toBe(0)

      expect(useMediaStore.getState().liveBufferDelay).toBe(300)
      expect(useMediaStore.getState().dynamicBufferMetrics.audioMs).toBe(50)
      expect(useMediaStore.getState().dynamicBufferMetrics.calculatedMs).toBe(300)
      expect(useMediaStore.getState().dynamicBufferMetrics.jitterMs).toBe(12)
      expect(useMediaStore.getState().dynamicBufferMetrics.frameDropRate).toBe(1)
    } finally {
      if (prevWindow === undefined) delete (globalThis as any).window
      else (globalThis as any).window = prevWindow
      if (prevCE === undefined) delete (globalThis as any).CustomEvent
      else (globalThis as any).CustomEvent = prevCE
    }
  })

  it('should synchronize and persist live stream volume across overlays and modal', () => {
    const { setLiveStreamVolume } = useMediaStore.getState()

    setLiveStreamVolume(42)
    expect(useMediaStore.getState().liveStreamVolume).toBe(42)
    expect(useMediaStore.getState().participantVolumes['live']).toBe(42)

    // Clamping (0 to 200%)
    setLiveStreamVolume(150)
    expect(useMediaStore.getState().liveStreamVolume).toBe(150)
    setLiveStreamVolume(250)
    expect(useMediaStore.getState().liveStreamVolume).toBe(200)

    setLiveStreamVolume(-10)
    expect(useMediaStore.getState().liveStreamVolume).toBe(0)

    // Reset to default 100%
    setLiveStreamVolume(100)
    expect(useMediaStore.getState().liveStreamVolume).toBe(100)
  })

  it('should clamp screen share audio volume up to 200% with default 100%', () => {
    const { setScreenShareAudioVolume } = useMediaStore.getState()

    setScreenShareAudioVolume(180)
    expect(useMediaStore.getState().screenShareAudioVolume).toBe(180)

    // Clamping to 200%
    setScreenShareAudioVolume(250)
    expect(useMediaStore.getState().screenShareAudioVolume).toBe(200)

    setScreenShareAudioVolume(-5)
    expect(useMediaStore.getState().screenShareAudioVolume).toBe(0)

    setScreenShareAudioVolume(100)
    expect(useMediaStore.getState().screenShareAudioVolume).toBe(100)
  })

  it('should update and persist selected video input device', () => {
    const { setSelectedVideoInput } = useMediaStore.getState()
    expect(useMediaStore.getState().selectedVideoInput).toBe('default')

    setSelectedVideoInput('usb-webcam-device-id-123')
    expect(useMediaStore.getState().selectedVideoInput).toBe('usb-webcam-device-id-123')
  })
})
