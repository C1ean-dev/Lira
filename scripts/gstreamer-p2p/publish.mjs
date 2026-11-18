import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isIPv4 } from 'node:net'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const receiverDirectory = fileURLToPath(new URL('./receiver/', import.meta.url))

function integer(label, value, minimum, maximum) {
  if (!/^-?\d+$/.test(value)) throw new Error(`${label} deve ser um inteiro`)
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum)
    throw new Error(`${label} deve estar entre ${minimum} e ${maximum}`)
  return number
}

export function optionsFrom(args) {
  const { values } = parseArgs({ args, options: {
    source: { type: 'string', default: 'test' },
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '8080' },
    'signal-port': { type: 'string', default: '8443' },
    resolution: { type: 'string', default: '1080' },
    fps: { type: 'string', default: '60' },
    'bitrate-kbps': { type: 'string', default: '8000' },
    monitor: { type: 'string' },
    'window-handle': { type: 'string' },
    'gst-bin': { type: 'string' },
    check: { type: 'boolean' },
    help: { type: 'boolean' },
  } })
  const { source, host, check, help } = values
  if (!['test', 'screen'].includes(source)) throw new Error('--source aceita test ou screen')
  if (!isIPv4(host) || !/^(127\.0\.0\.1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))
    throw new Error('--host deve ser 127.0.0.1 ou um IPv4 privado da placa de rede do apresentador')
  if (!['720', '1080'].includes(values.resolution)) throw new Error('--resolution aceita 720 ou 1080')
  if (!['30', '60'].includes(values.fps)) throw new Error('--fps aceita 30 ou 60')
  if (values.monitor !== undefined && values['window-handle'] !== undefined)
    throw new Error('Escolha --monitor ou --window-handle')
  if (source === 'test' && (values.monitor !== undefined || values['window-handle'] !== undefined))
    throw new Error('Escolha --source screen para capturar um monitor ou janela')

  const port = integer('--port', values.port, 1024, 65535)
  const signalPort = integer('--signal-port', values['signal-port'], 1024, 65535)
  if (port === signalPort) throw new Error('As portas HTTP e de sinalização devem ser diferentes')
  return {
    source, host, port, signalPort, check, help,
    gstBin: values['gst-bin'],
    width: values.resolution === '1080' ? 1920 : 1280,
    height: Number(values.resolution), fps: Number(values.fps),
    bitrate: integer('--bitrate-kbps', values['bitrate-kbps'], 1000, 30000),
    monitor: integer('--monitor', values.monitor ?? '-1', -1, 63),
    windowHandle: values['window-handle'] === undefined
      ? null : integer('--window-handle', values['window-handle'], 1, Number.MAX_SAFE_INTEGER),
  }
}

export function receiverUrl({ host, port, signalPort }) {
  return `http://${host}:${port}/index.html?signal=${signalPort}`
}

export function requiredElements({ source }) {
  const capture = source === 'screen' ? ['d3d11screencapturesrc', 'd3d11convert'] : ['videotestsrc']
  return [...capture, 'amfh264enc', 'h264parse', 'webrtcsink', 'webrtcbin', 'nicesrc', 'rtph264pay']
}

export function pipeline(options) {
  const { source, monitor, windowHandle, fps, width, height, bitrate, host, port, signalPort } = options
  const caps = `format=NV12,width=${width},height=${height},framerate=${fps}/1`
  const capture = source === 'screen' ? [
    'd3d11screencapturesrc', 'show-cursor=true',
    ...(windowHandle === null
      ? ['capture-api=dxgi', `monitor-index=${monitor}`]
      : ['capture-api=wgc', `window-handle=${windowHandle}`]),
    '!', `video/x-raw(memory:D3D11Memory),framerate=${fps}/1`,
    '!', 'queue', 'max-size-buffers=2', 'max-size-bytes=0', 'max-size-time=0', 'leaky=downstream',
    '!', 'd3d11convert', 'add-borders=true',
    '!', `video/x-raw(memory:D3D11Memory),${caps}`,
  ] : [
    'videotestsrc', 'is-live=true', 'pattern=ball',
    '!', `video/x-raw,${caps}`,
  ]
  return [
    '-v', ...capture,
    '!', 'amfh264enc', 'usage=low-latency', 'rate-control=cbr', 'cabac=false',
    `bitrate=${bitrate}`, `gop-size=${fps}`,
    '!', 'h264parse', 'config-interval=-1',
    '!', 'video/x-h264,profile=constrained-baseline,stream-format=byte-stream,alignment=au',
    '!', 'webrtcsink', 'video-caps=video/x-h264',
    'congestion-control=disabled', 'do-retransmission=true', 'stun-server=NULL',
    'run-signalling-server=true', `signalling-server-host=${host}`, `signalling-server-port=${signalPort}`,
    'run-web-server=true', `web-server-host-addr=http://${host}:${port}`, 'web-server-directory=.',
  ]
}

function findBin(explicit) {
  const preferred = explicit ?? process.env.LIRA_GSTREAMER_BIN
  if (preferred) return resolve(preferred)
  const roots = [process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64, process.env.GSTREAMER_ROOT,
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'gstreamer', '1.0', 'msvc_x86_64'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'gstreamer', '1.0', 'msvc_x86_64'),
    'C:\\gstreamer\\1.0\\msvc_x86_64',
  ]
  return roots.filter(Boolean).map(root => join(root, 'bin'))
    .find(folder => existsSync(join(folder, 'gst-launch-1.0.exe')))
}

function run(options) {
  if (options.help) {
    console.log('node scripts/gstreamer-p2p/publish.mjs [--check] [--source test|screen] [--monitor N | --window-handle HWND]\n'
      + '  [--host IPv4] [--port PORTA] [--signal-port PORTA] [--resolution 720|1080]\n'
      + '  [--fps 30|60] [--bitrate-kbps N] [--gst-bin PASTA]')
    return
  }
  if (process.platform !== 'win32') throw new Error('Este protótipo usa o encoder AMD AMF no Windows')
  const bin = findBin(options.gstBin)
  const command = name => bin ? join(bin, `${name}.exe`) : `${name}.exe`
  const invoke = args => spawnSync(command('gst-inspect-1.0'), args, {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
  })
  for (const element of requiredElements(options)) {
    const inspected = invoke([element])
    if (inspected.error?.code === 'ENOENT')
      throw new Error('GStreamer não encontrado. Instale o runtime MSVC x64 ou informe sua pasta bin com --gst-bin')
    if (inspected.status !== 0)
      throw new Error(`Elemento indisponível: ${element}. ${inspected.error?.message ?? inspected.stderr.trim()}`)
    if (element === 'webrtcsink' && !['run-signalling-server', 'run-web-server'].every(property => inspected.stdout.includes(property)))
      throw new Error('O webrtcsink precisa incluir os servidores locais de sinalização e da página')
  }
  console.log('Elementos GStreamer disponíveis. Encoder selecionado: amfh264enc (AMD AMF).')
  if (options.check) return

  console.log(`Abra no receptor: ${receiverUrl(options)}`)
  console.log(`${options.source === 'test' ? 'Fonte sintética' : 'Captura de tela'} · ${options.width}×${options.height} a ${options.fps} FPS · ${options.bitrate} kbps. Ctrl+C encerra.`)
  const publisher = spawn(command('gst-launch-1.0'), pipeline(options), { cwd: receiverDirectory, stdio: 'inherit' })
  const stop = () => publisher.kill()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  publisher.once('error', error => { console.error(error.message); process.exitCode = 1 })
  publisher.once('close', code => {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    process.exitCode = code ?? 0
  })
}

if (import.meta.main) {
  try { run(optionsFrom(process.argv.slice(2))) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
