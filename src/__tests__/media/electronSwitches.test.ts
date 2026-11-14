import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { runInNewContext } from 'node:vm'

describe('Electron WebRTC Switches and Features', () => {
  it('configures WebRTC DSCP and Pacer smoothing flags in electron/main.ts', () => {
    const mainPath = path.resolve(process.cwd(), 'electron/main.ts')
    const mainContent = fs.readFileSync(mainPath, 'utf8')

    expect(mainContent).toContain("app.commandLine.appendSwitch('enable-webrtc-dscp')")
    expect(mainContent).toContain('WebRtcPacerSmoothing')
    expect(mainContent).toContain('WebRtcDscpSupport')
  })
})

describe('microphone system volume protection', () => {
  it.each(['', 'ExistingFeature'])('blocks device volume changes before Chromium starts, preserving %s', (existing) => {
    const main = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const start = main.indexOf('// Configure Chromium switches at startup')
    const end = main.indexOf('let mainWindow:', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const switches = new Map([['disable-features', existing]])
    const app = { commandLine: {
      getSwitchValue: (name: string) => switches.get(name) ?? '',
      appendSwitch: (name: string, value = '') => switches.set(name, value),
    } }

    runInNewContext(main.slice(start, end), { app })

    const disabled = switches.get('disable-features')!.split(',')
    expect(disabled).toContain('WebRtcAllowInputVolumeAdjustment')
    expect(disabled).toContain('WebRtcAllowWgcScreenCapturer')
    if (existing) expect(disabled).toContain(existing)
  })
})
