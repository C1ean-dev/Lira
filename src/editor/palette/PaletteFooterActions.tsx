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
    <div className="p-2 sm:p-3 border-t border-[#2a3142] bg-[#12151d]/80 flex gap-1.5 sm:gap-2">
      <button
        onClick={handleToggleEraser}
        className={`flex-1 py-1.5 sm:py-2 px-2 sm:px-3 rounded-xl text-[11px] sm:text-xs font-medium flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${
          activeTool === 'eraser'
            ? 'bg-rose-600 text-white shadow-md ring-2 ring-rose-500/30'
            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
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
        className="py-1.5 sm:py-2 px-2 sm:px-3 rounded-xl text-[11px] sm:text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center gap-1.5 transition-all shrink-0"
        title="Limpar e reiniciar mapa em branco"
      >
        <RotateCcw className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400" />
        <span>Limpar Espaço</span>
      </button>
    </div>
  )
}
