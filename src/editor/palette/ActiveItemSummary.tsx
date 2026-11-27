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
          <div className="w-12 h-12 rounded-[8px] bg-lira-error/15 border border-lira-error/40 flex items-center justify-center">
            <Trash2 className="w-6 h-6 text-lira-error" />
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
            className="w-12 h-12 rounded-[8px] border-2 border-dashed border-lira-rule flex items-center justify-center"
            style={{ backgroundColor: `${zoneDraft.color}44` }}
          >
            <Sparkles className="w-6 h-6 text-lira-ink" />
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
          <div className="p-1 rounded-[8px] bg-lira-ground border border-lira-quiet">
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
          <div className="p-1 rounded-[8px] bg-lira-ground border border-lira-quiet">
            <PixelArtThumbnail type="wall" id={selectedWall} size={40} />
          </div>
        ),
      }
    }
    if (currentFurniture) {
      const shell = currentFurniture.houseShell
      const isHouse = Boolean(shell)
      const subtitle = isHouse
        ? `Base ${currentFurniture.width}×${currentFurniture.height} · Interior ${shell.defaultInteriorWidth ?? 14}×${shell.defaultInteriorHeight ?? 11}`
        : `${currentFurniture.width}x${currentFurniture.height} tiles • Clique para posicionar`
      return {
        title: currentFurniture.name,
        subtitle,
        badge: isHouse ? 'Casa Selecionada' : 'Objeto Selecionado',
        thumbnail: (
          <div className="p-1 rounded-[8px] bg-lira-ground border border-lira-quiet flex items-center justify-center">
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
        <div className="w-12 h-12 rounded-[8px] bg-lira-surface border border-lira-quiet flex items-center justify-center">
          <Armchair className="w-5 h-5 text-lira-muted" />
        </div>
      ),
    }
  }

  const activeItem = getSummary()

  return (
    <div className="p-2 sm:p-3 bg-lira-sidebar border-b border-dashed border-lira-rule/60 flex items-center gap-2 sm:gap-3 font-mono">
      <div className="shrink-0 scale-90 sm:scale-100 origin-left">
        {activeItem.thumbnail}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[9px] sm:text-[10px] uppercase font-mono font-bold tracking-wider px-1.5 py-0.5 rounded-[4px] bg-lira-surface text-lira-accent border border-lira-rule">
            {activeItem.badge}
          </span>
        </div>
        <div className="text-[11px] sm:text-xs font-mono font-bold text-lira-ink truncate mt-0.5">{activeItem.title}</div>
        <div className="text-[9px] sm:text-[10px] font-mono text-lira-muted truncate">{activeItem.subtitle}</div>
      </div>
      {activeTool !== 'select' && (
        <button
          type="button"
          onClick={() => {
            setSelectedFurnitureDefId('')
            setActiveTool('select')
          }}
          className="p-1 sm:p-1.5 rounded-[6px] text-lira-muted hover:text-lira-ink hover:bg-lira-surface transition-colors shrink-0"
          title="Deselecionar item (Escape)"
        >
          <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
      )}
    </div>
  )
}
