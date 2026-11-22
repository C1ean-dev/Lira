import React, { lazy, Suspense } from 'react'
import { NotebookPen } from 'lucide-react'
import { useMeetingStore } from '../../store/useMeetingStore'
const Panel = lazy(() => import('./MeetingSummaryPanel').then(module => ({ default: module.MeetingSummaryPanel })))
// The menu can open archived meetings without loading the space or P2P code.
export const MeetingHistoryAccess: React.FC = () => {
  const isOpen = useMeetingStore(state => state.isOpen)
  return <>
    <button type="button" aria-label="Abrir transcrições e resumo" title="Transcrições e resumos salvos neste dispositivo" onClick={() => useMeetingStore.getState().setOpen(true)} className="rounded-[8px] border border-lira-rule bg-lira-surface p-2 text-lira-accent transition-colors hover:border-lira-accent hover:text-lira-ink"><NotebookPen size={18} /></button>
    {isOpen && <Suspense fallback={null}><Panel /></Suspense>}
  </>
}
