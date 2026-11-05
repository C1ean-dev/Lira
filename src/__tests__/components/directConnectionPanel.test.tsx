import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectConnectionPanel } from '../../components/lobby/DirectConnectionPanel'
import { PeerManager } from '../../p2p/PeerManager'
import { useGameStore } from '../../store/useGameStore'
import { encodeLanInvite } from '../../p2p/directInvite'

const captured = vi.hoisted(() => ({ state: [] as unknown[], elements: [] as any[], invites: undefined as string[] | undefined }))
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>()
  return { ...actual,
    useState: (initial: unknown) => { const [value, set] = actual.useState(Array.isArray(initial) ? captured.invites ?? initial : initial); return [value, (next: unknown) => { captured.state.push(next); set(next) }] },
  }
})
function renderPanel(props: React.ComponentProps<typeof DirectConnectionPanel>) {
  function Capture() {
    const result = DirectConnectionPanel(props)
    const visit = (node: any) => {
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (!node?.props) return
      captured.elements.push([node.type, node.props, node.props.children])
      visit(node.props.children)
    }
    visit(result)
    return result
  }
  return renderToStaticMarkup(<Capture />)
}
beforeEach(() => { captured.state = []; captured.elements = []; captured.invites = undefined; vi.restoreAllMocks() })
afterEach(() => vi.unstubAllGlobals())
describe('direct connection controls', () => {
  it('offers an IPv6 invitation that can be copied without a manual answer exchange', async () => {
    const invite = encodeLanInvite({ room: 'ROOM', host: '[2001:db8::20]', port: 9002 })
    captured.invites = [invite]
    const copy = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText: copy } })
    const html = renderPanel({ role: 'host' })
    expect(html).toContain('Convite por IPv6')
    expect(html).toContain('[2001:db8::20]')
    expect(html).toContain('sem trocar uma resposta')
    const button = captured.elements.find(([type, , label]) => type === 'button' && label === 'Copiar convite IPv6')
    await button[1].onClick()
    expect(copy).toHaveBeenCalledWith(invite)
  })
  it('describes private IPv6 as a local network invitation', () => {
    captured.invites = [encodeLanInvite({ room: 'ROOM', host: '[fd12:3456::4]', port: 9000 })]
    const html = renderPanel({ role: 'host' })
    expect(html).toContain('Convite IPv6 da rede local')
    expect(html).toContain('Copiar convite IPv6 local')
  })
  it('explains the two-way exchange and provides a reachable host action', async () => {
    const create = vi.spyOn(PeerManager.getInstance(), 'createDirectInvite').mockResolvedValue('LIRA-DIRECT:offer')
    const html = renderPanel({ role: 'host' })
    expect(html).toContain('Gerar convite direto')
    expect(html).toContain('resposta')
    const button = captured.elements.find(([type, , label]) => type === 'button' && label === 'Gerar convite direto')
    await button[1].onClick()
    expect(create).toHaveBeenCalledOnce()
    expect(captured.state).toContain('LIRA-DIRECT:offer')
  })
  it('lets guests paste a case-sensitive invitation and does not start media before connecting', () => {
    const html = renderPanel({ role: 'guest', onJoined: () => {} })
    expect(html).toContain('Convite do anfitrião')
    const textarea = captured.elements.find(([type, props]) => type === 'textarea' && props['aria-label'] === 'Convite do anfitrião')
    textarea[1].onChange({ target: { value: 'LIRA-DIRECT:aBcD' } })
    expect(captured.state).toContain('LIRA-DIRECT:aBcD')
    expect(useGameStore.getState().roomId).toBeNull()
  })
})
