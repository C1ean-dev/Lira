import { createNegotiation, measure, videoSnapshot } from './probe.js'

const video = document.querySelector('video')
const status = document.querySelector('#status')
const button = document.querySelector('#connect')
const download = document.querySelector('#download')
const cells = Object.fromEntries([...document.querySelectorAll('[data-stat]')].map(cell => [cell.dataset.stat, cell]))
const format = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const text = (value, suffix = '') => value === null || value === undefined ? '—' : `${format.format(value)}${suffix}`
const MAX_SAMPLES = 600
let connection = null
let report = null

function display(stats) {
  cells.resolution.textContent = stats.width && stats.height ? `${stats.width} × ${stats.height}` : '—'
  cells.presentedFps.textContent = text(stats.presentedFps, ' FPS')
  cells.decodedFps.textContent = text(stats.decodedFps, ' FPS')
  cells.bitrate.textContent = text(stats.mbps, ' Mbps')
  cells.frozen.textContent = text(stats.freezeCount)
  cells.freezeSeconds.textContent = text(stats.freezeSeconds, ' s')
  cells.dropped.textContent = text(stats.droppedFrames)
  cells.rtt.textContent = text(stats.rttMs, ' ms')
  cells.jitter.textContent = text(stats.jitterMs, ' ms')
  cells.codec.textContent = stats.codec ?? '—'
  cells.route.textContent = stats.direct === null ? '—'
    : `${stats.direct ? 'P2P direto' : 'Via retransmissor'} (${stats.candidateTypes.join(' / ')})`
}

function stop(message) {
  if (!connection) return
  const { socket, peer, timer, frameCallback } = connection
  connection = null
  clearTimeout(timer)
  if (frameCallback !== null) video.cancelVideoFrameCallback(frameCallback)
  peer.close()
  socket.close()
  video.srcObject = null
  status.textContent = message
  button.textContent = 'Conectar'
}

function connect() {
  const signalPort = Number(new URLSearchParams(location.search).get('signal') ?? '8443')
  if (!Number.isInteger(signalPort) || signalPort < 1024 || signalPort > 65535) throw new Error('Porta de sinalização inválida')
  const peer = new RTCPeerConnection({ iceServers: [] })
  const socket = new WebSocket(`ws://${location.hostname}:${signalPort}`)
  const session = { peer, socket, timer: null, frameCallback: null }
  connection = session
  report = { startedAt: new Date().toISOString(), samples: [] }
  download.disabled = true
  button.textContent = 'Desconectar'
  status.textContent = 'Aguardando o transmissor…'
  for (const cell of Object.values(cells)) cell.textContent = '—'

  function fail(error) {
    if (connection === session) stop(error instanceof Error ? error.message : String(error))
  }
  const negotiation = createNegotiation(peer, message => {
    if (connection === session && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  })
  let inbox = Promise.resolve()
  socket.onmessage = ({ data }) => {
    inbox = inbox.then(async () => {
      if (connection !== session) return
      const result = await negotiation.receive(JSON.parse(data))
      if (result === 'ended' && connection === session)
        stop('O transmissor encerrou a live.')
    }).catch(fail)
  }
  socket.onerror = () => fail('Falha na sinalização. Confira o terminal do apresentador e o acesso às portas da rede local.')
  socket.onclose = () => fail('Sinalização encerrada pelo transmissor.')
  peer.onicecandidate = ({ candidate }) => negotiation.ice(candidate)
  peer.onconnectionstatechange = () => {
    if (connection !== session) return
    if (peer.connectionState === 'failed') fail('O WebRTC não encontrou um caminho direto entre os dois dispositivos.')
    else if (peer.connectionState === 'disconnected') status.textContent = 'Conexão interrompida. Aguardando recuperação…'
    else if (peer.connectionState === 'connected') status.textContent = 'Conectado'
  }
  let presentedFrames = null
  function framePresented(_time, frame) {
    if (connection !== session) return
    presentedFrames = frame.presentedFrames
    session.frameCallback = video.requestVideoFrameCallback(framePresented)
  }
  peer.ontrack = ({ streams, track }) => {
    if (connection !== session) return
    video.srcObject = streams[0] ?? new MediaStream([track])
    if (session.frameCallback === null && typeof video.requestVideoFrameCallback === 'function')
      session.frameCallback = video.requestVideoFrameCallback(framePresented)
    video.play().catch(() => { status.textContent = 'Use o botão de reprodução no vídeo.' })
  }

  let previous = null
  const start = performance.now()
  async function sample() {
    try {
      const reports = await peer.getStats()
      if (connection !== session) return
      const quality = video.getVideoPlaybackQuality()
      const snapshot = videoSnapshot(reports, {
        at: performance.now() - start,
        width: video.videoWidth, height: video.videoHeight,
        presentedFrames: presentedFrames ?? quality.totalVideoFrames - quality.droppedVideoFrames,
        droppedFrames: quality.droppedVideoFrames,
      })
      const stats = measure(snapshot, previous)
      previous = snapshot
      display(stats)
      if (snapshot.id && video.videoWidth) {
        if (report.samples.length === MAX_SAMPLES) report.samples.shift()
        report.samples.push(stats)
        download.disabled = false
      }
      session.timer = setTimeout(sample, 1000)
    } catch (error) { fail(error) }
  }
  session.timer = setTimeout(sample, 1000)
}

button.addEventListener('click', () => {
  if (connection) { stop('Desconectado'); return }
  try { connect() } catch (error) { status.textContent = error.message }
})
download.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'lira-gstreamer-p2p.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})
window.addEventListener('pagehide', () => stop('Desconectado'))
