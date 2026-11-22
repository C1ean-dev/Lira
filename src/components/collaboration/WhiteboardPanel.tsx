import React, { lazy, Suspense, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useWhiteboardStore } from '../../store/useWhiteboardStore'
import { prepareBoardAssets } from '../../collaboration/boardAssets'
import { useGameStore } from '../../store/useGameStore'

const ExcalidrawBoard = lazy(() => { prepareBoardAssets(); return import('./ExcalidrawBoard') })

class EditorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <p role="alert" className="p-8 text-center">Não foi possível carregar o editor. Feche e abra o quadro para tentar novamente.</p> : this.props.children
  }
}

export const WhiteboardPanel: React.FC = () => {
  const { isOpen, setOpen, synchronized, roomId, dark } = useWhiteboardStore()
  const connected = useGameStore(s => s.isConnected)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isOpen) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [isOpen])
  if (!isOpen) return null
  return <div className="fixed inset-0 z-[900] flex items-center justify-center bg-lira-ground/80 font-mono" onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <div ref={dialog} role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="whiteboard-title"
    className={`h-[96dvh] w-[98vw] overflow-hidden rounded-[12px] border p-0 ${dark ? 'border-[#45404f] bg-[#25232e] text-[#ebe7f3]' : 'border-slate-200 bg-white text-slate-800'}`}>
    <div className="flex h-full min-h-0 flex-col">
      <header className={`flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 ${dark ? 'border-[#45404f]' : 'border-slate-100'}`}>
        <h2 id="whiteboard-title" className="font-display text-sm font-bold">Quadro branco</h2>
        <div className="flex items-center gap-3"><span role="status" className={`text-xs font-mono ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{!connected ? 'Offline · salvo nesta sala' : synchronized ? 'Compartilhado com o espaço' : 'Sincronizando…'}</span><button type="button" onClick={() => setOpen(false)} aria-label="Fechar quadro branco" className={`rounded-[8px] p-2 ${dark ? 'hover:bg-[#514477]' : 'hover:bg-slate-100'}`}><X size={18} /></button></div>
      </header>
      <div className="relative min-h-0 flex-1">
        <EditorBoundary><Suspense fallback={<p role="status" className="p-8 text-center text-sm text-slate-500">Carregando editor…</p>}>
          <ExcalidrawBoard key={roomId} />
        </Suspense></EditorBoundary>
      </div>
    </div>
    </div>
  </div>
}
