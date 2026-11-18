const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const { pipeline } = require('node:stream/promises')
const path = require('node:path')

const VERSION = '1.28.8'
const INSTALLER = `gstreamer-1.0-msvc-x86_64-${VERSION}.exe`
const SHA256 = 'e4c41ee6ee9c6c32a45d198463ec08d79bac3bd5fa58adc93d13fe4a08abc9d9'
const SOURCE = `https://gstreamer.freedesktop.org/data/pkg/windows/${VERSION}/msvc/${INSTALLER}`
const pluginPath = 'lib/gstreamer-1.0'
const plugins = [
  'coreelements', 'app', 'debugutilsbad', 'd3d11', 'amfcodec', 'videoparsersbad', 'rswebrtc',
  'webrtc', 'nice', 'dtls', 'srtp', 'rtp', 'rtpmanager', 'udp',
]
const runtimeFiles = [
  'bin/gst-launch-1.0.exe', 'libexec/gstreamer-1.0/gst-plugin-scanner.exe',
  ...plugins.map(name => `${pluginPath}/gst${name}.dll`),
]

// Follow the Windows PE import and delay-import directories so the private
// runtime ships the dependencies of the selected plugins, including the scanner.
function importedDlls(image) {
  if (image.toString('ascii', 0, 2) !== 'MZ') throw new Error('Imagem PE inválida')
  const pe = image.readUInt32LE(0x3c)
  if (image.readUInt32LE(pe) !== 0x4550 || image.readUInt16LE(pe + 4) !== 0x8664) {
    throw new Error('O runtime precisa conter binários Windows x64')
  }
  const header = pe + 24
  const sections = header + image.readUInt16LE(pe + 20)
  const count = image.readUInt16LE(pe + 6)
  const directory = header + 112
  const imageBase = image.readBigUInt64LE(header + 24)

  function offset(rva) {
    for (let i = 0; i < count; i++) {
      const entry = sections + i * 40
      const start = image.readUInt32LE(entry + 12)
      if (rva >= start && rva - start < image.readUInt32LE(entry + 16)) {
        return image.readUInt32LE(entry + 20) + rva - start
      }
    }
    throw new Error(`Endereço inválido na tabela de importação: ${rva}`)
  }

  const names = []
  for (const { index, size, nameOffset } of [{ index: 1, size: 20, nameOffset: 12 }, { index: 13, size: 32, nameOffset: 4 }]) {
    const start = image.readUInt32LE(directory + index * 8)
    const length = image.readUInt32LE(directory + index * 8 + 4)
    if (!start) continue
    const base = offset(start)
    for (let entry = base; entry + size <= base + length; entry += size) {
      let name = image.readUInt32LE(entry + nameOffset)
      if (!name) break
      if (index === 13 && (image.readUInt32LE(entry) & 1) === 0) name = Number(BigInt(name) - imageBase)
      const from = offset(name)
      const end = image.indexOf(0, from)
      if (end === -1) throw new Error('Nome DLL inválido na tabela de importação')
      names.push(image.toString('ascii', from, end).toLowerCase())
    }
  }
  return names
}

function stageRuntime(root, target, { synthetic = false } = {}) {
  const provided = new Map(fs.readdirSync(path.join(root, 'bin'))
    .filter(name => /\.dll$/i.test(name)).map(name => [name.toLowerCase(), `bin/${name}`]))
  const queue = [...runtimeFiles]
  if (synthetic) queue.push(`${pluginPath}/gstvideotestsrc.dll`)
  const files = new Set()
  let bytes = 0
  for (const file of queue) {
    if (files.has(file)) continue
    const contents = fs.readFileSync(path.join(root, file))
    files.add(file)
    bytes += contents.length
    fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true })
    fs.writeFileSync(path.join(target, file), contents)
    for (const name of importedDlls(contents)) {
      const dependency = provided.get(name)
      if (dependency && !files.has(dependency)) queue.push(dependency)
    }
  }
  fs.cpSync(path.join(root, 'share', 'licenses'), path.join(target, 'licenses'), { recursive: true })
  fs.copyFileSync(path.join(root, 'share', 'versions.txt'), path.join(target, 'versions.txt'))
  fs.writeFileSync(path.join(target, 'UPSTREAM.txt'), [
    `GStreamer ${VERSION} runtime for Windows x64, distributed as separate, dynamically loaded executables and libraries.`,
    `Upstream binary distribution: ${SOURCE}`,
    'Source, build recipes, and dependency source locations:',
    `https://gitlab.freedesktop.org/gstreamer/cerbero/-/tree/${VERSION}`,
    'https://gstreamer.freedesktop.org/src/',
    'See licenses/ and versions.txt for the upstream license texts and component versions.',
  ].join('\n') + '\n')
  return { bytes, files: [...files].sort() }
}

async function checksum(file) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

function runInstaller(installer, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn(installer, [
      '/CURRENTUSER', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART',
      '/TYPE=runtime', `/DIR=${destination}`,
    ], { windowsHide: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Instalador GStreamer encerrou com código ${code}`)))
  })
}

function isPinnedRuntime(root) {
  try {
    return fs.readFileSync(path.join(root, 'share', 'versions.txt'), 'utf8').split(/\r?\n/)[0] === `cerbero ${VERSION}` &&
      runtimeFiles.every(file => fs.existsSync(path.join(root, file)))
  }
  catch { return false }
}

async function prepare() {
  if (process.platform !== 'win32') throw new Error('O runtime GStreamer deste pacote é para Windows x64')
  const project = fs.realpathSync(path.join(__dirname, '..'))
  const scratch = path.join(project, '.scratch')
  fs.mkdirSync(scratch, { recursive: true })
  if (fs.realpathSync(scratch).toLowerCase() !== scratch.toLowerCase()) throw new Error('Diretório .scratch redirecionado')
  const target = path.join(scratch, 'gstreamer-runtime')
  const source = [process.env.LIRA_GSTREAMER_ROOT, process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'gstreamer/1.0/msvc_x86_64'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs/gstreamer/1.0/msvc_x86_64'),
  ].find(folder => folder && isPinnedRuntime(folder))
  let root = source
  if (!root) {
    root = path.join(scratch, `gstreamer-upstream-${VERSION}`)
    if (!isPinnedRuntime(root)) {
      const installer = path.join(scratch, INSTALLER)
      if (!fs.existsSync(installer) || await checksum(installer) !== SHA256) {
        const response = await fetch(SOURCE, { signal: AbortSignal.timeout(180_000) })
        if (!response.ok || !response.body) throw new Error(`Download do GStreamer retornou HTTP ${response.status}`)
        await pipeline(response.body, fs.createWriteStream(installer))
      }
      if (await checksum(installer) !== SHA256) throw new Error('SHA-256 do instalador GStreamer inválido')
      await runInstaller(installer, root)
    }
  }
  if (!isPinnedRuntime(root)) throw new Error(`Runtime GStreamer ${VERSION} ausente ou incompleto`)
  if (fs.existsSync(target)) {
    if (fs.realpathSync(target).toLowerCase() !== target.toLowerCase()) throw new Error('Diretório GStreamer redirecionado')
    fs.rmSync(target, { force: true, recursive: true })
  }
  const result = stageRuntime(root, target)
  console.log(`[GStreamer] ${result.files.length} binários, ${(result.bytes / 1_000_000).toFixed(1)} MB antes da compressão.`)
}

module.exports = { runtimeFiles, stageRuntime }
if (require.main === module) prepare().catch(error => { console.error(error.message); process.exitCode = 1 })
