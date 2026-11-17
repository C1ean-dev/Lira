import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CaptureUpdateAction, Excalidraw, MainMenu } from '@excalidraw/excalidraw'
import type { BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawProps } from '@excalidraw/excalidraw/types'
import { useWhiteboardStore } from '../../store/useWhiteboardStore'
import { useGameStore } from '../../store/useGameStore'
import { PeerManager } from '../../p2p/PeerManager'
import { sendWhiteboardOperation } from '../../services/whiteboardNetwork'
import { sendBoardPointer } from '../../services/boardPointerNetwork'
import { getChangedElements, getWhiteboardElements, getWhiteboardFiles } from '../../collaboration/boardScene'
import { restoreSceneElements } from '../../collaboration/boardRestore'
import { parseBoardFile } from '../../collaboration/boardFile'
import { validWhiteboardOperation } from '../../collaboration/whiteboard'
import type { BoardElement, BoardFile } from '../../collaboration/boardEditor'
import { generateUUID } from '../../utils/uuid'
import { BoardPointerOverlay } from './BoardPointerOverlay'
import '@excalidraw/excalidraw/index.css'
import './whiteboard.css'

export default function ExcalidrawBoard() {
  const { document, hydrated, synchronized, storageError, dark, setDark } = useWhiteboardStore()
  const connected = useGameStore(s => s.isConnected)
  const ready = hydrated && (!connected || synchronized)
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [error, setError] = useState(''), [confirmClear, setConfirmClear] = useState(false)
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const openFile = useRef<HTMLInputElement>(null), applyingRemote = useRef(false), laserActive = useRef(false)
  const storedElements = useMemo(() => getWhiteboardElements(document), [document])
  const elements = useMemo(() => restoreSceneElements(storedElements), [storedElements])
  const files = useMemo(() => getWhiteboardFiles(document) as BinaryFiles, [document])
  const initialData = useRef({ elements, files, appState: { theme: dark ? 'dark' as const : 'light' as const } })
  const base = () => {
    const game = useGameStore.getState()
    const actor = game.isConnected ? PeerManager.getInstance().getPeerId() || game.localPlayer.id : game.localPlayer.id
    return { id: `${actor}:${generateUUID()}`, actor, clock: useWhiteboardStore.getState().document.clock + 1 }
  }
  const failed = () => setError('Não foi possível salvar a alteração. Exporte o quadro para preservar o desenho; verifique o limite de objetos e o tamanho das imagens.')
  const publish = (next: readonly BoardElement[], nextFiles: BinaryFiles) => {
    if (!ready || applyingRemote.current) return
    const known = getWhiteboardFiles(useWhiteboardStore.getState().document)
    const used = new Set(next.flatMap(element => 'fileId' in element && element.fileId ? [element.fileId] : []))
    for (const id of used) {
      const file = nextFiles[id]
      if (!file || !validWhiteboardOperation({ ...base(), kind: 'file', file })) { failed(); return }
      if (!known[id] && !sendWhiteboardOperation({ ...base(), kind: 'file', file: file as BoardFile })) { failed(); return }
    }
    for (const element of getChangedElements(useWhiteboardStore.getState().document, next)) {
      if (!sendWhiteboardOperation({ ...base(), kind: 'element', element })) { failed(); return }
    }
  }
  useEffect(() => {
    if (!api) return
    const current = api.getSceneElementsIncludingDeleted()
    // Restoration drops zero-size shapes while the SDK is still drawing them.
    // Compare saved revisions first so a local change is not echoed into the gesture.
    const same = current.length === storedElements.length && current.every((element, i) => {
      const other = storedElements[i]
      return element.id === other.id && element.version === other.version && element.versionNonce === other.versionNonce && element.isDeleted === other.isDeleted
    })
    const missing = Object.values(files).filter(file => !api.getFiles()[file.id])
    if (missing.length) api.addFiles(missing)
    if (same) return
    applyingRemote.current = true
    try { api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER }) }
    finally { applyingRemote.current = false }
  }, [api, storedElements, elements, files])
  useEffect(() => () => { if (laserActive.current) sendBoardPointer(null) }, [])
  const onChange: ExcalidrawProps['onChange'] = (next, appState, nextFiles) => {
    if (appState.theme !== (dark ? 'dark' : 'light')) setDark(appState.theme === 'dark')
    publish(next, nextFiles)
  }
  const pointer: ExcalidrawProps['onPointerUpdate'] = ({ pointer, button }) => {
    if (pointer.tool === 'laser' && button === 'down') { laserActive.current = true; sendBoardPointer({ x: pointer.x, y: pointer.y }) }
    else if (laserActive.current) { laserActive.current = false; sendBoardPointer(null) }
  }
  const clear = () => {
    if (ready && sendWhiteboardOperation({ ...base(), kind: 'clear' })) {
      applyingRemote.current = true
      try { api?.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.IMMEDIATELY }) }
      finally { applyingRemote.current = false }
      setConfirmClear(false)
    }
    else failed()
  }
  const importFile = async (file: File | undefined) => {
    if (!file || !api || !ready) return
    try {
      const scene = parseBoardFile(await file.text())
      if (!sendWhiteboardOperation({ ...base(), kind: 'clear' })) { failed(); return }
      const restored = restoreSceneElements(scene.elements)
      api.addFiles(Object.values(scene.files) as BinaryFiles[string][])
      publish(restored, scene.files)
      api.updateScene({ elements: restored, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    } catch { setError('Não foi possível abrir o arquivo do quadro.') }
    if (openFile.current) openFile.current.value = ''
  }
  return <div className={`lira-board${dark ? ' lira-board-dark' : ''}`}>
    {(error || storageError) && <p role="alert" className="board-storage-warning">{error || 'Não foi possível salvar neste dispositivo. Exporte o quadro antes de fechar.'}</p>}
    {!ready && <p role="status" className="board-sync-status">Carregando e sincronizando o quadro…</p>}
    <Excalidraw initialData={initialData.current} excalidrawAPI={setApi} onChange={onChange}
      langCode="pt-BR" theme={dark ? 'dark' : 'light'} viewModeEnabled={!ready} isCollaborating={connected}
      handleKeyboardGlobally={false} validateEmbeddable={false} aiEnabled={false} onPointerUpdate={pointer}
      onScrollChange={(x, y, zoom) => setView({ x: x * zoom.value, y: y * zoom.value, zoom: zoom.value })}
      UIOptions={{ canvasActions: { clearCanvas: false, loadScene: false } }}
      renderTopRightUI={() => <div className="board-lira-actions">
        <button type="button" disabled={!ready} onClick={() => openFile.current?.click()}>Abrir quadro</button>
        <button type="button" disabled={!ready} onClick={() => setConfirmClear(true)}>Limpar quadro</button>
      </div>} >
      <MainMenu>
        <MainMenu.DefaultItems.SaveToActiveFile />
        <MainMenu.DefaultItems.Export />
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.DefaultItems.SearchMenu />
        <MainMenu.DefaultItems.Help />
        <MainMenu.DefaultItems.ToggleTheme />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
    </Excalidraw>
    <svg className="board-remote-pointers" aria-hidden="true"><g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}><BoardPointerOverlay zoom={view.zoom} /></g></svg>
    <input hidden ref={openFile} type="file" accept=".json,.excalidraw" onChange={event => void importFile(event.target.files?.[0])} />
    {confirmClear && <div className="board-confirm-backdrop"><div className="board-confirm" role="alertdialog" aria-label="Limpar quadro compartilhado">
      <p>Limpar o quadro para todos os participantes?</p>
      <button type="button" onClick={clear}>Confirmar limpeza</button>
      <button type="button" onClick={() => setConfirmClear(false)}>Cancelar</button>
    </div></div>}
  </div>
}
