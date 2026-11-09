import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runRelease, buildEnvironment, selectVersion, commandInvocation, createRunner } from '../../../scripts/local-release.mjs'

let root: string
let calls: { command: string; args: string[]; cwd: string; env: Record<string, string> }[]
let failure: string
let skipArtifact: string
let javaOutput: string
const sha = 'a'.repeat(40)

async function run(command: string, args: string[], options: any = {}) {
  calls.push({ command, args, cwd: options.cwd, env: options.env })
  const line = [command, ...args].join(' ')
  if (failure && line.includes(failure)) throw new Error('simulated failure: ' + failure)
  if (line.includes('rev-parse --git-common-dir')) return path.join(root, '.git')
  if (line.includes('rev-parse --verify')) return sha
  if (line.includes('gh api repos/')) return sha
  if (line.includes('remote get-url')) return 'https://github.com/C1ean-dev/Lira.git'
  if (line.includes('git tag --list')) return 'v1.1.205\nv1.1.9\nv9.0.0-beta.1'
  if (line.includes('gh release list')) return JSON.stringify([{ tagName: 'v1.1.206' }])
  if (line.includes('java') && args.includes('-version')) return javaOutput
  if (line.includes('worktree add')) {
    const dir = args.at(-2)!
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ version: '1.1.117' }))
    await fs.writeFile(path.join(dir, 'package-lock.json'), JSON.stringify({ version: '1.1.117', packages: { '': { version: '1.1.117' } } }))
  }
  if (line === 'npm run build') {
    expect(JSON.parse(await fs.readFile(path.join(options.cwd, 'package.json'), 'utf8')).version).toBe('1.1.207')
    const lock = JSON.parse(await fs.readFile(path.join(options.cwd, 'package-lock.json'), 'utf8'))
    expect(lock.version).toBe('1.1.207')
    expect(lock.packages[''].version).toBe('1.1.207')
    await fs.mkdir(path.join(options.cwd, 'release'), { recursive: true })
    if (skipArtifact !== 'windows') await fs.writeFile(path.join(options.cwd, 'release', 'Lira Setup 1.1.207.exe'), 'installer')
  }
  if (line.includes('assembleRelease')) {
    const output = path.join(options.cwd, 'app/build/outputs/apk/release')
    await fs.mkdir(output, { recursive: true })
    if (skipArtifact !== 'android') await fs.writeFile(path.join(output, 'app-release.apk'), 'signed apk')
  }
  return ''
}

function execute(extraEnv: Record<string, string> = {}) {
  return runRelease({ root, run, platform: 'win32', env: {
    ANDROID_HOME: path.join(root, 'sdk'), LIRA_KEYSTORE_PATH: path.join(root, 'release.jks'),
    VITE_TURN_USERNAME: 'relay-user', VITE_TURN_CREDENTIAL: 'relay-password',
    ...extraEnv,
  } })
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-release-test-'))
  calls = []; failure = ''; skipArtifact = ''; javaOutput = 'openjdk version "21.0.7"'
  for (const dir of ['.git', 'sdk/platforms/android-35', 'sdk/build-tools/35.0.0', 'sdk/platform-tools']) await fs.mkdir(path.join(root, dir), { recursive: true })
  await fs.writeFile(path.join(root, 'release.jks'), 'fixture keystore')
  await fs.writeFile(path.join(root, 'untouched.txt'), 'uncommitted work')
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('local Windows and Android release', () => {
  it('tests and builds both platforms before uploading a draft, then publishes it as latest', async () => {
    const result = await execute()
    expect(result.tag).toBe('v1.1.207')
    const lines = calls.map(call => [call.command, ...call.args].join(' '))
    const tests = lines.indexOf('npm run test:all')
    const windows = lines.indexOf('npm run build')
    const android = lines.findIndex(line => line.includes('assembleRelease'))
    const upload = calls.findIndex(call => call.command === 'gh' && call.args[1] === 'create')
    const publish = calls.findIndex(call => call.command === 'gh' && call.args[1] === 'edit')
    expect(tests).toBeGreaterThan(-1)
    expect(windows).toBeGreaterThan(tests)
    expect(android).toBeGreaterThan(windows)
    expect(upload).toBeGreaterThan(android)
    expect(publish).toBeGreaterThan(upload)
    expect(calls[upload].args).toEqual(expect.arrayContaining(['--draft', '--target', sha, '--generate-notes']))
    expect(calls[upload].args.filter(arg => /\.(exe|apk)$/.test(arg))).toHaveLength(2)
    expect(calls[publish].args).toEqual(expect.arrayContaining(['--draft=false', '--latest']))
    expect(lines.some(line => /git (?:add|commit|reset|clean|checkout)/.test(line))).toBe(false)
    expect(await fs.readFile(path.join(root, 'untouched.txt'), 'utf8')).toBe('uncommitted work')
    expect(lines.some(line => line.includes('worktree remove'))).toBe(true)
    expect(await fs.readdir(path.join(root, '.git'))).not.toContain('lira-release.lock')
  })

  it.each(['npm ci', 'npm run test:all', 'npm run build', 'assembleRelease', 'apksigner.jar verify'])('stops without creating a release if %s fails', async stage => {
    failure = stage
    await expect(execute()).rejects.toThrow('simulated failure')
    expect(calls.some(call => call.command === 'gh' && call.args.includes('create'))).toBe(false)
    expect(await fs.readdir(path.join(root, '.git'))).not.toContain('lira-release.lock')
  })

  it.each(['windows', 'android'])('does not publish stale files when the %s artifact is missing', async platform => {
    skipArtifact = platform
    await expect(execute()).rejects.toThrow(/artefato/i)
    expect(calls.some(call => call.command === 'gh' && call.args.includes('create'))).toBe(false)
  })

  it('leaves a failed upload unpublished and records where to recover it', async () => {
    failure = 'gh release create'
    await expect(execute()).rejects.toThrow('simulated failure')
    expect(calls.some(call => call.command === 'gh' && call.args.includes('edit'))).toBe(false)
    const runs = await fs.readdir(path.join(root, '.scratch/local-releases'))
    const state = JSON.parse(await fs.readFile(path.join(root, '.scratch/local-releases', runs[0], 'release.json'), 'utf8'))
    expect(state).toMatchObject({ tag: 'v1.1.207', commit: sha, status: 'failed' })
    expect(state.assets).toHaveLength(2)
  })

  it('rejects a second simultaneous release instead of allocating the same version', async () => {
    await fs.writeFile(path.join(root, '.git/lira-release.lock'), 'other publisher')
    await expect(execute()).rejects.toThrow(/publicação.*andamento/i)
    expect(calls.some(call => call.args.includes('fetch'))).toBe(false)
    expect(await fs.readFile(path.join(root, '.git/lira-release.lock'), 'utf8')).toBe('other publisher')
  })

  it('fails before building if the signing key is unavailable', async () => {
    await fs.rm(path.join(root, 'release.jks'))
    await expect(execute()).rejects.toThrow(/keystore/i)
    expect(calls.some(call => call.command === 'npm')).toBe(false)
  })

  it.each(['openjdk version "17.0.1"', 'unrecognized output'])('rejects an unsupported Java runtime: %s', async output => {
    javaOutput = output
    await expect(execute()).rejects.toThrow(/JDK 21/)
    expect(calls.some(call => call.command === 'npm')).toBe(false)
  })

  it('rejects an incomplete Android SDK before installing npm dependencies', async () => {
    await fs.rmdir(path.join(root, 'sdk/platforms/android-35'))
    await expect(execute()).rejects.toThrow(/Android SDK/)
    expect(calls.some(call => call.command === 'npm')).toBe(false)
  })

  it('does not mark the release as published when the final GitHub request fails', async () => {
    failure = 'gh release edit'
    await expect(execute()).rejects.toThrow('simulated failure')
    const directories = await fs.readdir(path.join(root, '.scratch/local-releases'))
    const state = JSON.parse(await fs.readFile(path.join(root, '.scratch/local-releases', directories[0], 'release.json'), 'utf8'))
    expect(state.status).toBe('failed')
    expect(state.assets).toHaveLength(2)
  })

  it('passes identical TURN values and version numbers to both platform builds', async () => {
    await execute()
    const windows = calls.find(call => call.command === 'npm' && call.args.join(' ') === 'run build')!
    const android = calls.find(call => call.command === 'npm' && call.args.includes('vite'))!
    for (const build of [windows, android]) {
      expect(build.env.VITE_TURN_USERNAME).toBe('relay-user')
      expect(build.env.VITE_TURN_CREDENTIAL).toBe('relay-password')
      expect(build.env.VITE_APP_VERSION).toBe('1.1.207')
      expect(path.isAbsolute(build.env.LIRA_KEYSTORE_PATH)).toBe(true)
    }
    expect(windows.env.LIRA_TARGET).toBeUndefined()
    expect(android.env.LIRA_TARGET).toBe('web')
  })

  it('uses npm through Node with separate arguments even when paths contain spaces', () => {
    const invocation = commandInvocation('npm', ['exec', '--', 'vite', 'build'], 'win32', () => 'C:\\Program Files\\nodejs\\npm-cli.js')
    expect(invocation.command).toBe(process.execPath)
    expect(invocation.args).toEqual(['C:\\Program Files\\nodejs\\npm-cli.js', 'exec', '--', 'vite', 'build'])
    expect(commandInvocation('gradle', ['assembleRelease'], 'win32').args.at(-1)).toBe('gradlew.bat assembleRelease --no-daemon')
  })

  it('executes real child commands without a shell, stores logs and propagates failures', async () => {
    const log = path.join(root, 'runner.log')
    const runner = createRunner(log)
    expect(await runner(process.execPath, ['-e', 'console.log("child completed")'], { cwd: root, quiet: true })).toBe('child completed')
    await expect(runner(process.execPath, ['-e', 'console.error("child failed"); process.exit(7)'], { cwd: root, quiet: true })).rejects.toThrow(/código 7/)
    const content = await fs.readFile(log, 'utf8')
    expect(content).toContain('child completed')
    expect(content).toContain('child failed')
  })

  it('loads local configuration while giving the Windows environment priority', async () => {
    await fs.writeFile(path.join(root, '.env.release.local'), 'VITE_TURN_USERNAME=from-file\nVITE_TURN_CREDENTIALS_URL=https://relay.test/credentials\n')
    await execute()
    const build = calls.find(call => call.command === 'npm' && call.args.join(' ') === 'run build')!
    expect(build.env.VITE_TURN_USERNAME).toBe('relay-user')
    expect(build.env.VITE_TURN_CREDENTIALS_URL).toBe('https://relay.test/credentials')
  })

  it('uses the release JDK for the Java check and Gradle even when Windows points to an older JDK', async () => {
    const jdk = path.join(root, 'Temurin 21')
    await fs.writeFile(path.join(root, '.env.release.local'), `LIRA_JAVA_HOME="${jdk}"\n`)
    await execute({ JAVA_HOME: path.join(root, 'JDK 18') })
    expect(calls.find(call => call.args.includes('-version'))?.command).toBe(path.join(jdk, 'bin/java.exe'))
    expect(calls.find(call => call.command === 'gradle')?.env.JAVA_HOME).toBe(jdk)
  })

  it('installs the Python test dependencies in an isolated environment before the suite', async () => {
    const python = path.join(root, 'Python install', 'python.exe')
    await execute({ LIRA_PYTHON: python })
    const suiteIndex = calls.findIndex(call => call.command === 'npm' && call.args.join(' ') === 'run test:all')
    const suite = calls[suiteIndex]
    const venv = path.join(suite.cwd, '.scratch', 'release-python')
    const isolatedPython = path.join(venv, 'Scripts', 'python.exe')
    expect(suite.env.LIRA_PYTHON).toBe(isolatedPython)
    const preparation = calls.slice(0, suiteIndex)
    expect(preparation).toContainEqual(expect.objectContaining({ command: python, args: ['-m', 'venv', venv] }))
    expect(preparation).toContainEqual(expect.objectContaining({ command: isolatedPython, args: expect.arrayContaining([
      '-m', 'pip', 'install', '-r', 'scripts/noise-benchmark/requirements.txt', 'Pillow',
    ]) }))
  })

  it('stops before the test suite if Python dependencies cannot be installed', async () => {
    failure = '-m pip install'
    await expect(execute()).rejects.toThrow('simulated failure')
    expect(calls.some(call => call.args.includes('test:all') || call.args.includes('create'))).toBe(false)
  })

  it('removes ignored files left in the temporary checkout by git worktree remove', async () => {
    await execute()
    const worktree = calls.find(call => call.command === 'git' && call.args[1] === 'add')!.args.at(-2)!
    await expect(fs.access(path.dirname(worktree))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps TURN settings in both builds and strips CI version outputs', () => {
    const env = buildEnvironment({ VITE_TURN_URLS: 'turn:relay.test:3478', VITE_TURN_CREDENTIAL: 'credential', GITHUB_OUTPUT: 'do-not-write', LIRA_TARGET: 'web' }, '1.1.207')
    expect(env.VITE_TURN_CREDENTIAL).toBe('credential')
    expect(env.VITE_TURN_URLS).toContain('turn:')
    expect(env.GITHUB_OUTPUT).toBeUndefined()
    expect(env.LIRA_TARGET).toBeUndefined()
    expect(env.VITE_APP_VERSION).toBe('1.1.207')
    expect(env.LIRA_VERSION_CODE).toBe('101207')
  })

  it('allocates versions numerically, includes drafts, and ignores prereleases', () => {
    expect(selectVersion('1.1.117', ['v1.1.9', 'v1.1.205', 'v2.0.0-beta.1'], ['v1.1.206']).version).toBe('1.1.207')
    expect(selectVersion('1.2.0', ['v1.1.206'], []).version).toBe('1.2.0')
    expect(() => selectVersion('invalid', [], [])).toThrow()
  })
})
