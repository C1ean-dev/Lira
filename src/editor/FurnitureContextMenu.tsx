import React, { useState, useEffect, useCallback } from 'react'
import { Move, Trash2, Palette, X, Check, Pencil, RotateCw, Lightbulb } from 'lucide-react'
import { useMapStore } from '../store/useMapStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { FURNITURE_CATALOG } from '../engine/Constants'
import { PeerManager } from '../p2p/PeerManager'
import { Direction } from '../types/game'
import { DEFAULT_FURNITURE_LIGHT, type FurnitureLightConfig } from '../types/customAsset'
import { FurnitureLightControls } from './custom-element/FurnitureLightControls'

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
  const [showLightPanel, setShowLightPanel] = useState<boolean>(false)

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
        setShowLightPanel(false)
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
    PeerManager.getInstance().sendMapEdit('remove_furniture', { id: selectedFurn.id, x: selectedFurn.x, y: selectedFurn.y })
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

  const effectiveLight: FurnitureLightConfig =
    selectedFurn.light ?? customAsset?.light ?? { ...DEFAULT_FURNITURE_LIGHT }

  const handleChangeLight = (nextLight?: FurnitureLightConfig) => {
    updateFurniture(selectedFurn.id, { light: nextLight })
    PeerManager.getInstance().sendMapEdit('add_furniture', {
      furniture: { ...selectedFurn, light: nextLight },
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
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 font-mono text-lira-ink">
      {showLightPanel && (
        <div className="bg-lira-panel p-3 rounded-[12px] border border-dashed border-lira-rule flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-mono font-bold text-lira-amber pb-1 border-b border-dashed border-lira-rule/60">
            <span>Iluminação 2D da Mobília</span>
            <button
              type="button"
              onClick={() => setShowLightPanel(false)}
              className="text-lira-muted hover:text-lira-ink p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <FurnitureLightControls
            compact
            light={effectiveLight}
            onChange={(next) => handleChangeLight(next)}
            onResetToDefault={selectedFurn.light !== undefined ? () => handleChangeLight(undefined) : undefined}
          />
        </div>
      )}

      {showColorPalette && (
        <div className="bg-lira-panel p-3 rounded-[12px] border border-dashed border-lira-rule flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-mono font-bold text-lira-accent pb-1 border-b border-dashed border-lira-rule/60">
            <span>Escolher Cor da Mobília</span>
            <button
              type="button"
              onClick={() => setShowColorPalette(false)}
              className="text-lira-muted hover:text-lira-ink p-0.5"
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
                  className={`w-7 h-7 rounded-[6px] border flex items-center justify-center ${
                    isSelected
                      ? 'border-lira-accent ring-2 ring-lira-accent/50'
                      : 'border-lira-rule hover:border-lira-ink'
                  }`}
                  style={{
                    backgroundColor: item.color || '#1e162b',
                    backgroundImage: item.color
                      ? undefined
                      : 'repeating-conic-gradient(#1e162b 0% 25%, #100c18 0% 50%) 50% / 8px 8px',
                  }}
                  title={item.name}
                >
                  {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="bg-lira-panel px-4 py-2.5 rounded-[12px] border border-dashed border-lira-rule flex items-center gap-3">
        <div className="flex items-center gap-2 pr-3 border-r border-dashed border-lira-rule/60">
          <div
            className="w-3.5 h-3.5 rounded-[4px] border border-lira-rule shrink-0"
            style={{
              backgroundColor: selectedFurn.tintColor || furnDef?.iconColor || '#d1b5ff',
            }}
          />
          <span className="text-xs font-mono font-bold text-lira-ink max-w-[140px] truncate">{furnName}</span>
        </div>

        <button
          type="button"
          onClick={handleStartMove}
          className={`px-3 py-1.5 rounded-[8px] text-xs font-mono font-bold flex items-center gap-1.5 transition-colors ${
            isMovingFurniture
              ? 'bg-lira-amber text-lira-ground'
              : 'bg-lira-accent hover:bg-lira-ink text-lira-ground'
          }`}
          title="Arraste a mobília diretamente pelo mapa para movê-la"
        >
          <Move className="w-3.5 h-3.5" />
          <span>{isMovingFurniture ? 'Arraste no mapa' : 'Mover'}</span>
        </button>

        <button
          type="button"
          onClick={handleRotate}
          className="px-3 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-accent text-lira-ink border border-lira-rule text-xs font-mono font-bold flex items-center gap-1.5 transition-colors"
          title="Girar mobília (tecla R) — Alterna entre as 4 direções"
        >
          <RotateCw className="w-3.5 h-3.5 text-lira-amber" />
          <span>Girar <span className="text-lira-amber font-mono text-[11px]">({dirBadge.icon} {dirBadge.label})</span></span>
        </button>

        <button
          type="button"
          onClick={() => {
            setShowColorPalette(!showColorPalette)
            setShowLightPanel(false)
          }}
          className={`px-3 py-1.5 rounded-[8px] text-xs font-mono font-bold flex items-center gap-1.5 transition-colors border ${
            showColorPalette
              ? 'bg-lira-online text-lira-ground border-lira-online'
              : 'bg-lira-surface hover:border-lira-accent text-lira-ink border-lira-rule'
          }`}
          title="Trocar cor ou aplicar tom na mobília"
        >
          <Palette className="w-3.5 h-3.5 text-lira-online" />
          <span>Trocar de Cor</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setShowLightPanel(!showLightPanel)
            setShowColorPalette(false)
          }}
          className={`px-3 py-1.5 rounded-[8px] text-xs font-mono font-bold flex items-center gap-1.5 transition-colors border ${
            showLightPanel || effectiveLight.enabled
              ? 'bg-lira-amber text-lira-ground border-lira-amber'
              : 'bg-lira-surface hover:border-lira-amber text-lira-ink border-lira-rule'
          }`}
          title="Adicionar ou editar luz 2D emitida por esta mobília"
        >
          <Lightbulb className="w-3.5 h-3.5" />
          <span>Luz</span>
        </button>

        {customAsset && (
          <button
            type="button"
            onClick={() => {
              useCustomAssetsStore.getState().openEditModal(selectedFurn.defId, 'compose')
            }}
            className="px-3 py-1.5 rounded-[8px] bg-lira-surface hover:bg-lira-accent text-lira-accent hover:text-lira-ground border border-lira-rule text-xs font-mono font-bold flex items-center gap-1.5 transition-colors"
            title="Editar esta mobília no Estúdio de Criação"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Editar</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleDelete}
          className="px-3 py-1.5 rounded-[8px] bg-lira-error/15 hover:bg-lira-error text-lira-error hover:text-lira-ground border border-lira-error/40 text-xs font-mono font-bold flex items-center gap-1.5 transition-colors"
          title="Apagar esta mobília do mapa"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Apagar</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSelectedPlacedFurnitureId(null)
            setIsMovingFurniture(false)
            setShowColorPalette(false)
            setShowLightPanel(false)
          }}
          className="p-1.5 text-lira-muted hover:text-lira-ink rounded-[6px] hover:bg-lira-surface transition-colors ml-1"
          title="Fechar seleção"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
