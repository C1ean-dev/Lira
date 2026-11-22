import React from 'react'
import { Presentation, NotebookPen } from 'lucide-react'
import { useMeetingStore } from '../../store/useMeetingStore'
import { useWhiteboardStore } from '../../store/useWhiteboardStore'
import { requestWhiteboard } from '../../services/whiteboardNetwork'
import { useSpaceTranscription } from '../../hooks/useSpaceTranscription'
export const CollaborationButtons: React.FC<{ showLabels?: boolean; onAction?: () => void }> = ({ showLabels, onAction }) => {
  const transcription = useSpaceTranscription()
  return <div className="flex shrink-0 flex-wrap gap-1 font-mono" aria-label="Ferramentas de colaboração">
  <button type="button" onClick={() => { onAction?.(); requestWhiteboard(); useWhiteboardStore.getState().setOpen(true) }} title="Quadro branco colaborativo" aria-label="Abrir quadro branco" className="flex items-center gap-2 text-xs rounded-[8px] border border-lira-quiet bg-lira-surface p-2 text-lira-accent transition-colors hover:border-lira-accent hover:text-lira-ink"><Presentation size={16} />{showLabels && <span>Quadro branco</span>}</button>
  <button type="button" onClick={() => { onAction?.(); useMeetingStore.getState().setOpen(true) }} title="Transcrições e resumo" aria-label="Abrir transcrições e resumo" className="relative flex items-center gap-2 text-xs rounded-[8px] border border-lira-quiet bg-lira-surface p-2 text-lira-accent transition-colors hover:border-lira-accent hover:text-lira-ink"><NotebookPen size={16} />{showLabels && <span>Transcrições e resumo</span>}{transcription?.status === 'recording' && <span aria-label="Transcrição ativa" className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-lira-online" />}</button>
</div>
}
