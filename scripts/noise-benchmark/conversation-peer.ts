import { PeerManager, setActiveSignalingTier, markSignalingTierFailed } from '../../src/p2p/PeerManager'
import { MediaManager } from '../../src/media/MediaManager'
import { SHARED_RTC_CONFIG } from '../../src/p2p/mediaCalls'
import { useGameStore } from '../../src/store/useGameStore'
import { useMediaStore } from '../../src/store/useMediaStore'
import { attachRemoteAudio, applyAudioOutput } from '../../src/media/remoteAudio'
import { attachStreamToVideo } from '../../src/media/attachVideoElement'
import { installEncodedProbe } from './encodedProbe'

// Each iframe has its own module instances, stores, PeerManager and processors.
// Only test instrumentation and the synthetic microphone cross realm boundaries.
const peer = PeerManager.getInstance()
const media = MediaManager.getInstance()
let mode = ''
let input: MediaStream
let detach: (() => void) | undefined
let audio: HTMLAudioElement | undefined
let video: HTMLVideoElement | undefined
let detachVideo: (() => void) | undefined
let frames: ReturnType<typeof installEncodedProbe> | undefined

async function stats() {
  const call = [...peer.mediaCalls.values()][0]
  if (!call) throw new Error('No Lira media call')
  const report = [...(await call.peerConnection.getStats()).values()]
  const inbound = report.find(row => row.type === 'inbound-rtp' && row.kind === 'audio')
  const outbound = report.find(row => row.type === 'outbound-rtp' && row.kind === 'audio')
  const codec = report.find(row => row.id === inbound?.codecId)
  return { bytesReceived: inbound?.bytesReceived || 0, bytesSent: outbound?.bytesSent || 0,
    packetsLost: inbound?.packetsLost || 0, packetsReceived: inbound?.packetsReceived || 0,
    jitterSeconds: inbound?.jitter, jitterBufferDelaySeconds: inbound?.jitterBufferDelay,
    jitterBufferTargetDelay: inbound?.jitterBufferTargetDelay, jitterBufferMinimumDelay: inbound?.jitterBufferMinimumDelay,
    jitterBufferEmittedCount: inbound?.jitterBufferEmittedCount,
    concealedSamples: inbound?.concealedSamples, totalSamplesReceived: inbound?.totalSamplesReceived,
    insertedSamplesForDeceleration: inbound?.insertedSamplesForDeceleration, removedSamplesForAcceleration: inbound?.removedSamplesForAcceleration,
    packetsDiscarded: inbound?.packetsDiscarded,
    packetsSent: outbound?.packetsSent, totalPacketSendDelay: outbound?.totalPacketSendDelay,
    playout: report.filter(row => row.type === 'media-playout'),
    receiverTargets: call.peerConnection.getReceivers().map(receiver => ({ kind: receiver.track.kind,
      playoutDelayHint: (receiver as any).playoutDelayHint, jitterBufferTarget: (receiver as any).jitterBufferTarget })),
    codec: codec?.mimeType, sampleRate: codec?.clockRate,
    selectedCandidatePair: report.filter(row => row.type === 'candidate-pair' && row.state === 'succeeded').map(row => ({ currentRoundTripTime: row.currentRoundTripTime, localCandidateId: row.localCandidateId, remoteCandidateId: row.remoteCandidateId })),
  }
}

const api = {
  async configure(stream: MediaStream, selectedMode: string, signalingPort: number, name: string, variant = 'normal', encodedProbe = false) {
    mode = selectedMode
    input = stream
    if (encodedProbe) frames = installEncodedProbe()
    Object.assign(window, { __LIRA_LOCAL_SIGNALING_PORT__: signalingPort })
    SHARED_RTC_CONFIG.iceServers = []
    setActiveSignalingTier('local')
    markSignalingTierFailed('render', 3600000)
    markSignalingTierFailed('public', 3600000)
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => input })
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [] })
    const identity = crypto.randomUUID()
    useGameStore.getState().setLocalPlayer({ id: identity, gameId: identity, name, currentZoneId: 'audio-room', isScreenSharing: false, isMuted: false, isCameraOff: true })
    useMediaStore.setState({ isMuted: false, isCameraOff: true, isDeafened: false, isScreenSharing: false,
      audioProcessorMode: selectedMode === 'bypass' ? 'classic' : selectedMode as any,
      hasUserChosenProcessorMode: true, inputVolume: 100, outputVolume: 100,
      sensitivityMode: variant === 'settled-open-gate' ? 'manual' : 'auto',
      manualSensitivityThreshold: variant === 'settled-open-gate' ? 0 : 20, isNoiseSuppressionEnabled: true,
      selectedAudioInput: 'default', selectedAudioOutput: 'default', isTestingMic: false,
      soundEffectsEnabled: false,
    })
    const NativeContext = window.AudioContext
    let engineContext: AudioContext | undefined
    let holdResume = variant === 'defer-resume'
    if (holdResume) window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) { super(options); engineContext ||= this }
      resume() { return holdResume ? Promise.resolve() : super.resume() }
    }
    if (mode === 'bypass') {
      // Instrument control: PeerManager transmits the exact virtual microphone,
      // bypassing all filter graphs. This is not the UI's suppression toggle.
      // Match startMedia's disabled camera track. Audio-only SDP is not an
      // equivalent reference for the application's audio+dummy-video calls.
      const dummyVideo = media.createDummyVideoTrack()
      if (!dummyVideo) throw new Error('Reference dummy video unavailable')
      input.addTrack(dummyVideo)
      useMediaStore.getState().setLocalStream(input)
    } else if (!await media.startMedia(false, true)) throw new Error('Lira microphone setup failed')
    if (variant === 'defer-resume') {
      holdResume = false
      window.AudioContext = NativeContext
      await engineContext?.resume()
    }
    if (variant === 'audio-only') {
      const local = useMediaStore.getState().localStream!
      local.getVideoTracks().forEach(track => local.removeTrack(track))
    }
    api.assertMode()
  },
  assertMode() {
    const state = useMediaStore.getState()
    if (mode === 'deepfilter' && state.deepFilterStatus !== 'ready') throw new Error('DeepFilter unavailable/fallback: ' + state.deepFilterError)
    if (mode === 'rnnoise' && state.rnnoiseStatus !== 'ready') throw new Error('RNNoise unavailable/fallback: ' + state.rnnoiseError)
  },
  async create(room: string) { await peer.createRoom(room, useGameStore.getState().localPlayer, { isPublic: false }, 2) },
  async join(room: string) { await peer.joinRoom(room, useGameStore.getState().localPlayer, 2) },
  async connected() {
    return peer.mediaCalls.size === 1 && Object.values(useGameStore.getState().callStates).includes('connected') && (await stats()).bytesReceived > 0
  },
  local() { return useMediaStore.getState().localStream! },
  async playback() {
    const stream = Object.values(useMediaStore.getState().peerStreams)[0]
    if (!stream?.getAudioTracks().length) throw new Error('Remote Lira audio missing')
    // MiniCallOverlay/GridParticipantTile always attach the original stream to
    // a muted video, including when the camera is hidden. Chromium requires this
    // native remote-stream consumer before WebAudio can pull decoded RTP audio
    // (Chromium issue 40094084). Reproduce that real receiver path as well.
    video = document.createElement('video')
    video.autoplay = true
    video.playsInline = true
    video.muted = true
    document.body.append(video)
    detachVideo = attachStreamToVideo(video, stream, { tile: 'conversation-video', peer: 'Other participant', muted: true })
    audio = document.createElement('audio')
    audio.autoplay = true
    document.body.append(audio)
    detach = attachRemoteAudio(audio, stream, { tile: 'conversation-test', peer: 'Other participant', muted: false })
    applyAudioOutput(audio, { muted: false, volume: 1, sinkId: 'default' })
    await audio.play()
    const played = (audio as any).captureStream() as MediaStream
    if (!played.getAudioTracks().length) throw new Error('Audio element capture has no audio track')
    return { decoded: stream, gain: audio.srcObject as MediaStream, played }
  },
  stats,
  frames() { return frames },
  status() {
    api.assertMode()
    const state = useMediaStore.getState()
    return { selectedMode: state.audioProcessorMode, deepFilterStatus: state.deepFilterStatus,
      rnnoiseStatus: state.rnnoiseStatus, playbackTracks: (audio as any)?.captureStream().getAudioTracks().length || 0,
      audioElement: { paused: audio?.paused, currentTime: audio?.currentTime, readyState: audio?.readyState },
      videoElement: { paused: video?.paused, currentTime: video?.currentTime, readyState: video?.readyState },
      localTracks: state.localStream?.getTracks().map(track => ({ kind: track.kind, enabled: track.enabled })),
      remoteTracks: Object.values(state.peerStreams).flatMap(stream => stream.getAudioTracks().map(track => ({ id: track.id, enabled: track.enabled, muted: track.muted, state: track.readyState }))),
    }
  },
  dispose() {
    detach?.()
    audio?.remove()
    detachVideo?.()
    video?.remove()
    peer.disconnect()
    media.stopAllMedia()
  },
}
Object.assign(window, { conversationPeer: api })
export type ConversationPeer = typeof api
