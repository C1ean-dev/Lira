import React, { lazy, Suspense } from 'react'
import { NotebookPen } from 'lucide-react'
import { useMeetingStore } from '../../store/useMeetingStore'
const Panel = lazy(() => import('./MeetingSummaryPanel').then(module => ({ default: module.MeetingSummaryPanel })))
// The menu can open archived meetings without loading the space or P2P code.
export const MeetingHistoryAccess: React.FC = () => {
  const isOpen = useMeetingStore(state => state.isOpen)
  return <>
    <button type="button" aria-label="Abrir resumos de reuniões" title="Resumos de reuniões salvas neste dispositivo" onClick={() => useMeetingStore.getState().setOpen(true)} className="rounded-xl border border-white/20 bg-white/10 p-2 text-white hover:bg-white/20"><NotebookPen size={18} /></button>
    {isOpen && <Suspense fallback={null}><Panel /></Suspense>}
  </>
}
