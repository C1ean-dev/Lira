import { NoiseSuppressor } from './NoiseSuppressor'
import { SoftDspProcessor } from './SoftDspProcessor'
import { RnnoiseProcessor } from './RnnoiseProcessor'
import { MicCalibrator, ProcessedSampleInfo } from './MicCalibrator'
import { CallAudioIsolator } from './CallAudioIsolator'
import { ProcessAudioCapture } from './ProcessAudioCapture'
import { diagLog, summarizeStream, summarizeTrack } from '../utils/diagnosticLogger'
import { useMediaStore } from '../store/useMediaStore'
import { useGameStore } from '../store/useGameStore'
import { PeerManager } from '../p2p/PeerManager'
import { SensitivityMode, AudioProcessorMode } from '../types/audio'

export interface ScreenShareConfig {
  captureMethod?: 'auto' | 'wgc' | 'dxgi' | 'bitblt' | 'graphics-hook'
  sourceId?: string
  sourceName?: string
  /** Required when sharing a monitor: the window whose audio belongs in the live. */
  audioSourceId?: string
  /** Source-only capture is mandatory; this legacy flag is ignored. */
  includeAudio?: boolean
  resolution?: 'auto' | '480p' | '720p' | '1080p'
  fps?: 'auto' | 30 | 60
  /**
   * Kept for backwards compatibility. The microphone remains in the call via
   * its own input; this flag cannot enable system audio or other applications.
   */
  mixMicrophone?: boolean
  /**
   * When true (default), incoming call voices are filtered out of the screen share
   * audio so remote peers never hear their own voices echoing in the live stream.
   */
  isolateCallAudio?: boolean
}

/**
  * Common interface implemented by every audio cleanup engine so
  * MediaManager can swap between them without knowing the internals.
  */
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

/** Compact error for logs (name + message, no stack). */
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
  private screenAudioContext: AudioContext | null = null
  private screenGainNode: GainNode | null = null
  private screenDuckInterval: number | null = null
  private callAudioIsolator: CallAudioIsolator | null = null
  private currentProcessorMode: AudioProcessorMode = 'rnnoise'

  private processAudioCapture: ProcessAudioCapture | null = null

  // Throttle state for VU-meter forwarding. DSP engines invoke the level
  // callback every rAF (~60Hz); pushing every sample into zustand re-renders
  // all media subscribers 60×/s. Forward at ~10Hz, immediately on gate
  // open/close transitions (speaker aura stays responsive).
  private levelForwardLastSent: number = 0
  private levelForwardLastGate: boolean = false
  private static readonly LEVEL_FORWARD_INTERVAL_MS = 100

  /**
   * Shared level forwarder for all engines (startMedia / changeAudioInput /
   * reprocessStream). Throttled — see field comment above.
   */
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
  }

  public static getInstance(): MediaManager {
    if (!MediaManager.instance) {
      MediaManager.instance = new MediaManager()
    }
    return MediaManager.instance
  }

  /**
    * Map the user's processor-mode setting to the concrete engine instance.
    *
    * Two overrides are consulted:
    *   1. If `hasUserChosenProcessorMode` is true, the user's manual choice
    *      always wins.
    *   2. Otherwise we look for a stored calibration for the current input
    *      device and use its recommendedMode.
    *   3. If neither exists we fall back to 'rnnoise' (the default).
    */
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

  /**
    * Manually run a 5-second mic calibration against the user's raw input
    * stream and store the result. The recommendation is **not** applied
    * automatically — it is surfaced to the UI so the user can accept it
    * with a single click. The previous behaviour of auto-applying the
    * mode change made the "Aplicar" button a no-op and confused users
    * ("nothing changed when I clicked").
    *
    * Sensitivity *is* still applied automatically because it is per-device
    * and never visible to the user otherwise.
    */
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

  /**
    * Pipe an input MediaStream through the active engine and return the
    * processed stream. Handles both sync (classic/soft) and async
    * (RNNoise) engines, and falls back to the soft DSP if the user
    * picked RNNoise but the WASM module failed to load.
    */
  /**
   * Serializes engine (re)starts. Without this, two rapid swaps (e.g. double
   * retry clicks) run concurrently: both dispose/create contexts and the
   * loser overwrites the winner's status with a stale failure.
   */
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
    const nextEngine = this.selectEngine()

    // Tear down whatever engine was previously in use. Without this the
    // RNNoise worklet (or DSP analyser) keeps running in parallel and the
    // user hears the OLD engine after a mode swap.
    if (this.activeEngine && this.activeEngine !== nextEngine) {
      try {
        this.activeEngine.dispose()
      } catch (err) {
        console.warn('[MediaManager] failed to dispose previous engine:', err)
      }
    }
    this.activeEngine = nextEngine
    // Force the next level sample through immediately (fresh engine / mic).
    this.levelForwardLastSent = 0
    // Keep the RNNoise status badge truthful when another engine is active.
    if (nextEngine !== this.rnnoiseEngine) {
      useMediaStore.getState().setRnnoiseStatus('idle')
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

    if (processed === inputStream && this.currentProcessorMode === 'rnnoise') {
      console.warn(
        '[MediaManager] RNNoise failed to initialise, falling back to soft DSP'
      )
      // Preserve the underlying cause set by the processor (don't clobber
      // 'error' detail — it's the only pointer to the real failure).
      const st = useMediaStore.getState()
      const cause =
        st.rnnoiseStatus === 'error' && st.rnnoiseError
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
        (level, gateOpen) => levelCallback(level, gateOpen)
      )
    }

    return processed
  }

  /**
   * Generates a minimal 16x16 black canvas video track when no webcam is available or camera is disabled.
   * This ensures WebRTC always negotiates a video transceiver so screen sharing can immediately swap tracks.
   */
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

  /**
   * Start User Webcam & Microphone with selected constraints and device IDs
   * Always guarantees that localStream has both audio and video tracks (using dummy canvas if no camera)
   */
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
          noiseSuppression: false, // We use our own dynamic DSP / RNNoise
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

    // 1. Try with Camera + Mic
    try {
      stream = await safeGetUserMedia({
        video: videoConstraints,
        audio: audioConstraints,
      }, 4000)
    } catch (err) {
      console.warn('Could not access camera/mic with selected constraints, trying separated fallbacks:', err)
      diagLog('media', 'startMedia.av-failed', { error: errShort(err) })
      // 2. Fallback: try mic alone (constraints first, then generic)
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

      // 3. Fallback: try camera alone if requested so mic constraints don't kill the webcam
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

    // 4. Ensure there is ALWAYS a video track in the stream (using canvas dummy if no camera)
    // This is CRITICAL for WebRTC P2P mesh so the video transceiver is created from the start
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

    // Ensure video track is preserved in processedStream
    if (processedStream.getVideoTracks().length === 0 && this.rawUserStream.getVideoTracks().length > 0) {
      processedStream.addTrack(this.rawUserStream.getVideoTracks()[0])
    }

    // Apply initial mute and camera off state
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

    // The room-join path runs startMedia IN PARALLEL with the P2P handshake
    // (see LobbyModal) so mic-permission latency (or the 5s RNNoise WASM
    // init) doesn't block entering the room. PLAYER_JOIN messages that
    // arrived before this stream existed skipped their zone calls —
    // re-evaluate now that we can actually dial.
    try {
      PeerManager.getInstance().recheckZoneCalls()
    } catch (e) {}

    return processedStream
  }

  /**
   * Acquire a physical camera track with robust fallbacks (selected deviceId -> ideal -> generic).
   */
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

    // 1. Try target device with exact constraint if specified
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

    // 2. Try target device with ideal constraint or generic resolution
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
      // 3. Fallback: simple video: true
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

  /**
   * Toggle camera on/off. When turning on, dynamically acquires physical webcam via getUserMedia,
   * creates a new MediaStream to notify React consumers, updates peer senders, and broadcasts presence update.
   */
  public async toggleCamera(): Promise<boolean> {
    const nextCameraOff = !useMediaStore.getState().isCameraOff
    await this.syncCameraState(nextCameraOff)
    return !nextCameraOff
  }

  public async syncCameraState(isCameraOff: boolean): Promise<void> {
    useMediaStore.setState({ isCameraOff })

    if (!isCameraOff) {
      // Turning camera ON
      let activeCamTrack = this.rawUserStream?.getVideoTracks().find((t) => t.readyState === 'live' && !(t as any).__isDummy) || null

      if (!activeCamTrack) {
        activeCamTrack = await this.acquireCameraTrack()
      }

      if (!activeCamTrack) {
        // Physical camera failed to start or was denied
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

      // Update rawUserStream
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

      // Recreate localStream with the new track to notify React subscribers
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
      // Turning camera OFF
      diagLog('media', 'camera.off')

      // Stop physical tracks to turn off hardware camera light
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

      // Add dummy video track to keep WebRTC transceivers active
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

      const audioTracks = currentLocal ? currentLocal.getAudioTracks() : (this.rawUserStream ? this.rawUserStream.getAudioTracks() : [])
      const newLocalStream = new MediaStream([...audioTracks, ...(dummyTrack ? [dummyTrack] : [])])
      useMediaStore.getState().setLocalStream(newLocalStream)
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

  /**
   * Switch Video Input Camera on the fly
   */
  public async changeVideoInput(deviceId: string): Promise<boolean> {
    try {
      useMediaStore.setState({ selectedVideoInput: deviceId })
      const isCameraOff = useMediaStore.getState().isCameraOff

      // If camera is currently active, switch to the new camera immediately
      if (!isCameraOff) {
        const newCamTrack = await this.acquireCameraTrack(deviceId)
        if (!newCamTrack) return false

        newCamTrack.enabled = true
        ;(newCamTrack as any).__isDummy = false

        // Stop old physical tracks
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

  /**
   * Toggle mute on/off. Updates track enabled state, local player state, and broadcasts to peers.
   */
  public toggleMute(): boolean {
    const nextMute = !useMediaStore.getState().isMuted
    this.syncMuteState(nextMute)
    return nextMute
  }

  public syncMuteState(isMuted: boolean, isMutedByAdmin?: boolean): void {
    diagLog('media', 'mute', { isMuted, isMutedByAdmin })
    try {
      // Sender proof for the next diagnostic: is audio RTP actually flowing?
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
    const nextMutedByAdmin = isMutedByAdmin !== undefined ? isMutedByAdmin : false
    try {
      useGameStore.getState().setLocalPlayer({ isMuted, isMutedByAdmin: nextMutedByAdmin })
    } catch {}
    try {
      PeerManager.getInstance().sendPlayerUpdate({ isMuted, isMutedByAdmin: nextMutedByAdmin })
    } catch {}
  }

  /**
    * Switch Audio Input Microphone on the fly
    */
  public async changeAudioInput(deviceId: string): Promise<boolean> {
    try {
      useMediaStore.getState().setSelectedAudioInput(deviceId)
      const state = useMediaStore.getState()

      const newAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
          echoCancellation: state.echoCancellation,
          autoGainControl: state.autoGainControl,
          noiseSuppression: false,
        },
      })

      const newAudioTrack = newAudioStream.getAudioTracks()[0]
      if (!newAudioTrack) return false

      if (this.rawUserStream) {
        this.rawUserStream.getAudioTracks().forEach((t) => t.stop())
        this.rawUserStream.removeTrack(this.rawUserStream.getAudioTracks()[0])
        this.rawUserStream.addTrack(newAudioTrack)
      } else {
        this.rawUserStream = newAudioStream
      }

      const processedStream = await this.runEngine(
        this.rawUserStream,
        this.handleEngineLevel
      )

    useMediaStore.getState().setLocalStream(processedStream)

      const processedAudioTrack = processedStream.getAudioTracks()[0]
      if (processedAudioTrack) {
        PeerManager.getInstance().replaceAudioTrack(processedAudioTrack)
      }

      // If the call was started while the microphone was unavailable, the
      // eligibility guard intentionally skipped it. Re-check now that a real
      // audio track exists so the first negotiated call includes the mic.
      try {
        PeerManager.getInstance().recheckZoneCalls()
      } catch {}

      return true
    } catch (err) {
      console.warn('Error changing audio input:', err)
      return false
    }
  }

  /**
    * Switch Audio Output Device for all audio elements
    */
  public async changeAudioOutput(deviceId: string): Promise<boolean> {
    try {
      useMediaStore.getState().setSelectedAudioOutput(deviceId)
      const audioElements = document.querySelectorAll('video, audio')
      audioElements.forEach(async (el: any) => {
        if (typeof el.setSinkId === 'function') {
          try {
            await el.setSinkId(deviceId === 'default' ? '' : deviceId)
          } catch (e) {
            console.warn('Failed to set sinkId on element:', e)
          }
        }
      })
      return true
    } catch (err) {
      console.warn('Error changing audio output:', err)
      return false
    }
  }

  /**
   * Determine optimal screen share resolution & FPS based on room occupancy, ping and network quality.
   */
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
        // When 3+ people in the room share screens concurrently, 720p keeps all 3 streams fluid and stable
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

    // Recommended industry bitrates (H.264 WebRTC):
    let targetBitrate = 3_500_000
    if (chosenRes === '1080p') {
      targetBitrate = chosenFps === 60 ? 5_500_000 : 3_500_000
    } else if (chosenRes === '720p') {
      targetBitrate = chosenFps === 60 ? 3_000_000 : 2_000_000
    } else if (chosenRes === '480p') {
      targetBitrate = chosenFps === 60 ? 1_500_000 : 1_000_000
    }

    // Multi-stream & crowded room bandwidth management to prevent packet drop and disconnects
    if (activeScreensInZone >= 2) {
      // 3 or more concurrent screen shares in the same zone:
      // Cap at 2.0 Mbps per stream so total combined uplink/downlink remains healthy
      targetBitrate = Math.min(targetBitrate, 2_000_000)
    } else if (activeScreensInZone >= 1) {
      // 2 concurrent screen shares in the same zone:
      targetBitrate = Math.min(targetBitrate, 3_000_000)
    } else if (peersInZone >= 6) {
      targetBitrate = Math.min(targetBitrate, 2_500_000)
    }

    return { resolution: chosenRes, fps: chosenFps, targetBitrate }
  }

  /**
   * Start Screen Sharing with Customizable Source, Audio, Resolution (auto, 480p, 720p, 1080p) and FPS (auto, 30, 60).
   *
   * The live stream captures ONLY the selected application/window sound,
   * while your microphone remains live in the call via its own dedicated
   * input. The user cannot turn off this isolation or fall back to
   * system-wide loopback because that mixes unrelated apps into the live.
   */
  public async startScreenShare(config: ScreenShareConfig = {}): Promise<MediaStream | null> {
    try {
      const {
        sourceId,
        sourceName,
        audioSourceId,
        captureMethod = 'auto',
        resolution = 'auto',
        fps = 'auto',
      } = config
      // This policy is intentionally not configurable. The application sound
      // is source-scoped, while the microphone remains its own call input.
      const includeAudio = true

      if (sourceName) {
        useMediaStore.getState().setScreenShareTargetTitle(sourceName)
      }

      const { resolution: effectiveResolution, fps: effectiveFps, targetBitrate } =
        MediaManager.resolveOptimalScreenQuality(resolution, fps)

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
      // Browsers that support these hints return source/tab audio instead of
      // the system mix. Electron has no source-scoped audio API for external
      // windows, so it receives video only (see electron/main.ts).
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
        // Chromium capture hints. They are deliberately omitted from the
        // Electron path, where its display-media handler owns the source.
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
          await electronAPI.setScreenSource(sourceId, includeAudio, captureMethod)
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

      // Electron screen capture intentionally has no audio track: its native
      // helper produces source-scoped process audio instead of system audio.
      // In a browser, the display picker may supply a tab/window audio track.
      let applicationAudioTrack = screenStream.getAudioTracks()[0] || null
      const localStream = useMediaStore.getState().localStream
      diagLog('screenshare-audio', 'display-capture-ready', {
        sourceId: sourceId || null,
        isElectron: isElectronCapture,
        tracks: summarizeStream(screenStream),
        microphoneTracks: localStream?.getAudioTracks().length || 0,
      })

      // Tear down any previous isolator before (re)building.
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
        // Never substitute the source audio with system loopback. The regular
        // microphone sender remains untouched so the user stays audible in
        // the call even if the selected app has no audio or capture failed.
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

      const screenVideoTrack = screenStream.getVideoTracks()[0]
      if (screenVideoTrack) {
        screenVideoTrack.enabled = true
        // 'motion' prioritizes steady frame rate over heavy intra-frame compression
        if ('contentHint' in screenVideoTrack) {
          screenVideoTrack.contentHint = 'motion'
        }

        PeerManager.getInstance().replaceVideoTrack(screenVideoTrack, true, targetBitrate, effectiveFps)
        diagLog('screenshare', 'video-track-sent', {
          bitrate: targetBitrate,
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
          this.stopScreenShare()
        }
      }

      return screenStream
    } catch (err) {
      console.warn('Screen share cancelled or failed:', err)
      diagLog('screenshare', 'cancelled-or-failed', { error: errShort(err) })
      return null
    }
  }

  /**
   * Combines two already-separated inputs for the single audio sender used by
   * the current PeerJS call: the isolated application PCM and the user's
   * microphone. No system output or remote-call stream is ever attached.
   */
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

    // The mic is a separate input, not part of the process capture. It stays
    // subject to the normal mute state and audio processor before it enters
    // the live sender.
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

  public stopScreenShare() {
    if (this.callAudioIsolator) {
      this.callAudioIsolator.dispose()
      this.callAudioIsolator = null
    }
    this.disposeScreenShareAudioPipeline()
    this.processAudioCapture?.stop()
    this.processAudioCapture = null
    useMediaStore.getState().setScreenShareTargetTitle(null)

    const currentScreen = useMediaStore.getState().localScreenStream
    if (currentScreen) {
      currentScreen.getTracks().forEach((t) => t.stop())
    }
    useMediaStore.getState().setLocalScreenStream(null)
    useMediaStore.getState().setScreenSharing(false)
    useGameStore.getState().setLocalPlayer({ isScreenSharing: false })

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
    // The actual swap happens on the next processStream() call, which
    // selects the engine based on the current store value. Nothing to do
    // here — kept so callers can force a state flush if they want.
  }

  /**
   * Re-run the active engine over the cached raw user stream and swap the
   * processed audio track into every connected peer. Used when the user
   * changes the processor mode without leaving the call — without this
   * the new engine only takes effect on the next startMedia() / mic swap.
   *
   * No-op if no raw stream is cached (caller must request mic permission
   * first).
   */
  public async reprocessStream(): Promise<boolean> {
    if (!this.rawUserStream) return false
    try {
      const processed = await this.runEngine(
        this.rawUserStream,
        this.handleEngineLevel
      )
      // Preserve current mute/cameraOff state on the new track.
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

  public setTestMic(enabled: boolean) {
    useMediaStore.getState().setIsTestingMic(enabled)
    this.classicEngine.setTestLoopback(enabled)
    this.softEngine.setTestLoopback(enabled)
    this.rnnoiseEngine.setTestLoopback(enabled)
  }

  /**
   * Play a pleasant chime tone to test the selected speakers/headphones
   */
  public playAudioTestBeep() {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
      const testCtx = new AudioContextClass()

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
      gain.connect(testCtx.destination)

      osc1.start(now)
      osc2.start(now)
      osc1.stop(now + 0.5)
      osc2.stop(now + 0.5)

      setTimeout(() => {
        testCtx.close().catch(() => {})
      }, 700)
    } catch (e) {
      console.warn('Could not play test audio chime:', e)
    }
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
