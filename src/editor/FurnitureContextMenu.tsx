import React, { useState, useEffect, useCallback } from 'react'
import { Move, Trash2, Palette, X, Check, Pencil, RotateCw } from 'lucide-react'
import { useMapStore } from '../store/useMapStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { FURNITURE_CATALOG } from '../engine/Constants'
import { PeerManager } from '../p2p/PeerManager'
import { Direction } from '../types/game'

const TINT_PALETTE = [
  { name: 'Original', color: undefined },
  { name: 'Vermelho', color: '#ef4444' },
  { name: 'Laranja', color: '#f97316' },
  { name: 'Dourado', color: '#eab308' },
  { name: 'Verde', color: '#22c55e' },
  { name: 'Ciano', color: '#06b6d4' },
  { name: 'Azul', color: '#3b82f6' },
  { name: 'Roxo', color: '#8b5cf6' },
  { name: 'Rosa', color: '#ec4899' },
  { name: 'Madeira Escura', color: '#78350f' },
  { name: 'Madeira Clara', color: '#d4a373' },
  { name: 'Grafite', color: '#1e293b' },
  { name: 'Branco', color: '#ffffff' },
]

export const FurnitureContextMenu: React.FC = () => {
  const {
    mapData,
    selectedPlacedFurnitureId,
    setSelectedPlacedFurnitureId,
    isMovingFurniture,
    setIsMovingFurniture,
    updateFurniture,
    removeFurnitureById,
    isEditorOpen,
  } = useMapStore()

  const [showColorPalette, setShowColorPalette] = useState<boolean>(false)

  const selectedFurn = selectedPlacedFurnitureId
    ? mapData.furniture.find((f) => f.id === selectedPlacedFurnitureId)
    : null

  const handleRotate = useCallback(() => {
    if (!selectedFurn) return
    const order: Direction[] = ['down', 'left', 'up', 'right']
    const curDir: Direction = selectedFurn.direction || (
      selectedFurn.rotation === 90 ? 'left' :
      selectedFurn.rotation === 180 ? 'up' :
      selectedFurn.rotation === 270 ? 'right' : 'down'
    )
    const nextIdx = (order.indexOf(curDir) + 1) % 4
    const nextDir = order[nextIdx]
    const rotMap: Record<Direction, 0 | 90 | 180 | 270> = { down: 0, left: 90, up: 180, right: 270 }
    const nextRot = rotMap[nextDir]

    updateFurniture(selectedFurn.id, { direction: nextDir, rotation: nextRot })
    PeerManager.getInstance().sendMapEdit('add_furniture', {
      furniture: { ...selectedFurn, direction: nextDir, rotation: nextRot },
    })
  }, [selectedFurn, updateFurniture])

  // Hotkeys: R to rotate, Escape to deselect, Arrows to move placed furniture
  useEffect(() => {
    if (!isEditorOpen || !selectedFurn) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        handleRotate()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setSelectedPlacedFurnitureId(null)
        setIsMovingFurniture(false)
        setShowColorPalette(false)
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
        const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
        const newX = Math.max(0, Math.min(mapData.width - 1, selectedFurn.x + dx))
        const newY = Math.max(0, Math.min(mapData.height - 1, selectedFurn.y + dy))
        updateFurniture(selectedFurn.id, { x: newX, y: newY })
        PeerManager.getInstance().sendMapEdit('add_furniture', {
          furniture: { ...selectedFurn, x: newX, y: newY },
        })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEditorOpen, selectedFurn, handleRotate, setSelectedPlacedFurnitureId, setIsMovingFurniture, mapData.width, mapData.height, updateFurniture])

  if (!isEditorOpen || !selectedPlacedFurnitureId || !selectedFurn) {
    return null
  }

  const customAsset = useCustomAssetsStore.getState().getAssetById(selectedFurn.defId)
  const furnDef = customAsset || FURNITURE_CATALOG.find((f) => f.id === selectedFurn.defId)
  const furnName = furnDef?.name || 'Mobília Selecionada'

  const handleDelete = () => {
    removeFurnitureById(selectedFurn.id)
    PeerManager.getInstance().sendMapEdit('remove_furniture', { x: selectedFurn.x, y: selectedFurn.y })
    setSelectedPlacedFurnitureId(null)
  }

  const handleStartMove = () => {
    setIsMovingFurniture(!isMovingFurniture)
  }

  const handleSelectColor = (colorHex?: string) => {
    updateFurniture(selectedFurn.id, { tintColor: colorHex })
    PeerManager.getInstance().sendMapEdit('add_furniture', {
      furniture: { ...selectedFurn, tintColor: colorHex },
    })
  }

  const dirBadge = (() => {
    const dir: Direction = selectedFurn.direction || (
      selectedFurn.rotation === 90 ? 'left' :
      selectedFurn.rotation === 180 ? 'up' :
      selectedFurn.rotation === 270 ? 'right' : 'down'
    )
    if (dir === 'left') return { label: 'Esquerda', icon: '⬅️' }
    if (dir === 'up') return { label: 'Costas', icon: '⬆️' }
    if (dir === 'right') return { label: 'Direita', icon: '➡️' }
    return { label: 'Frente', icon: '⬇️' }
  })()

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 animate-in fade-in slide-in-from-bottom-4 duration-200">
      {/* Color Palette Popover */}
      {showColorPalette && (
        <div className="bg-[#18191c]/95 backdrop-blur-md p-3 rounded-2xl border border-[#2b2d31] shadow-2xl flex flex-col gap-2 animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between text-xs font-bold text-slate-300 pb-1 border-b border-[#2b2d31]">
            <span>Escolher Cor da Mobília</span>
            <button
              type="button"
              onClick={() => setShowColorPalette(false)}
              className="text-slate-400 hover:text-white p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap max-w-xs">
            {TINT_PALETTE.map((item) => {
              const isSelected = selectedFurn.tintColor === item.color
              return (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => handleSelectColor(item.color)}
                  className={`w-7 h-7 rounded-xl border flex items-center justify-center transition-all ${
                    isSelected
                      ? 'border-indigo-400 scale-110 shadow-lg ring-2 ring-indigo-500/50'
                      : 'border-white/20 hover:scale-105'
                  }`}
                  style={{
                    backgroundColor: item.color || '#333742',
                    backgroundImage: item.color
                      ? undefined
                      : 'repeating-conic-gradient(#475569 0% 25%, #1e293b 0% 50%) 50% / 8px 8px',
                  }}
                  title={item.name}
                >
                  {isSelected && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Main Action Bar */}
      <div className="bg-[#18191c]/95 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-indigo-500/40 shadow-2xl flex items-center gap-3">
        {/* Furniture Name Indicator */}
        <div className="flex items-center gap-2 pr-3 border-r border-[#2b2d31]">
          <div
            className="w-3.5 h-3.5 rounded-md border border-white/20 shadow-inner shrink-0"
            style={{
              backgroundColor: selectedFurn.tintColor || furnDef?.iconColor || '#6366f1',
            }}
          />
          <span className="text-xs font-bold text-white max-w-[140px] truncate">{furnName}</span>
        </div>

        {/* Move Action */}
        <button
          type="button"
          onClick={handleStartMove}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md active:scale-95 ${
            isMovingFurniture
              ? 'bg-amber-500 text-slate-950 shadow-amber-500/30'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
          }`}
          title="Arraste a mobília diretamente pelo mapa para movê-la"
        >
          <Move className="w-3.5 h-3.5" />
          <span>{isMovingFurniture ? 'Arraste no mapa' : 'Mover'}</span>
        </button>

        {/* Rotate / Direction Action */}
        <button
          type="button"
          onClick={handleRotate}
          className="px-3 py-1.5 rounded-xl bg-[#26282e] hover:bg-[#32353b] text-slate-200 border border-[#3b3e45] text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 shadow-sm"
          title="Girar mobília (tecla R) — Alterna entre as 4 direções"
        >
          <RotateCw className="w-3.5 h-3.5 text-amber-400" />
          <span>Girar <span className="text-amber-300 font-mono text-[11px]">({dirBadge.icon} {dirBadge.label})</span></span>
        </button>

        {/* Color Action */}
        <button
          type="button"
          onClick={() => setShowColorPalette(!showColorPalette)}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 ${
            showColorPalette
              ? 'bg-emerald-600 text-white shadow-emerald-600/30'
              : 'bg-[#26282e] hover:bg-[#32353b] text-slate-200 border border-[#3b3e45]'
          }`}
          title="Trocar cor ou aplicar tom na mobília"
        >
          <Palette className="w-3.5 h-3.5 text-emerald-400" />
          <span>Trocar de Cor</span>
        </button>

        {/* Edit in Studio */}
        {customAsset && (
          <button
            type="button"
            onClick={() => {
              useCustomAssetsStore.getState().openEditModal(selectedFurn.defId, 'compose')
            }}
            className="px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/40 text-xs font-bold flex items-center gap-1.5 transition-all shadow-md active:scale-95"
            title="Editar esta mobília no Estúdio de Criação"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Editar</span>
          </button>
        )}

        {/* Delete Action */}
        <button
          type="button"
          onClick={handleDelete}
          className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-bold flex items-center gap-1.5 transition-all shadow-md active:scale-95"
          title="Apagar esta mobília do mapa"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Apagar</span>
        </button>

        {/* Close / Deselect */}
        <button
          type="button"
          onClick={() => {
            setSelectedPlacedFurnitureId(null)
            setIsMovingFurniture(false)
            setShowColorPalette(false)
          }}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors ml-1"
          title="Fechar seleção"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
