import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParsecEchoSettings, applyParsecEchoProtection } from '../../components/settings/ParsecEchoSettings'
import { AudioDevicesTab } from '../../components/settings/AudioDevicesTab'

afterEach(() => vi.unstubAllGlobals())
const desktop = (configure = vi.fn(async () => ({ ok: true, restartRequired: false, restarted: false }))) => {
  vi.stubGlobal('window', { electronAPI: { platform: 'win32', configureParsecEcho: configure } })
  return configure
}

describe('Parsec echo protection in audio settings', () => {
  it('renders a compact informative status card with a discrete reapply button', () => {
    desktop()
    const html = renderToStaticMarkup(<ParsecEchoSettings />)
    expect(html).toContain('Evitar eco no Parsec')
    expect(html).toContain('Proteção ativa')
    expect(html).toContain('Exclui automaticamente o áudio do Lira')
    expect(html).toContain('Reaplicar')
  })

  it('is rendered below the sound effects section in audio device controls', () => {
    desktop()
    const html = renderToStaticMarkup(
      <AudioDevicesTab inputDevices={[]} outputDevices={[]} videoDevices={[]} isPlayingTestSound={false} onPlayTestSound={() => {}} />
    )
    const soundEffectsIndex = html.indexOf('Efeitos Sonoros')
    const parsecIndex = html.indexOf('Evitar eco no Parsec')
    expect(soundEffectsIndex).toBeGreaterThan(-1)
    expect(parsecIndex).toBeGreaterThan(soundEffectsIndex)
  })

  it('hides the integration outside the Windows desktop app', () => {
    vi.stubGlobal('window', {})
    expect(renderToStaticMarkup(<ParsecEchoSettings />)).toBe('')
    vi.stubGlobal('window', { electronAPI: { platform: 'darwin', configureParsecEcho: vi.fn() } })
    expect(renderToStaticMarkup(<ParsecEchoSettings />)).toBe('')
  })

  it('reports automatic active protection when no manual restart is needed', async () => {
    const configure = desktop(vi.fn(async () => ({ ok: true, restartRequired: false, restarted: false })))
    expect(await applyParsecEchoProtection()).toMatchObject({
      ok: true,
      restartRequired: false,
      restarted: false,
      message: expect.stringContaining('Proteção ativa no Parsec'),
    })
    expect(configure).toHaveBeenCalledOnce()
  })

  it('reports when Parsec was automatically restarted to apply the configuration', async () => {
    desktop(vi.fn(async () => ({ ok: true, restartRequired: false, restarted: true })))
    expect(await applyParsecEchoProtection()).toMatchObject({
      ok: true,
      restartRequired: false,
      restarted: true,
      message: expect.stringContaining('reiniciado automaticamente'),
    })
  })

  it('reports that a manual restart is still required if automatic restart could not complete', async () => {
    desktop(vi.fn(async () => ({ ok: true, restartRequired: true, restarted: false })))
    expect(await applyParsecEchoProtection()).toMatchObject({
      ok: true,
      restartRequired: true,
      restarted: false,
      message: expect.stringContaining('Reinicie o Parsec'),
    })
  })

  it('shows configuration errors without claiming protection is active', async () => {
    desktop(vi.fn(async () => ({ ok: false, error: 'Parsec não encontrado.' })) as any)
    expect(await applyParsecEchoProtection()).toEqual({ ok: false, message: 'Parsec não encontrado.' })
    desktop(vi.fn(async () => { throw new Error('IPC disconnected') }))
    expect(await applyParsecEchoProtection()).toMatchObject({ ok: false, message: expect.stringContaining('Não foi possível') })
  })
})
