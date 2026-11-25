import React from 'react'
import { Presentation, NotebookPen } from 'lucide-react'
import { useMeetingStore } from '../../store/useMeetingStore'
import { useWhiteboardStore } from '../../store/useWhiteboardStore'
import { requestWhiteboard } from '../../services/whiteboardNetwork'
import { useSpaceTranscription } from '../../hooks/useSpaceTranscription'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/Tooltip'

export const CollaborationButtons: React.FC<{
  showLabels?: boolean
  orientation?: 'horizontal' | 'vertical'
  onAction?: () => void
}> = ({ showLabels, orientation = 'horizontal', onAction }) => {
  const transcription = useSpaceTranscription()
  const openWhiteboard = () => {
    onAction?.()
    requestWhiteboard()
    useWhiteboardStore.getState().setOpen(true)
  }
  const openMeeting = () => {
    onAction?.()
    useMeetingStore.getState().setOpen(true)
  }

  if (orientation === 'vertical') {
    return (
      <TooltipProvider delayDuration={180} skipDelayDuration={100}>
        <div className="flex shrink-0 flex-col items-center gap-1.5 font-mono" aria-label="Ferramentas de colaboração">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={openWhiteboard}
                aria-label="Abrir quadro branco"
                className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-[10px] border border-lira-quiet bg-lira-surface text-lira-accent transition-colors hover:border-lira-accent hover:text-lira-ink"
              >
                <Presentation className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Quadro branco colaborativo</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={openMeeting}
                aria-label="Abrir transcrições e resumo"
                className="relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-[10px] border border-lira-quiet bg-lira-surface text-lira-accent transition-colors hover:border-lira-accent hover:text-lira-ink"
              >
                <NotebookPen className="w-4 h-4" />
                {transcription?.status === 'recording' && (
                  <span aria-label="Transcrição ativa" className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-lira-online" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Transcrições e resumo</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    )
  }

  return <div className="flex shrink-0 flex-wrap gap-1.5 font-mono" aria-label="Ferramentas de colaboração">
  <button type="button" onClick={openWhiteboard} title="Quadro branco colaborativo" aria-label="Abrir quadro branco" className="flex items-center gap-2 text-xs rounded-[8px] border border-lira-quiet bg-lira-surface p-2 text-lira-accent transition-colors hover:border-lira-accent hover:text-lira-ink"><Presentation size={16} />{showLabels && <span>Quadro branco</span>}</button>
  <button type="button" onClick={openMeeting} title="Transcrições e resumo" aria-label="Abrir transcrições e resumo" className="relative flex items-center gap-2 text-xs rounded-[8px] border border-lira-quiet bg-lira-surface p-2 text-lira-accent transition-colors hover:border-lira-accent hover:text-lira-ink"><NotebookPen size={16} />{showLabels && <span>Transcrições e resumo</span>}{transcription?.status === 'recording' && <span aria-label="Transcrição ativa" className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-lira-online" />}</button>
</div>
}
