import React from 'react'
import { Sparkles, Armchair, Trash2, X } from 'lucide-react'
import { PixelArtThumbnail } from '../PixelArtThumbnail'
import { FloorType, WallType } from '../../types/map'
import { FurnitureDef } from '../../engine/PixelArtRenderer'

import { useMapStore } from '../../store/useMapStore'

interface Props {
  activeTool: string
  zoneDraft: { name: string; color: string }
  currentFloor?: { id: string; name: string }
  currentWall?: { id: string; name: string }
  currentFurniture?: { id: string; name: string; width: number; height: number; [key: string]: any }
  selectedFloor: FloorType
  selectedWall: WallType
  selectedFurnitureDefId: string
}

export const ActiveItemSummary: React.FC<Props> = ({
  activeTool,
  zoneDraft,
  currentFloor,
  currentWall,
  currentFurniture,
  selectedFloor,
  selectedWall,
  selectedFurnitureDefId,
}) => {
  const eraserTarget = useMapStore((s) => s.eraserTarget)
  const setSelectedFurnitureDefId = useMapStore((s) => s.setSelectedFurnitureDefId)
  const setActiveTool = useMapStore((s) => s.setActiveTool)

  const getSummary = () => {
    if (activeTool === 'eraser') {
      const info = {
        furniture: {
          title: 'Borracha: Mobília',
          subtitle: 'Clique ou arraste sobre móveis para removê-los',
          badge: 'Apagar Mobília',
        },
        floor: {
          title: 'Borracha: Piso',
          subtitle: 'Clique ou arraste no chão para restaurar o piso padrão',
          badge: 'Apagar Piso',
        },
        zone: {
          title: 'Borracha: Zonas',
          subtitle: 'Clique sobre uma zona privada para removê-la',
          badge: 'Apagar Zonas',
        },
        wall: {
          title: 'Borracha: Paredes',
          subtitle: 'Clique ou arraste sobre paredes para removê-las',
          badge: 'Apagar Paredes',
        },
      }[eraserTarget || 'furniture'] || {
        title: 'Borracha Ativa',
        subtitle: 'Clique para apagar elementos',
        badge: 'Borracha',
      }

      return {
        title: info.title,
        subtitle: info.subtitle,
        badge: info.badge,
        thumbnail: (
          <div className="w-12 h-12 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center">
            <Trash2 className="w-6 h-6 text-rose-400" />
          </div>
        ),
      }
    }
    if (activeTool === 'draw_zone') {
      return {
        title: zoneDraft.name || 'Zona Privada',
        subtitle: 'Clique e arraste no mapa para demarcar a área',
        badge: 'Demarcar Zona',
        thumbnail: (
          <div
            className="w-12 h-12 rounded-xl border-2 border-dashed border-white/60 flex items-center justify-center shadow-inner"
            style={{ backgroundColor: `${zoneDraft.color}44` }}
          >
            <Sparkles className="w-6 h-6 text-white" />
          </div>
        ),
      }
    }
    if (activeTool === 'paint_floor') {
      return {
        title: currentFloor?.name || 'Piso',
        subtitle: 'Clique no chão para pintar o piso',
        badge: 'Pintar Piso',
        thumbnail: (
          <div className="p-1 rounded-xl bg-[#1b202c] border border-white/15 shadow-md">
            <PixelArtThumbnail type="floor" id={selectedFloor} size={40} />
          </div>
        ),
      }
    }
    if (activeTool === 'paint_wall') {
      return {
        title: currentWall?.name || 'Parede',
        subtitle: 'Clique no mapa para levantar paredes com colisão',
        badge: 'Pintar Parede',
        thumbnail: (
          <div className="p-1 rounded-xl bg-[#1b202c] border border-white/15 shadow-md">
            <PixelArtThumbnail type="wall" id={selectedWall} size={40} />
          </div>
        ),
      }
    }
    // Place Furniture
    if (currentFurniture) {
      return {
        title: currentFurniture.name,
        subtitle: `${currentFurniture.width}x${currentFurniture.height} tiles • Clique para posicionar`,
        badge: 'Objeto Selecionado',
        thumbnail: (
          <div className="p-1 rounded-xl bg-[#1b202c] border border-white/15 shadow-md flex items-center justify-center">
            <PixelArtThumbnail type="furniture" id={selectedFurnitureDefId} size={40} />
          </div>
        ),
      }
    }

    return {
      title: 'Nenhuma mobília selecionada',
      subtitle: 'Crie ou selecione um elemento abaixo para posicionar',
      badge: 'Modo Mobília',
      thumbnail: (
        <div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center">
          <Armchair className="w-5 h-5 text-slate-400" />
        </div>
      ),
    }
  }

  const activeItem = getSummary()

  return (
    <div className="p-3 bg-[#12151d]/90 border-b border-[#2a3142] flex items-center gap-3">
      {activeItem.thumbnail}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
            {activeItem.badge}
          </span>
        </div>
        <div className="text-xs font-bold text-slate-100 truncate mt-0.5">{activeItem.title}</div>
        <div className="text-[10px] text-slate-400 truncate">{activeItem.subtitle}</div>
      </div>
      {activeTool !== 'select' && (
        <button
          type="button"
          onClick={() => {
            setSelectedFurnitureDefId('')
            setActiveTool('select')
          }}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors shrink-0"
          title="Deselecionar item (Escape)"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
