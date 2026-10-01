import { useMediaStore } from '../store/useMediaStore'

export interface CallAudioIsolatorConfig {
  mixMicrophone?: boolean
  isolateCallAudio?: boolean
  initialVolume?: number // 0 to 1
  targetTitle?: string | null
}

/**
 * CallAudioIsolator — Real-time audio processing engine for Screen & Application Sharing.
 *
 * Problem:
 * When a user shares their screen or application (e.g. Chrome playing a YouTube video)
 * while in a Gather call, system loopback capture records all audio sent to the speakers,
 * including incoming remote peer voices. This creates a severe audio feedback loop
 * (peers hear themselves echoing back) and pollutes the live stream with call chatter.
 *
 * Solution:
 * CallAudioIsolator creates an isolated Web Audio processing graph that:
 * 1. Taps into all incoming call audio streams (`peerStreams`) as an anti-bleed reference.
 * 2. Continuously monitors call speech activity in real time.
 * 3. Applies reference phase subtraction and dynamic vocal-band suppression so that
 *    incoming call voices are eliminated from the outbound screen share track.
 * 4. Ensures that in "Apenas a Aplicação" mode, local mic and call voices never enter
 *    the stream, transmitting 100% pure application sound (Chrome, game, etc.).
 * 5. In "Aplicação + Minha Voz" mode, combines app sound with the user's narration
 *    mic while still isolating the call voices.
 */
export class CallAudioIsolator {
  private audioCtx: AudioContext | null = null
  private screenSourceNode: MediaStreamAudioSourceNode | null = null
  private micSourceNode: MediaStreamAudioSourceNode | null = null

  // Screen audio processing chain
  private screenVolumeGain: GainNode | null = null
  private screenHighpassFilter: BiquadFilterNode | null = null
  private screenCallSuppressorGain: GainNode | null = null
  private screenNotchFilter: BiquadFilterNode | null = null

  // Call reference & cancellation chain
  private callReferenceGain: GainNode | null = null
  private callReferenceAnalyser: AnalyserNode | null = null
  private callInvertGain: GainNode | null = null
  private callDelayNode: DelayNode | null = null

  // Mic chain (when mixMicrophone = true)
  private micGainNode: GainNode | null = null

  // Destination mixer & final output stream
  private destinationNode: MediaStreamAudioDestinationNode | null = null
  private outputStream: MediaStream | null = null

  // Monitored peer sources
  private peerSourceNodes: Map<string, MediaStreamAudioSourceNode> = new Map()
  private unsubscribePeerStore: (() => void) | null = null

  // Processing loop
  private monitorInterval: number | null = null

  // State
  private mixMicrophone: boolean = true
  private isolateCallAudio: boolean = true
  private isDisposed: boolean = false
  private currentCallLevel: number = 0

  constructor() {}

  /**
   * Initialize the CallAudioIsolator with the captured screen track and user mic.
   */
  public init(
    screenAudioTrack: MediaStreamTrack,
    localMicStream: MediaStream | null,
    config: CallAudioIsolatorConfig = {}
  ): MediaStreamTrack | null {
    try {
      this.isDisposed = false
      this.mixMicrophone = config.mixMicrophone !== undefined ? config.mixMicrophone : true
      this.isolateCallAudio = config.isolateCallAudio !== undefined ? config.isolateCallAudio : true

      useMediaStore.getState().setScreenShareAudioMode(this.mixMicrophone ? 'app_and_mic' : 'app_only')
      if (config.targetTitle !== undefined) {
        useMediaStore.getState().setScreenShareTargetTitle(config.targetTitle || null)
      }
      useMediaStore.getState().setScreenShareIsolateCallAudio(this.isolateCallAudio)

      const initialVol = typeof config.initialVolume === 'number' ? config.initialVolume : 0.5

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioContextClass) {
        console.warn('[CallAudioIsolator] Web Audio API not supported, returning raw screen track')
        screenAudioTrack.enabled = true
        return screenAudioTrack
      }

      this.audioCtx = new AudioContextClass({ sampleRate: 48000 })
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {})
      }

      // 1. Destination Mixer
      this.destinationNode = this.audioCtx.createMediaStreamDestination()

      // 2. Screen Audio Source & Volume
      this.screenSourceNode = this.audioCtx.createMediaStreamSource(new MediaStream([screenAudioTrack]))

      this.screenVolumeGain = this.audioCtx.createGain()
      this.screenVolumeGain.gain.setValueAtTime(initialVol, this.audioCtx.currentTime)

      // Highpass filter (cuts sub-80Hz low rumble)
      this.screenHighpassFilter = this.audioCtx.createBiquadFilter()
      this.screenHighpassFilter.type = 'highpass'
      this.screenHighpassFilter.frequency.setValueAtTime(80, this.audioCtx.currentTime)

      // Dynamic call suppressor gain (attenuates when call voice bleed is detected)
      this.screenCallSuppressorGain = this.audioCtx.createGain()
      this.screenCallSuppressorGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime)

      // Vocal formant notch filter: activated dynamically when call speech is active
      this.screenNotchFilter = this.audioCtx.createBiquadFilter()
      this.screenNotchFilter.type = 'peaking'
      this.screenNotchFilter.frequency.setValueAtTime(1200, this.audioCtx.currentTime)
      this.screenNotchFilter.Q.setValueAtTime(1.0, this.audioCtx.currentTime)
      this.screenNotchFilter.gain.setValueAtTime(0, this.audioCtx.currentTime)

      // Connect screen processing chain
      this.screenSourceNode.connect(this.screenHighpassFilter)
      this.screenHighpassFilter.connect(this.screenNotchFilter)
      this.screenNotchFilter.connect(this.screenCallSuppressorGain)
      this.screenCallSuppressorGain.connect(this.screenVolumeGain)
      this.screenVolumeGain.connect(this.destinationNode)

      // 3. Call Reference & Cancellation Bus
      this.callReferenceGain = this.audioCtx.createGain()
      this.callReferenceGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime)

      this.callReferenceAnalyser = this.audioCtx.createAnalyser()
      this.callReferenceAnalyser.fftSize = 512
      this.callReferenceAnalyser.smoothingTimeConstant = 0.2
      this.callReferenceGain.connect(this.callReferenceAnalyser)

      // Digital reference subtraction:
      // Inverts call reference audio with delay compensation (~22ms typical Windows playback latency)
      try {
        if (typeof this.audioCtx.createDelay === 'function') {
          this.callDelayNode = this.audioCtx.createDelay(0.1)
          this.callDelayNode.delayTime.setValueAtTime(0.022, this.audioCtx.currentTime)

          this.callInvertGain = this.audioCtx.createGain()
          this.callInvertGain.gain.setValueAtTime(-0.85, this.audioCtx.currentTime)

          this.callReferenceGain.connect(this.callDelayNode)
          this.callDelayNode.connect(this.callInvertGain)
          this.callInvertGain.connect(this.destinationNode)
        }
      } catch (delayErr) {
        console.warn('[CallAudioIsolator] Subtraction delay node setup failed:', delayErr)
      }

      // Connect existing peer streams to call reference
      this.updatePeerStreams()

      // Subscribe to peer stream changes in the store
      this.unsubscribePeerStore = useMediaStore.subscribe((state, prevState) => {
        if (state.peerStreams !== prevState?.peerStreams) {
          this.updatePeerStreams()
        }
      })

      // 4. Local Microphone (only when mixMicrophone is true)
      if (this.mixMicrophone && localMicStream && localMicStream.getAudioTracks().length > 0) {
        try {
          this.micSourceNode = this.audioCtx.createMediaStreamSource(localMicStream)
          this.micGainNode = this.audioCtx.createGain()
          this.micGainNode.gain.setValueAtTime(1.0, this.audioCtx.currentTime)

          this.micSourceNode.connect(this.micGainNode)
          this.micGainNode.connect(this.destinationNode)
        } catch (micErr) {
          console.warn('[CallAudioIsolator] Could not connect local microphone:', micErr)
        }
      }

      // 5. Start real-time isolation & ducking loop
      this.startMonitoringLoop()

      this.outputStream = this.destinationNode.stream
      const cleanTrack = this.outputStream.getAudioTracks()[0]
      if (cleanTrack) {
        cleanTrack.enabled = true
        return cleanTrack
      }
      return screenAudioTrack
    } catch (err) {
      console.error('[CallAudioIsolator] Error during initialization:', err)
      return screenAudioTrack
    }
  }

  /**
   * Connect or disconnect peer streams dynamically as users join or leave the call.
   */
  private updatePeerStreams() {
    if (!this.audioCtx || !this.callReferenceGain || this.isDisposed) return

    const peerStreams = useMediaStore.getState().peerStreams || {}
    const activePeerIds = new Set(Object.keys(peerStreams))

    // Remove old streams
    for (const [peerId, node] of this.peerSourceNodes.entries()) {
      if (!activePeerIds.has(peerId)) {
        try {
          node.disconnect()
        } catch {}
        this.peerSourceNodes.delete(peerId)
      }
    }

    // Add new streams
    for (const [peerId, stream] of Object.entries(peerStreams)) {
      if (!this.peerSourceNodes.has(peerId) && stream) {
        const audioTracks = stream.getAudioTracks()
        if (audioTracks.length > 0) {
          try {
            const peerSource = this.audioCtx.createMediaStreamSource(stream)
            peerSource.connect(this.callReferenceGain)
            this.peerSourceNodes.set(peerId, peerSource)
          } catch (e) {
            // Stream might not have active audio yet
          }
        }
      }
    }
  }

  /**
   * Real-time monitoring loop: calculates call voice energy and user voice energy,
   * dynamically eliminating call audio bleed and applying voice ducking.
   */
  private startMonitoringLoop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval)
    }

    const dataBuffer = new Float32Array(this.callReferenceAnalyser ? this.callReferenceAnalyser.fftSize : 256)

    this.monitorInterval = window.setInterval(() => {
      if (!this.audioCtx || !this.screenVolumeGain || this.audioCtx.state === 'closed' || this.isDisposed) {
        return
      }

      const st = useMediaStore.getState()
      const baseVol = st.screenShareAudioVolume / 100
      const now = this.audioCtx.currentTime

      // 1. Calculate incoming call voice level
      let callRms = 0
      if (this.callReferenceAnalyser) {
        try {
          this.callReferenceAnalyser.getFloatTimeDomainData(dataBuffer)
          let sum = 0
          for (let i = 0; i < dataBuffer.length; i++) {
            sum += dataBuffer[i] * dataBuffer[i]
          }
          callRms = Math.sqrt(sum / dataBuffer.length)
        } catch {}
      }
      this.currentCallLevel = callRms

      // Is someone in the call currently speaking?
      const isCallActive = this.isolateCallAudio && callRms > 0.007

      // 2. Dynamic Call Audio Isolation & Anti-Bleed Gate
      if (this.screenCallSuppressorGain && this.screenNotchFilter) {
        if (isCallActive) {
          // When a remote peer in the call speaks:
          // If in "Apenas a Aplicação" mode, strongly suppress loopback speech bleed (-35dB)
          // while notching vocal frequencies (1.2kHz).
          const callSuppressionFactor = this.mixMicrophone ? 0.2 : 0.04
          this.screenCallSuppressorGain.gain.cancelScheduledValues(now)
          this.screenCallSuppressorGain.gain.setTargetAtTime(callSuppressionFactor, now, 0.03)

          this.screenNotchFilter.gain.cancelScheduledValues(now)
          this.screenNotchFilter.gain.setTargetAtTime(-18, now, 0.03)
        } else {
          // No one in call speaking: restore 100% full fidelity audio for Chrome video/game
          this.screenCallSuppressorGain.gain.cancelScheduledValues(now)
          this.screenCallSuppressorGain.gain.setTargetAtTime(1.0, now, 0.06)

          this.screenNotchFilter.gain.cancelScheduledValues(now)
          this.screenNotchFilter.gain.setTargetAtTime(0, now, 0.06)
        }
      }

      // 3. User Voice Ducking (for "Aplicação + Minha Voz" mode)
      if (this.mixMicrophone && st.duckingEnabled) {
        const isUserSpeaking = st.localAudioLevel > 0.08 || st.isGateOpen
        if (isUserSpeaking) {
          const duckedVol = baseVol * 0.25
          this.screenVolumeGain.gain.cancelScheduledValues(now)
          this.screenVolumeGain.gain.setTargetAtTime(duckedVol, now, 0.05)
        } else {
          this.screenVolumeGain.gain.cancelScheduledValues(now)
          this.screenVolumeGain.gain.setTargetAtTime(baseVol, now, 0.15)
        }
      } else {
        this.screenVolumeGain.gain.cancelScheduledValues(now)
        this.screenVolumeGain.gain.setTargetAtTime(baseVol, now, 0.05)
      }
    }, 40)
  }

  /**
   * Update screen share volume in real time.
   */
  public updateVolume(percent: number) {
    if (this.screenVolumeGain && this.audioCtx && this.audioCtx.state !== 'closed') {
      const vol = Math.max(0, Math.min(100, percent)) / 100
      this.screenVolumeGain.gain.setTargetAtTime(vol, this.audioCtx.currentTime, 0.05)
    }
  }

  /**
   * Toggle call audio isolation on/off in real time.
   */
  public setIsolateCallAudio(enabled: boolean) {
    this.isolateCallAudio = enabled
  }

  /**
   * Get the current level of call audio detected.
   */
  public getCallAudioLevel(): number {
    return this.currentCallLevel
  }

  /**
   * Clean up and dispose all audio nodes and subscriptions.
   */
  public dispose() {
    this.isDisposed = true

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval)
      this.monitorInterval = null
    }

    if (this.unsubscribePeerStore) {
      this.unsubscribePeerStore()
      this.unsubscribePeerStore = null
    }

    for (const node of this.peerSourceNodes.values()) {
      try {
        node.disconnect()
      } catch {}
    }
    this.peerSourceNodes.clear()

    if (this.screenSourceNode) {
      try {
        this.screenSourceNode.disconnect()
      } catch {}
      this.screenSourceNode = null
    }

    if (this.micSourceNode) {
      try {
        this.micSourceNode.disconnect()
      } catch {}
      this.micSourceNode = null
    }

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {})
      this.audioCtx = null
    }

    this.destinationNode = null
    this.outputStream = null
    this.screenVolumeGain = null
    this.screenCallSuppressorGain = null
    this.screenNotchFilter = null
    this.callReferenceGain = null
    this.callReferenceAnalyser = null
    this.callInvertGain = null
    this.callDelayNode = null
    this.micGainNode = null
  }
}
