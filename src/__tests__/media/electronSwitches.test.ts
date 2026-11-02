import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Electron WebRTC Switches and Features', () => {
  it('configures WebRTC DSCP and Pacer smoothing flags in electron/main.ts', () => {
    const mainPath = path.resolve(process.cwd(), 'electron/main.ts')
    const mainContent = fs.readFileSync(mainPath, 'utf8')

    expect(mainContent).toContain("app.commandLine.appendSwitch('enable-webrtc-dscp')")
    expect(mainContent).toContain('WebRtcPacerSmoothing')
    expect(mainContent).toContain('WebRtcDscpSupport')
  })
})
