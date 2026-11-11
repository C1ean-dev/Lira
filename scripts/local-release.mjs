import fs from 'node:fs/promises'
import { existsSync, createWriteStream } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateNextVersion } from './bump-version.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stableVersion = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function selectVersion(current, tags, releases) {
  if (!stableVersion.test(current)) throw new Error('Versão inválida em package.json')
  const versions = [...tags, ...releases].filter(tag => stableVersion.test(tag))
  versions.sort((a, b) => {
    const left = a.replace(/^v/, '').split('.').map(Number)
    const right = b.replace(/^v/, '').split('.').map(Number)
    return right[0] - left[0] || right[1] - left[1] || right[2] - left[2]
  })
  return calculateNextVersion(current, versions[0] || '')
}

/** Disables Go's HTTP/2 client so large gh release uploads do not stall on multiplexed streams. */
export function ghUploadEnvironment(env = process.env) {
  const current = (env.GODEBUG || '').split(',').map(part => part.trim()).filter(Boolean)
  if (!current.some(part => part.startsWith('http2client='))) current.push('http2client=0')
  return { ...env, GODEBUG: current.join(',') }
}

/** Uploads one release asset sequentially with --clobber retries for transient HTTP 408 stalls. */
async function uploadReleaseAsset(exec, { repository, tagName, asset, env, maxAttempts = 3, retryDelayMs = 5000 }) {
  const uploadEnv = ghUploadEnvironment(env)
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await exec('gh', ['release', 'upload', tagName, asset, '--repo', repository, '--clobber'], { env: uploadEnv })
      return
    } catch (error) {
      if (attempt === maxAttempts) throw error
      console.warn(`Falha ao enviar ${path.basename(asset)} (tentativa ${attempt}/${maxAttempts}): ${error.message}. Tentando novamente...`)
      if (retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs))
    }
  }
}

/** Removes the temporary worktree even when Android build paths exceed Windows MAX_PATH. */
async function cleanupTemporaryWorktree(exec, { temporary, source, worktreeAdded }) {
  if (!temporary) return
  const removeDirectory = target => fs.rm(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 })
  if (!worktreeAdded) {
    await removeDirectory(temporary)
    return
  }
  const resolved = await fs.realpath(temporary)
  const resolvedSource = await fs.realpath(source)
  if (resolved !== temporary || resolvedSource !== path.join(resolved, 'source')) throw new Error('Caminho de limpeza inválido')
  let removedByGit = true
  try { await exec('git', ['-c', 'core.longpaths=true', 'worktree', 'remove', '--force', source]) }
  catch { removedByGit = false }
  // Git can leave ignored files behind or abort on locked/long paths; Node handles \\?\ paths and retries.
  await removeDirectory(resolved)
  if (!removedByGit) await exec('git', ['worktree', 'prune'])
}

export function buildEnvironment(env, version) {
  const result = { ...env }
  for (const name of ['GITHUB_OUTPUT', 'LIRA_TARGET', 'VITEST', 'NODE_ENV', 'VITE_DEV_SERVER_URL']) delete result[name]
  const [major, minor, patch] = version.split('.').map(Number)
  if (minor > 99 || patch > 999) throw new Error('Versão excede o formato de versionCode Android; incremente minor/major.')
  return { ...result, VITE_APP_VERSION: version, LIRA_VERSION_NAME: version,
    LIRA_VERSION_CODE: String(major * 100000 + minor * 1000 + patch),
    CSC_IDENTITY_AUTO_DISCOVERY: 'false', ONNXRUNTIME_NODE_INSTALL_CUDA: 'skip' }
}

function npmCli() {
  const candidates = [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]
  const located = spawnSync('where.exe', ['npm'], { encoding: 'utf8', windowsHide: true })
  for (const entry of (located.stdout || '').trim().split(/\r?\n/)) {
    candidates.push(path.join(path.dirname(entry), 'node_modules/npm/bin/npm-cli.js'))
  }
  const cli = candidates.find(existsSync)
  if (!cli) throw new Error('npm não encontrado. Instale Node.js 22.12 ou superior com npm.')
  return cli
}

/** No shell interpolation: npm runs through Node; Gradle uses a fixed batch command. */
export function commandInvocation(command, args, platform = process.platform, cli = npmCli) {
  if (platform === 'win32' && command === 'npm') return { command: process.execPath, args: [cli(), ...args] }
  if (platform === 'win32' && command === 'gradle') return {
    command: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', 'gradlew.bat assembleRelease --no-daemon'],
  }
  return { command, args }
}

export function createRunner(logFile) {
  return async (command, args, { cwd, env = process.env, quiet = false } = {}) => {
    const invocation = commandInvocation(command, args)
    console.log(`\n[publicação] ${command} ${args.join(' ')}`)
    const log = createWriteStream(logFile, { flags: 'a' })
    log.write(`\n> ${command} ${args.join(' ')}\n`)
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(invocation.command, invocation.args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''
        const receive = (chunk, stream) => {
          output = (output + chunk.toString()).slice(-4 * 1024 * 1024)
          log.write(chunk)
          if (!quiet) stream.write(chunk)
        }
        child.stdout.on('data', chunk => receive(chunk, process.stdout))
        child.stderr.on('data', chunk => receive(chunk, process.stderr))
        child.once('error', reject)
        child.once('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`${command} falhou (código ${code}). Veja ${logFile}`)))
      })
    } finally { await new Promise(resolve => log.end(resolve)) }
  }
}

async function loadEnvironment(root, env) {
  let configured = {}
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local', '.env.release.local']) {
    try { configured = { ...configured, ...parseEnv(await fs.readFile(path.join(root, file), 'utf8')) } }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return { ...configured, ...env }
}

/** Parses CLI options for building a new release or resuming a failed upload. */
export function parseCliArgs(args) {
  if (!args.length) return { mode: 'release', ref: 'origin/main' }
  if (args.length === 2 && args[0] === '--ref' && args[1]) return { mode: 'release', ref: args[1] }
  if (args.length === 2 && args[0] === '--resume' && args[1]) return { mode: 'resume', output: args[1] }
  throw new Error('Uso: npm run release -- [--ref origin/main|HEAD|commit | --resume pasta-da-release]')
}

function validateRuntime(platform) {
  if (platform !== 'win32') throw new Error('Execute esta publicação no Windows (Windows e Android).')
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
  if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 12)) throw new Error('Use Node.js 22.12 ou superior.')
}

async function withReleaseLock(exec, root, output, fn) {
  const common = path.resolve(root, (await exec('git', ['rev-parse', '--git-common-dir'], { quiet: true })).trim())
  const lockFile = path.join(common, 'lira-release.lock')
  let lock
  try { lock = await fs.open(lockFile, 'wx') }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Há uma publicação em andamento. Se foi interrompida, confira o processo e remova ${lockFile}.`)
    throw error
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, started: new Date().toISOString(), output }))
    return await fn()
  } finally {
    await lock.close()
    await fs.unlink(lockFile)
  }
}

async function publishDraftAssets(exec, { repository, tagName, commit, releaseTitle, assets, env, uploadRetryDelayMs, existingAssets = null }) {
  for (const file of assets) if (!(await fs.stat(file)).size) throw new Error('Artefato vazio: ' + file)
  if (existingAssets === null) {
    // Draft keeps the previous public version active until both sequential uploads succeed.
    await exec('gh', ['release', 'create', tagName, '--repo', repository,
      '--target', commit, '--title', releaseTitle, '--draft', '--generate-notes'])
  }
  const uploaded = existingAssets || []
  for (const asset of assets) {
    const assetSize = (await fs.stat(asset)).size
    const alreadyUploaded = uploaded.some(entry => entry.name === path.basename(asset) && entry.size === assetSize && entry.state === 'uploaded')
    if (alreadyUploaded) continue
    await uploadReleaseAsset(exec, { repository, tagName, asset, env, retryDelayMs: uploadRetryDelayMs })
  }
  await exec('gh', ['release', 'edit', tagName, '--repo', repository, '--draft=false', '--latest'])
}

function logFailure(output, assets) {
  console.error(`Publicação interrompida. Logs e artefatos: ${output}. Se houver um rascunho no GitHub, confira os dois anexos antes de publicá-lo.`)
  if (assets?.length) console.error(`Para retomar apenas o envio dos artefatos prontos sem recompilar: npm run release -- --resume ${output}`)
}

export async function runRelease({ root = projectRoot, run, env = process.env, platform = process.platform, ref = 'origin/main', uploadRetryDelayMs = 5000 } = {}) {
  validateRuntime(platform)
  if (!ref || ref.startsWith('-')) throw new Error('Referência Git inválida.')
  env = await loadEnvironment(root, env)
  if (env.LIRA_JAVA_HOME) env.JAVA_HOME = path.resolve(root, env.LIRA_JAVA_HOME)
  const output = path.join(root, '.scratch/local-releases', new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid)
  await fs.mkdir(output, { recursive: true })
  run ||= createRunner(path.join(output, 'release.log'))
  const exec = (command, args, options = {}) => run(command, args, { cwd: root, env, ...options })
  return withReleaseLock(exec, root, output, async () => {
    let temporary
    let source
    let worktreeAdded = false
    const state = { status: 'preparing', ref, output, assets: [] }
    const saveState = () => fs.writeFile(path.join(output, 'release.json'), JSON.stringify(state, null, 2) + '\n')
    try {
      console.log(`\nLogs e arquivos desta publicação: ${output}`)
      await exec('gh', ['auth', 'status'])
      const remote = await exec('git', ['remote', 'get-url', 'origin'], { quiet: true })
      const match = remote.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/)
      if (!match) throw new Error('origin deve apontar para um repositório GitHub por HTTPS ou SSH.')
      const repository = match[1]
      state.repository = repository
      await exec('git', ['fetch', 'origin', '--tags'])
      const commit = (await exec('git', ['rev-parse', '--verify', `${ref}^{commit}`], { quiet: true })).trim()
      if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Commit de publicação inválido.')
      // GitHub must know the exact source commit; never create a tag on a different HEAD.
      const remoteCommit = (await exec('gh', ['api', `repos/${repository}/commits/${commit}`, '--jq', '.sha'], { quiet: true })).trim()
      if (remoteCommit !== commit) throw new Error('Envie o commit ao GitHub antes de publicar.')
      state.commit = commit
      const java = env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin/java.exe') : 'java'
      const javaVersion = await exec(java, ['-version'], { quiet: true })
      if (Number(javaVersion.match(/version\s+"(\d+)/)?.[1]) < 21 || !/version\s+"\d+/.test(javaVersion)) throw new Error('Instale JDK 21 ou superior e configure LIRA_JAVA_HOME ou JAVA_HOME.')
      const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || (env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Android/Sdk'))
      for (const part of ['platforms/android-35', 'build-tools/35.0.0', 'platform-tools']) {
        if (!sdk || !existsSync(path.join(sdk, part))) throw new Error(`Android SDK ausente: ${part}. Configure ANDROID_HOME.`)
      }
      const keystore = path.resolve(root, env.LIRA_KEYSTORE_PATH || 'android/app/lira-release.jks')
      if (!existsSync(keystore)) throw new Error('Keystore Android não encontrado. Configure LIRA_KEYSTORE_PATH com a chave usada nas versões anteriores.')
      await exec('powershell', ['-NoProfile', '-Command', "$v = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\\Installer\\vswhere.exe'; if (!(Test-Path -LiteralPath $v)) { throw 'Instale Visual Studio Build Tools com C++' }; $p = & $v -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath; if (!$p) { throw 'Instale o componente Desktop development with C++' }"])
      temporary = await fs.mkdtemp(path.join(await fs.realpath(tmpdir()), 'lira-publish-'))
      source = path.join(temporary, 'source')
      await exec('git', ['-c', 'core.longpaths=true', 'worktree', 'add', '--detach', source, commit])
      worktreeAdded = true
      const pkgFile = path.join(source, 'package.json')
      const pkg = JSON.parse(await fs.readFile(pkgFile, 'utf8'))
      const tags = (await exec('git', ['tag', '--list', 'v*'], { quiet: true })).split(/\r?\n/)
      const releases = JSON.parse(await exec('gh', ['release', 'list', '--repo', repository, '--limit', '1000', '--json', 'tagName'], { quiet: true }))
      const { version, tagName, releaseTitle } = selectVersion(pkg.version, tags, releases.map(release => release.tagName))
      Object.assign(state, { tag: tagName, version, status: 'building' })
      await saveState()
      const buildEnv = buildEnvironment({ ...env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, LIRA_KEYSTORE_PATH: keystore }, version)
      const atSource = (command, args, extra = {}) => exec(command, args, { cwd: source, env: buildEnv, ...extra })
      await atSource('npm', ['ci'])
      // Update only the isolated checkout, keeping both npm manifests consistent.
      pkg.version = version
      await fs.writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
      const lockPath = path.join(source, 'package-lock.json')
      const packageLock = JSON.parse(await fs.readFile(lockPath, 'utf8'))
      packageLock.version = version
      if (packageLock.packages?.['']) packageLock.packages[''].version = version
      await fs.writeFile(lockPath, JSON.stringify(packageLock, null, 2) + '\n')
      await atSource('npm', ['run', 'build'])
      const executables = (await fs.readdir(path.join(source, 'release'))).filter(file => file.toLowerCase().endsWith('.exe'))
      if (executables.length !== 1) throw new Error('Artefato Windows: esperado exatamente um instalador .exe novo.')
      const windowsAsset = path.join(output, `Lira.Setup.${version}.exe`)
      await fs.copyFile(path.join(source, 'release', executables[0]), windowsAsset)
      // The Windows build already type-checks the shared sources. Only Vite needs the web target.
      const webEnv = { ...buildEnv, LIRA_TARGET: 'web' }
      await atSource('npm', ['exec', '--', 'vite', 'build'], { env: webEnv })
      await atSource('npm', ['exec', '--', 'cap', 'sync', 'android'], { env: webEnv })
      await atSource('gradle', ['assembleRelease', '--no-daemon'], { cwd: path.join(source, 'android'), env: webEnv })
      const apk = path.join(source, 'android/app/build/outputs/apk/release/app-release.apk')
      if (!existsSync(apk)) throw new Error('Artefato Android: APK release assinado não foi gerado.')
      const androidAsset = path.join(output, `Lira-${tagName}.apk`)
      await fs.copyFile(apk, androidAsset)
      const apksigner = path.join(sdk, 'build-tools/35.0.0/lib/apksigner.jar')
      await atSource(java, ['-jar', apksigner, 'verify', '--verbose', androidAsset])
      state.assets = [windowsAsset, androidAsset]
      state.status = 'uploading'; await saveState()
      await publishDraftAssets(exec, { repository, tagName, commit, releaseTitle, assets: state.assets, env, uploadRetryDelayMs })
      state.status = 'published'; await saveState()
      const url = `https://github.com/${repository}/releases/tag/${tagName}`
      console.log(`\nAtualização publicada: ${url}`)
      return { tag: tagName, commit, url, output }
    } catch (error) {
      state.status = 'failed'
      state.error = error.message
      await saveState()
      logFailure(output, state.assets)
      throw error
    } finally {
      try {
        await cleanupTemporaryWorktree(exec, { temporary, source, worktreeAdded })
      } catch (error) { console.error(`Cópia temporária preservada em ${temporary}: ${error.message}`) }
    }
  })
}

/** Resumes uploading and publishing already-built artifacts from a failed local-release directory. */
export async function resumeRelease({ root = projectRoot, output, run, env = process.env, platform = process.platform, uploadRetryDelayMs = 5000 } = {}) {
  validateRuntime(platform)
  if (!output) throw new Error('Informe a pasta da publicação em .scratch/local-releases.')
  const resolved = path.resolve(root, output)
  const outputDir = path.basename(resolved) === 'release.json' ? path.dirname(resolved) : resolved
  const statePath = path.join(outputDir, 'release.json')
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'))
  if (state.status === 'published') throw new Error('Esta release já foi publicada.')
  const { repository, commit, tag: tagName, version, assets } = state
  if (!repository || !/^[a-f0-9]{40}$/.test(commit || '') || !stableVersion.test(tagName || '') || !stableVersion.test(version || '') || !Array.isArray(assets) || !assets.length) {
    throw new Error(`Estado inválido para retomada em ${statePath}.`)
  }
  for (const file of assets) if (!existsSync(file) || !(await fs.stat(file)).size) throw new Error('Artefato ausente ou vazio: ' + file)
  env = await loadEnvironment(root, env)
  run ||= createRunner(path.join(outputDir, 'release.log'))
  const exec = (command, args, options = {}) => run(command, args, { cwd: root, env, ...options })
  const saveState = () => fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n')
  return withReleaseLock(exec, root, outputDir, async () => {
    try {
      state.status = 'uploading'; await saveState()
      await exec('gh', ['auth', 'status'])
      const releases = JSON.parse(await exec('gh', ['release', 'list', '--repo', repository, '--limit', '1000', '--json', 'tagName'], { quiet: true }))
      let existingAssets = null
      if (releases.some(release => release.tagName === tagName)) {
        const existing = JSON.parse(await exec('gh', ['release', 'view', tagName, '--repo', repository, '--json', 'isDraft,targetCommitish,assets'], { quiet: true }))
        if (!existing.isDraft) throw new Error(`A release ${tagName} já está publicada no GitHub.`)
        if (existing.targetCommitish && existing.targetCommitish !== commit) throw new Error(`O rascunho ${tagName} no GitHub aponta para outro commit (${existing.targetCommitish}).`)
        existingAssets = Array.isArray(existing.assets) ? existing.assets : []
      }
      await publishDraftAssets(exec, {
        repository, tagName, commit, releaseTitle: `Lira - v${version}`,
        assets, env, uploadRetryDelayMs, existingAssets,
      })
      delete state.error
      state.status = 'published'; await saveState()
      const url = `https://github.com/${repository}/releases/tag/${tagName}`
      console.log(`\nAtualização publicada: ${url}`)
      return { tag: tagName, commit, url, output: outputDir }
    } catch (error) {
      state.status = 'failed'
      state.error = error.message
      await saveState()
      logFailure(outputDir, assets)
      throw error
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const parsed = parseCliArgs(process.argv.slice(2))
    await (parsed.mode === 'resume' ? resumeRelease({ output: parsed.output }) : runRelease({ ref: parsed.ref }))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
