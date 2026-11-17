// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExcalidrawBoard from '../../components/collaboration/ExcalidrawBoard'
import { useWhiteboardStore } from '../../store/useWhiteboardStore'
import { useGameStore } from '../../store/useGameStore'
import { PeerManager } from '../../p2p/PeerManager'

const sdk = vi.hoisted(() => ({ props: null as any, elements: [] as any[], files: {} as any,
  appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 }, theme: 'light', activeTool: { type: 'selection' } } as any,
  updateScene: vi.fn(), addFiles: vi.fn(),
}))
vi.mock('@excalidraw/excalidraw', async () => {
  const React = await import('react')
  const api = { getSceneElementsIncludingDeleted: () => sdk.elements, getFiles: () => sdk.files,
    getAppState: () => sdk.appState, updateScene: sdk.updateScene, addFiles: sdk.addFiles }
  const MainMenu = Object.assign(({ children }: any) => <>{children}</>, { DefaultItems: Object.fromEntries(['SaveToActiveFile', 'Export', 'SaveAsImage', 'SearchMenu', 'Help', 'ToggleTheme', 'ChangeCanvasBackground'].map(key => [key, () => null])) })
  return { MainMenu, CaptureUpdateAction: { NEVER: 'NEVER', IMMEDIATELY: 'IMMEDIATELY' },
    restoreElements: (elements: unknown[]) => elements,
    Excalidraw: (props: any) => {
      sdk.props = props
      React.useEffect(() => { props.excalidrawAPI(api) }, [props.excalidrawAPI])
      return <div role="application" aria-label="Editor">{props.renderTopRightUI?.(false, {})}</div>
    },
  }
})
const originalGame = useGameStore.getState()
const element = (version = 1) => ({ id: 'shape', type: 'rectangle', x: 10, y: 20, width: 100, height: 80,
  seed: 1, version, versionNonce: version, isDeleted: false, index: 'a0', strokeColor: '#112233' })
beforeEach(async () => {
  sdk.elements = []; sdk.files = {}; vi.clearAllMocks(); localStorage.clear()
  useGameStore.setState({ ...originalGame, roomId: 'test-' + crypto.randomUUID(), isConnected: false })
  useWhiteboardStore.getState().reset()
  await useWhiteboardStore.getState().selectRoom(useGameStore.getState().roomId)
  sdk.updateScene.mockImplementation(scene => { sdk.elements = scene.elements; sdk.props.onChange(scene.elements, sdk.appState, sdk.files) })
  sdk.addFiles.mockImplementation(files => { for (const file of files) sdk.files[file.id] = file })
})
afterEach(async () => { cleanup(); await useWhiteboardStore.getState().flushWrites(); useWhiteboardStore.getState().reset(); useGameStore.setState(originalGame); vi.restoreAllMocks() })
describe('embedded Excalidraw integration', () => {
  it('uses the SDK in Portuguese with local controls and remote embeds disabled', () => {
    render(<ExcalidrawBoard />)
    expect(sdk.props.langCode).toBe('pt-BR')
    expect(sdk.props.handleKeyboardGlobally).toBe(false)
    expect(sdk.props.validateEmbeddable).toBe(false)
    expect(sdk.props.aiEnabled).toBe(false)
    expect(sdk.props.UIOptions.canvasActions.clearCanvas).toBe(false)
    expect(sdk.props.UIOptions.canvasActions.loadScene).toBe(false)
    expect(sdk.props.viewModeEnabled).toBe(false)
  })
  it('persists local changes offline without initializing a network client', () => {
    const peer = vi.spyOn(PeerManager, 'getInstance')
    render(<ExcalidrawBoard />)
    act(() => sdk.props.onChange([element()], sdk.appState, {}))
    expect(Object.values(useWhiteboardStore.getState().document.operations)).toMatchObject([{ kind: 'element', element: { id: 'shape' } }])
    expect(peer).not.toHaveBeenCalled()
  })
  it('applies remote revisions without echoing them or adding them to local history', () => {
    useGameStore.setState({ isConnected: true }); useWhiteboardStore.setState({ synchronized: true })
    const broadcast = vi.fn(); vi.spyOn(PeerManager, 'getInstance').mockReturnValue({ broadcast, getPeerId: () => 'self' } as any)
    render(<ExcalidrawBoard />)
    act(() => sdk.props.onChange([element()], sdk.appState, {})); broadcast.mockClear(); sdk.updateScene.mockClear()
    act(() => useWhiteboardStore.getState().apply(useGameStore.getState().roomId!, { id: 'remote:2', actor: 'remote', clock: 2, kind: 'element', element: element(2) }))
    expect(sdk.updateScene).toHaveBeenCalledWith(expect.objectContaining({ captureUpdate: 'NEVER' }))
    expect(broadcast).not.toHaveBeenCalled()
  })
  it('requires confirmation before clearing the shared document', () => {
    render(<ExcalidrawBoard />)
    act(() => sdk.props.onChange([element()], sdk.appState, {}))
    fireEvent.click(screen.getByRole('button', { name: 'Limpar quadro' }))
    expect(screen.getByRole('alertdialog')).toBeDefined()
    expect(Object.values(useWhiteboardStore.getState().document.operations)[0].kind).toBe('element')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar limpeza' }))
    expect(Object.values(useWhiteboardStore.getState().document.operations).some(op => op.kind === 'clear')).toBe(true)
  })
  it('imports a scene with a deletion barrier and keeps invalid imports from clearing existing content', async () => {
    const { container } = render(<ExcalidrawBoard />)
    act(() => sdk.props.onChange([element()], sdk.appState, {}))
    const input = container.querySelector('input[type=file]')!
    const imported = { ...element(), id: 'imported' }
    await act(async () => { fireEvent.change(input, { target: { files: [{ text: async () => JSON.stringify({ type: 'excalidraw', elements: [imported], files: {} }) }] } }) })
    expect(sdk.elements).toMatchObject([{ id: 'imported' }])
    const before = useWhiteboardStore.getState().document
    await act(async () => { fireEvent.change(input, { target: { files: [{ text: async () => '{}'}] } }) })
    expect(useWhiteboardStore.getState().document).toBe(before)
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível abrir')
  })
  it('shares laser samples and their stop event through the existing P2P transport', () => {
    useGameStore.setState({ isConnected: true }); useWhiteboardStore.setState({ synchronized: true })
    const broadcast = vi.fn(); vi.spyOn(PeerManager, 'getInstance').mockReturnValue({ broadcast, getPeerId: () => 'self' } as any)
    render(<ExcalidrawBoard />)
    act(() => { sdk.props.onPointerUpdate({ pointer: { x: 10, y: 20, tool: 'laser' }, button: 'down' }); sdk.props.onPointerUpdate({ pointer: { x: 10, y: 20, tool: 'laser' }, button: 'up' }) })
    expect(broadcast.mock.calls.map(call => call[0].payload.point)).toEqual([{ x: 10, y: 20 }, null])
  })
})
