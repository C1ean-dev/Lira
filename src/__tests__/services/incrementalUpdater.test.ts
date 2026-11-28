import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { createPackage } from '@electron/asar'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ASAR_RELATIVE_NAME,
  INCREMENTAL_FORMAT_VERSION,
  INCREMENTAL_MANIFEST_NAME,
  INCREMENTAL_PACK_NAME,
  indexLocalAsar,
  planByteRanges,
  prepareIncrementalUpdate,
  readStagedIncrementalPlan,
  validateIncrementalManifest,
} from '../../../electron/incrementalUpdater'

const require = createRequire(import.meta.url)
const { writeUpdateManifest } = require('../../../scripts/windows-update-package.cjs')
const { buildIncrementalReleaseArtifacts } = require('../../../scripts/windows-incremental-pack.cjs')

const tempRoots: string[] = []
const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server => new Promise<void>(resolve => server.close(() => resolve())),
    ),
  )
  await Promise.all(
    tempRoots.splice(0).map(root => fsp.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })),
  )
})

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

function deterministicBytes(seed: string, size: number): Buffer {
  const out = Buffer.allocUnsafe(size)
  let offset = 0
  let counter = 0
  while (offset < size) {
    const chunk = crypto.createHash('sha256').update(`${seed}:${counter++}`).digest()
    const copyLen = Math.min(chunk.length, size - offset)
    chunk.copy(out, offset, 0, copyLen)
    offset += copyLen
  }
  return out
}

async function createSyntheticAppInstall(
  root: string,
  version: string,
  opts: {
    mainCode: string
    extraSprite?: string
    includeObsoleteFile?: boolean
    includeNewExternalFile?: boolean
  },
) {
  const srcTree = path.join(root, `_asar-src-${version}`)
  const appDir = path.join(root, `app-${version}`)
  await fsp.mkdir(path.join(srcTree, 'out'), { recursive: true })
  await fsp.mkdir(path.join(srcTree, 'dist/assets/library/sprites/chair'), { recursive: true })
  await fsp.mkdir(path.join(srcTree, 'dist/excalidraw-assets/fonts'), { recursive: true })
  await fsp.mkdir(path.join(appDir, 'resources/gstreamer/bin'), { recursive: true })
  await fsp.mkdir(path.join(appDir, 'resources/native'), { recursive: true })

  // Heavy static assets inside app.asar (identical between versions)
  await fsp.writeFile(path.join(srcTree, 'dist/assets/df_bg-static.wasm'), deterministicBytes('df-wasm', 512 * 1024))
  await fsp.writeFile(path.join(srcTree, 'dist/excalidraw-assets/fonts/Excalifont.woff2'), deterministicBytes('font-woff2', 256 * 1024))
  await fsp.writeFile(path.join(srcTree, 'dist/assets/library/sprites/chair/chair.png'), deterministicBytes('chair-png', 128 * 1024))
  await fsp.writeFile(path.join(srcTree, 'dist/index.html'), '<!doctype html><html><body>Lira</body></html>\n')
  await fsp.writeFile(path.join(srcTree, 'package.json'), JSON.stringify({ name: 'lira', version }, null, 2) + '\n')
  await fsp.writeFile(path.join(srcTree, 'out/main.js'), opts.mainCode)
  if (opts.extraSprite) {
    await fsp.writeFile(path.join(srcTree, 'dist/assets/library/sprites/chair/lamp.png'), deterministicBytes(opts.extraSprite, 4096))
  }

  await createPackage(srcTree, path.join(appDir, ASAR_RELATIVE_NAME))

  // Heavy external runtimes (identical between versions)
  await fsp.writeFile(path.join(appDir, 'Lira.exe'), deterministicBytes('electron-exe', 384 * 1024))
  await fsp.writeFile(path.join(appDir, 'resources/gstreamer/bin/gst.dll'), deterministicBytes('gstreamer-dll', 256 * 1024))
  await fsp.writeFile(path.join(appDir, 'resources/native/process-audio-capture.exe'), deterministicBytes('audio-helper', 16 * 1024))
  if (opts.includeObsoleteFile) {
    await fsp.writeFile(path.join(appDir, 'resources/obsolete.txt'), 'remove-me')
  }
  if (opts.includeNewExternalFile) {
    await fsp.writeFile(path.join(appDir, 'resources/new-note.txt'), 'added-in-update')
  }

  const manifest = await writeUpdateManifest(appDir, version)
  return { appDir, manifest }
}

async function startRangeServer(
  directory: string,
  options: { disableRange?: boolean; hideManifest?: boolean } = {},
) {
  let rangeRequests = 0
  let rangeBytesSent = 0
  let manifestRequests = 0

  const server = http.createServer((req, res) => {
    const fileName = decodeURIComponent((req.url || '/').replace(/^\/+/, ''))
    if (options.hideManifest && fileName === INCREMENTAL_MANIFEST_NAME) {
      res.writeHead(404)
      res.end()
      return
    }
    const filePath = path.join(directory, fileName)
    if (!fs.existsSync(filePath)) {
      res.writeHead(404)
      res.end()
      return
    }
    const stat = fs.statSync(filePath)
    if (fileName === INCREMENTAL_MANIFEST_NAME) manifestRequests++
    const rangeHeader = req.headers.range
    if (rangeHeader && !options.disableRange) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader)
      if (!match) {
        res.writeHead(416)
        res.end()
        return
      }
      const start = Number(match[1])
      const end = Math.min(Number(match[2]), stat.size - 1)
      const len = end - start + 1
      rangeRequests++
      rangeBytesSent += len
      res.writeHead(206, {
        'Content-Type': 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': String(len),
      })
      fs.createReadStream(filePath, { start, end }).pipe(res)
      return
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(stat.size),
    })
    fs.createReadStream(filePath).pipe(res)
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stats: () => ({ rangeRequests, rangeBytesSent, manifestRequests }),
  }
}

describe('incremental ASAR + file pack updater', () => {
  it('coalesces nearby pack ranges into bounded windows and keeps large items isolated', () => {
    const windows = planByteRanges(
      [
        { key: 'a', packOffset: 0, packLength: 1000, rawLength: 1000, hash: 'A'.repeat(64), compression: 'raw', destinationPath: 'a' },
        { key: 'b', packOffset: 5000, packLength: 2000, rawLength: 2000, hash: 'B'.repeat(64), compression: 'raw', destinationPath: 'b' },
        { key: 'c', packOffset: 500_000, packLength: 500, rawLength: 500, hash: 'C'.repeat(64), compression: 'raw', destinationPath: 'c' },
      ],
      64 * 1024,
      1024 * 1024,
    )
    expect(windows).toHaveLength(2)
    expect(windows[0]).toMatchObject({ start: 0, end: 6999 })
    expect(windows[0].items.map(i => i.key)).toEqual(['a', 'b'])
    expect(windows[1]).toMatchObject({ start: 500_000, end: 500_499 })
  })

  it('reconstructs app.asar bit-for-bit using < 5% download size and applies via SparseDeltaUpdate', async () => {
    const root = makeTempDir('lira-inc-e2e-')
    const releaseDir = path.join(root, 'release')
    const installParent = path.join(root, 'installed')
    const liveInstall = path.join(installParent, 'lira')
    const userDataDir = path.join(root, 'profile', 'lira')
    await fsp.mkdir(path.join(userDataDir, 'data', 'spaces'), { recursive: true })
    await fsp.writeFile(path.join(userDataDir, 'data', 'spaces', 'home.json'), '{"id":"home"}')

    const v1 = await createSyntheticAppInstall(root, '1.0.0', {
      mainCode: 'console.log("v1.0.0");\n',
      includeObsoleteFile: true,
    })
    const v2 = await createSyntheticAppInstall(root, '1.0.1', {
      mainCode: 'console.log("v1.0.1 - updated");\n',
      extraSprite: 'lamp-v2',
      includeNewExternalFile: true,
    })

    await fsp.cp(v1.appDir, liveInstall, { recursive: true })
    const packStats = await buildIncrementalReleaseArtifacts({
      appOutDir: v2.appDir,
      outputDir: releaseDir,
      version: '1.0.1',
      manifest: v2.manifest,
    })
    expect(fs.existsSync(path.join(releaseDir, INCREMENTAL_MANIFEST_NAME))).toBe(true)
    expect(fs.existsSync(path.join(releaseDir, INCREMENTAL_PACK_NAME))).toBe(true)
    expect(packStats.asarBlockCount).toBeGreaterThanOrEqual(6)

    const server = await startRangeServer(releaseDir)
    const progressEvents: number[] = []
    const stageDir = path.join(installParent, 'lira.update-stage')

    const staged = await prepareIncrementalUpdate({
      installDir: liveInstall,
      stageDir,
      targetVersion: 'v1.0.1',
      releaseBaseUrl: server.baseUrl,
      onProgress: pct => progressEvents.push(pct),
    })

    expect(staged.ok).toBe(true)
    if (!staged.ok) throw new Error(staged.reason)

    // Verify massive bandwidth reduction: unchanged WASM, font, PNG, Lira.exe and gst.dll were NOT downloaded.
    // 3 tiers changed here (Tier 0 code+header, Tier 1 new sprite, Tier 3 new external file) -> at most 3 Range requests.
    const net = server.stats()
    expect(net.rangeRequests).toBeLessThanOrEqual(3)
    expect(net.rangeBytesSent).toBeLessThan(30 * 1024) // < 30 KB vs ~1.5 MB full install!
    expect(staged.plan.Stats.AsarBlocksReused).toBeGreaterThanOrEqual(4)
    expect(staged.plan.Stats.ExternalFilesKept).toBe(3)
    expect(staged.plan.Stats.ExternalFilesDownloaded).toBe(1)
    expect(staged.plan.RemovedFiles).toEqual(['resources\\obsolete.txt'])
    expect(progressEvents[progressEvents.length - 1]).toBe(100)

    // Verify bit-for-bit equality of reconstructed app.asar against official v2 app.asar
    const expectedAsar = await fsp.readFile(path.join(v2.appDir, ASAR_RELATIVE_NAME))
    const rebuiltAsar = await fsp.readFile(path.join(stageDir, 'payload', ASAR_RELATIVE_NAME))
    expect(rebuiltAsar.equals(expectedAsar)).toBe(true)

    // Re-running prepareIncrementalUpdate reuses the staged directory with zero extra HTTP requests
    const beforeReuseRequests = server.stats().rangeRequests
    const reused = await prepareIncrementalUpdate({
      installDir: liveInstall,
      stageDir,
      targetVersion: '1.0.1',
      releaseBaseUrl: server.baseUrl,
    })
    expect(reused.ok).toBe(true)
    expect(server.stats().rangeRequests).toBe(beforeReuseRequests)
    expect(await readStagedIncrementalPlan(stageDir, '1.0.1')).not.toBeNull()

    // On Windows, execute the REAL PowerShell SparseDeltaUpdate + Commit and verify unchanged files keep timestamps
    if (process.platform === 'win32') {
      const exeBefore = fs.statSync(path.join(liveInstall, 'Lira.exe'))
      const gstBefore = fs.statSync(path.join(liveInstall, 'resources/gstreamer/bin/gst.dll'))

      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.resolve('build/update-recovery.ps1'),
          '-Action',
          'SparseDeltaUpdate',
          '-InstallDir',
          liveInstall,
          '-PayloadDir',
          path.join(stageDir, 'payload'),
          '-UserDataDir',
          userDataDir,
        ],
        { windowsHide: true, stdio: 'pipe' },
      )
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.resolve('build/update-recovery.ps1'),
          '-Action',
          'Commit',
          '-InstallDir',
          liveInstall,
          '-UserDataDir',
          userDataDir,
        ],
        { windowsHide: true, stdio: 'pipe' },
      )

      expect(fs.existsSync(path.join(installParent, 'lira.update-pending.json'))).toBe(false)
      expect(fs.existsSync(path.join(liveInstall, 'resources/obsolete.txt'))).toBe(false)
      expect(fs.readFileSync(path.join(liveInstall, 'resources/new-note.txt'), 'utf8')).toBe('added-in-update')
      expect(fs.readFileSync(path.join(liveInstall, ASAR_RELATIVE_NAME)).equals(expectedAsar)).toBe(true)
      expect(JSON.parse(fs.readFileSync(path.join(liveInstall, 'resources/update-manifest.json'), 'utf8')).Version).toBe('1.0.1')
      // Unchanged runtime files were never rewritten
      expect(fs.statSync(path.join(liveInstall, 'Lira.exe')).mtimeMs).toBe(exeBefore.mtimeMs)
      expect(fs.statSync(path.join(liveInstall, 'resources/gstreamer/bin/gst.dll')).mtimeMs).toBe(gstBefore.mtimeMs)
      // User profile data untouched
      expect(fs.readFileSync(path.join(userDataDir, 'data/spaces/home.json'), 'utf8')).toBe('{"id":"home"}')
    }
  }, 60_000)

  it.skipIf(process.platform !== 'win32')('rolls back cleanly if SparseDeltaUpdate is interrupted after Applying', async () => {
    const root = makeTempDir('lira-inc-rollback-')
    const releaseDir = path.join(root, 'release')
    const installParent = path.join(root, 'installed')
    const liveInstall = path.join(installParent, 'lira')
    const userDataDir = path.join(root, 'profile', 'lira')
    await fsp.mkdir(path.join(userDataDir, 'data', 'spaces'), { recursive: true })
    await fsp.writeFile(path.join(userDataDir, 'data', 'spaces', 'saved.json'), '{"v":1}')

    const v1 = await createSyntheticAppInstall(root, '1.0.0', { mainCode: 'console.log("v1");\n', includeObsoleteFile: true })
    const v2 = await createSyntheticAppInstall(root, '1.0.1', { mainCode: 'console.log("v2");\n', includeNewExternalFile: true })
    await fsp.cp(v1.appDir, liveInstall, { recursive: true })
    await buildIncrementalReleaseArtifacts({ appOutDir: v2.appDir, outputDir: releaseDir, version: '1.0.1', manifest: v2.manifest })

    const server = await startRangeServer(releaseDir)
    const stageDir = path.join(installParent, 'lira.update-stage')
    const staged = await prepareIncrementalUpdate({ installDir: liveInstall, stageDir, targetVersion: '1.0.1', releaseBaseUrl: server.baseUrl })
    expect(staged.ok).toBe(true)

    // Run SparseDeltaUpdate WITHOUT Commit, mutate profile, then run Restore to verify FormatVersion 6 rollback works
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.resolve('build/update-recovery.ps1'),
        '-Action', 'SparseDeltaUpdate',
        '-InstallDir', liveInstall,
        '-PayloadDir', path.join(stageDir, 'payload'),
        '-UserDataDir', userDataDir,
      ],
      { windowsHide: true, stdio: 'pipe' },
    )
    expect(fs.existsSync(path.join(installParent, 'lira.update-pending.json'))).toBe(true)
    await fsp.writeFile(path.join(userDataDir, 'data', 'spaces', 'saved.json'), '{"v":"migrated-bad"}')

    execFileSync(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.resolve('build/update-recovery.ps1'),
        '-Action', 'Restore',
        '-InstallDir', liveInstall,
        '-UserDataDir', userDataDir,
      ],
      { windowsHide: true, stdio: 'pipe' },
    )

    expect(fs.existsSync(path.join(installParent, 'lira.update-pending.json'))).toBe(false)
    expect(fs.readFileSync(path.join(liveInstall, ASAR_RELATIVE_NAME)).equals(fs.readFileSync(path.join(v1.appDir, ASAR_RELATIVE_NAME)))).toBe(true)
    expect(fs.existsSync(path.join(liveInstall, 'resources/obsolete.txt'))).toBe(true)
    expect(fs.existsSync(path.join(liveInstall, 'resources/new-note.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(userDataDir, 'data/spaces/saved.json'), 'utf8')).toBe('{"v":1}')
  }, 60_000)

  it('falls back gracefully when manifest is 404, Range is unsupported, delta exceeds threshold, or local ASAR has bit-rot', async () => {
    const root = makeTempDir('lira-inc-fallback-')
    const releaseDir = path.join(root, 'release')
    const liveInstall = path.join(root, 'lira')

    const v1 = await createSyntheticAppInstall(root, '1.0.0', { mainCode: 'console.log("v1");\n' })
    const v2 = await createSyntheticAppInstall(root, '1.0.1', { mainCode: 'console.log("v2");\n' })
    await fsp.cp(v1.appDir, liveInstall, { recursive: true })
    await buildIncrementalReleaseArtifacts({ appOutDir: v2.appDir, outputDir: releaseDir, version: '1.0.1', manifest: v2.manifest })

    // 1. 404 manifest -> fallback
    const noManifestServer = await startRangeServer(releaseDir, { hideManifest: true })
    const r404 = await prepareIncrementalUpdate({ installDir: liveInstall, targetVersion: '1.0.1', releaseBaseUrl: noManifestServer.baseUrl, attempts: 1 })
    expect(r404).toMatchObject({ ok: false, fallbackToFull: true })

    // 2. Range unsupported (HTTP 200 instead of 206) -> fallback
    const noRangeServer = await startRangeServer(releaseDir, { disableRange: true })
    const rNoRange = await prepareIncrementalUpdate({ installDir: liveInstall, targetVersion: '1.0.1', releaseBaseUrl: noRangeServer.baseUrl, attempts: 1 })
    expect(rNoRange).toMatchObject({ ok: false, fallbackToFull: true })

    // 3. Delta exceeds maxDownloadBytes -> fallback
    const okServer = await startRangeServer(releaseDir)
    const rTooBig = await prepareIncrementalUpdate({ installDir: liveInstall, targetVersion: '1.0.1', releaseBaseUrl: okServer.baseUrl, maxDownloadBytes: 10 })
    expect(rTooBig).toMatchObject({ ok: false, fallbackToFull: true })

    // 4. Bit-rot in a reused local ASAR block (e.g. df_bg-static.wasm) -> fails SHA-256 verification and falls back cleanly
    const asarFile = path.join(liveInstall, ASAR_RELATIVE_NAME)
    const idx = await indexLocalAsar(asarFile)
    const largestReused = [...(idx?.byHash.values() || [])].sort((a, b) => b.length - a.length)[0]
    expect(largestReused).toBeDefined()
    const handle = await fsp.open(asarFile, 'r+')
    try {
      await handle.write(Buffer.from([0xde, 0xad, 0xbe, 0xef]), 0, 4, largestReused!.fileOffset + 64)
    } finally {
      await handle.close()
    }
    const stageDir = path.join(root, 'stage-corrupt')
    const rCorrupt = await prepareIncrementalUpdate({ installDir: liveInstall, stageDir, targetVersion: '1.0.1', releaseBaseUrl: okServer.baseUrl })
    expect(rCorrupt).toMatchObject({ ok: false, fallbackToFull: true })
    expect(fs.existsSync(stageDir)).toBe(false)
  }, 60_000)

  it('fetches a pure code-only release in a single coalesced HTTP Range request', async () => {
    const root = makeTempDir('lira-inc-code-only-')
    const releaseDir = path.join(root, 'release')
    const liveInstall = path.join(root, 'lira')

    const v1 = await createSyntheticAppInstall(root, '1.0.0', { mainCode: 'console.log("v1");\n' })
    const v2 = await createSyntheticAppInstall(root, '1.0.1', { mainCode: 'console.log("v2 code-only");\n' })
    await fsp.cp(v1.appDir, liveInstall, { recursive: true })
    await buildIncrementalReleaseArtifacts({ appOutDir: v2.appDir, outputDir: releaseDir, version: '1.0.1', manifest: v2.manifest })

    const server = await startRangeServer(releaseDir)
    const stageDir = path.join(root, 'stage-code-only')
    const res = await prepareIncrementalUpdate({ installDir: liveInstall, stageDir, targetVersion: '1.0.1', releaseBaseUrl: server.baseUrl })
    expect(res.ok).toBe(true)
    expect(server.stats().rangeRequests).toBe(1)
    expect(server.stats().rangeBytesSent).toBeLessThan(10 * 1024)
  }, 60_000)

  it.skipIf(process.platform !== 'win32')('runs update-apply-incremental.ps1 end-to-end and cleans stage & lock files', async () => {
    const root = makeTempDir('lira-inc-applier-')
    const releaseDir = path.join(root, 'release')
    const installParent = path.join(root, 'installed')
    const liveInstall = path.join(installParent, 'lira')
    const userDataDir = path.join(root, 'profile', 'lira')
    await fsp.mkdir(path.join(userDataDir, 'data'), { recursive: true })

    const v1 = await createSyntheticAppInstall(root, '1.0.0', { mainCode: 'console.log("v1");\n' })
    const v2 = await createSyntheticAppInstall(root, '1.0.1', { mainCode: 'console.log("v2 applied");\n' })
    await fsp.cp(v1.appDir, liveInstall, { recursive: true })
    await buildIncrementalReleaseArtifacts({ appOutDir: v2.appDir, outputDir: releaseDir, version: '1.0.1', manifest: v2.manifest })

    const server = await startRangeServer(releaseDir)
    const stageDir = path.join(installParent, 'lira.update-stage')
    const staged = await prepareIncrementalUpdate({ installDir: liveInstall, stageDir, targetVersion: '1.0.1', releaseBaseUrl: server.baseUrl })
    expect(staged.ok).toBe(true)

    const scriptsDir = path.join(stageDir, 'scripts')
    await fsp.mkdir(scriptsDir, { recursive: true })
    for (const file of ['update-recovery.ps1', 'update-io.ps1', 'update-delta.ps1', 'update-apply-incremental.ps1']) {
      await fsp.copyFile(path.resolve('build', file), path.join(scriptsDir, file))
    }

    execFileSync(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(scriptsDir, 'update-apply-incremental.ps1'),
        '-InstallDir', liveInstall,
        '-UserDataDir', userDataDir,
        '-StageDir', stageDir,
        '-TargetVersion', '1.0.1',
        '-SilentBoot',
      ],
      { windowsHide: true, stdio: 'pipe' },
    )

    expect(JSON.parse(fs.readFileSync(path.join(liveInstall, 'resources/update-manifest.json'), 'utf8')).Version).toBe('1.0.1')
    expect(fs.existsSync(path.join(installParent, 'lira.update-pending.json'))).toBe(false)
    expect(fs.existsSync(path.join(installParent, 'lira.update-applying.lock'))).toBe(false)
    expect(fs.existsSync(stageDir)).toBe(false)
  }, 60_000)

  it('reconstructs chunked Lira.exe bit-for-bit when only 64 version bytes change (rcedit scenario)', async () => {
    const root = makeTempDir('lira-inc-chunked-exe-')
    const releaseDir = path.join(root, 'release')
    const liveInstall = path.join(root, 'lira')

    const v1 = await createSyntheticAppInstall(root, '1.0.0', { mainCode: 'console.log("v1");\n' })
    const v2 = await createSyntheticAppInstall(root, '1.0.1', { mainCode: 'console.log("v2");\n' })

    // Replace Lira.exe with a 1 MB binary where only 64 bytes near the end differ (like rcedit PE version stamp)
    const exeV1 = deterministicBytes('real-electron-bin', 1024 * 1024)
    const exeV2 = Buffer.from(exeV1)
    for (let i = 0; i < 64; i++) exeV2[exeV2.length - 512 + i] ^= 0xff
    await fsp.writeFile(path.join(v1.appDir, 'Lira.exe'), exeV1)
    await fsp.writeFile(path.join(v2.appDir, 'Lira.exe'), exeV2)
    await writeUpdateManifest(v1.appDir, '1.0.0')
    const v2Manifest = await writeUpdateManifest(v2.appDir, '1.0.1')

    await fsp.cp(v1.appDir, liveInstall, { recursive: true })
    await buildIncrementalReleaseArtifacts({
      appOutDir: v2.appDir,
      outputDir: releaseDir,
      version: '1.0.1',
      manifest: v2Manifest,
      externalChunkThreshold: 256 * 1024,
      externalChunkSize: 64 * 1024,
    })

    const server = await startRangeServer(releaseDir)
    const stageDir = path.join(root, 'stage-chunked-exe')
    const staged = await prepareIncrementalUpdate({
      installDir: liveInstall,
      stageDir,
      targetVersion: '1.0.1',
      releaseBaseUrl: server.baseUrl,
    })

    expect(staged.ok).toBe(true)
    if (!staged.ok) throw new Error(staged.reason)

    // 15 of 16 chunks of Lira.exe reused locally; only 1 chunk (64 KB) + tiny ASAR code downloaded
    expect(staged.plan.Stats.ExternalChunksReused).toBe(15)
    expect(staged.plan.Stats.ExternalChunksDownloaded).toBe(1)
    expect(server.stats().rangeBytesSent).toBeLessThan(80 * 1024)

    const rebuiltExe = await fsp.readFile(path.join(stageDir, 'payload', 'Lira.exe'))
    expect(rebuiltExe.equals(exeV2)).toBe(true)
  }, 60_000)

  it('rejects malformed, version-mismatched, and path-traversal incremental manifests', () => {
    expect(() => validateIncrementalManifest(null)).toThrow()
    expect(() => validateIncrementalManifest({ FormatVersion: 99 })).toThrow()
    expect(() =>
      validateIncrementalManifest(
        {
          FormatVersion: 1,
          Version: '1.0.1',
          Platform: 'win32',
          Arch: 'x64',
          PackFileName: INCREMENTAL_PACK_NAME,
          PackSize: 100,
          Manifest: {
            FormatVersion: 1,
            Version: '1.0.1',
            Files: [
              { Name: '..\\evil.exe', Length: 10, Hash: 'A'.repeat(64) },
              { Name: 'Lira.exe', Length: 10, Hash: 'B'.repeat(64) },
              { Name: ASAR_RELATIVE_NAME, Length: 20, Hash: 'C'.repeat(64) },
            ],
          },
          Files: [],
          Asar: {},
        },
        '1.0.1',
      ),
    ).toThrow(/Invalid update entry/)
    expect(() => validateIncrementalManifest({ FormatVersion: 4 })).toThrow(/Unsupported incremental manifest format/)
    expect(() => validateIncrementalManifest({ FormatVersion: 99 })).toThrow(/Unsupported incremental manifest format/)
  })

  it('emits FormatVersion 3 in release artifacts and accepts FormatVersion 1, 2, and 3', async () => {
    expect(INCREMENTAL_FORMAT_VERSION).toBe(3)
    const root = makeTempDir('lira-inc-format-v3-')
    const releaseDir = path.join(root, 'release')
    const v2 = await createSyntheticAppInstall(root, '1.0.1', { mainCode: 'console.log("v2");\n' })
    const artifacts = await buildIncrementalReleaseArtifacts({
      appOutDir: v2.appDir,
      outputDir: releaseDir,
      version: '1.0.1',
      manifest: v2.manifest,
    })

    const manifestObj = JSON.parse(zlib.gunzipSync(fs.readFileSync(artifacts.manifestPath)).toString('utf8'))
    expect(manifestObj.FormatVersion).toBe(3)

    for (const supportedVersion of [1, 2, 3]) {
      const validated = validateIncrementalManifest({ ...manifestObj, FormatVersion: supportedVersion }, '1.0.1')
      expect(validated.FormatVersion).toBe(supportedVersion)
    }

    for (const unsupportedVersion of [4, 99]) {
      expect(() => validateIncrementalManifest({ ...manifestObj, FormatVersion: unsupportedVersion }, '1.0.1')).toThrow(
        /Unsupported incremental manifest format/,
      )
    }
  })
})
