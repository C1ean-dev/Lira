import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, delimiter } from 'node:path'
import { findCaptureDisplay } from './captureDisplay'
import { gstreamerSignalSchema, type GStreamerCapture, type GStreamerSignal } from '../src/media/gstreamerProtocol'

type Source = { windowHandle: string } | { monitorIndex: number } | { monitorHandle: string }
type Quality = Pick<GStreamerCapture, 'width' | 'height' | 'fps'>

export function resolveGStreamerSource(
  sourceId: string,
  sources: readonly { id: string; display_id: string }[],
  displays: readonly { id: number }[],
): Source | { displayId: number } | null {
  const source = sources.find(item => item.id === sourceId)
  if (!source) return null
  const win = /^window:([1-9]\d{0,15}):\d+$/.exec(source.id)
  if (win) return { windowHandle: win[1] }
  const display = findCaptureDisplay(sourceId, sources, displays)
  if (!display) return null
  // Electron display IDs are not DXGI monitor indices.
  return displays.length === 1 ? { monitorIndex: 0 } : { displayId: display.id }
}

export function getGStreamerMonitorHandle(helper: string, point: { x: number; y: number }): Promise<string | null> {
  return new Promise(resolve => {
    execFile(helper, ['--monitor-handle-at', String(point.x), String(point.y)], { windowsHide: true, timeout: 2000 }, (error, output) => {
      const handle = output.trim()
      resolve(!error && /^[1-9]\d{0,19}$/.test(handle) ? handle : null)
    })
  })
}

export function buildGStreamerPipeline(source: Source | 'test', quality: Quality, uri: string, token: string, stun = 'stun://stun.l.google.com:19302'): string[] {
  const { width, height, fps } = quality
  const geometry = `format=NV12,width=${width},height=${height},framerate=${fps}/1`
  const capture = source === 'test'
    ? ['videotestsrc', 'is-live=true', 'pattern=ball', '!', `video/x-raw,${geometry}`]
    : ['d3d11screencapturesrc', 'show-cursor=true',
      ...('windowHandle' in source ? ['capture-api=wgc', `window-handle=${source.windowHandle}`]
        : ['capture-api=dxgi', 'monitorHandle' in source ? `monitor-handle=${source.monitorHandle}` : `monitor-index=${source.monitorIndex}`]),
      '!', `video/x-raw(memory:D3D11Memory),framerate=${fps}/1`,
      '!', 'queue', 'max-size-buffers=2', 'max-size-bytes=0', 'max-size-time=0', 'leaky=downstream',
      '!', 'd3d11convert', 'add-borders=true', '!', `video/x-raw(memory:D3D11Memory),${geometry}`]
  const bitrate = height === 480 ? 2500 : height === 720 ? (fps === 60 ? 5000 : 3500) : (fps === 60 ? 8000 : 5000)
  return [
    '-q', ...capture,
    '!', 'amfh264enc', 'usage=low-latency', 'rate-control=cbr', 'cabac=false', `bitrate=${bitrate}`, `gop-size=${fps}`,
    '!', 'h264parse', 'config-interval=-1',
    '!', 'video/x-h264,profile=(string){constrained-baseline,baseline},stream-format=avc,alignment=au',
    '!', 'webrtcsink', 'video-caps=video/x-h264', 'congestion-control=disabled', 'do-retransmission=true',
    `stun-server=${stun}`, 'run-web-server=false', 'run-signalling-server=false', `signaller::uri=${uri}`,
    `signaller::headers=headers,lira-token=(string)${token}`,
  ]
}

export function findGStreamerRuntime(packaged: boolean, resources: string): string | undefined {
  if (process.platform !== 'win32' || process.arch !== 'x64') return
  const inProgramFiles = (base?: string) => base && join(base, 'gstreamer', '1.0', 'msvc_x86_64')
  const roots = packaged ? [join(resources, 'gstreamer')] : [
    process.env.LIRA_GSTREAMER_ROOT, process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64,
    inProgramFiles(process.env.ProgramFiles), inProgramFiles(process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')),
  ]
  return roots.find((root): root is string => !!root && existsSync(join(root, 'bin', 'gst-launch-1.0.exe')))
}

type ProducerSocket = {
  send(data: string): void
  terminate(): void
  on(event: 'message', handler: (data: Buffer) => void): void
  on(event: 'close' | 'error', handler: () => void): void
}
const nodeRequire = createRequire(import.meta.url)
const IPC_SESSION_LIMIT = 33

/** The only local socket accepts the native producer. Viewers use authenticated Lira room signalling. */
export function launchGStreamer(
  root: string, registry: string, source: Source | 'test', quality: Quality,
  emit: (signal: GStreamerSignal | null) => void,
  log: (error: string) => void,
  stun?: string,
) {
  const server = createServer((_req, res) => res.writeHead(404).end())
  const token = randomUUID()
  const producerId = randomUUID()
  const sockets = new (nodeRequire('ws').WebSocketServer)({
    noServer: true, maxPayload: 150_000, perMessageDeflate: false,
  })
  const sessions = new Map<string, boolean>()
  let producer: ProducerSocket | undefined
  let child: ReturnType<typeof spawn> | undefined
  let closed = false
  let registered = false
  let resolveReady!: (value: boolean) => void
  let resolveStopped!: () => void
  const ready = new Promise<boolean>(resolve => { resolveReady = resolve })
  const stopped = new Promise<void>(resolve => { resolveStopped = resolve })
  const timeout = setTimeout(() => finish('Tempo esgotado ao iniciar o GStreamer.'), 8_000)
  const send = (data: object) => producer?.send(JSON.stringify(data))
  const stop = () => {
    if (closed) return
    closed = true
    clearTimeout(timeout)
    resolveReady(false)
    sessions.clear()
    producer?.terminate()
    sockets.close()
    server.close()
    if (child) child.kill()
    else resolveStopped()
  }
  const finish = (reason: string) => {
    if (closed) return
    stop()
    log(reason)
    if (registered) emit(null)
  }
  server.on('error', error => finish(error.message))
  server.on('upgrade', (request, socket, head) => {
    if (closed || producer || request.url !== '/native' || request.headers['lira-token'] !== token) {
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, (ws: ProducerSocket) => {
      producer = ws
      ws.on('error', () => finish('Falha na sinalização local do GStreamer.'))
      ws.on('close', () => finish('A sinalização local do GStreamer foi encerrada.'))
      ws.on('message', bytes => {
        let message
        try { message = JSON.parse(bytes.toString()) } catch { return }
        if (message?.type === 'setPeerStatus' && Array.isArray(message.roles) && message.roles.includes('producer')) {
          registered = true
          clearTimeout(timeout)
          resolveReady(true)
          return
        }
        if (!sessions.has(message?.sessionId)) return
        const session = message.sessionId
        const signal = message.type === 'peer' && message.sdp?.type === 'offer'
          ? { kind: 'sdp', session, description: message.sdp }
          : message.type === 'peer' && message.ice
            ? { kind: 'ice', session, candidate: message.ice }
            : ['endSession', 'endSessionV1_1'].includes(message.type) ? { kind: 'end', session } : null
        const parsed = gstreamerSignalSchema.safeParse(signal)
        if (!parsed.success) return
        if (parsed.data.kind === 'end') sessions.delete(session)
        emit(parsed.data)
      })
      send({ type: 'welcome', peerId: producerId })
    })
  })
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (closed || !address || typeof address === 'string') return
    const bin = join(root, 'bin')
    child = spawn(join(bin, 'gst-launch-1.0.exe'),
      buildGStreamerPipeline(source, quality, `ws://127.0.0.1:${address.port}/native`, token, stun), {
        cwd: bin, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env, PATH: [bin, process.env.PATH].filter(Boolean).join(delimiter),
          GST_PLUGIN_PATH: '', GST_PLUGIN_PATH_1_0: '', GST_PLUGIN_SYSTEM_PATH: '', GST_PLUGIN_SYSTEM_PATH_1_0: join(root, 'lib', 'gstreamer-1.0'),
          GST_PLUGIN_SCANNER: join(root, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner.exe'),
          GST_REGISTRY: registry, GST_DEBUG: '2', GST_DEBUG_NO_COLOR: '1',
        },
      })
    let stderr = ''
    child.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-2400) })
    child.once('error', error => finish(error.message))
    child.once('exit', code => finish(`GStreamer encerrou (${code ?? 'sinal'}). ${stderr.split(token).join('[token]').trim()}`))
    child.once('close', resolveStopped)
  })
  return {
    ready,
    stopped,
    stop,
    signal(message: GStreamerSignal): boolean {
      if (closed || !registered) return false
      const sessionId = message.session
      if (message.kind === 'watch') {
        if (sessions.has(sessionId)) return true
        if (sessions.size >= IPC_SESSION_LIMIT) return false
        sessions.set(sessionId, false)
        send({ type: 'startSession', sessionId, peerId: sessionId })
      } else if (!sessions.has(sessionId)) return false
      else if (message.kind === 'end') {
        sessions.delete(sessionId)
        send({ type: 'endSession', sessionId })
      } else if (message.kind === 'sdp' && message.description.type === 'answer' && !sessions.get(sessionId)) {
        sessions.set(sessionId, true)
        send({ type: 'peer', sessionId, sdp: message.description })
      } else if (message.kind === 'ice') send({ type: 'peer', sessionId, ice: message.candidate })
      else return false
      return true
    },
  }
}
