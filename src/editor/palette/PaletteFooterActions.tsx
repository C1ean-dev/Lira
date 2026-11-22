import React from 'react'
import { Trash2, RotateCcw } from 'lucide-react'
import { useMapStore } from '../../store/useMapStore'

interface Props {
  activeTool: string
  setActiveTool: (tool: any) => void
  onResetWorkspace: () => void
}

export const PaletteFooterActions: React.FC<Props> = ({
  activeTool,
  setActiveTool,
  onResetWorkspace,
}) => {
  const eraserTarget = useMapStore((s) => s.eraserTarget)

  const handleToggleEraser = () => {
    if (activeTool === 'eraser') {
      if (eraserTarget === 'floor') setActiveTool('paint_floor')
      else if (eraserTarget === 'zone') setActiveTool('draw_zone')
      else if (eraserTarget === 'wall') setActiveTool('paint_wall')
      else setActiveTool('place_furniture')
    } else {
      setActiveTool('eraser')
    }
  }

  const getEraserLabel = () => {
    if (activeTool === 'eraser') {
      if (eraserTarget === 'floor') return 'Borracha: Piso'
      if (eraserTarget === 'zone') return 'Borracha: Zonas'
      if (eraserTarget === 'wall') return 'Borracha: Paredes'
      return 'Borracha: Mobília'
    }
    if (eraserTarget === 'floor') return 'Apagar Piso'
    if (eraserTarget === 'zone') return 'Apagar Zonas'
    if (eraserTarget === 'wall') return 'Apagar Paredes'
    return 'Apagar Mobília'
  }

  return (
    <div className="p-2 sm:p-3 border-t border-dashed border-lira-rule/60 bg-lira-sidebar flex gap-1.5 sm:gap-2 font-mono">
      <button
        onClick={handleToggleEraser}
        className={`flex-1 py-1.5 sm:py-2 px-2 sm:px-3 rounded-[8px] text-[11px] sm:text-xs font-mono font-bold flex items-center justify-center gap-1.5 sm:gap-2 transition-colors border ${
          activeTool === 'eraser'
            ? 'bg-lira-error text-lira-ground border-lira-error'
            : 'bg-lira-surface text-lira-muted border-lira-rule hover:text-lira-ink hover:border-lira-accent'
        }`}
        title={`Ativar borracha para apagar ${
          eraserTarget === 'floor'
            ? 'pisos'
            : eraserTarget === 'zone'
            ? 'zonas privadas'
            : eraserTarget === 'wall'
            ? 'paredes'
            : 'mobílias'
        }`}
      >
        <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        <span>{getEraserLabel()}</span>
      </button>

      <button
        onClick={onResetWorkspace}
        className="py-1.5 sm:py-2 px-2 sm:px-3 rounded-[8px] text-[11px] sm:text-xs font-mono font-bold bg-lira-surface hover:border-lira-amber border border-lira-rule text-lira-muted hover:text-lira-ink flex items-center gap-1.5 transition-colors shrink-0"
        title="Limpar e reiniciar mapa em branco"
      >
        <RotateCcw className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-lira-amber" />
        <span>Limpar Espaço</span>
      </button>
    </div>
  )
}
