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

export async function runRelease({ root = projectRoot, run, env = process.env, platform = process.platform, ref = 'origin/main' } = {}) {
  if (platform !== 'win32') throw new Error('Execute esta publicação no Windows (Windows e Android).')
  if (!ref || ref.startsWith('-')) throw new Error('Referência Git inválida.')
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
  if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 12)) throw new Error('Use Node.js 22.12 ou superior.')
  env = await loadEnvironment(root, env)
  if (env.LIRA_JAVA_HOME) env.JAVA_HOME = path.resolve(root, env.LIRA_JAVA_HOME)
  const output = path.join(root, '.scratch/local-releases', new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid)
  await fs.mkdir(output, { recursive: true })
  run ||= createRunner(path.join(output, 'release.log'))
  const exec = (command, args, options = {}) => run(command, args, { cwd: root, env, ...options })
  const common = path.resolve(root, (await exec('git', ['rev-parse', '--git-common-dir'], { quiet: true })).trim())
  const lockFile = path.join(common, 'lira-release.lock')
  let lock
  try { lock = await fs.open(lockFile, 'wx') }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Há uma publicação em andamento. Se foi interrompida, confira o processo e remova ${lockFile}.`)
    throw error
  }
  let temporary
  let source
  let worktreeAdded = false
  const state = { status: 'preparing', ref, output, assets: [] }
  const saveState = () => fs.writeFile(path.join(output, 'release.json'), JSON.stringify(state, null, 2) + '\n')
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, started: new Date().toISOString(), output }))
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
    await exec('git', ['worktree', 'add', '--detach', source, commit])
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
    const webEnv = { ...buildEnv, LIRA_TARGET: 'web' }
    await atSource('npm', ['exec', '--', 'tsc'], { env: webEnv })
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
    for (const file of state.assets) if (!(await fs.stat(file)).size) throw new Error('Artefato vazio: ' + file)
    state.status = 'uploading'; await saveState()
    // Draft keeps the previous public version active until both uploads succeed.
    await exec('gh', ['release', 'create', tagName, ...state.assets, '--repo', repository,
      '--target', commit, '--title', releaseTitle, '--draft', '--generate-notes'])
    await exec('gh', ['release', 'edit', tagName, '--repo', repository, '--draft=false', '--latest'])
    state.status = 'published'; await saveState()
    const url = `https://github.com/${repository}/releases/tag/${tagName}`
    console.log(`\nAtualização publicada: ${url}`)
    return { tag: tagName, commit, url, output }
  } catch (error) {
    state.status = 'failed'
    state.error = error.message
    await saveState()
    console.error(`Publicação interrompida. Logs e artefatos: ${output}. Se houver um rascunho no GitHub, confira os dois anexos antes de publicá-lo.`)
    throw error
  } finally {
    try {
      if (worktreeAdded) {
        const resolved = await fs.realpath(temporary)
        const resolvedSource = await fs.realpath(source)
        if (resolved !== temporary || resolvedSource !== path.join(resolved, 'source')) throw new Error('Caminho de limpeza inválido')
        await exec('git', ['worktree', 'remove', '--force', source])
        // Git can leave ignored files behind even after unregistering the worktree.
        await fs.rm(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 })
      } else if (temporary) {
        await fs.rmdir(temporary)
      }
    } catch (error) { console.error(`Cópia temporária preservada em ${temporary}: ${error.message}`) }
    finally { await lock.close(); await fs.unlink(lockFile) }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length && (args.length !== 2 || args[0] !== '--ref')) throw new Error('Uso: npm run release -- [--ref origin/main|HEAD|commit]')
    await runRelease({ ref: args[1] || 'origin/main' })
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
