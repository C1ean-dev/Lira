import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorHistoryControls } from '../../editor/EditorHistoryControls'
import { MeetingSummaryPanel } from '../../components/collaboration/MeetingSummaryPanel'
import { WhiteboardPanel } from '../../components/collaboration/WhiteboardPanel'
import { useMapStore } from '../../store/useMapStore'
import { useMeetingStore } from '../../store/useMeetingStore'
import { useWhiteboardStore } from '../../store/useWhiteboardStore'
import { PeerManager } from '../../p2p/PeerManager'

// React SSR reads Zustand's initial snapshot. Use the live test state while
// retaining the actual store actions so these fixtures cover populated panels.
vi.mock('../../store/useMeetingStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../../store/useMeetingStore')>()
  return { ...actual, useMeetingStore: Object.assign((selector?: any) => selector ? selector(actual.useMeetingStore.getState()) : actual.useMeetingStore.getState(), actual.useMeetingStore) }
})
vi.mock('../../store/useWhiteboardStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../../store/useWhiteboardStore')>()
  return { ...actual, useWhiteboardStore: Object.assign((selector?: any) => selector ? selector(actual.useWhiteboardStore.getState()) : actual.useWhiteboardStore.getState(), actual.useWhiteboardStore) }
})

const originalMap = useMapStore.getState(), originalMeetings = useMeetingStore.getState()
afterEach(() => { useMapStore.setState(originalMap); useMeetingStore.setState(originalMeetings); useWhiteboardStore.getState().reset(); vi.restoreAllMocks() })
describe('collaboration tools UI', () => {
  it('offers undo/redo with keyboard hints and disabled empty history', () => {
    useMapStore.setState({ historyPast: [], historyFuture: [] })
    const html = renderToStaticMarkup(<EditorHistoryControls />)
    expect(html).toContain('Desfazer')
    expect(html).toContain('Refazer')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
  })
  it('keeps archived meetings accessible after calls and explains the AI data transfer', () => {
    useMeetingStore.setState({ isOpen: true })
    const id = useMeetingStore.getState().begin('room', 'zone', 'Planejamento')
    useMeetingStore.getState().append(id, { id: 1, speakerId: 'ana', speakerName: 'Ana', text: 'Revisar entrega', timestamp: 1 })
    useMeetingStore.getState().finish(id)
    const html = renderToStaticMarkup(<MeetingSummaryPanel />)
    expect(html).toContain('Planejamento')
    expect(html).toContain('Gerar resumo com IA')
    expect(html).toContain('OpenRouter')
    expect(html).toContain('Exportar')
    expect(html).toContain('type="password"')
  })
  it('provides a scalable board with drawing, color, undo, clear and export', () => {
    useWhiteboardStore.setState({ isOpen: true, roomId: 'room' })
    const html = renderToStaticMarkup(<WhiteboardPanel />)
    expect(html).toContain('Quadro branco')
    expect(html).toContain('viewBox="0 0 1000 600"')
    expect(html).toContain('Cor do traço')
    expect(html).toContain('Desfazer meu traço')
    expect(html).toContain('Limpar quadro')
    expect(html).toContain('Exportar SVG')
  })
  it('does not initialize a peer manager while the board is closed', () => {
    const getPeer = vi.spyOn(PeerManager, 'getInstance')
    useWhiteboardStore.setState({ isOpen: false })
    renderToStaticMarkup(<WhiteboardPanel />)
    expect(getPeer).not.toHaveBeenCalled()
    getPeer.mockRestore()
  })
})
