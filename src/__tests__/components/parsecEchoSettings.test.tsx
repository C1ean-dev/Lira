import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParsecEchoSettings, applyParsecEchoProtection } from '../../components/settings/ParsecEchoSettings'
import { AudioDevicesTab } from '../../components/settings/AudioDevicesTab'

afterEach(() => vi.unstubAllGlobals())
const desktop = (configure = vi.fn(async () => ({ ok: true, restartRequired: true }))) => {
  vi.stubGlobal('window', { electronAPI: { platform: 'win32', configureParsecEcho: configure } })
  return configure
}

describe('Parsec echo protection in audio settings', () => {
  it('offers an explicit action on the host and explains the change and restart', () => {
    const configure = desktop()
    const html = renderToStaticMarkup(<ParsecEchoSettings />)
    expect(html).toContain('Evitar eco no Parsec')
    expect(html).toContain('computador que está hospedando o jogo')
    expect(html).toContain('substitui o aplicativo excluído anteriormente')
    expect(html).toContain('Reinicie o Parsec')
    expect(configure).not.toHaveBeenCalled()
  })

  it('is reachable next to the audio device controls', () => {
    desktop()
    expect(renderToStaticMarkup(<AudioDevicesTab inputDevices={[]} outputDevices={[]} videoDevices={[]}
      isPlayingTestSound={false} onPlayTestSound={() => {}} />)).toContain('Evitar eco no Parsec')
  })

  it('hides the integration outside the Windows desktop app', () => {
    vi.stubGlobal('window', {})
    expect(renderToStaticMarkup(<ParsecEchoSettings />)).toBe('')
    vi.stubGlobal('window', { electronAPI: { platform: 'darwin', configureParsecEcho: vi.fn() } })
    expect(renderToStaticMarkup(<ParsecEchoSettings />)).toBe('')
  })

  it('applies only on request and reports that a restart is still required', async () => {
    const configure = desktop()
    expect(await applyParsecEchoProtection()).toMatchObject({ ok: true, message: expect.stringContaining('Reinicie o Parsec') })
    expect(configure).toHaveBeenCalledOnce()
    expect(configure).toHaveBeenCalledWith()
  })

  it('shows configuration errors without claiming protection is active', async () => {
    desktop(vi.fn(async () => ({ ok: false, error: 'Parsec não encontrado.' })) as any)
    expect(await applyParsecEchoProtection()).toEqual({ ok: false, message: 'Parsec não encontrado.' })
    desktop(vi.fn(async () => { throw new Error('IPC disconnected') }))
    expect(await applyParsecEchoProtection()).toMatchObject({ ok: false, message: expect.stringContaining('Não foi possível') })
  })
})
