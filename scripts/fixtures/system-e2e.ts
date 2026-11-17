// The real application is bootstrapped after the test installs its local network
// endpoints. These diagnostics only observe; all scenario actions use the UI.
import { useGameStore } from '../../src/store/useGameStore'
import { useMediaStore } from '../../src/store/useMediaStore'
import { useMapStore } from '../../src/store/useMapStore'
import { PeerManager } from '../../src/p2p/PeerManager'
import { SHARED_RTC_CONFIG } from '../../src/p2p/mediaCalls'
import { useWhiteboardStore } from '../../src/store/useWhiteboardStore'
import { useChatStore } from '../../src/store/useChatStore'
import { parseNetworkMessage } from '../../src/validation/schemas'
import { almAudioOutput, isAlmStream } from '../../src/media/almStreams'

SHARED_RTC_CONFIG.iceServers = []
const meters = new WeakMap<MediaStream, AnalyserNode>()
let audioContext: AudioContext | undefined
const received: unknown[] = [], observed = new WeakSet<object>()
setInterval(() => {
  for (const connection of PeerManager.getInstance().connections.values()) {
    if (observed.has(connection)) continue
    observed.add(connection)
    connection.on('data', data => {
      if (received.length < 100) received.push({ type: data?.type, ...(data?.type === 'CHAT_MESSAGE' ? { raw: data, valid: !!parseNetworkMessage(data) } : {}) })
    })
  }
}, 100)
async function rms(stream: MediaStream) {
  audioContext ??= new AudioContext()
  await audioContext.resume()
  let analyser = meters.get(stream)
  if (!analyser) {
    analyser = audioContext.createAnalyser(); analyser.fftSize = 4096
    audioContext.createMediaStreamSource(stream).connect(analyser)
    meters.set(stream, analyser)
  }
  const samples = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(samples)
  return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
}

Object.assign(window, { liraE2E: {
  snapshot() {
    const game = useGameStore.getState(), media = useMediaStore.getState()
    return {
      roomId: game.roomId, connected: game.isConnected,
      received, messages: useChatStore.getState().messages,
      connections: [...PeerManager.getInstance().connections].map(([id, connection]) => ({ id, open: connection.open, state: connection.dataChannel?.readyState, buffer: connection.dataChannel?.bufferedAmount, queued: connection.bufferSize })),
      local: game.localPlayer, peers: Object.values(game.remotePlayers),
      zones: useMapStore.getState().mapData.zones,
      board: Object.values(useWhiteboardStore.getState().document.operations)
        .filter(operation => operation.kind === 'element').map(operation => operation.element),
      media: {
        muted: media.isMuted, cameraOff: media.isCameraOff, sharing: media.isScreenSharing,
        deafened: media.isDeafened, noiseEnabled: media.isNoiseSuppressionEnabled,
        noiseMode: media.audioProcessorMode, rnnoise: media.rnnoiseStatus, deepfilter: media.deepFilterStatus,
      },
    }
  },
  async rtp() {
    const calls = [...PeerManager.getInstance().mediaCalls.values()]
    const reports = await Promise.all(calls.map(call => call.peerConnection.getStats()))
    return reports.flatMap(report => [...report.values()].filter(row =>
      row.type === 'inbound-rtp' || row.type === 'outbound-rtp'))
  },
  async audio() {
    const media = useMediaStore.getState()
    const streams = [
      ...Object.entries(media.peerStreams).map(([id, stream]) => ({ id, source: 'call', stream })),
      ...Object.entries(media.peerVoiceStreams).map(([id, stream]) => ({ id, source: 'voice', stream })),
    ]
    const levels = await Promise.all(streams.filter(({ stream }) => stream?.getAudioTracks().length)
      .map(async ({ id, source, stream }) => ({ id, source, rms: await rms(stream!) })))
    const live = Object.entries(media.peerScreenStreams).flatMap(([id, stream]) => {
      const output = almAudioOutput(stream)
      return output ? [{ id, source: 'live', rms: output.level() }] : []
    })
    return [...levels, ...live]
  },
  async outputAudio() {
    return Promise.all(Array.from(document.querySelectorAll('audio'))
      .filter(element => element.srcObject instanceof MediaStream && element.srcObject.getAudioTracks().length)
      .map(async element => ({ muted: element.muted, paused: element.paused, rms: await rms(element.srcObject as MediaStream) })))
  },
  playback() {
    const media = useMediaStore.getState()
    const remoteTracks = new Set([...Object.values(media.peerStreams), ...Object.values(media.peerScreenStreams)]
      .flatMap(stream => stream?.getVideoTracks().map(track => track.id) || []))
    return Array.from(document.querySelectorAll('video')).filter(video =>
      video.srcObject instanceof MediaStream && video.srcObject.getVideoTracks().some(track => remoteTracks.has(track.id)))
      .map(video => ({ width: video.videoWidth, height: video.videoHeight, frames: video.getVideoPlaybackQuality().totalVideoFrames,
        alm: video.srcObject instanceof MediaStream && isAlmStream(video.srcObject) }))
  },
} })

await import('../../src/bootstrap')
