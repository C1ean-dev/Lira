import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GSTREAMER_COLD_START_TIMEOUT_MS,
  GSTREAMER_WARM_START_TIMEOUT_MS,
  buildGStreamerEnv,
  buildGStreamerPipeline,
  findGStreamerRuntime,
  gstreamerStartupTimeoutMs,
  resolveGStreamerSource,
} from '../../../electron/gstreamerLive'
import { gstreamerSignalSchema, normalizeGStreamerOffer } from '../../media/gstreamerProtocol'

describe('GStreamer live', () => {
  const windowSource = { id: 'window:84049:0', display_id: '' }
  const screenSource = { id: 'screen:25:0', display_id: '25' }

  it('uses the exact selected source and resolves the display ID without guessing its DXGI index', () => {
    expect(resolveGStreamerSource(windowSource.id, [windowSource], [])).toEqual({ windowHandle: '84049' })
    expect(resolveGStreamerSource('window:84050:0', [windowSource], [])).toBeNull()
    expect(resolveGStreamerSource(screenSource.id, [screenSource], [{ id: 25 }])).toEqual({ monitorIndex: 0 })
    expect(resolveGStreamerSource(screenSource.id, [screenSource], [{ id: 26 }, { id: 25 }])).toEqual({ displayId: 25 })
    expect(resolveGStreamerSource(screenSource.id, [screenSource], [{ id: 26 }, { id: 27 }])).toBeNull()
    expect(resolveGStreamerSource(screenSource.id, [screenSource], [{ id: 30 }])).toBeNull()
  })

  it('targets the Win32 monitor handle when sharing from a multi-monitor desktop', () => {
    const args = buildGStreamerPipeline({ monitorHandle: '262175' }, { width: 1280, height: 720, fps: 30 }, 'ws://127.0.0.1:61001/native', 'test-token')
    expect(args).toEqual(expect.arrayContaining(['capture-api=dxgi', 'monitor-handle=262175']))
    expect(args.some(arg => arg.startsWith('monitor-index='))).toBe(false)
  })

  it('preserves the tested hardware capture and sends WebRTC to a private signaller', () => {
    const args = buildGStreamerPipeline({ windowHandle: '84049' }, { width: 1920, height: 1080, fps: 60 }, 'ws://127.0.0.1:61001/native', 'test-token')
    expect(args).toEqual(expect.arrayContaining([
      'capture-api=wgc', 'window-handle=84049', 'amfh264enc', 'bitrate=8000', 'gop-size=60',
      'video/x-raw(memory:D3D11Memory),format=NV12,width=1920,height=1080,framerate=60/1',
      'webrtcsink', 'run-web-server=false', 'run-signalling-server=false',
      'signaller::uri=ws://127.0.0.1:61001/native', 'signaller::headers=headers,lira-token=(string)test-token',
    ]))
  })

  it('accepts only bounded session-scoped offers, answers, ICE and lifecycle signals', () => {
    const session = 'a87cdfd3-1d62-447c-a155-50348760fe30'
    expect(gstreamerSignalSchema.safeParse({ kind: 'watch', session }).success).toBe(true)
    expect(gstreamerSignalSchema.safeParse({ kind: 'sdp', session, description: { type: 'offer', sdp: 'v=0\r\n' } }).success).toBe(true)
    expect(gstreamerSignalSchema.safeParse({ kind: 'sdp', session, description: { type: 'answer', sdp: 'a'.repeat(131073) } }).success).toBe(false)
    expect(gstreamerSignalSchema.safeParse({ kind: 'ice', session, candidate: { candidate: 'candidate:1', sdpMLineIndex: -1 } }).success).toBe(false)
    expect(gstreamerSignalSchema.safeParse({ kind: 'run', session }).success).toBe(false)
  })

  it('normalizes only the AMF H.264 profile in the video section', () => {
    const video = 'm=video 9 UDP/TLS/RTP/SAVPF 96 97\r\na=rtpmap:96 H264/90000\r\na=fmtp:96 profile-level-id=42042a;packetization-mode=1\r\na=fmtp:97 profile-level-id=42042a\r\n'
    const audio = 'm=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=fmtp:96 profile-level-id=42042a\r\n'
    expect(normalizeGStreamerOffer(video + audio)).toBe(video.replace('42042a', '42002a') + audio)
  })

  it('uses an adaptive startup timeout depending on whether the registry cache exists', () => {
    const temp = mkdtempSync(join(tmpdir(), 'lira-gst-timeout-'))
    try {
      const reg = join(temp, 'gstreamer-registry.bin')
      expect(gstreamerStartupTimeoutMs(reg)).toBe(GSTREAMER_COLD_START_TIMEOUT_MS)
      expect(gstreamerStartupTimeoutMs(reg, false)).toBe(GSTREAMER_COLD_START_TIMEOUT_MS)
      writeFileSync(reg, 'cached')
      expect(gstreamerStartupTimeoutMs(reg)).toBe(GSTREAMER_WARM_START_TIMEOUT_MS)
      expect(gstreamerStartupTimeoutMs(reg, true)).toBe(GSTREAMER_WARM_START_TIMEOUT_MS)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('builds isolated GStreamer environment variables pointing to the given runtime and registry', () => {
    const root = join('C:\\fake', 'gst-root')
    const registry = join('C:\\fake', 'userData', 'gstreamer-registry.bin')
    const env = buildGStreamerEnv(root, registry)
    expect(env.GST_PLUGIN_PATH).toBe('')
    expect(env.GST_PLUGIN_PATH_1_0).toBe('')
    expect(env.GST_PLUGIN_SYSTEM_PATH).toBe('')
    expect(env.GST_PLUGIN_SYSTEM_PATH_1_0).toBe(join(root, 'lib', 'gstreamer-1.0'))
    expect(env.GST_PLUGIN_SCANNER).toBe(join(root, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner.exe'))
    expect(env.GST_REGISTRY).toBe(registry)
    expect(env.PATH?.split(delimiter)[0]).toBe(join(root, 'bin'))
  })

  it.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
    'prefers the trimmed dev .scratch runtime only when devAppRoot is provided and respects LIRA_GSTREAMER_ROOT',
    () => {
      const temp = mkdtempSync(join(tmpdir(), 'lira-gst-find-'))
      const prevOverride = process.env.LIRA_GSTREAMER_ROOT
      const prevSystemVar = process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64
      try {
        const scratchRuntime = join(temp, '.scratch', 'gstreamer-runtime')
        mkdirSync(join(scratchRuntime, 'bin'), { recursive: true })
        writeFileSync(join(scratchRuntime, 'bin', 'gst-launch-1.0.exe'), '')

        const overrideRuntime = join(temp, 'override-runtime')
        mkdirSync(join(overrideRuntime, 'bin'), { recursive: true })
        writeFileSync(join(overrideRuntime, 'bin', 'gst-launch-1.0.exe'), '')

        const systemVarRuntime = join(temp, 'system-var-runtime')
        mkdirSync(join(systemVarRuntime, 'bin'), { recursive: true })
        writeFileSync(join(systemVarRuntime, 'bin', 'gst-launch-1.0.exe'), '')

        delete process.env.LIRA_GSTREAMER_ROOT
        process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 = systemVarRuntime

        expect(findGStreamerRuntime(false, '', temp)).toBe(scratchRuntime)
        expect(findGStreamerRuntime(false, '')).toBe(systemVarRuntime)

        process.env.LIRA_GSTREAMER_ROOT = overrideRuntime
        expect(findGStreamerRuntime(false, '', temp)).toBe(overrideRuntime)
      } finally {
        if (prevOverride === undefined) delete process.env.LIRA_GSTREAMER_ROOT
        else process.env.LIRA_GSTREAMER_ROOT = prevOverride
        if (prevSystemVar === undefined) delete process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64
        else process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 = prevSystemVar
        rmSync(temp, { recursive: true, force: true })
      }
    },
  )
})
