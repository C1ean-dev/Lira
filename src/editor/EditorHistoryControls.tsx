import React, { useEffect } from 'react'
import { Undo2, Redo2 } from 'lucide-react'
import { useMapStore } from '../store/useMapStore'
import { editorHistoryShortcut } from './historyShortcut'

export const EditorHistoryControls: React.FC = () => {
  const past = useMapStore(s => s.historyPast.length), future = useMapStore(s => s.historyFuture.length)
  const isEditorOpen = useMapStore(s => s.isEditorOpen)
  useEffect(() => {
    if (!isEditorOpen) return
    const keydown = (event: KeyboardEvent) => {
      const action = editorHistoryShortcut({ ...event, key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
        shiftKey: event.shiftKey, altKey: event.altKey, target: event.target as HTMLElement })
      if (action) { event.preventDefault(); useMapStore.getState()[action]() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [isEditorOpen])
  return <div className="flex gap-1 font-mono" aria-label="Histórico do editor">
    <button type="button" onClick={() => useMapStore.getState().undo()} disabled={!past} aria-label="Desfazer" title="Desfazer (Ctrl/Cmd+Z)" className="p-1 rounded-[6px] text-lira-muted hover:text-lira-ink hover:bg-lira-surface disabled:opacity-30"><Undo2 className="w-4 h-4" /></button>
    <button type="button" onClick={() => useMapStore.getState().redo()} disabled={!future} aria-label="Refazer" title="Refazer (Ctrl/Cmd+Shift+Z ou Ctrl+Y)" className="p-1 rounded-[6px] text-lira-muted hover:text-lira-ink hover:bg-lira-surface disabled:opacity-30"><Redo2 className="w-4 h-4" /></button>
  </div>
}
