import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveTransmissionInfo } from '../../components/grid/LiveTransmissionInfo'

const state = vi.hoisted(() => ({ open: false, setOpen: vi.fn(), stats: [] as any[] }))
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return { ...actual, useState: () => [state.open, state.setOpen] }
})
vi.mock('../../hooks/useLiveTransmissionStats', () => ({ useLiveTransmissionStats: vi.fn(() => state.stats) }))
vi.mock('../../store/useGameStore', () => ({ useGameStore: { getState: () => ({ remotePlayers: { peer: { name: 'Pessoa' } } }) } }))

const props = { stream: null, local: true, peerName: 'Você', onOpenSettings: vi.fn() }
function elements() {
  let tree: React.ReactElement
  function Probe() { tree = LiveTransmissionInfo(props); return null }
  renderToStaticMarkup(<Probe />)
  const nodes: React.ReactElement<any>[] = []
  const visit = (node: React.ReactNode) => React.Children.forEach(node, child => {
    if (!React.isValidElement(child)) return
    nodes.push(child)
    visit((child.props as any).children)
  })
  visit(tree!)
  return nodes
}
beforeEach(() => { vi.clearAllMocks(); state.open = false; state.stats = [] })

describe('transmission information', () => {
  it('uses a small circular icon instead of a text badge and opens without focusing the tile', () => {
    const html = renderToStaticMarkup(<LiveTransmissionInfo {...props} />)
    expect(html).toContain('aria-label="Informações da transmissão"')
    expect(html).toContain('rounded-full')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Resolução e FPS')
    expect(html).not.toContain('TRANSMISSÃO AO VIVO')
    const nodes = elements()
    const stopPropagation = vi.fn()
    nodes[0].props.onClick({ stopPropagation })
    nodes.find(node => node.type === 'button')!.props.onClick()
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(state.setOpen).toHaveBeenCalledOnce()
  })

  it('shows measured statistics with unavailable values distinct from zero and preserves capture settings', () => {
    state.open = true
    state.stats = [{ id: 'video', peerId: 'peer', width: 1920, height: 1080, fps: 60,
      bitrateKbps: 2400, bytes: 1048576, bufferMs: 0, rttMs: null, jitterMs: null,
      lossPct: 0, droppedFrames: null, codec: 'VP9', limitation: 'bandwidth' }]
    const html = renderToStaticMarkup(<LiveTransmissionInfo {...props} />)
    for (const value of ['1920 × 1080', '60 FPS', '2.4 Mbps', '1 MB', 'Fila de envio', '0 ms', '—', 'VP9', 'Rede', 'Envio para Pessoa']) expect(html).toContain(value)
    const settings = elements().find(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('Resolução e FPS'))!
    settings.props.onClick()
    expect(props.onOpenSettings).toHaveBeenCalledOnce()
    expect(state.setOpen).toHaveBeenCalledWith(false)
  })

  it('shows received bitrate and playback buffer for viewers without local capture settings', () => {
    state.open = true
    state.stats = [{ id: 'remote', peerId: 'peer', width: null, height: null, fps: null, bitrateKbps: null,
      bytes: null, bufferMs: 20, rttMs: null, jitterMs: null, lossPct: null, droppedFrames: 2, codec: null }]
    const html = renderToStaticMarkup(<LiveTransmissionInfo {...props} local={false} peerName="Pessoa" />)
    expect(html).toContain('Bitrate recebido')
    expect(html).toContain('Buffer de reprodução')
    expect(html).toContain('20 ms')
    expect(html).toContain('Quadros descartados')
    expect(html).not.toContain('Resolução e FPS')
  })
})
