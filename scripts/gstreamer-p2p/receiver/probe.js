function h264Payloads(media) {
  return [...media.matchAll(/^a=rtpmap:(\d+)[ \t]+H264\/90000[ \t]*\r?$/gim)].map(match => match[1])
}

function normalizeAmfOffer(description) {
  const sdp = description.sdp.split(/(?=^m=)/m).map(media => {
    if (!media.startsWith('m=video ')) return media
    const payloads = h264Payloads(media)
    return media.replace(/^a=fmtp:(\d+)[ \t]+[^\r\n]+/gm, (line, payload) => {
      if (!payloads.includes(payload)) return line
      // AMF sets constraint_set5 on Baseline, where it imposes no profile constraint.
      // libwebrtc's Baseline SDP matching requires that bit to be clear.
      return line.replace(/(\bprofile-level-id[ \t]*=[ \t]*)4204([\da-f]{2})(?=[; \t]|$)/gi,
        (_value, prefix, level) => `${prefix}4200${level}`)
    })
  }).join('')
  return { ...description, sdp }
}

function acceptsH264(sdp) {
  return sdp.split(/(?=^m=)/m).some(media => {
    if (!media.startsWith('m=video ') || /^a=inactive\r?$/m.test(media)) return false
    const [, port, , ...payloads] = media.split(/\r?\n/, 1)[0].trim().split(/\s+/)
    return Number(port) > 0 && h264Payloads(media).some(payload => payloads.includes(payload))
  })
}

// Consumer messages for the default gst-plugins-rs WebRTC signaller.
export function createNegotiation(peer, send) {
  let producer = null
  let sessionId = null
  let answered = false
  const waitingRemoteIce = []
  const waitingLocalIce = []

  function start(peerId) {
    if (producer === null && typeof peerId === 'string' && peerId) {
      producer = peerId
      send({ type: 'startSession', peerId })
    }
  }

  function ice(candidate) {
    if (!candidate?.candidate || !Number.isInteger(candidate.sdpMLineIndex)) return
    const { candidate: value, sdpMLineIndex } = candidate
    const message = { candidate: value, sdpMLineIndex }
    if (answered) send({ type: 'peer', sessionId, ice: message })
    else waitingLocalIce.push(message)
  }

  async function receive(message) {
    switch (message?.type) {
      case 'welcome':
        send({ type: 'setPeerStatus', roles: ['listener'] })
        send({ type: 'list' })
        break
      case 'list':
        start(message.producers?.[0]?.id)
        break
      case 'peerStatusChanged':
        if (message.roles?.includes('producer')) start(message.peerId)
        break
      case 'sessionStarted':
        if (message.peerId === producer && sessionId === null) sessionId = message.sessionId
        break
      case 'peer':
        if (!sessionId || message.sessionId !== sessionId) break
        if (message.sdp?.type === 'offer') {
          answered = false
          await peer.setRemoteDescription(normalizeAmfOffer(message.sdp))
          for (const candidate of waitingRemoteIce.splice(0)) await peer.addIceCandidate(candidate)
          const answer = await peer.createAnswer()
          if (!acceptsH264(answer.sdp)) throw new Error('O navegador não aceitou o vídeo H.264 desta transmissão.')
          await peer.setLocalDescription(answer)
          const { type, sdp } = peer.localDescription
          send({ type: 'peer', sessionId, sdp: { type, sdp } })
          answered = true
          for (const candidate of waitingLocalIce.splice(0)) ice(candidate)
        } else if (message.ice?.candidate) {
          if (peer.remoteDescription) await peer.addIceCandidate(message.ice)
          else waitingRemoteIce.push(message.ice)
        }
        break
      case 'endSession':
        if (sessionId && message.sessionId === sessionId) return 'ended'
        break
      case 'error':
        throw new Error(message.details || 'Erro de sinalização no GStreamer')
    }
  }

  return { receive, ice }
}

const finite = value => Number.isFinite(value) ? value : null
const milliseconds = seconds => Number.isFinite(seconds) ? seconds * 1000 : null

export function videoSnapshot(reports, playback) {
  const video = [...reports.values()].find(report => report.type === 'inbound-rtp' &&
    (report.kind ?? report.mediaType) === 'video' && Number.isFinite(report.framesDecoded))
  const transport = reports.get(video?.transportId)
  const pair = reports.get(transport?.selectedCandidatePairId)
  return {
    ...playback,
    id: video?.id ?? null,
    codec: reports.get(video?.codecId)?.mimeType ?? null,
    bytesReceived: finite(video?.bytesReceived),
    framesDecoded: finite(video?.framesDecoded),
    freezeCount: finite(video?.freezeCount),
    freezeSeconds: finite(video?.totalFreezesDuration),
    droppedFrames: playback.droppedFrames ?? finite(video?.framesDropped),
    jitterMs: milliseconds(video?.jitter),
    rttMs: milliseconds(pair?.currentRoundTripTime),
    candidateTypes: [pair?.localCandidateId, pair?.remoteCandidateId].map(id => reports.get(id)?.candidateType ?? null),
  }
}

export function measure(current, previous) {
  const elapsed = current.at - previous?.at
  const rate = (value, before) => elapsed > 0 && Number.isFinite(value) && Number.isFinite(before) && value >= before
    ? (value - before) * 1000 / elapsed : null
  const lastReport = current.id && current.id === previous?.id ? previous : null
  const bytesPerSec = rate(current.bytesReceived, lastReport?.bytesReceived)
  const hasRoute = current.candidateTypes.every(Boolean)
  return {
    at: current.at, width: current.width, height: current.height,
    presentedFps: rate(current.presentedFrames, previous?.presentedFrames),
    decodedFps: rate(current.framesDecoded, lastReport?.framesDecoded),
    mbps: bytesPerSec === null ? null : bytesPerSec * 8 / 1_000_000,
    codec: current.codec, rttMs: current.rttMs, jitterMs: current.jitterMs,
    freezeCount: current.freezeCount, freezeSeconds: current.freezeSeconds, droppedFrames: current.droppedFrames,
    candidateTypes: current.candidateTypes,
    direct: hasRoute ? !current.candidateTypes.includes('relay') : null,
  }
}
