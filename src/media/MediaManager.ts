import { NoiseSuppressor } from './NoiseSuppressor'
import { SoftDspProcessor } from './SoftDspProcessor'
import { RnnoiseProcessor } from './RnnoiseProcessor'
import { MicCalibrator, ProcessedSampleInfo } from './MicCalibrator'
import { CallAudioIsolator } from './CallAudioIsolator'
import { ProcessAudioCapture } from './ProcessAudioCapture'
import { diagLog, shortId, summarizeStream, summarizeTrack } from '../utils/diagnosticLogger'
import { useMediaStore } from '../store/useMediaStore'
import { useGameStore } from '../store/useGameStore'
import { useSpotifyJamStore } from '../store/useSpotifyJamStore'
import { PeerManager } from '../p2p/PeerManager'
import { SensitivityMode, AudioProcessorMode } from '../types/audio'

export interface ScreenShareConfig {
  captureMethod?: 'auto' | 'wgc' | 'dxgi' | 'bitblt' | 'graphics-hook'
  sourceId?: string
  sourceName?: string
  audioSourceId?: string
  includeAudio?: boolean
  resolution?: 'auto' | '480p' | '720p' | '1080p'
  fps?: 'auto' | 30 | 60
  optimizationMode?: 'quality' | 'smoothness'
  mixMicrophone?: boolean
  isolateCallAudio?: boolean
}

interface AudioEngine {
  processStream(
    inputStream: MediaStream,
    enableSuppression: boolean,
    initialInputVolume: number,
    sensitivityMode: SensitivityMode,
    manualThresholdPercent: number,
    onAudioLevel?: (level: number, gateOpen: boolean, rawRms: number, dynamicThresholdPercent?: number) => void
  ): MediaStream | Promise<MediaStream>
  setInputVolume(percentage: number): void
  setSensitivity(mode: SensitivityMode, manualThresholdPercent: number): void
  setSuppressionEnabled(enabled: boolean): void
  setTestLoopback(enabled: boolean): void
  dispose(): void
}

function errShort(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 300)
  return String(err).slice(0, 300)
}
export class MediaManager {
  private static instance: MediaManager
  private classicEngine: NoiseSuppressor
  private softEngine: SoftDspProcessor
  private rnnoiseEngine: RnnoiseProcessor
  private activeEngine: AudioEngine | null = null
  private rawUserStream: MediaStream | null = null
  private rawScreenStream: MediaStream | null = null
  private screenAudioContext: AudioContext | null = null
  private screenGainNode: GainNode | null = null
  private screenDuckInterval: number | null = null
  private callAudioIsolator: CallAudioIsolator | null = null
  private currentProcessorMode: AudioProcessorMode = 'rnnoise'

  private isRecoveringScreenShare: boolean = false
  private isStoppingScreenShare: boolean = false
  private activeScreenConfig: ScreenShareConfig | null = null
  private processAudioCapture: ProcessAudioCapture | null = null
  private isDeviceWatcherInitialized: boolean = false
  private deviceChangeTimeout: ReturnType<typeof setTimeout> | null = null
  private currentTestAudio: { ctx?: AudioContext; el?: HTMLAudioElement; timeout?: any } | null = null
  private djProcessAudioCapture: ProcessAudioCapture | null = null
  private djAudioContext: AudioContext | null = null
  private djGainNode: GainNode | null = null
  private isDjStreaming: boolean = false
  private isDjStarting: boolean = false
  private djStartGeneration: number = 0
  private djPlayerClosedUnsubscribe: (() => void) | null = null

  private levelForwardLastSent: number = 0
  private levelForwardLastGate: boolean = false
  private static readonly LEVEL_FORWARD_INTERVAL_MS = 100

  private handleEngineLevel = (
    level: number,
    isGateOpen: boolean,
    _rawRms?: number,
    dynamicThresholdPercent?: number
  ) => {
    const now = performance.now()
    const gateChanged = isGateOpen !== this.levelForwardLastGate
    if (
      !gateChanged &&
      now - this.levelForwardLastSent < MediaManager.LEVEL_FORWARD_INTERVAL_MS
    ) {
      return
    }
    this.levelForwardLastSent = now
    this.levelForwardLastGate = isGateOpen
    useMediaStore.getState().setLocalAudioLevel(level, isGateOpen, dynamicThresholdPercent)
  }

  private constructor() {
    this.classicEngine = new NoiseSuppressor()
    this.softEngine = new SoftDspProcessor()
    this.rnnoiseEngine = new RnnoiseProcessor()
    this.rnnoiseEngine.setRuntimeFailureHandler((cause) => {
      void this.handleRnnoiseRuntimeFailure(cause)
    })
    this.initDeviceWatcher()
  }

  private rnnoiseRuntimeFailure: string | null = null

  private async handleRnnoiseRuntimeFailure(cause: string) {
    if (this.activeEngine !== this.rnnoiseEngine) return
    this.rnnoiseRuntimeFailure = cause
    await this.reprocessStream()
    this.rnnoiseRuntimeFailure = null
  }

  public static getInstance(): MediaManager {
    if (!MediaManager.instance) {
      MediaManager.instance = new MediaManager()
    }
    return MediaManager.instance
  }

  public initDeviceWatcher() {
    if (this.isDeviceWatcherInitialized) return
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.mediaDevices) return
    this.isDeviceWatcherInitialized = true
    try {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        this.handleDeviceChangeDebounced()
      })
    } catch {}
  }

  private handleDeviceChangeDebounced() {
    if (this.deviceChangeTimeout) {
      clearTimeout(this.deviceChangeTimeout)
    }
    this.deviceChangeTimeout = setTimeout(() => {
      this.deviceChangeTimeout = null
      void this.handleDeviceChange()
    }, 400)
  }

  public async handleDeviceChange() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = devices.filter((d) => d.kind === 'audioinput')
      const audioOutputs = devices.filter((d) => d.kind === 'audiooutput')
      const videoInputs = devices.filter((d) => d.kind === 'videoinput')

      diagLog('media', 'devicechange-detected', {
        audioInputs: audioInputs.map((d) => ({ id: shortId(d.deviceId), label: d.label })),
        audioOutputs: audioOutputs.map((d) => ({ id: shortId(d.deviceId), label: d.label })),
      })

      const state = useMediaStore.getState()

      let targetOutput = state.selectedAudioOutput || 'default'
      const outputExists = targetOutput === 'default' || audioOutputs.some((d) => d.deviceId === targetOutput)
      if (!outputExists) {
        targetOutput = 'default'
        state.setSelectedAudioOutput('default')
      }
      await this.changeAudioOutput(targetOutput)

      let targetInput = state.selectedAudioInput || 'default'
      const inputExists = targetInput === 'default' || audioInputs.some((d) => d.deviceId === targetInput)
      if (!inputExists) {
        targetInput = 'default'
        state.setSelectedAudioInput('default')
      }

      let targetVideo = state.selectedVideoInput || 'default'
      const videoExists = targetVideo === 'default' || videoInputs.some((d) => d.deviceId === targetVideo)
      if (!videoExists) {
        state.setSelectedVideoInput('default')
      }

      if (this.rawUserStream) {
        const currentTrack = this.rawUserStream.getAudioTracks()[0]
        const isEnded = !currentTrack || currentTrack.readyState === 'ended'

        if (targetInput === 'default' || isEnded || !inputExists) {
          diagLog('media', 'devicechange-reacquiring-input', {
            targetInput,
            isEnded,
            inputExists,
          })
          await this.changeAudioInput(targetInput)
        }
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lira:devices-changed'))
      }
    } catch (err) {
      console.warn('Error handling device change:', err)
      diagLog('media', 'devicechange-error', { error: errShort(err) })
    }
  }

  private selectEngine(): AudioEngine {
    const state = useMediaStore.getState()
    const manual = state.hasUserChosenProcessorMode
    const cal = state.micCalibrations[state.selectedAudioInput]
    const mode: AudioProcessorMode = manual
      ? state.audioProcessorMode
      : cal?.recommendedMode ?? state.audioProcessorMode ?? 'rnnoise'
    this.currentProcessorMode = mode
    if (mode === 'rnnoise') return this.rnnoiseEngine
    if (mode === 'soft') return this.softEngine
    return this.classicEngine
  }

    public async calibrateMicrophone(
      inputStream: MediaStream,
      durationMs: number = 5000,
      onProgress?: (elapsedMs: number, totalMs: number, currentDb: number, liveWaveform?: number[]) => void
    ): Promise<{
      noiseFloorDb: number
      peakRmsDb: number
      snrDb: number
      recommendedMode: AudioProcessorMode
      recommendedSensitivity: number
      rawAudioUrl?: string
      processedAudioUrl?: string
      rawWaveform?: number[]
      processedWaveform?: number[]
      processedSamples?: {
        classic: ProcessedSampleInfo
        soft: ProcessedSampleInfo
        rnnoise: ProcessedSampleInfo
      }
    }> {
      const state = useMediaStore.getState()
      const deviceId = state.selectedAudioInput
      state.setIsCalibrating(true)
      try {
        const calibrator = new MicCalibrator()
        const result = await calibrator.calibrate(inputStream, durationMs, (p) => {
          onProgress?.(p.elapsedMs, p.totalMs, p.currentRmsDb, p.liveWaveform)
        })
        const cal = {
          noiseFloorDb: result.noiseFloorDb,
          peakRmsDb: result.peakRmsDb,
          snrDb: result.snrDb,
          recommendedMode: result.recommendedMode,
          recommendedSensitivity: result.recommendedSensitivity,
          calibratedAt: Date.now(),
        }
        state.setMicCalibration(deviceId, cal)
        state.setManualSensitivityThreshold(result.recommendedSensitivity)
        if (state.sensitivityMode === 'manual') {
          this.updateSensitivity('manual', result.recommendedSensitivity)
        }

        return {
          noiseFloorDb: cal.noiseFloorDb,
          peakRmsDb: cal.peakRmsDb,
          snrDb: cal.snrDb,
          recommendedMode: cal.recommendedMode,
          recommendedSensitivity: cal.recommendedSensitivity,
          rawAudioUrl: result.rawAudioUrl,
          processedAudioUrl: result.processedAudioUrl,
          rawWaveform: result.rawWaveform,
          processedWaveform: result.processedWaveform,
          processedSamples: result.processedSamples,
        }
      } finally {
        useMediaStore.getState().setIsCalibrating(false)
      }
    }

  private runQueue: Promise<void> = Promise.resolve()

  private async runEngine(
    inputStream: MediaStream,
    levelCallback: (level: number, isGateOpen: boolean, rawRms?: number, dynamicThresholdPercent?: number) => void
  ): Promise<MediaStream> {
    const prev = this.runQueue
    let release!: () => void
    this.runQueue = new Promise<void>((r) => (release = r))
    await prev
    try {
      return await this.doRunEngine(inputStream, levelCallback)
    } finally {
      release()
    }
  }

  private async doRunEngine(
    inputStream: MediaStream,
    levelCallback: (level: number, isGateOpen: boolean, rawRms?: number, dynamicThresholdPercent?: number) => void
  ): Promise<MediaStream> {
    const state = useMediaStore.getState()
    let nextEngine = this.selectEngine()
    const runtimeFailure = this.rnnoiseRuntimeFailure
    this.rnnoiseRuntimeFailure = null
    if (runtimeFailure && nextEngine === this.rnnoiseEngine) {
      console.warn('[MediaManager] RNNoise stopped processing, falling back to soft DSP')
      nextEngine = this.softEngine
    }

    if (this.activeEngine && this.activeEngine !== nextEngine) {
      try {
        this.activeEngine.dispose()
      } catch (err) {
        console.warn('[MediaManager] failed to dispose previous engine:', err)
      }
    }
    this.activeEngine = nextEngine
    this.levelForwardLastSent = 0
    if (nextEngine !== this.rnnoiseEngine) {
      useMediaStore
        .getState()
        .setRnnoiseStatus(runtimeFailure ? 'fallback' : 'idle', runtimeFailure)
    }

    const result = nextEngine.processStream(
      inputStream,
      state.isNoiseSuppressionEnabled,
      state.inputVolume,
      state.sensitivityMode,
      state.manualSensitivityThreshold,
      (level, gateOpen, rawRms, dynamicThresholdPercent) =>
        levelCallback(level, gateOpen, rawRms, dynamicThresholdPercent)
    )

    const processed = result instanceof Promise ? await result : result

    if (
      processed === inputStream &&
      this.currentProcessorMode === 'rnnoise' &&
      useMediaStore.getState().rnnoiseStatus === 'error'
    ) {
      console.warn(
        '[MediaManager] RNNoise failed to initialise, falling back to soft DSP'
      )
      const st = useMediaStore.getState()
      const cause = st.rnnoiseError
        ? st.rnnoiseError
        : 'init failed — using Soft DSP'
      st.setRnnoiseStatus('fallback', cause)
      try {
        this.activeEngine.dispose()
      } catch {}
      this.activeEngine = this.softEngine
      return this.softEngine.processStream(
        inputStream,
        state.isNoiseSuppressionEnabled,
        state.inputVolume,
        state.sensitivityMode,
        state.manualSensitivityThreshold,
        (level, gateOpen, rawRms, dynamicThresholdPercent) =>
          levelCallback(level, gateOpen, rawRms, dynamicThresholdPercent)
      )
    }

    if (useMediaStore.getState().isTestingMic) {
      if (this.activeEngine) {
        this.activeEngine.setTestLoopback(true)
      }
    }

    return processed
  }

  public createDummyVideoTrack(): MediaStreamTrack {
    try {
      if (typeof document === 'undefined') {
        return null as any
      }
      const canvas = document.createElement('canvas')
      canvas.width = 16
      canvas.height = 16
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#0c0e14'
        ctx.fillRect(0, 0, 16, 16)
      }
      const stream = canvas.captureStream(5)
      const track = stream.getVideoTracks()[0]
      if (track) {
        track.enabled = false
        ;(track as any).__isDummy = true
        return track
      }
    } catch (e) {
      console.warn('[MediaManager] Failed to create canvas video track:', e)
    }
    return null as any
  }

  public async startMedia(video: boolean = true, audio: boolean = true): Promise<MediaStream | null> {
    const state = useMediaStore.getState()

    const audioConstraints: any = audio
      ? {
          deviceId:
            state.selectedAudioInput && state.selectedAudioInput !== 'default'
              ? { exact: state.selectedAudioInput }
              : undefined,
          echoCancellation: state.echoCancellation,
          autoGainControl: state.autoGainControl,
          noiseSuppression: false,
        }
      : false

    const safeGetUserMedia = (constraints: MediaStreamConstraints, timeoutMs: number = 3500): Promise<MediaStream> => {
      return Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        new Promise<MediaStream>((_, reject) =>
          setTimeout(() => reject(new Error('getUserMedia timed out')), timeoutMs)
        ),
      ])
    }

    let stream: MediaStream | null = null

    const videoConstraints: any = video
      ? {
          ...(state.selectedVideoInput && state.selectedVideoInput !== 'default'
            ? { deviceId: { exact: state.selectedVideoInput } }
            : {}),
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
        }
      : false

    try {
      stream = await safeGetUserMedia({
        video: videoConstraints,
        audio: audioConstraints,
      }, 4000)
    } catch (err) {
      console.warn('Could not access camera/mic with selected constraints, trying separated fallbacks:', err)
      diagLog('media', 'startMedia.av-failed', { error: errShort(err) })
      try {
        stream = await safeGetUserMedia({
          video: false,
          audio: audioConstraints,
        }, 2500)
      } catch (micErr) {
        console.warn('Could not access mic with constraints, trying generic audio:', micErr)
        diagLog('media', 'startMedia.mic-constrained-failed', { error: errShort(micErr) })
        try {
          stream = await safeGetUserMedia({
            video: false,
            audio: audio,
          }, 2000)
        } catch (totalErr) {
          console.error('Failed to access physical microphone:', totalErr)
          diagLog('media', 'startMedia.mic-failed', { error: errShort(totalErr) })
        }
      }

      if (!stream) {
        stream = new MediaStream()
      }

      if (video && stream.getVideoTracks().length === 0) {
        try {
          const camOnlyStream = await safeGetUserMedia({
            video: videoConstraints,
          }, 3000)
          const camTrack = camOnlyStream.getVideoTracks()[0]
          if (camTrack) {
            ;(camTrack as any).__isDummy = false
            stream.addTrack(camTrack)
          }
        } catch (camErr) {
          console.warn('Could not access camera individually:', camErr)
          diagLog('media', 'startMedia.camonly-failed', { error: errShort(camErr) })
        }
      }
    }

    if (!stream) {
      stream = new MediaStream()
    }

    if (stream.getVideoTracks().length === 0) {
      const dummyVideo = this.createDummyVideoTrack()
      if (dummyVideo) {
        stream.addTrack(dummyVideo)
      }
    }

    this.rawUserStream = stream
    diagLog('media', 'startMedia.capture', {
      videoRequested: video,
      audioRequested: audio,
      selectedAudioInput: state.selectedAudioInput,
      tracks: summarizeStream(stream),
      dummyVideo: stream.getVideoTracks().some((t) => (t as any).__isDummy === true),
    })

    const processedStream = await this.runEngine(
      this.rawUserStream,
      this.handleEngineLevel
    )

    if (processedStream.getVideoTracks().length === 0 && this.rawUserStream.getVideoTracks().length > 0) {
      processedStream.addTrack(this.rawUserStream.getVideoTracks()[0])
    }

    const isMuted = useMediaStore.getState().isMuted
    const isCameraOff = useMediaStore.getState().isCameraOff
    processedStream.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted
    })
    processedStream.getVideoTracks().forEach((track) => {
      track.enabled = !isCameraOff
    })

    useMediaStore.getState().setLocalStream(processedStream)
    diagLog('media', 'startMedia.ready', {
      engine: this.currentProcessorMode,
      tracks: summarizeStream(processedStream),
      isMuted,
      isCameraOff,
    })

    const newAudioTrack = processedStream.getAudioTracks()[0]
    if (newAudioTrack) {
      try {
        PeerManager.getInstance().replaceAudioTrack(newAudioTrack)
      } catch (e) {}
    }

    try {
      PeerManager.getInstance().recheckZoneCalls()
    } catch (e) {}

    this.initDeviceWatcher()

    return processedStream
  }

  private async acquireCameraTrack(deviceId?: string): Promise<MediaStreamTrack | null> {
    const state = useMediaStore.getState()
    const targetId = deviceId || (state.selectedVideoInput && state.selectedVideoInput !== 'default' ? state.selectedVideoInput : undefined)

    const safeGetMedia = (constraints: MediaStreamConstraints, timeoutMs: number = 4000): Promise<MediaStream> => {
      return Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        new Promise<MediaStream>((_, reject) =>
          setTimeout(() => reject(new Error('Tempo limite ao acessar a webcam')), timeoutMs)
        ),
      ])
    }

    if (targetId) {
      try {
        const stream = await safeGetMedia({
          video: {
            deviceId: { exact: targetId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
        })
        const track = stream?.getVideoTracks?.()?.[0]
        if (track) {
          ;(track as any).__isDummy = false
          return track
        }
      } catch (err) {
        console.warn(`[MediaManager] Failed to acquire camera with exact deviceId (${targetId}):`, err)
      }
    }

    try {
      const stream = await safeGetMedia({
        video: targetId
          ? { deviceId: { ideal: targetId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      })
      const track = stream?.getVideoTracks?.()?.[0]
      if (track) {
        ;(track as any).__isDummy = false
        return track
      }
    } catch (err) {
      console.warn('[MediaManager] Failed to acquire camera with ideal constraints:', err)
      try {
        const stream = await safeGetMedia({ video: true }, 2500)
        const track = stream?.getVideoTracks?.()?.[0]
        if (track) {
          ;(track as any).__isDummy = false
          return track
        }
      } catch (lastErr) {
        console.warn('[MediaManager] All camera acquire attempts failed:', lastErr)
        diagLog('media', 'camera.acquire-failed', { error: errShort(lastErr) })
      }
    }

    return null
  }

  public async toggleCamera(): Promise<boolean> {
    const nextCameraOff = !useMediaStore.getState().isCameraOff
    await this.syncCameraState(nextCameraOff)
    return !nextCameraOff
  }

  public async syncCameraState(isCameraOff: boolean): Promise<void> {
    useMediaStore.setState({ isCameraOff })

    if (!isCameraOff) {
      let activeCamTrack = this.rawUserStream?.getVideoTracks().find((t) => t.readyState === 'live' && !(t as any).__isDummy) || null

      if (!activeCamTrack) {
        activeCamTrack = await this.acquireCameraTrack()
      }

      if (!activeCamTrack) {
        console.warn('[MediaManager] Could not acquire camera, reverting to camera off')
        useMediaStore.setState({ isCameraOff: true })
        try {
          useGameStore.getState().setLocalPlayer({ isCameraOff: true })
          PeerManager.getInstance().sendPlayerUpdate({ isCameraOff: true })
        } catch {}
        return
      }

      activeCamTrack.enabled = true
      ;(activeCamTrack as any).__isDummy = false

      if (this.rawUserStream) {
        this.rawUserStream.getVideoTracks().forEach((t) => {
          if (t !== activeCamTrack) {
            t.stop()
            this.rawUserStream?.removeTrack(t)
          }
        })
        if (!this.rawUserStream.getVideoTracks().includes(activeCamTrack)) {
          this.rawUserStream.addTrack(activeCamTrack)
        }
      }

      const currentLocal = useMediaStore.getState().localStream
      const audioTracks = currentLocal ? currentLocal.getAudioTracks() : (this.rawUserStream ? this.rawUserStream.getAudioTracks() : [])
      if (currentLocal) {
        currentLocal.getVideoTracks().forEach((t) => {
          if (t !== activeCamTrack) {
            t.stop()
          }
        })
      }
      const newLocalStream = new MediaStream([...audioTracks, activeCamTrack])
      useMediaStore.getState().setLocalStream(newLocalStream)
      useMediaStore.setState({ isCameraOff: false })

      diagLog('media', 'camera.on', {
        physical: true,
        tracks: summarizeStream(newLocalStream),
      })

      try {
        PeerManager.getInstance().logSenderSnapshot('camera-on')
      } catch {}

      if (!useMediaStore.getState().isScreenSharing) {
        try {
          PeerManager.getInstance().replaceVideoTrack(activeCamTrack, false)
        } catch {}
      }
    } else {
      diagLog('media', 'camera.off')

      if (this.rawUserStream) {
        this.rawUserStream.getVideoTracks().forEach((t) => {
          if (!(t as any).__isDummy) {
            t.stop()
            this.rawUserStream?.removeTrack(t)
          }
        })
      }
      const currentLocal = useMediaStore.getState().localStream
      if (currentLocal) {
        currentLocal.getVideoTracks().forEach((t) => {
          if (!(t as any).__isDummy) {
            t.stop()
          }
        })
      }

      let dummyTrack = this.rawUserStream?.getVideoTracks().find((t) => (t as any).__isDummy) || null
      if (!dummyTrack) {
        dummyTrack = this.createDummyVideoTrack()
        if (dummyTrack && this.rawUserStream) {
          this.rawUserStream.addTrack(dummyTrack)
        }
      }
      if (dummyTrack) {
        dummyTrack.enabled = false
      }

      if (typeof MediaStream !== 'undefined') {
        const audioTracks = currentLocal ? currentLocal.getAudioTracks() : (this.rawUserStream ? this.rawUserStream.getAudioTracks() : [])
        const newLocalStream = new MediaStream([...audioTracks, ...(dummyTrack ? [dummyTrack] : [])])
        useMediaStore.getState().setLocalStream(newLocalStream)
      }
      useMediaStore.setState({ isCameraOff: true })

      if (!useMediaStore.getState().isScreenSharing && dummyTrack) {
        try {
          PeerManager.getInstance().replaceVideoTrack(dummyTrack, false)
        } catch {}
      }
    }

    try {
      useGameStore.getState().setLocalPlayer({ isCameraOff })
    } catch {}
    try {
      PeerManager.getInstance().sendPlayerUpdate({ isCameraOff })
    } catch {}
  }

  public async changeVideoInput(deviceId: string): Promise<boolean> {
    try {
      useMediaStore.setState({ selectedVideoInput: deviceId })
      const isCameraOff = useMediaStore.getState().isCameraOff

      if (!isCameraOff) {
        const newCamTrack = await this.acquireCameraTrack(deviceId)
        if (!newCamTrack) return false

        newCamTrack.enabled = true
        ;(newCamTrack as any).__isDummy = false

        if (this.rawUserStream) {
          this.rawUserStream.getVideoTracks().forEach((t) => {
            t.stop()
            this.rawUserStream?.removeTrack(t)
          })
          this.rawUserStream.addTrack(newCamTrack)
        }

        const currentLocal = useMediaStore.getState().localStream
        if (currentLocal) {
          currentLocal.getVideoTracks().forEach((t) => {
            if (t !== newCamTrack) {
              t.stop()
            }
          })
        }

        const audioTracks = currentLocal ? currentLocal.getAudioTracks() : (this.rawUserStream ? this.rawUserStream.getAudioTracks() : [])
        const newLocalStream = new MediaStream([...audioTracks, newCamTrack])
        useMediaStore.getState().setLocalStream(newLocalStream)

        if (!useMediaStore.getState().isScreenSharing) {
          PeerManager.getInstance().replaceVideoTrack(newCamTrack, false)
        }
      }
      return true
    } catch (err) {
      console.warn('[MediaManager] Error changing video input:', err)
      return false
    }
  }

  public toggleMute(): boolean {
    const nextMute = !useMediaStore.getState().isMuted
    this.syncMuteState(nextMute)
    return nextMute
  }

  public syncMuteState(isMuted: boolean, isMutedByAdmin?: boolean): void {
    diagLog('media', 'mute', { isMuted, isMutedByAdmin })
    try {
      PeerManager.getInstance().logSenderSnapshot(isMuted ? 'mute-on' : 'mute-off')
    } catch {}
    if (useMediaStore.getState().isMuted !== isMuted) {
      useMediaStore.getState().setMuted(isMuted)
    }
    const localStream = useMediaStore.getState().localStream
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted
      })
    }
    try {
      PeerManager.getInstance().syncSenderTracksMuteState(!isMuted)
    } catch {}

    if (!isMuted && this.activeEngine) {
      try {
        ;(this.activeEngine as any).resumeContext?.()
      } catch {}
    }
    const nextMutedByAdmin = isMutedByAdmin !== undefined ? isMutedByAdmin : false
    try {
      useGameStore.getState().setLocalPlayer({ isMuted, isMutedByAdmin: nextMutedByAdmin })
    } catch {}
    try {
      PeerManager.getInstance().sendPlayerUpdate({ isMuted, isMutedByAdmin: nextMutedByAdmin })
    } catch {}
  }

  public async changeAudioInput(deviceId: string): Promise<boolean> {
    try {
      useMediaStore.getState().setSelectedAudioInput(deviceId)
      const state = useMediaStore.getState()

      let newAudioStream: MediaStream | null = null
      const targetDevice = deviceId && deviceId !== 'default' ? deviceId : undefined
      try {
        newAudioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: targetDevice ? { exact: targetDevice } : undefined,
            echoCancellation: state.echoCancellation,
            autoGainControl: state.autoGainControl,
            noiseSuppression: false,
          },
        })
      } catch {
        if (targetDevice) {
          try {
            newAudioStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                deviceId: targetDevice,
                echoCancellation: state.echoCancellation,
                autoGainControl: state.autoGainControl,
                noiseSuppression: false,
              },
            })
          } catch {}
        }
      }

      if (!newAudioStream) {
        newAudioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: state.echoCancellation,
            autoGainControl: state.autoGainControl,
            noiseSuppression: false,
          },
        })
      }

      const newAudioTrack = newAudioStream.getAudioTracks()[0]
      if (!newAudioTrack) return false

      if (this.rawUserStream) {
        this.rawUserStream.getAudioTracks().forEach((t) => {
          t.stop()
          this.rawUserStream?.removeTrack(t)
        })
        this.rawUserStream.addTrack(newAudioTrack)
      } else {
        this.rawUserStream = newAudioStream
      }

      const processedStream = await this.runEngine(
        this.rawUserStream,
        this.handleEngineLevel
      )

      useMediaStore.getState().setLocalStream(processedStream)

      if (useMediaStore.getState().isTestingMic) {
        this.classicEngine.setTestLoopback(true)
        this.softEngine.setTestLoopback(true)
        this.rnnoiseEngine.setTestLoopback(true)
      }

      const isMuted = useMediaStore.getState().isMuted
      const processedAudioTrack = processedStream.getAudioTracks()[0]
      if (processedAudioTrack) {
        processedAudioTrack.enabled = !isMuted
        if (!useMediaStore.getState().isScreenSharing) {
          try {
            PeerManager.getInstance().replaceAudioTrack(processedAudioTrack)
          } catch {}
        }
      }

      try {
        PeerManager.getInstance().recheckZoneCalls()
      } catch {}

      return true
    } catch (err) {
      console.warn('Error changing audio input:', err)
      return false
    }
  }

  public async changeAudioOutput(deviceId: string): Promise<boolean> {
    try {
      this.stopAudioTestBeep()
      const state = useMediaStore.getState()
      if (state.selectedAudioOutput !== deviceId) {
        state.setSelectedAudioOutput(deviceId)
      }
      const sink = deviceId === 'default' || !deviceId ? '' : deviceId
      const audioElements = document.querySelectorAll('video, audio')
      audioElements.forEach(async (el: any) => {
        if (typeof el.setSinkId === 'function') {
          try {
            await el.setSinkId(sink)
          } catch (e) {
            console.warn('Failed to set sinkId on element:', e)
          }
        }
      })
      if (typeof (this.classicEngine as any).updateAudioOutput === 'function') {
        ;(this.classicEngine as any).updateAudioOutput(deviceId)
      }
      if (typeof (this.softEngine as any).updateAudioOutput === 'function') {
        ;(this.softEngine as any).updateAudioOutput(deviceId)
      }
      if (typeof (this.rnnoiseEngine as any).updateAudioOutput === 'function') {
        ;(this.rnnoiseEngine as any).updateAudioOutput(deviceId)
      }
      return true
    } catch (err) {
      console.warn('Error changing audio output:', err)
      return false
    }
  }

  public static resolveOptimalScreenQuality(
    requestedRes: 'auto' | '480p' | '720p' | '1080p' = 'auto',
    requestedFps: 'auto' | 30 | 60 = 'auto'
  ): { resolution: '480p' | '720p' | '1080p'; fps: 30 | 60; targetBitrate: number } {
    const state = useGameStore.getState()
    const localZone = state.localPlayer.currentZoneId
    const peersInZone = Object.values(state.remotePlayers).filter(
      (p) => p.currentZoneId === localZone
    ).length
    const activeScreensInZone = Object.values(state.remotePlayers).filter(
      (p) => p.currentZoneId === localZone && p.isScreenSharing
    ).length
    const ping = state.localPlayer.ping || 20

    const navConn = typeof navigator !== 'undefined' && (navigator as any).connection
    const effectiveType = navConn?.effectiveType
    const isConstrained = effectiveType === '3g' || effectiveType === '2g' || ping > 180

    let chosenRes: '480p' | '720p' | '1080p' = '1080p'
    let chosenFps: 30 | 60 = 60

    if (requestedRes === 'auto') {
      if (isConstrained || peersInZone >= 8) {
        chosenRes = '480p'
      } else if (activeScreensInZone >= 2) {
        chosenRes = '720p'
      } else if (peersInZone >= 4 || activeScreensInZone >= 1 || ping > 100) {
        chosenRes = '720p'
      } else {
        chosenRes = '1080p'
      }
    } else {
      chosenRes = requestedRes
    }

    if (requestedFps === 'auto') {
      if (isConstrained || peersInZone >= 6 || activeScreensInZone >= 2) {
        chosenFps = 30
      } else {
        chosenFps = chosenRes === '480p' ? 30 : 60
      }
    } else {
      chosenFps = requestedFps
    }

    let targetBitrate = 3_500_000
    if (chosenRes === '1080p') {
      targetBitrate = chosenFps === 60 ? 5_500_000 : 3_500_000
    } else if (chosenRes === '720p') {
      targetBitrate = chosenFps === 60 ? 3_000_000 : 2_000_000
    } else if (chosenRes === '480p') {
      targetBitrate = chosenFps === 60 ? 1_500_000 : 1_000_000
    }

    if (activeScreensInZone >= 2) {
      targetBitrate = Math.min(targetBitrate, 2_000_000)
    } else if (activeScreensInZone >= 1) {
      targetBitrate = Math.min(targetBitrate, 3_000_000)
    } else if (peersInZone >= 6) {
      targetBitrate = Math.min(targetBitrate, 2_500_000)
    }

    return { resolution: chosenRes, fps: chosenFps, targetBitrate }
  }

  public async startScreenShare(config: ScreenShareConfig = {}): Promise<MediaStream | null> {
    if (this.isDjStreaming || this.isDjStarting) {
      console.warn('[MediaManager] Pare o DJ antes de compartilhar áudio da tela.')
      return null
    }
    try {
      this.isStoppingScreenShare = false
      this.isRecoveringScreenShare = false
      this.activeScreenConfig = { ...config }
      const {
        sourceId,
        sourceName,
        audioSourceId,
        captureMethod = 'auto',
        resolution = 'auto',
        fps = 'auto',
      } = config
      const includeAudio = true

      if (sourceName) {
        useMediaStore.getState().setScreenShareTargetTitle(sourceName)
      }

      const { resolution: effectiveResolution, fps: effectiveFps, targetBitrate } =
        MediaManager.resolveOptimalScreenQuality(resolution, fps)

      PeerManager.getInstance().primeScreenShare(targetBitrate, effectiveFps)

      let width = 1920
      let height = 1080
      if (effectiveResolution === '480p') {
        width = 854
        height = 480
      } else if (effectiveResolution === '720p') {
        width = 1280
        height = 720
      } else if (effectiveResolution === '1080p') {
        width = 1920
        height = 1080
      }

      let screenStream: MediaStream

      const electronAPI = (window as any).electronAPI
      const isElectronCapture = Boolean(electronAPI?.setScreenSource)
      diagLog('screenshare-audio', 'capture-request', {
        sourceId: sourceId || null,
        audioSourceId: audioSourceId || null,
        sourceName: sourceName || null,
        isElectron: isElectronCapture,
        includeAudio,
        resolution,
        fps,
        captureMethod,
      })
      const displayAudioConstraint = includeAudio && !isElectronCapture
        ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          }
        : false
      const displayMediaOptions = {
        video: {
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: effectiveFps, max: 60 },
        },
        audio: displayAudioConstraint,
        ...(isElectronCapture
          ? {}
          : {
              systemAudio: 'exclude' as const,
              windowAudio: 'window' as const,
              selfBrowserSurface: 'exclude' as const,
            }),
      }

      if (sourceId && electronAPI?.setScreenSource) {
        try {
          if (sourceName) {
            await electronAPI.setScreenSource(sourceId, includeAudio, captureMethod, sourceName)
          } else {
            await electronAPI.setScreenSource(sourceId, includeAudio, captureMethod)
          }
        } catch (ipcErr) {
          console.warn('[MediaManager] set-screen-source IPC failed, capturing primary screen:', ipcErr)
        }
        try {
          screenStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions)
        } catch {
          screenStream = await navigator.mediaDevices.getDisplayMedia({
            ...displayMediaOptions,
            audio: false,
          })
        }
      } else {
        try {
          screenStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions)
        } catch {
          screenStream = await navigator.mediaDevices.getDisplayMedia({
            ...displayMediaOptions,
            audio: false,
          })
        }
      }

      this.rawScreenStream = screenStream
      let applicationAudioTrack = screenStream.getAudioTracks()[0] || null
      const localStream = useMediaStore.getState().localStream
      diagLog('screenshare-audio', 'display-capture-ready', {
        sourceId: sourceId || null,
        isElectron: isElectronCapture,
        tracks: summarizeStream(screenStream),
        microphoneTracks: localStream?.getAudioTracks().length || 0,
      })

      if (this.callAudioIsolator) {
        this.callAudioIsolator.dispose()
        this.callAudioIsolator = null
      }
      this.disposeScreenShareAudioPipeline()
      this.processAudioCapture?.stop()
      this.processAudioCapture = null

      const processAudioSourceId = audioSourceId || sourceId
      const nativeAudioSupported = ProcessAudioCapture.isSupported()
      diagLog('screenshare-audio', 'native-capability', {
        isElectron: isElectronCapture,
        sourceId: processAudioSourceId || null,
        supported: nativeAudioSupported,
      })
      if (isElectronCapture && processAudioSourceId && nativeAudioSupported) {
        try {
          this.processAudioCapture = new ProcessAudioCapture()
          applicationAudioTrack = await this.processAudioCapture.start(processAudioSourceId)
          diagLog('screenshare', 'process-audio-started', { sourceId: processAudioSourceId })
        } catch (audioErr) {
          this.processAudioCapture?.stop()
          this.processAudioCapture = null
          console.warn('Process-scoped audio capture unavailable:', audioErr)
          diagLog('screenshare', 'process-audio-unavailable', { sourceId: processAudioSourceId, error: errShort(audioErr) })
        }
      } else if (isElectronCapture) {
        diagLog('screenshare-audio', 'native-capture-skipped', {
          sourceId: processAudioSourceId || null,
          reason: processAudioSourceId ? 'api-unavailable' : 'source-id-missing',
        })
      }

      if (applicationAudioTrack) {
        applicationAudioTrack.enabled = true
        try {
          const liveAudioTrack = await this.createLiveAudioTrack(applicationAudioTrack, localStream)
          ;(liveAudioTrack as any).__screenShareLiveAudio = true
          liveAudioTrack.enabled = true
          screenStream.addTrack(liveAudioTrack)
          useMediaStore.getState().setScreenShareAudioMode(
            localStream?.getAudioTracks().length ? 'app_and_mic' : 'app_only'
          )
          diagLog('screenshare', 'audio-track-sent', { sourceOnly: true, microphonePreserved: true })
          diagLog('screenshare-audio', 'live-track-created', {
            sourceId: processAudioSourceId || null,
            track: summarizeStream(screenStream),
            audioContextState: this.screenAudioContext?.state || null,
          })
          PeerManager.getInstance().replaceAudioTrack(liveAudioTrack)
        } catch (audioErr) {
          console.warn('Could not build the isolated live audio track:', audioErr)
          diagLog('screenshare', 'audio-track-failed', { error: errShort(audioErr) })
        }
      } else {
        diagLog('screenshare', 'audio-track-unavailable', {
          reason: isElectronCapture ? 'process-audio-unavailable' : 'no-source-audio-track',
          microphonePreserved: true,
        })
        diagLog('screenshare-audio', 'live-track-missing', {
          sourceId: processAudioSourceId || null,
          isElectron: isElectronCapture,
          microphonePreserved: true,
        })
      }

      useMediaStore.getState().setLocalScreenStream(screenStream)
      useMediaStore.getState().setScreenSharing(true)
      useGameStore.getState().setLocalPlayer({ isScreenSharing: true })
      diagLog('screenshare', 'start', {
        resolution, fps, includeAudio, sourceOnlyAudio: true,
        tracks: summarizeStream(screenStream),
      })

      const optimizationMode =
        config.optimizationMode ?? useMediaStore.getState().screenShareOptimizationMode ?? 'quality'

      const screenVideoTrack = screenStream.getVideoTracks()[0]
      if (screenVideoTrack) {
        screenVideoTrack.enabled = true
        if ('contentHint' in screenVideoTrack) {
          screenVideoTrack.contentHint = optimizationMode === 'quality' ? 'detail' : 'motion'
        }

        const degradationPref = optimizationMode === 'quality' ? 'maintain-resolution' : 'maintain-framerate'
        PeerManager.getInstance().replaceVideoTrack(screenVideoTrack, true, targetBitrate, effectiveFps)
        PeerManager.getInstance().updateScreenShareOptimizationMode(optimizationMode)
        diagLog('screenshare', 'video-track-sent', {
          bitrate: targetBitrate,
          optimizationMode,
          degradationPreference: degradationPref,
          track: summarizeStream({
            getAudioTracks: () => [],
            getVideoTracks: () => [screenVideoTrack],
          } as unknown as MediaStream),
        })
        try {
          PeerManager.getInstance().logSenderSnapshot('screenshare-start')
        } catch {}
        PeerManager.getInstance().sendPlayerUpdate({ isScreenSharing: true })

        screenVideoTrack.onended = () => {
          if (this.isStoppingScreenShare) {
            this.stopScreenShare()
            return
          }
          void this.handleUnexpectedScreenTrackEnded()
        }
      } else {
        PeerManager.getInstance().cancelScreenSharePrime()
      }

      return screenStream
    } catch (err) {
      console.warn('Screen share cancelled or failed:', err)
      diagLog('screenshare', 'cancelled-or-failed', { error: errShort(err) })
      if (!useMediaStore.getState().isScreenSharing) {
        try {
          PeerManager.getInstance().cancelScreenSharePrime()
        } catch {}
      }
      return null
    }
  }

  private async createLiveAudioTrack(sourceTrack: MediaStreamTrack, localStream: MediaStream | null): Promise<MediaStreamTrack> {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextClass) {
      diagLog('screenshare-audio', 'live-track-web-audio-unavailable', { sourceTrack: summarizeTrack(sourceTrack) })
      return sourceTrack
    }

    const audioContext = new AudioContextClass({ sampleRate: 48000 })
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume()
      } catch {}
    }

    const source = audioContext.createMediaStreamSource(new MediaStream([sourceTrack]))
    const applicationGain = audioContext.createGain()
    const destination = audioContext.createMediaStreamDestination()
    const rawVolume = useMediaStore.getState().screenShareAudioVolume
    const volume = (rawVolume !== undefined ? rawVolume : 100) / 100

    applicationGain.gain.setValueAtTime(volume, audioContext.currentTime)
    source.connect(applicationGain)
    applicationGain.connect(destination)

    if (localStream?.getAudioTracks().length) {
      const microphone = audioContext.createMediaStreamSource(localStream)
      microphone.connect(destination)
    }

    diagLog('screenshare-audio', 'live-track-graph', {
      contextState: audioContext.state,
      sampleRate: audioContext.sampleRate,
      applicationVolume: volume,
      applicationTrack: summarizeTrack(sourceTrack),
      microphoneTracks: localStream?.getAudioTracks().length || 0,
      destinationTracks: destination.stream.getAudioTracks().length,
    })

    this.screenAudioContext = audioContext
    this.screenGainNode = applicationGain

    const track = destination.stream.getAudioTracks()[0] || sourceTrack
    track.enabled = true
    return track
  }

  private disposeScreenShareAudioPipeline() {
    this.screenGainNode = null
    const audioContext = this.screenAudioContext
    this.screenAudioContext = null
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(() => {})
    }
  }

  public async startDjAudio(customSourceId?: string): Promise<{ ok: boolean; error?: string }> {
    if (this.isDjStreaming) return { ok: true }
    if (this.isDjStarting) return { ok: false, error: 'O DJ já está sendo preparado.' }
    this.isDjStarting = true
    const generation = this.djStartGeneration = (this.djStartGeneration || 0) + 1
    const checkCancelled = () => {
      if (generation !== this.djStartGeneration) throw new Error('Inicialização do DJ cancelada.')
    }
    try {
      if (this.isDjStreaming) {
        return { ok: true }
      }

      let targetSourceId = customSourceId
      const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null

      if (this.processAudioCapture) {
        return { ok: false, error: 'Pare o compartilhamento de áudio da tela antes de iniciar o DJ.' }
      }
      if (!targetSourceId) {
        if (!electronAPI?.openSpotifyPlayer || !electronAPI?.findSpotifySource) {
          return { ok: false, error: 'A captura do Spotify no navegador requer o aplicativo Lira para Windows.' }
        }
        const opened = await electronAPI.openSpotifyPlayer()
        checkCancelled()
        if (!opened?.ok) return { ok: false, error: opened?.error || 'Não foi possível abrir o Spotify no navegador.' }
        const source = await electronAPI.findSpotifySource()
        checkCancelled()
        if (!source?.isBrowserPlayer) {
          return { ok: false, error: 'A janela dedicada do Spotify no navegador não está disponível para captura.' }
        }
        targetSourceId = source.sourceId
      }
      if (!targetSourceId || !/^window:[1-9][0-9]*:\d+$/.test(targetSourceId)) {
        return { ok: false, error: 'O DJ deve capturar apenas a janela do player, sem áudio da tela ou da chamada.' }
      }
      if (!ProcessAudioCapture.isSupported()) {
        return {
          ok: false,
          error: 'Transmissão direta de áudio nativa indisponível neste ambiente.',
        }
      }

      this.djProcessAudioCapture = new ProcessAudioCapture()
      this.djPlayerClosedUnsubscribe = electronAPI?.onSpotifyPlayerClosed?.(() => {
        this.stopDjAudio().catch(() => {})
      }) || null
      const capturedTrack = await this.djProcessAudioCapture.start(targetSourceId)
      checkCancelled()
      capturedTrack.enabled = true

      const liveAudioTrack = await this.createDjLiveAudioTrack(capturedTrack)
      checkCancelled()
      liveAudioTrack.enabled = true
      const djStream = new MediaStream([liveAudioTrack])

      const djRes = await PeerManager.getInstance().startDjBot(djStream)
      checkCancelled()
      if (!djRes.ok) {
        throw new Error(djRes.error || 'Falha ao iniciar bot DJ na sala.')
      }

      this.isDjStreaming = true
      useSpotifyJamStore.getState().setIsDjModeActive(true)

      return { ok: true }
    } catch (err) {
      console.error('[MediaManager] Failed to start DJ audio:', err)
      await this.stopDjAudio()
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      this.isDjStarting = false
    }
  }

  public async stopDjAudio(): Promise<void> {
    this.djStartGeneration = (this.djStartGeneration || 0) + 1
    try {
      this.djPlayerClosedUnsubscribe?.()
      this.djPlayerClosedUnsubscribe = null
      this.isDjStreaming = false
      useSpotifyJamStore.getState().setIsDjModeActive(false)
      const ownerId = useGameStore.getState().localPlayer.id
      const jams = useSpotifyJamStore.getState()
      for (const [zoneId, dj] of Object.entries(jams.djStateByZone)) {
        if (dj?.djPeerId === ownerId) jams.setDjStateInZone(zoneId, null, true)
      }
      PeerManager.getInstance().stopDjBot()

      if (this.djProcessAudioCapture) {
        this.djProcessAudioCapture.stop()
        this.djProcessAudioCapture = null
      }

      if (this.djAudioContext && this.djAudioContext.state !== 'closed') {
        this.djAudioContext.close().catch(() => {})
        this.djAudioContext = null
      }
      this.djGainNode = null
    } catch (e) {
      console.warn('[MediaManager] Error stopping DJ audio:', e)
    }
  }

  public isDjAudioActive(): boolean {
    return this.isDjStreaming
  }

  public setDjVolume(percentage: number): void {
    if (this.djGainNode && this.djAudioContext) {
      const vol = Math.max(0, Math.min(100, percentage)) / 100
      this.djGainNode.gain.setValueAtTime(vol, this.djAudioContext.currentTime)
    }
  }

  private async createDjLiveAudioTrack(
    sourceTrack: MediaStreamTrack
  ): Promise<MediaStreamTrack> {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextClass) return sourceTrack

    const audioContext = new AudioContextClass({ sampleRate: 48000 })
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume()
      } catch {}
    }

    const musicSource = audioContext.createMediaStreamSource(new MediaStream([sourceTrack]))
    const musicGain = audioContext.createGain()
    const destination = audioContext.createMediaStreamDestination()

    const rawVol = useSpotifyJamStore.getState().volume
    musicGain.gain.setValueAtTime(rawVol / 100, audioContext.currentTime)
    musicSource.connect(musicGain)
    musicGain.connect(destination)

    this.djAudioContext = audioContext
    this.djGainNode = musicGain

    const track = destination.stream.getAudioTracks()[0] || sourceTrack
    track.enabled = true
    return track
  }

  public stopScreenShare() {
    this.isStoppingScreenShare = true
    this.activeScreenConfig = null
    this.isRecoveringScreenShare = false
    if (this.callAudioIsolator) {
      this.callAudioIsolator.dispose()
      this.callAudioIsolator = null
    }
    this.disposeScreenShareAudioPipeline()
    this.processAudioCapture?.stop()
    this.processAudioCapture = null
    useMediaStore.getState().setScreenShareTargetTitle(null)

    const streamsToClean: MediaStream[] = []
    const storeScreen = useMediaStore.getState().localScreenStream
    if (storeScreen) streamsToClean.push(storeScreen)
    if (this.rawScreenStream && this.rawScreenStream !== storeScreen) streamsToClean.push(this.rawScreenStream)
    this.rawScreenStream = null

    for (const stream of streamsToClean) {
      try {
        stream.getTracks().forEach((track) => {
          try {
            track.enabled = false
            track.onended = null
            track.stop()
          } catch {}
          try {
            stream.removeTrack(track)
          } catch {}
        })
      } catch {}
    }

    useMediaStore.getState().setLocalScreenStream(null)
    useMediaStore.getState().setScreenSharing(false)
    useGameStore.getState().setLocalPlayer({ isScreenSharing: false })

    const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null
    if (electronAPI?.stopScreenCapture) {
      electronAPI.stopScreenCapture().catch(() => {})
    } else if (electronAPI?.setScreenSource) {
      electronAPI.setScreenSource(null, false, 'auto', null).catch(() => {})
    }

    const localStream = useMediaStore.getState().localStream
    let camTrack = localStream?.getVideoTracks()[0] || null
    const micTrack = localStream?.getAudioTracks()[0] || null

    if (!camTrack) {
      camTrack = this.createDummyVideoTrack()
      if (localStream && camTrack) {
        localStream.addTrack(camTrack)
      }
    }

    if (camTrack && 'contentHint' in camTrack) {
      camTrack.contentHint = ''
    }

    PeerManager.getInstance().replaceVideoTrack(camTrack, false)
    if (micTrack) {
      PeerManager.getInstance().replaceAudioTrack(micTrack)
    }
    diagLog('screenshare', 'stop-restore', {
      cam: camTrack ? { enabled: camTrack.enabled, dummy: (camTrack as any).__isDummy === true } : null,
      mic: micTrack ? { enabled: micTrack.enabled } : null,
    })
    PeerManager.getInstance().sendPlayerUpdate({ isScreenSharing: false })
  }

  private async handleUnexpectedScreenTrackEnded(): Promise<void> {
    if (this.isStoppingScreenShare || this.isRecoveringScreenShare) return
    if (!useMediaStore.getState().isScreenSharing) return

    this.isRecoveringScreenShare = true
    diagLog('screenshare', 'track-ended-unexpected', {
      config: this.activeScreenConfig,
    })

    const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null
    const isElectron = Boolean(electronAPI?.setScreenSource)

    if (!isElectron) {
      this.isRecoveringScreenShare = false
      this.stopScreenShare()
      return
    }

    let recovered = false
    const config = this.activeScreenConfig ? { ...this.activeScreenConfig } : {}

    for (let attempt = 1; attempt <= 3; attempt++) {
      await new Promise((r) => setTimeout(r, attempt === 1 ? 600 : 1000))
      if (this.isStoppingScreenShare || !useMediaStore.getState().isScreenSharing) {
        this.isRecoveringScreenShare = false
        return
      }

      try {
        let targetSourceId = config.sourceId

        if (electronAPI.getSources) {
          try {
            const sources = (await electronAPI.getSources()) as Array<{ id: string; name: string }>
            if (sources && sources.length > 0) {
              const exact = targetSourceId ? sources.find((s) => s.id === targetSourceId) : null
              if (exact) {
                targetSourceId = exact.id
              } else if (config.sourceName) {
                const cleanWanted = config.sourceName.toLowerCase().trim()
                const byName = sources.find((s) => {
                  if (!s.id.startsWith('window:')) return false
                  const sName = s.name.toLowerCase().trim()
                  return sName.includes(cleanWanted) || cleanWanted.includes(sName)
                })
                if (byName) {
                  targetSourceId = byName.id
                } else {
                  const browserKeywords = ['chrome', 'firefox', 'edge', 'brave', 'opera', 'vivaldi']
                  const matched = browserKeywords.find((k) => cleanWanted.includes(k))
                  if (matched) {
                    const byApp = sources.find((s) => s.id.startsWith('window:') && s.name.toLowerCase().includes(matched))
                    if (byApp) targetSourceId = byApp.id
                  }
                }
              }
            }
          } catch {}
        }

        if (targetSourceId) {
          if (config.sourceName) {
            await electronAPI.setScreenSource(targetSourceId, true, config.captureMethod || 'auto', config.sourceName)
          } else {
            await electronAPI.setScreenSource(targetSourceId, true, config.captureMethod || 'auto')
          }
        }

        const { resolution: effectiveResolution, fps: effectiveFps, targetBitrate } =
          MediaManager.resolveOptimalScreenQuality(config.resolution, config.fps)

        let width = 1920
        let height = 1080
        if (effectiveResolution === '480p') {
          width = 854
          height = 480
        } else if (effectiveResolution === '720p') {
          width = 1280
          height = 720
        }

        const newStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: width },
            height: { ideal: height },
            frameRate: { ideal: effectiveFps, max: 60 },
          },
          audio: false,
        })

        const newVideoTrack = newStream.getVideoTracks()[0]
        if (newVideoTrack && newVideoTrack.readyState === 'live') {
          const currentScreenStream = useMediaStore.getState().localScreenStream
          if (currentScreenStream) {
            currentScreenStream.getVideoTracks().forEach((t) => {
              try {
                t.stop()
              } catch {}
              currentScreenStream.removeTrack(t)
            })
            currentScreenStream.addTrack(newVideoTrack)
          } else {
            useMediaStore.getState().setLocalScreenStream(newStream)
          }
          this.rawScreenStream = newStream

          const optimizationMode =
            config.optimizationMode ?? useMediaStore.getState().screenShareOptimizationMode ?? 'quality'
          if ('contentHint' in newVideoTrack) {
            newVideoTrack.contentHint = optimizationMode === 'quality' ? 'detail' : 'motion'
          }

          PeerManager.getInstance().replaceVideoTrack(newVideoTrack, true, targetBitrate, effectiveFps)

          newVideoTrack.onended = () => {
            if (this.isStoppingScreenShare) {
              this.stopScreenShare()
              return
            }
            void this.handleUnexpectedScreenTrackEnded()
          }

          diagLog('screenshare', 'recovered-successfully', {
            attempt,
            newTrack: summarizeStream(newStream),
          })
          recovered = true
          break
        }
      } catch (err) {
        diagLog('screenshare', 'recovery-attempt-failed', { attempt, error: errShort(err) })
      }
    }

    this.isRecoveringScreenShare = false
    if (!recovered && !this.isStoppingScreenShare) {
      diagLog('screenshare', 'recovery-exhausted-stopping')
      this.stopScreenShare()
    }
  }



  public updateScreenShareOptimizationMode(mode: 'quality' | 'smoothness') {
    const localScreenStream = useMediaStore.getState().localScreenStream
    const track = localScreenStream?.getVideoTracks()[0]
    if (track && 'contentHint' in track) {
      track.contentHint = mode === 'quality' ? 'detail' : 'motion'
    }
    PeerManager.getInstance().updateScreenShareOptimizationMode(mode)
    diagLog('screenshare', 'optimization-mode-updated', { mode })
  }

  public stopAllMedia() {
    this.stopScreenShare()
    if (this.rawUserStream) {
      try {
        this.rawUserStream.getTracks().forEach((t) => t.stop())
      } catch (e) {}
      this.rawUserStream = null
    }
    try {
      this.classicEngine.dispose()
      this.softEngine.dispose()
      this.rnnoiseEngine.dispose()
      this.activeEngine = null
    } catch (e) {}
  }

  public updateScreenShareAudioVolume(percent: number) {
    if (this.callAudioIsolator) {
      this.callAudioIsolator.updateVolume(percent)
    }
    if (this.screenGainNode && this.screenAudioContext) {
      const now = this.screenAudioContext.currentTime
      this.screenGainNode.gain.cancelScheduledValues(now)
      this.screenGainNode.gain.setTargetAtTime(percent / 100, now, 0.05)
    }
  }

  public setScreenShareIsolateCallAudio(enabled: boolean) {
    useMediaStore.getState().setScreenShareIsolateCallAudio(enabled)
    if (this.callAudioIsolator) {
      this.callAudioIsolator.setIsolateCallAudio(enabled)
    }
  }

  public updateInputVolume(vol: number) {
    this.classicEngine.setInputVolume(vol)
    this.softEngine.setInputVolume(vol)
    this.rnnoiseEngine.setInputVolume(vol)
  }

  public updateSensitivity(mode: SensitivityMode, thresholdPercent: number) {
    this.classicEngine.setSensitivity(mode, thresholdPercent)
    this.softEngine.setSensitivity(mode, thresholdPercent)
    this.rnnoiseEngine.setSensitivity(mode, thresholdPercent)
  }

  public updateNoiseSuppression(enabled: boolean) {
    this.classicEngine.setSuppressionEnabled(enabled)
    this.softEngine.setSuppressionEnabled(enabled)
    this.rnnoiseEngine.setSuppressionEnabled(enabled)
  }

  public updateAudioProcessorMode(_mode: AudioProcessorMode) {
  }

  public async reprocessStream(): Promise<boolean> {
    if (!this.rawUserStream) return false
    try {
      const processed = await this.runEngine(
        this.rawUserStream,
        this.handleEngineLevel
      )
      const isMuted = useMediaStore.getState().isMuted
      processed.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted
      })
      const existingVideo = useMediaStore.getState().localStream?.getVideoTracks() ?? []
      existingVideo.forEach((v) => processed.addTrack(v))

      useMediaStore.getState().setLocalStream(processed)
      const newAudioTrack = processed.getAudioTracks()[0]
      if (newAudioTrack) {
        PeerManager.getInstance().replaceAudioTrack(newAudioTrack)
      }
      return true
    } catch (err) {
      console.warn('[MediaManager] reprocessStream failed:', err)
      return false
    }
  }

  public async setTestMic(enabled: boolean): Promise<void> {
    useMediaStore.getState().setIsTestingMic(enabled)
    if (enabled) {
      const hasLiveAudio =
        this.rawUserStream &&
        this.rawUserStream.getAudioTracks().length > 0 &&
        this.rawUserStream.getAudioTracks()[0].readyState === 'live'

      if (!hasLiveAudio) {
        const state = useMediaStore.getState()
        await this.changeAudioInput(state.selectedAudioInput || 'default')
      }

      this.classicEngine.setTestLoopback(true)
      this.softEngine.setTestLoopback(true)
      this.rnnoiseEngine.setTestLoopback(true)
    } else {
      this.classicEngine.setTestLoopback(false)
      this.softEngine.setTestLoopback(false)
      this.rnnoiseEngine.setTestLoopback(false)
    }
  }

  public stopAudioTestBeep(): void {
    if (this.currentTestAudio) {
      if (this.currentTestAudio.timeout) {
        clearTimeout(this.currentTestAudio.timeout)
      }
      if (this.currentTestAudio.el) {
        try {
          this.currentTestAudio.el.pause()
          this.currentTestAudio.el.srcObject = null
        } catch {}
      }
      if (this.currentTestAudio.ctx) {
        try {
          this.currentTestAudio.ctx.close().catch(() => {})
        } catch {}
      }
      this.currentTestAudio = null
    }
  }

  public async playAudioTestBeep(targetDeviceId?: string): Promise<void> {
    this.stopAudioTestBeep()
    return new Promise<void>(async (resolve) => {
      let resolved = false
      const finish = () => {
        if (!resolved) {
          resolved = true
          this.stopAudioTestBeep()
          resolve()
        }
      }

      try {
        const state = useMediaStore.getState()
        const targetOutput = targetDeviceId ?? state.selectedAudioOutput ?? 'default'
        const sink = targetOutput === 'default' || !targetOutput ? '' : targetOutput
        const AudioContextClass =
          (typeof window !== 'undefined' && ((window as any).AudioContext || (window as any).webkitAudioContext)) ||
          (typeof globalThis !== 'undefined' && ((globalThis as any).AudioContext || (globalThis as any).webkitAudioContext)) ||
          null
        if (!AudioContextClass) {
          finish()
          return
        }

        let testCtx: AudioContext
        try {
          testCtx = new AudioContextClass(sink ? { sinkId: sink } : undefined)
        } catch {
          testCtx = new AudioContextClass()
        }

        if (testCtx.state === 'suspended') {
          try {
            await testCtx.resume()
          } catch {}
        }

        if (sink && typeof (testCtx as any).setSinkId === 'function') {
          try {
            await (testCtx as any).setSinkId(sink)
          } catch {}
        }

        const now = testCtx.currentTime
        const osc1 = testCtx.createOscillator()
        const osc2 = testCtx.createOscillator()
        const gain = testCtx.createGain()

        osc1.type = 'sine'
        osc1.frequency.setValueAtTime(587.33, now)
        osc1.frequency.setValueAtTime(880, now + 0.12)

        osc2.type = 'sine'
        osc2.frequency.setValueAtTime(440, now)
        osc2.frequency.setValueAtTime(659.25, now + 0.12)

        gain.gain.setValueAtTime(0.01, now)
        gain.gain.exponentialRampToValueAtTime(0.3, now + 0.04)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45)

        osc1.connect(gain)
        osc2.connect(gain)

        let testAudioEl: HTMLAudioElement | null = null
        let routedViaElement = false

        if (typeof (testCtx as any).createMediaStreamDestination === 'function' && typeof Audio !== 'undefined') {
          try {
            const dest = (testCtx as any).createMediaStreamDestination()
            gain.connect(dest)
            testAudioEl = new Audio()
            testAudioEl.srcObject = dest.stream
            if (typeof (testAudioEl as any).setSinkId === 'function') {
              await (testAudioEl as any).setSinkId(sink)
            }
            await testAudioEl.play()
            routedViaElement = true
          } catch {
            routedViaElement = false
            if (testAudioEl) {
              try {
                testAudioEl.srcObject = null
              } catch {}
              testAudioEl = null
            }
          }
        }

        if (!routedViaElement) {
          gain.connect(testCtx.destination)
        }

        const currentNow = testCtx.currentTime
        osc1.start(currentNow)
        osc2.start(currentNow)
        osc1.stop(currentNow + 0.5)
        osc2.stop(currentNow + 0.5)

        const timeoutId = setTimeout(() => {
          finish()
        }, 650)

        this.currentTestAudio = { ctx: testCtx, el: testAudioEl ?? undefined, timeout: timeoutId }
      } catch (e) {
        console.warn('Could not play test audio chime:', e)
        finish()
      }
    })
  }

  public stopAll() {
    this.stopScreenShare()
    if (this.rawUserStream) {
      this.rawUserStream.getTracks().forEach((t) => t.stop())
      this.rawUserStream = null
    }
    useMediaStore.getState().setLocalStream(null)
    this.classicEngine.dispose()
    this.softEngine.dispose()
    this.rnnoiseEngine.dispose()
  }
}
