import { EditorHistoryControls } from './EditorHistoryControls'
import React, { useState, useMemo, useRef } from 'react'
import {
  Layers,
  Plus,
  X,
  Armchair,
  LayoutGrid,
  Square,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useMapStore } from '../store/useMapStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { WallType, FloorType } from '../types/map'
import { Direction } from '../types/game'
import { CustomAsset } from '../types/customAsset'
import { FURNITURE_CATALOG } from '../engine/Constants'
import { createEmptyWorkspace } from './templates'
import { PeerManager } from '../p2p/PeerManager'
import { ActiveItemSummary } from './palette/ActiveItemSummary'
import { FurnitureTab } from './palette/tabs/FurnitureTab'
import { FloorsTab } from './palette/tabs/FloorsTab'
import { ZonesTab } from './palette/tabs/ZonesTab'
import { PaletteFooterActions } from './palette/PaletteFooterActions'
import { ConfirmModal } from '../components/ConfirmModal'
import { AvatarSpritesheetSlicerModal } from '../components/avatar-customizer/AvatarSpritesheetSlicerModal'
import { AtlasImportModal } from '../components/avatar-customizer/AtlasImportModal'
import { AtlasExportModal } from '../components/avatar-customizer/AtlasExportModal'

export const AssetPalette: React.FC = () => {
  const {
    isEditorOpen,
    setEditorOpen,
    activeTool,
    setActiveTool,
    selectedFurnitureDefId,
    setSelectedFurnitureDefId,
    selectedFloor,
    setSelectedFloor,
    selectedWall,
    setSelectedWall,
    mapData,
    zoneDraft,
    setZoneDraft,
    removeZone,
    removeFurnitureByDefId,
    replaceFloorGlobally,
    eraserTarget,
    setEraserTarget,
  } = useMapStore()

  const {
    customAssets,
    customCategories,
    addCategory,
    setCustomModalOpen,
    openCreateModal,
    deleteCustomAsset,
    addCustomAsset,
    updateCustomAsset,
    syncAllAssetsToDisk,
    openEditModal,
    getAllCategories,
  } = useCustomAssetsStore()

  const categories = getAllCategories()
  const [activeTab, setActiveTab] = useState<'furniture' | 'floors' | 'zones'>('furniture')
  const [furnitureCategory, setFurnitureCategory] = useState<string>(() => categories[0] || 'Geral')
  const [isCollapsed, setIsCollapsed] = useState(false)

  const directSlicerInputRef = useRef<HTMLInputElement | null>(null)
  const [slicerCategory, setSlicerCategory] = useState<'furniture' | 'floor' | 'wall'>('furniture')
  const [slicerImageSrc, setSlicerImageSrc] = useState<string | null>(null)
  const [slicerImageName, setSlicerImageName] = useState<string>('')
  const [editingSlicerAsset, setEditingSlicerAsset] = useState<CustomAsset | null>(null)
  const [isDirectSlicerOpen, setIsDirectSlicerOpen] = useState(false)

  const [atlasImportModal, setAtlasImportModal] = useState<{
    isOpen: boolean
    category: 'furniture' | 'floor' | 'wall'
  }>({
    isOpen: false,
    category: 'furniture',
  })

  const [atlasExportModal, setAtlasExportModal] = useState<{
    isOpen: boolean
    category: 'furniture' | 'floor' | 'wall'
  }>({
    isOpen: false,
    category: 'furniture',
  })

  const baseFloors: { id: FloorType | string; name: string; isCustom?: boolean }[] = [
    { id: 'wood_parquet', name: 'Piso Padrão (Madeira)' },
  ]
  const customFloors = customAssets
    .filter((a) => a.type === 'floor')
    .map((a) => ({
      id: a.id,
      name: `✨ ${a.name}`,
      isCustom: true,
      width: a.width || 1,
      height: a.height || 1,
      updatedAt: a.updatedAt,
    }))
  const floors = [...customFloors, ...baseFloors]

  const baseWalls: { id: WallType | string; name: string; isCustom?: boolean; updatedAt?: number }[] = [
    { id: 'drywall_white', name: 'Parede Padrão (Drywall)' },
  ]
  const customWalls = customAssets
    .filter((a) => a.type === 'wall')
    .map((a) => ({ id: a.id, name: `✨ ${a.name}`, isCustom: true, updatedAt: a.updatedAt }))
  const walls = [...customWalls, ...baseWalls]

  const customFurnitureDefs = customAssets
    .filter((a) => a.type === 'furniture')
    .map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category || 'Geral',
      width: a.width,
      height: a.height,
      isObstacle: a.isObstacle,
      spriteKey: a.id,
      iconColor: a.iconColor || '#e03131',
      light: a.light,
      isCustom: true,
      updatedAt: a.updatedAt,
    }))
  const allFurniture = [...customFurnitureDefs, ...FURNITURE_CATALOG]

  const effectiveCategory = categories.includes(furnitureCategory) ? furnitureCategory : (categories[0] || 'Geral')

  const filteredFurniture = useMemo(() => {
    if (effectiveCategory === 'Todos') return allFurniture
    if (effectiveCategory === 'Customizados') return allFurniture.filter((f) => (f as any).isCustom)
    return allFurniture.filter((f) => f.category === effectiveCategory)
  }, [allFurniture, effectiveCategory])

  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)

  if (!isEditorOpen) return null

  const handleDeleteZone = (id: string) => {
    removeZone(id)
    PeerManager.getInstance().broadcast({
      type: 'MAP_EDIT',
      senderId: 'local',
      payload: { action: 'remove_zone', data: { id } },
      timestamp: Date.now(),
    })
  }

  const handleConfirmReset = () => {
    setIsResetConfirmOpen(false)
    const emptyMap = createEmptyWorkspace()
    useMapStore.getState().setMapData(emptyMap, true)
    PeerManager.getInstance().broadcast({
      type: 'MAP_SYNC',
      senderId: 'host',
      payload: { mapData: emptyMap },
      timestamp: Date.now(),
    })
  }

  const handleResetWorkspace = () => {
    setIsResetConfirmOpen(true)
  }

  const openStudioForCreate = (type: 'furniture' | 'floor' | 'wall') => {
    const category = effectiveCategory !== 'Todos' && effectiveCategory !== 'Customizados' ? effectiveCategory : 'Geral'
    openCreateModal('draw', category, type)
  }

  const openStudioForEdit = (id: string, _type: 'furniture' | 'floor' | 'wall') => {
    openEditModal(id, 'draw')
  }

  const handleOpenSlicer = (cat: 'furniture' | 'floor' | 'wall', assetId?: string) => {
    setSlicerCategory(cat)
    if (assetId) {
      const asset = customAssets.find((a) => a.id === assetId)
      if (asset) {
        const preview =
          asset.sourceImageSrc ||
          (typeof asset.directionalFrames?.down === 'string'
            ? asset.directionalFrames.down
            : asset.directionalFrames?.down?.[0]) ||
          asset.frames?.[0] ||
          asset.thumbnail ||
          ''
        setEditingSlicerAsset(asset)
        setSlicerImageSrc(preview)
        setSlicerImageName(asset.sourceFileName || asset.name || `${cat}.png`)
        setIsDirectSlicerOpen(true)
        return
      }
    }
    setEditingSlicerAsset(null)
    directSlicerInputRef.current?.click()
  }

  const handleSlicerFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const result = evt.target?.result as string
      if (result) {
        setSlicerImageSrc(result)
        setSlicerImageName(file.name)
        setIsDirectSlicerOpen(true)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleOpenAtlasImport = (cat: 'furniture' | 'floor' | 'wall') => {
    setAtlasImportModal({
      isOpen: true,
      category: cat,
    })
  }

  const handleExportAtlas = (cat: 'furniture' | 'floor' | 'wall') => {
    setAtlasExportModal({
      isOpen: true,
      category: cat,
    })
  }

  const handleSlicerSaveComplete = (createdAssets: CustomAsset[]) => {
    syncAllAssetsToDisk()
    if (createdAssets && createdAssets.length > 0) {
      const last = createdAssets[createdAssets.length - 1]
      if (slicerCategory === 'furniture') {
        setSelectedFurnitureDefId(last.id)
        setActiveTool('place_furniture')
      } else if (slicerCategory === 'floor') {
        setSelectedFloor(last.id as any)
        setActiveTool('paint_floor')
      } else if (slicerCategory === 'wall') {
        setZoneDraft({ ...zoneDraft, wallType: last.id, hasWalls: true })
      }
    }
  }

  const currentFloor = floors.find((f) => f.id === selectedFloor)
  const currentWall = walls.find((w) => w.id === selectedWall)
  const currentFurniture = allFurniture.find((f) => f.id === selectedFurnitureDefId)

  return (
    <>
      <input
        ref={directSlicerInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleSlicerFileSelected}
      />

      <div
        className={`absolute top-3 sm:top-4 right-2 left-2 sm:left-auto sm:right-4 w-auto sm:w-[380px] max-w-sm sm:max-w-md bg-lira-panel border border-dashed border-lira-rule rounded-[12px] z-40 overflow-hidden flex flex-col font-mono text-lira-ink ${
          isCollapsed ? 'max-h-none' : 'max-h-[52vh] sm:max-h-[calc(100vh-32px)]'
        } select-none`}
      >
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-b border-dashed border-lira-rule/60 bg-lira-sidebar">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Layers className="w-4 h-4 sm:w-5 sm:h-5 text-lira-accent" />
            <span className="font-display font-bold text-xs sm:text-sm text-lira-accent">Editor de Espaço</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5">
            <EditorHistoryControls />
            <button
              onClick={() =>
                openStudioForCreate(
                  activeTab === 'furniture' ? 'furniture' : activeTab === 'floors' ? 'floor' : 'wall'
                )
              }
              className="flex items-center gap-1 px-2 py-1 rounded-[6px] bg-lira-accent hover:bg-lira-ink text-lira-ground font-mono font-bold text-[11px] sm:text-xs transition-colors border border-lira-accent cursor-pointer"
              title="Criar novo elemento no Estúdio Pixel Art"
            >
              <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span>Criar</span>
            </button>
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1 rounded-[6px] hover:bg-lira-surface text-lira-muted hover:text-lira-ink transition-colors"
              title={isCollapsed ? 'Expandir painel de ferramentas' : 'Recolher painel para visualizar o mapa'}
            >
              {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setEditorOpen(false)}
              className="p-1 rounded-[6px] hover:bg-lira-surface text-lira-muted hover:text-lira-ink transition-colors"
              title="Fechar editor"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <ActiveItemSummary
          activeTool={activeTool}
          zoneDraft={zoneDraft}
          currentFloor={currentFloor}
          currentWall={currentWall}
          currentFurniture={currentFurniture}
          selectedFloor={selectedFloor}
          selectedWall={selectedWall}
          selectedFurnitureDefId={selectedFurnitureDefId}
        />

        {!isCollapsed && (
          <>
            <div className="grid grid-cols-3 p-1.5 gap-1 bg-lira-sidebar border-b border-dashed border-lira-rule/60">
          <button
            onClick={() => {
              setActiveTab('furniture')
              if (activeTool === 'eraser') {
                setEraserTarget('furniture')
              } else {
                setActiveTool('place_furniture')
              }
            }}
            className={`flex flex-col items-center py-2 px-1 rounded-[8px] text-xs font-mono font-bold transition-colors border ${
              activeTab === 'furniture'
                ? 'bg-lira-accent text-lira-ground border-lira-accent'
                : 'text-lira-muted border-transparent hover:text-lira-ink hover:bg-lira-surface'
            }`}
          >
            <Armchair className="w-4 h-4 mb-1" />
            Mobília
          </button>

          <button
            onClick={() => {
              setActiveTab('floors')
              if (activeTool === 'eraser') {
                setEraserTarget('floor')
              } else {
                setActiveTool('paint_floor')
              }
            }}
            className={`flex flex-col items-center py-2 px-1 rounded-[8px] text-xs font-mono font-bold transition-colors border ${
              activeTab === 'floors'
                ? 'bg-lira-accent text-lira-ground border-lira-accent'
                : 'text-lira-muted border-transparent hover:text-lira-ink hover:bg-lira-surface'
            }`}
          >
            <LayoutGrid className="w-4 h-4 mb-1" />
            Pisos
          </button>

          <button
            onClick={() => {
              setActiveTab('zones')
              if (activeTool === 'eraser') {
                setEraserTarget('zone')
              } else {
                setActiveTool('draw_zone')
              }
            }}
            className={`flex flex-col items-center py-2 px-1 rounded-[8px] text-xs font-mono font-bold transition-colors border ${
              activeTab === 'zones'
                ? 'bg-lira-accent text-lira-ground border-lira-accent'
                : 'text-lira-muted border-transparent hover:text-lira-ink hover:bg-lira-surface'
            }`}
          >
            <Square className="w-4 h-4 mb-1" />
            Zonas & Paredes
          </button>
        </div>

        <div className="p-2 sm:p-4 overflow-y-auto flex-1 space-y-3 sm:space-y-4">
          {activeTab === 'furniture' && (
            <FurnitureTab
              categories={categories}
              furnitureCategory={effectiveCategory}
              setFurnitureCategory={setFurnitureCategory}
              addCategory={addCategory}
              allFurniture={allFurniture}
              filteredFurniture={filteredFurniture}
              selectedFurnitureDefId={selectedFurnitureDefId}
              setSelectedFurnitureDefId={setSelectedFurnitureDefId}
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              deleteCustomAsset={deleteCustomAsset}
              openEditModal={openEditModal}
              onDeleteFurniture={(defId) => {
                removeFurnitureByDefId(defId)
              }}
              onOpenStudioCreate={() => openStudioForCreate('furniture')}
              onOpenStudioEdit={(id) => openStudioForEdit(id, 'furniture')}
              onOpenSlicer={(id) => handleOpenSlicer('furniture', id)}
              onOpenAtlasImport={() => handleOpenAtlasImport('furniture')}
              onExportAtlas={() => handleExportAtlas('furniture')}
            />
          )}

          {activeTab === 'floors' && (
            <FloorsTab
              floors={floors}
              selectedFloor={selectedFloor}
              setSelectedFloor={setSelectedFloor}
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              deleteCustomAsset={deleteCustomAsset}
              openEditModal={openEditModal}
              onDeleteFloor={(floorId) => {
                replaceFloorGlobally(floorId, 'wood_parquet')
              }}
              onOpenStudioCreate={() => openStudioForCreate('floor')}
              onOpenStudioEdit={(id) => openStudioForEdit(id, 'floor')}
              onOpenSlicer={(id) => handleOpenSlicer('floor', id)}
              onOpenAtlasImport={() => handleOpenAtlasImport('floor')}
              onExportAtlas={() => handleExportAtlas('floor')}
            />
          )}

          {activeTab === 'zones' && (
            <ZonesTab
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              zoneDraft={zoneDraft}
              setZoneDraft={setZoneDraft}
              walls={walls}
              mapData={mapData}
              handleDeleteZone={handleDeleteZone}
              openEditModal={openEditModal}
              deleteCustomAsset={deleteCustomAsset}
              onOpenStudioCreate={() => openStudioForCreate('wall')}
              onOpenStudioEdit={(id) => openStudioForEdit(id, 'wall')}
              onOpenSlicer={(id) => handleOpenSlicer('wall', id)}
              onOpenAtlasImport={() => handleOpenAtlasImport('wall')}
              onExportAtlas={() => handleExportAtlas('wall')}
            />
          )}
        </div>

        <PaletteFooterActions
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          onResetWorkspace={handleResetWorkspace}
        />
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={isResetConfirmOpen}
        title="Limpar Espaço de Trabalho"
        message="Tem certeza que deseja limpar todo o mapa e começar um espaço em branco? Esta ação apagará todas as mobílias e divisórias atuais."
        confirmText="Limpar Tudo"
        confirmVariant="danger"
        onConfirm={handleConfirmReset}
        onCancel={() => setIsResetConfirmOpen(false)}
      />

      {isDirectSlicerOpen && slicerImageSrc && (
        <AvatarSpritesheetSlicerModal
          isOpen={isDirectSlicerOpen}
          onClose={() => {
            setIsDirectSlicerOpen(false)
            setEditingSlicerAsset(null)
            if (directSlicerInputRef.current) {
              directSlicerInputRef.current.value = ''
            }
          }}
          editingAsset={editingSlicerAsset}
          imageSrc={slicerImageSrc}
          imageFileName={slicerImageName || `${slicerCategory}.png`}
          category={slicerCategory}
          onSaveComplete={handleSlicerSaveComplete}
        />
      )}

      {atlasImportModal.isOpen && (
        <AtlasImportModal
          isOpen={atlasImportModal.isOpen}
          onClose={() => setAtlasImportModal((prev) => ({ ...prev, isOpen: false }))}
          category={atlasImportModal.category}
          onImportSuccess={() => {
            syncAllAssetsToDisk()
          }}
        />
      )}

      {atlasExportModal.isOpen && (
        <AtlasExportModal
          isOpen={atlasExportModal.isOpen}
          onClose={() => setAtlasExportModal((prev) => ({ ...prev, isOpen: false }))}
          category={atlasExportModal.category}
          customAssets={customAssets}
          initialSubCategory={atlasExportModal.category === 'furniture' ? effectiveCategory : undefined}
        />
      )}
    </>
  )
}
