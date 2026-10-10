import { useMediaStore } from '../store/useMediaStore'

export interface CallAudioIsolatorConfig {
  mixMicrophone?: boolean
  isolateCallAudio?: boolean
  initialVolume?: number
  targetTitle?: string | null
}

export class CallAudioIsolator {
  private audioCtx: AudioContext | null = null
  private screenSourceNode: MediaStreamAudioSourceNode | null = null
  private micSourceNode: MediaStreamAudioSourceNode | null = null

  private screenVolumeGain: GainNode | null = null
  private screenHighpassFilter: BiquadFilterNode | null = null
  private screenCallSuppressorGain: GainNode | null = null
  private screenNotchFilter: BiquadFilterNode | null = null

  private callReferenceGain: GainNode | null = null
  private callReferenceAnalyser: AnalyserNode | null = null
  private callInvertGain: GainNode | null = null
  private callDelayNode: DelayNode | null = null

  private micGainNode: GainNode | null = null

  private destinationNode: MediaStreamAudioDestinationNode | null = null
  private outputStream: MediaStream | null = null

  private peerSourceNodes: Map<string, MediaStreamAudioSourceNode> = new Map()
  private unsubscribePeerStore: (() => void) | null = null

  private monitorInterval: number | null = null

  private mixMicrophone: boolean = true
  private isolateCallAudio: boolean = true
  private isDisposed: boolean = false
  private currentCallLevel: number = 0

  constructor() {}

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

      this.destinationNode = this.audioCtx.createMediaStreamDestination()

      this.screenSourceNode = this.audioCtx.createMediaStreamSource(new MediaStream([screenAudioTrack]))

      this.screenVolumeGain = this.audioCtx.createGain()
      this.screenVolumeGain.gain.setValueAtTime(initialVol, this.audioCtx.currentTime)

      this.screenHighpassFilter = this.audioCtx.createBiquadFilter()
      this.screenHighpassFilter.type = 'highpass'
      this.screenHighpassFilter.frequency.setValueAtTime(80, this.audioCtx.currentTime)

      this.screenCallSuppressorGain = this.audioCtx.createGain()
      this.screenCallSuppressorGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime)

      this.screenNotchFilter = this.audioCtx.createBiquadFilter()
      this.screenNotchFilter.type = 'peaking'
      this.screenNotchFilter.frequency.setValueAtTime(1200, this.audioCtx.currentTime)
      this.screenNotchFilter.Q.setValueAtTime(1.0, this.audioCtx.currentTime)
      this.screenNotchFilter.gain.setValueAtTime(0, this.audioCtx.currentTime)

      this.screenSourceNode.connect(this.screenHighpassFilter)
      this.screenHighpassFilter.connect(this.screenNotchFilter)
      this.screenNotchFilter.connect(this.screenCallSuppressorGain)
      this.screenCallSuppressorGain.connect(this.screenVolumeGain)
      this.screenVolumeGain.connect(this.destinationNode)

      this.callReferenceGain = this.audioCtx.createGain()
      this.callReferenceGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime)

      this.callReferenceAnalyser = this.audioCtx.createAnalyser()
      this.callReferenceAnalyser.fftSize = 512
      this.callReferenceAnalyser.smoothingTimeConstant = 0.2
      this.callReferenceGain.connect(this.callReferenceAnalyser)

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

      this.updatePeerStreams()

      this.unsubscribePeerStore = useMediaStore.subscribe((state, prevState) => {
        if (state.peerStreams !== prevState?.peerStreams) {
          this.updatePeerStreams()
        }
      })

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

  private updatePeerStreams() {
    if (!this.audioCtx || !this.callReferenceGain || this.isDisposed) return

    const peerStreams = useMediaStore.getState().peerStreams || {}
    const activePeerIds = new Set(Object.keys(peerStreams))

    for (const [peerId, node] of this.peerSourceNodes.entries()) {
      if (!activePeerIds.has(peerId)) {
        try {
          node.disconnect()
        } catch {}
        this.peerSourceNodes.delete(peerId)
      }
    }

    for (const [peerId, stream] of Object.entries(peerStreams)) {
      if (!this.peerSourceNodes.has(peerId) && stream) {
        const audioTracks = stream.getAudioTracks()
        if (audioTracks.length > 0) {
          try {
            const peerSource = this.audioCtx.createMediaStreamSource(stream)
            peerSource.connect(this.callReferenceGain)
            this.peerSourceNodes.set(peerId, peerSource)
          } catch (e) {
          }
        }
      }
    }
  }

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

      const isCallActive = this.isolateCallAudio && callRms > 0.007

      if (this.screenCallSuppressorGain && this.screenNotchFilter) {
        if (isCallActive) {
          const callSuppressionFactor = this.mixMicrophone ? 0.2 : 0.04
          this.screenCallSuppressorGain.gain.cancelScheduledValues(now)
          this.screenCallSuppressorGain.gain.setTargetAtTime(callSuppressionFactor, now, 0.03)

          this.screenNotchFilter.gain.cancelScheduledValues(now)
          this.screenNotchFilter.gain.setTargetAtTime(-18, now, 0.03)
        } else {
          this.screenCallSuppressorGain.gain.cancelScheduledValues(now)
          this.screenCallSuppressorGain.gain.setTargetAtTime(1.0, now, 0.06)

          this.screenNotchFilter.gain.cancelScheduledValues(now)
          this.screenNotchFilter.gain.setTargetAtTime(0, now, 0.06)
        }
      }

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

  public updateVolume(percent: number) {
    if (this.screenVolumeGain && this.audioCtx && this.audioCtx.state !== 'closed') {
      const vol = Math.max(0, Math.min(100, percent)) / 100
      this.screenVolumeGain.gain.setTargetAtTime(vol, this.audioCtx.currentTime, 0.05)
    }
  }

  public setIsolateCallAudio(enabled: boolean) {
    this.isolateCallAudio = enabled
  }

  public getCallAudioLevel(): number {
    return this.currentCallLevel
  }

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
