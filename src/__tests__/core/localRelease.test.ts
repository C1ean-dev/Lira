import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runRelease, resumeRelease as resumeReleaseImpl, parseCliArgs, buildEnvironment, selectVersion, commandInvocation, createRunner, ghUploadEnvironment } from '../../../scripts/local-release.mjs'

let root: string
let calls: { command: string; args: string[]; cwd: string; env: Record<string, string> }[]
let failure: string | RegExp
let failOnce: Map<string | RegExp, number>
let skipArtifact: string
let javaOutput: string
let createLongWorktreePath: boolean
let releaseViewResponse: string | Error
let releaseListResponse: string
let renderFetch: ReturnType<typeof vi.fn>
const sha = 'a'.repeat(40)

function resumeRelease(options: any) {
  return resumeReleaseImpl({ env: { LIRA_UPDATE_PUBLISH_TOKEN: 'publisher-secret' }, fetch: renderFetch, ...options })
}

function matchesPattern(line: string, pattern: string | RegExp) {
  return typeof pattern === 'string' ? line.includes(pattern) : pattern.test(line)
}

async function run(command: string, args: string[], options: any = {}) {
  calls.push({ command, args, cwd: options.cwd, env: options.env })
  const line = [command, ...args].join(' ')
  for (const [pattern, remaining] of failOnce.entries()) {
    if (matchesPattern(line, pattern) && remaining > 0) {
      failOnce.set(pattern, remaining - 1)
      throw new Error('transient failure: ' + pattern)
    }
  }
  if (failure && matchesPattern(line, failure)) throw new Error('simulated failure: ' + failure)
  if (line.includes('rev-parse --git-common-dir')) return path.join(root, '.git')
  if (line.includes('rev-parse --verify')) return sha
  if (line.includes('gh api repos/')) return sha
  if (line.includes('remote get-url')) return 'https://github.com/C1ean-dev/Lira.git'
  if (line.includes('git tag --list')) return 'v1.1.205\nv1.1.9\nv9.0.0-beta.1'
  if (line.includes('gh release list')) return releaseListResponse
  if (line.includes('gh release view')) {
    if (releaseViewResponse instanceof Error) throw releaseViewResponse
    return releaseViewResponse
  }
  if (line.includes('java') && args.includes('-version')) return javaOutput
  if (line.includes('worktree add')) {
    const dir = args.at(-2)!
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ version: '1.1.117' }))
    await fs.writeFile(path.join(dir, 'package-lock.json'), JSON.stringify({ version: '1.1.117', packages: { '': { version: '1.1.117' } } }))
    if (createLongWorktreePath) {
      const deepDir = path.join(dir, 'android/app/build/intermediates', 'x'.repeat(110), 'y'.repeat(110))
      await fs.mkdir(deepDir, { recursive: true })
      await fs.writeFile(path.join(deepDir, 'asset.jar'), 'artifact')
    }
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

function execute(extraEnv: Record<string, string> = {}, options: Record<string, unknown> = {}) {
  return runRelease({ root, run, platform: 'win32', uploadRetryDelayMs: 0, fetch: renderFetch, ...options, env: {
    ANDROID_HOME: path.join(root, 'sdk'), LIRA_KEYSTORE_PATH: path.join(root, 'release.jks'),
    VITE_TURN_USERNAME: 'relay-user', VITE_TURN_CREDENTIAL: 'relay-password',
    LIRA_UPDATE_PUBLISH_TOKEN: 'publisher-secret',
    ...extraEnv,
  } })
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-release-test-'))
  calls = []; failure = ''; failOnce = new Map(); skipArtifact = ''; javaOutput = 'openjdk version "21.0.7"'; createLongWorktreePath = false
  releaseViewResponse = JSON.stringify({ isDraft: true, targetCommitish: sha, assets: [] })
  releaseListResponse = JSON.stringify([{ tagName: 'v1.1.206' }])
  renderFetch = vi.fn(async (_url, options) => Response.json({ tag_name: JSON.parse(options.body).tag_name, status: 'ready' }))
  for (const dir of ['.git', 'sdk/platforms/android-35', 'sdk/build-tools/35.0.0', 'sdk/platform-tools']) await fs.mkdir(path.join(root, dir), { recursive: true })
  await fs.writeFile(path.join(root, 'release.jks'), 'fixture keystore')
  await fs.writeFile(path.join(root, 'untouched.txt'), 'uncommitted work')
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('local Windows and Android release', () => {
  it('refreshes Render only after GitHub publication and keeps its token out of builds and saved state', async () => {
    renderFetch.mockImplementation(async (url, options) => {
      expect(calls.some(call => call.command === 'gh' && call.args[1] === 'edit')).toBe(true)
      expect(url).toBe('https://lira-signaling.onrender.com/updates/lira/refresh')
      expect(options.method).toBe('POST')
      expect(options.headers.Authorization).toBe('Bearer publisher-secret')
      expect(JSON.parse(options.body)).toEqual({ tag_name: 'v1.1.207' })
      expect(options.redirect).toBe('error')
      return Response.json({ tag_name: 'v1.1.207', status: 'ready' })
    })
    const result = await execute()
    expect(renderFetch).toHaveBeenCalledTimes(1)
    for (const call of calls.filter(call => ['npm', 'gradle'].includes(call.command))) {
      expect(call.env.LIRA_UPDATE_PUBLISH_TOKEN).toBeUndefined()
    }
    const saved = await fs.readFile(path.join(result.output, 'release.json'), 'utf8')
    expect(saved).not.toContain('publisher-secret')
    expect(JSON.parse(saved)).toMatchObject({ status: 'published', githubPublished: true })
  })

  it('requires the Render publishing token before starting builds or publishing GitHub assets', async () => {
    await expect(execute({ LIRA_UPDATE_PUBLISH_TOKEN: '' })).rejects.toThrow(/LIRA_UPDATE_PUBLISH_TOKEN/)
    expect(calls).toHaveLength(0)
    expect(renderFetch).not.toHaveBeenCalled()
  })

  it.each([
    [401, /HTTP 401.*token/i],
    [404, /HTTP 404.*deploy/i],
    [503, /HTTP 503.*LIRA_UPDATE_PUBLISH_TOKEN/i],
    [502, /HTTP 502.*logs/i],
  ])('reports an actionable Render HTTP %s error without recording the response body', async (status, message) => {
    renderFetch.mockResolvedValue(new Response('publisher-secret sensitive upstream body', { status }))
    await expect(execute()).rejects.toThrow(message)
    const directories = await fs.readdir(path.join(root, '.scratch/local-releases'))
    const saved = await fs.readFile(path.join(root, '.scratch/local-releases', directories[0], 'release.json'), 'utf8')
    expect(JSON.parse(saved).error).toMatch(message)
    expect(saved).not.toContain('publisher-secret')
    expect(saved).not.toContain('sensitive upstream body')
  })

  it.each(['invalid-json', 'wrong-version', 'timeout', 'network'])('distinguishes Render %s from HTTP failures', async mode => {
    if (mode === 'invalid-json') renderFetch.mockResolvedValue(new Response('publisher-secret', { status: 200 }))
    if (mode === 'wrong-version') renderFetch.mockResolvedValue(Response.json({ status: 'ready', tag_name: 'publisher-secret' }))
    if (mode === 'timeout') renderFetch.mockRejectedValue(new DOMException('publisher-secret', 'TimeoutError'))
    if (mode === 'network') renderFetch.mockRejectedValue(new Error('publisher-secret'))
    const messages = { 'invalid-json': /resposta inválida/i, 'wrong-version': /versão esperada/i, timeout: /tempo limite/i, network: /conexão/i }
    await expect(execute()).rejects.toThrow(messages[mode])
  })

  it.each(['http', 'wrong-tag', 'network'])('records a resumable failure when Render fails: %s', async mode => {
    if (mode === 'http') renderFetch.mockResolvedValue(new Response('publisher-secret', { status: 502 }))
    if (mode === 'wrong-tag') renderFetch.mockResolvedValue(Response.json({ tag_name: 'v1.1.206', status: 'ready' }))
    if (mode === 'network') renderFetch.mockRejectedValue(new Error('publisher-secret'))
    await expect(execute()).rejects.toThrow(/Render/)
    const directories = await fs.readdir(path.join(root, '.scratch/local-releases'))
    const saved = await fs.readFile(path.join(root, '.scratch/local-releases', directories[0], 'release.json'), 'utf8')
    expect(JSON.parse(saved)).toMatchObject({ status: 'failed', githubPublished: true })
    expect(saved).not.toContain('publisher-secret')
    const uploads = calls.filter(call => call.command === 'gh' && call.args[1] === 'upload').length
    releaseListResponse = JSON.stringify([{ tagName: 'v1.1.207' }])
    releaseViewResponse = JSON.stringify({ isDraft: false, targetCommitish: sha, assets: [] })
    renderFetch.mockResolvedValue(Response.json({ tag_name: 'v1.1.207', status: 'ready' }))
    await resumeRelease({ root, output: path.join(root, '.scratch/local-releases', directories[0]), run, platform: 'win32',
      env: { LIRA_UPDATE_PUBLISH_TOKEN: 'publisher-secret' }, fetch: renderFetch })
    expect(calls.filter(call => call.command === 'gh' && call.args[1] === 'upload')).toHaveLength(uploads)
    expect(calls.filter(call => call.command === 'gh' && call.args[1] === 'edit')).toHaveLength(1)
    expect(JSON.parse(await fs.readFile(path.join(root, '.scratch/local-releases', directories[0], 'release.json'), 'utf8')).status).toBe('published')
  })

  it('builds both platforms without running tests before publishing the draft as latest', async () => {
    const result = await execute()
    expect(result.tag).toBe('v1.1.207')
    const lines = calls.map(call => [call.command, ...call.args].join(' '))
    const install = lines.indexOf('npm ci')
    const windows = lines.indexOf('npm run build')
    const androidBundle = lines.indexOf('npm exec -- vite build')
    const android = lines.findIndex(line => line.includes('assembleRelease'))
    const createDraft = calls.findIndex(call => call.command === 'gh' && call.args[1] === 'create')
    const uploads = calls.map((call, index) => ({ call, index })).filter(({ call }) => call.command === 'gh' && call.args[1] === 'upload')
    const publish = calls.findIndex(call => call.command === 'gh' && call.args[1] === 'edit')
    expect(install).toBeGreaterThan(-1)
    expect(windows).toBeGreaterThan(install)
    expect(lines).not.toContain('npm run test:all')
    expect(lines).not.toContain('npm exec -- playwright install chromium')
    expect(lines.some(line => /(?:python|pip)\b/i.test(line))).toBe(false)
    expect(androidBundle).toBeGreaterThan(windows)
    expect(android).toBeGreaterThan(androidBundle)
    expect(createDraft).toBeGreaterThan(android)
    expect(uploads).toHaveLength(2)
    expect(uploads[0].index).toBeGreaterThan(createDraft)
    expect(uploads[1].index).toBeGreaterThan(uploads[0].index)
    expect(publish).toBeGreaterThan(uploads[1].index)
    expect(calls[createDraft].args).toEqual(expect.arrayContaining(['--draft', '--target', sha, '--generate-notes']))
    expect(calls[createDraft].args.filter(arg => /\.(exe|apk)$/.test(arg))).toHaveLength(0)
    expect(uploads[0].call.args).toEqual(expect.arrayContaining(['release', 'upload', 'v1.1.207', '--repo', 'C1ean-dev/Lira', '--clobber']))
    expect(uploads[0].call.args.filter(arg => /\.(exe|apk)$/.test(arg))).toHaveLength(1)
    expect(uploads[1].call.args.filter(arg => /\.(exe|apk)$/.test(arg))).toHaveLength(1)
    expect(uploads[0].call.args.find(arg => arg.endsWith('.exe'))).toBeTruthy()
    expect(uploads[1].call.args.find(arg => arg.endsWith('.apk'))).toBeTruthy()
    for (const { call } of uploads) expect(call.env.GODEBUG).toContain('http2client=0')
    expect(calls[publish].args).toEqual(expect.arrayContaining(['--draft=false', '--latest']))
    expect(lines.some(line => /git (?:add|commit|reset|clean|checkout)/.test(line))).toBe(false)
    expect(await fs.readFile(path.join(root, 'untouched.txt'), 'utf8')).toBe('uncommitted work')
    expect(lines.some(line => line.includes('worktree add') && line.includes('core.longpaths=true'))).toBe(true)
    expect(lines.some(line => line.includes('worktree remove') && line.includes('core.longpaths=true'))).toBe(true)
    expect(await fs.readdir(path.join(root, '.git'))).not.toContain('lira-release.lock')
  })

  it('retries a timed-out sequential asset upload with --clobber before publishing', async () => {
    failOnce.set(/gh release upload .*Lira-v1\.1\.207\.apk/, 1)
    const result = await execute()
    expect(result.tag).toBe('v1.1.207')
    const exeUploads = calls.filter(call => call.command === 'gh' && call.args[1] === 'upload' && call.args.some(arg => arg.endsWith('.exe')))
    const apkUploads = calls.filter(call => call.command === 'gh' && call.args[1] === 'upload' && call.args.some(arg => arg.endsWith('.apk')))
    expect(exeUploads).toHaveLength(1)
    expect(apkUploads).toHaveLength(2)
    expect(apkUploads[1].args).toContain('--clobber')
    expect(calls.some(call => call.command === 'gh' && call.args[1] === 'edit')).toBe(true)
  })

  it('leaves the draft unpublished when an asset upload still fails after retries', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      failure = /gh release upload .*Lira-v1\.1\.207\.apk/
      await expect(execute()).rejects.toThrow('simulated failure')
      const apkUploads = calls.filter(call => call.command === 'gh' && call.args[1] === 'upload' && call.args.some(arg => arg.endsWith('.apk')))
      expect(apkUploads).toHaveLength(3)
      expect(calls.some(call => call.command === 'gh' && call.args.includes('edit'))).toBe(false)
      const runs = await fs.readdir(path.join(root, '.scratch/local-releases'))
      const runDir = path.join(root, '.scratch/local-releases', runs[0])
      const state = JSON.parse(await fs.readFile(path.join(runDir, 'release.json'), 'utf8'))
      expect(state).toMatchObject({ tag: 'v1.1.207', commit: sha, status: 'failed' })
      expect(state.assets).toHaveLength(2)
      expect(errors.mock.calls.flat().join('\n')).toContain(`--resume ${runDir}`)
    } finally { errors.mockRestore() }
  })

  it('reuses the Windows build type check for Android', async () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(scripts.build).toMatch(/&& tsc && vite build/)
    await execute()
    expect(calls.some(call => call.command === 'npm' && call.args.includes('tsc'))).toBe(false)
  })

  it.each(['npm ci', 'npm run build', 'assembleRelease', 'apksigner.jar verify'])('stops without creating a release if %s fails', async stage => {
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
    expect(renderFetch).not.toHaveBeenCalled()
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

  it('removes ignored files left in the temporary checkout by git worktree remove', async () => {
    await execute()
    const worktree = calls.find(call => call.command === 'git' && call.args.includes('add'))!.args.at(-2)!
    await expect(fs.access(path.dirname(worktree))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes long-path temporary worktrees via Node fallback and prunes git metadata when git worktree remove fails', async () => {
    createLongWorktreePath = true
    failure = 'worktree remove'
    const result = await execute()
    expect(result.tag).toBe('v1.1.207')
    const worktree = calls.find(call => call.command === 'git' && call.args.includes('add'))!.args.at(-2)!
    await expect(fs.access(path.dirname(worktree))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(calls.some(call => call.command === 'git' && call.args.includes('worktree') && call.args.includes('prune'))).toBe(true)
    expect(await fs.readdir(path.join(root, '.git'))).not.toContain('lira-release.lock')
  })

  it('disables HTTP/2 on gh uploads without discarding existing GODEBUG settings', () => {
    expect(ghUploadEnvironment({}).GODEBUG).toBe('http2client=0')
    expect(ghUploadEnvironment({ GODEBUG: 'x509sha1=1' }).GODEBUG).toBe('x509sha1=1,http2client=0')
    expect(ghUploadEnvironment({ GODEBUG: 'http2client=1,x509sha1=1' }).GODEBUG).toBe('http2client=1,x509sha1=1')
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

  it('resumes a failed release upload without rebuilding and skips assets already on the draft', async () => {
    const runDir = path.join(root, '.scratch/local-releases/run-208')
    await fs.mkdir(runDir, { recursive: true })
    const exe = path.join(runDir, 'Lira.Setup.1.1.208.exe')
    const apk = path.join(runDir, 'Lira-v1.1.208.apk')
    await fs.writeFile(exe, 'windows-installer')
    await fs.writeFile(apk, 'android-apk')
    await fs.writeFile(path.join(runDir, 'release.json'), JSON.stringify({
      status: 'failed', ref: 'origin/main', output: runDir,
      assets: [exe, apk], repository: 'C1ean-dev/Lira',
      commit: sha, tag: 'v1.1.208', version: '1.1.208', error: 'gh falhou (código 1)',
    }))
    releaseListResponse = JSON.stringify([{ tagName: 'v1.1.208' }])
    releaseViewResponse = JSON.stringify({
      isDraft: true,
      targetCommitish: sha,
      assets: [{ name: 'Lira.Setup.1.1.208.exe', size: Buffer.byteLength('windows-installer'), state: 'uploaded' }],
    })
    const result = await resumeRelease({ root, output: '.scratch/local-releases/run-208', run, platform: 'win32', uploadRetryDelayMs: 0 })
    expect(result).toEqual({ tag: 'v1.1.208', commit: sha, url: 'https://github.com/C1ean-dev/Lira/releases/tag/v1.1.208', output: runDir })
    expect(calls.some(call => ['npm', 'gradle'].includes(call.command))).toBe(false)
    expect(calls.some(call => call.command === 'git' && call.args.includes('worktree'))).toBe(false)
    expect(calls.some(call => call.command === 'gh' && call.args[1] === 'create')).toBe(false)
    const uploads = calls.filter(call => call.command === 'gh' && call.args[1] === 'upload')
    expect(uploads).toHaveLength(1)
    expect(uploads[0].args).toContain(apk)
    expect(uploads[0].env.GODEBUG).toContain('http2client=0')
    expect(calls.some(call => call.command === 'gh' && call.args[1] === 'edit' && call.args.includes('--draft=false'))).toBe(true)
    const updated = JSON.parse(await fs.readFile(path.join(runDir, 'release.json'), 'utf8'))
    expect(updated.status).toBe('published')
    expect(updated.error).toBeUndefined()
    expect(await fs.readdir(path.join(root, '.git'))).not.toContain('lira-release.lock')
  })

  it('creates the draft when resuming a release whose draft creation failed', async () => {
    const runDir = path.join(root, '.scratch/local-releases/run-208-no-draft')
    await fs.mkdir(runDir, { recursive: true })
    const exe = path.join(runDir, 'Lira.Setup.1.1.208.exe')
    const apk = path.join(runDir, 'Lira-v1.1.208.apk')
    await fs.writeFile(exe, 'windows-installer')
    await fs.writeFile(apk, 'android-apk')
    await fs.writeFile(path.join(runDir, 'release.json'), JSON.stringify({
      status: 'failed', ref: 'origin/main', output: runDir,
      assets: [exe, apk], repository: 'C1ean-dev/Lira',
      commit: sha, tag: 'v1.1.208', version: '1.1.208',
    }))
    releaseViewResponse = new Error('release not found')
    await resumeRelease({ root, output: runDir, run, platform: 'win32', uploadRetryDelayMs: 0 })
    const createIndex = calls.findIndex(call => call.command === 'gh' && call.args[1] === 'create')
    const uploads = calls.map((call, index) => ({ call, index })).filter(({ call }) => call.command === 'gh' && call.args[1] === 'upload')
    const editIndex = calls.findIndex(call => call.command === 'gh' && call.args[1] === 'edit')
    expect(createIndex).toBeGreaterThan(-1)
    expect(uploads).toHaveLength(2)
    expect(uploads[0].index).toBeGreaterThan(createIndex)
    expect(editIndex).toBeGreaterThan(uploads[1].index)
  })

  it('refuses to resume a published release or a draft pointing to another commit', async () => {
    const runDir = path.join(root, '.scratch/local-releases/run-guard')
    await fs.mkdir(runDir, { recursive: true })
    const exe = path.join(runDir, 'Lira.Setup.1.1.208.exe')
    await fs.writeFile(exe, 'windows-installer')
    await fs.writeFile(path.join(runDir, 'release.json'), JSON.stringify({
      status: 'published', output: runDir, assets: [exe],
      repository: 'C1ean-dev/Lira', commit: sha, tag: 'v1.1.208', version: '1.1.208',
    }))
    await expect(resumeRelease({ root, output: runDir, run, platform: 'win32', uploadRetryDelayMs: 0 })).rejects.toThrow(/publicad/i)

    await fs.writeFile(path.join(runDir, 'release.json'), JSON.stringify({
      status: 'failed', output: runDir, assets: [exe],
      repository: 'C1ean-dev/Lira', commit: sha, tag: 'v1.1.208', version: '1.1.208',
    }))
    releaseListResponse = JSON.stringify([{ tagName: 'v1.1.208' }])
    releaseViewResponse = JSON.stringify({ isDraft: false, targetCommitish: sha, assets: [] })
    await expect(resumeRelease({ root, output: runDir, run, platform: 'win32', uploadRetryDelayMs: 0 })).rejects.toThrow(/já está publicada/i)

    releaseViewResponse = JSON.stringify({ isDraft: true, targetCommitish: 'b'.repeat(40), assets: [] })
    await expect(resumeRelease({ root, output: runDir, run, platform: 'win32', uploadRetryDelayMs: 0 })).rejects.toThrow(/outro commit/i)
    expect(calls.some(call => call.command === 'gh' && call.args[1] === 'upload')).toBe(false)
  })

  it('parses --ref and --resume CLI flags cleanly', () => {
    expect(parseCliArgs([])).toEqual({ mode: 'release', ref: 'origin/main' })
    expect(parseCliArgs(['--ref', 'HEAD'])).toEqual({ mode: 'release', ref: 'HEAD' })
    expect(parseCliArgs(['--resume', '.scratch/local-releases/run-208'])).toEqual({ mode: 'resume', output: '.scratch/local-releases/run-208' })
    expect(() => parseCliArgs(['--unknown'])).toThrow(/Uso:/)
  })
})
