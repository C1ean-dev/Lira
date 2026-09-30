import React, { useState, useMemo, useRef } from 'react'
import {
  Layers,
  Plus,
  X,
  Armchair,
  LayoutGrid,
  Square,
  Sparkles,
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
import { ConfirmModal } from '../components/common/ConfirmModal'
import { AvatarPixelArtModal } from './avatar/AvatarPixelArtModal'
import { AvatarSpritesheetSlicerModal } from '../components/avatar-customizer/AvatarSpritesheetSlicerModal'
import { AtlasImportModal } from '../components/avatar-customizer/AtlasImportModal'
import { exportCategoryAtlas } from '../engine/avatar/avatarAtlasExporter'

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

  // Modals state for Pixel Art Studio, Slicer and Atlas Importer
  const [pixelArtModal, setPixelArtModal] = useState<{
    isOpen: boolean
    category: 'furniture' | 'floor' | 'wall'
    name: string
    initialDataUrl?: string
    initialDirectionalFrames?: Partial<Record<Direction, string | string[]>>
    initialWidth?: number
    initialHeight?: number
    initialPixelWidth?: number
    initialPixelHeight?: number
    initialIsObstacle?: boolean
    initialSubCategory?: string
    editingId?: string
  }>({
    isOpen: false,
    category: 'furniture',
    name: '',
  })

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
    }))
  const floors = [...customFloors, ...baseFloors]

  const baseWalls: { id: WallType | string; name: string; isCustom?: boolean }[] = [
    { id: 'drywall_white', name: 'Parede Padrão (Drywall)' },
  ]
  const customWalls = customAssets
    .filter((a) => a.type === 'wall')
    .map((a) => ({ id: a.id, name: `✨ ${a.name}`, isCustom: true }))
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
      isCustom: true,
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
    useMapStore.getState().setMapData(emptyMap)
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

  const openStudioForCreate = (cat: 'furniture' | 'floor' | 'wall') => {
    setPixelArtModal({
      isOpen: true,
      category: cat,
      name: cat === 'furniture' ? 'Nova Mobília' : cat === 'floor' ? 'Novo Piso' : 'Nova Parede',
      initialWidth: 1,
      initialHeight: 1,
      initialPixelWidth: 32,
      initialPixelHeight: 32,
      initialIsObstacle: cat === 'furniture' || cat === 'wall',
      initialSubCategory:
        cat === 'furniture' && effectiveCategory !== 'Todos' && effectiveCategory !== 'Customizados'
          ? effectiveCategory
          : 'Geral',
    })
  }

  const openStudioForEdit = (id: string, cat: 'furniture' | 'floor' | 'wall') => {
    const asset = customAssets.find((a) => a.id === id)
    if (!asset) return
    const masterFrame =
      (typeof asset.directionalFrames?.down === 'string'
        ? asset.directionalFrames.down
        : asset.directionalFrames?.down?.[0]) ||
      asset.frames?.[0] ||
      asset.thumbnail ||
      ''
    setPixelArtModal({
      isOpen: true,
      category: cat,
      name: asset.name,
      initialDataUrl: masterFrame,
      initialDirectionalFrames: asset.directionalFrames,
      initialWidth: asset.width || 1,
      initialHeight: asset.height || 1,
      initialPixelWidth: asset.pixelWidth || (asset.width ? asset.width * 32 : undefined),
      initialPixelHeight: asset.pixelHeight || (asset.height ? asset.height * 32 : undefined),
      initialIsObstacle: asset.isObstacle !== undefined ? asset.isObstacle : true,
      initialSubCategory: asset.category || 'Geral',
      editingId: asset.id,
    })
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

  const handleExportAtlas = async (cat: 'furniture' | 'floor' | 'wall') => {
    await exportCategoryAtlas(cat, customAssets)
  }

  const handleSaveFromStudio = (
    directionalFrames: Record<Direction, string | string[]>,
    name: string,
    options?: {
      width?: number
      height?: number
      pixelWidth?: number
      pixelHeight?: number
      isObstacle?: boolean
      category?: string
    }
  ) => {
    const editingId = pixelArtModal.editingId
    const cat = pixelArtModal.category
    const id = editingId || `custom_${cat}_${Date.now()}`

    const rawDown = directionalFrames.down
    const previewUrl = Array.isArray(rawDown) ? rawDown[0] : (rawDown || '')
    const frames = Array.isArray(rawDown)
      ? rawDown.filter(Boolean)
      : (rawDown ? [rawDown] : [])

    const width = options?.width || 1
    const height = options?.height || 1
    const pixelWidth = options?.pixelWidth
    const pixelHeight = options?.pixelHeight
    const isObstacle =
      options?.isObstacle !== undefined
        ? options.isObstacle
        : (cat === 'furniture' || cat === 'wall')
    const subCategory = options?.category || (cat === 'furniture' ? effectiveCategory : cat)

    const asset: CustomAsset = {
      id,
      name,
      type: cat,
      category: subCategory,
      width,
      height,
      pixelWidth,
      pixelHeight,
      isObstacle,
      directionalFrames,
      thumbnail: previewUrl || undefined,
      frames: frames.length > 0 ? frames : (previewUrl ? [previewUrl] : []),
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    if (editingId) {
      updateCustomAsset(editingId, asset)
    } else {
      addCustomAsset(asset)
    }
    syncAllAssetsToDisk()

    if (cat === 'furniture') {
      setSelectedFurnitureDefId(id)
      setActiveTool('place_furniture')
    } else if (cat === 'floor') {
      setSelectedFloor(id as any)
      setActiveTool('paint_floor')
    } else if (cat === 'wall') {
      setZoneDraft({ ...zoneDraft, wallType: id, hasWalls: true })
    }
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
      {/* Hidden file input for Spritesheet Slicer image selection */}
      <input
        ref={directSlicerInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleSlicerFileSelected}
      />

      <div className="absolute top-16 right-4 w-[380px] max-w-[calc(100vw-2rem)] bg-[#1b202c]/95 backdrop-blur-md border border-[#2a3142] rounded-2xl shadow-2xl z-40 overflow-hidden flex flex-col max-h-[calc(100vh-100px)] animate-in fade-in slide-in-from-right-4 duration-200 select-none">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a3142] bg-[#12151d]/70">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            <span className="font-bold text-sm text-slate-100">Editor de Espaço</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() =>
                openStudioForCreate(
                  activeTab === 'furniture' ? 'furniture' : activeTab === 'floors' ? 'floor' : 'wall'
                )
              }
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-xs shadow-md transition-all border border-white/10 cursor-pointer"
              title="Criar novo elemento no Estúdio Pixel Art"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Criar Elemento</span>
            </button>
            <button
              onClick={() => setEditorOpen(false)}
              className="p-1 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ACTIVE SELECTED OBJECT CARD */}
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

        {/* Tabs */}
        <div className="grid grid-cols-3 p-1.5 gap-1 bg-[#12151d]/40 border-b border-[#2a3142]">
          <button
            onClick={() => {
              setActiveTab('furniture')
              if (activeTool === 'eraser') {
                setEraserTarget('furniture')
              } else {
                setActiveTool('place_furniture')
              }
            }}
            className={`flex flex-col items-center py-2 px-1 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'furniture'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
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
            className={`flex flex-col items-center py-2 px-1 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'floors'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
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
            className={`flex flex-col items-center py-2 px-1 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'zones'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Square className="w-4 h-4 mb-1" />
            Zonas & Paredes
          </button>
        </div>

        {/* Content Area */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
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

        {/* Footer Tools: Borracha e Limpar Espaço */}
        <PaletteFooterActions
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          onResetWorkspace={handleResetWorkspace}
        />
      </div>

      {/* Confirm Reset Space Modal */}
      <ConfirmModal
        isOpen={isResetConfirmOpen}
        title="Limpar Espaço de Trabalho"
        message="Tem certeza que deseja limpar todo o mapa e começar um espaço em branco? Esta ação apagará todas as mobílias e divisórias atuais."
        confirmText="Limpar Tudo"
        confirmVariant="danger"
        onConfirm={handleConfirmReset}
        onCancel={() => setIsResetConfirmOpen(false)}
      />

      {/* Pixel Art Studio Modal (Furniture, Floors, Walls) */}
      {pixelArtModal.isOpen && (
        <AvatarPixelArtModal
          isOpen={pixelArtModal.isOpen}
          onClose={() => setPixelArtModal((prev) => ({ ...prev, isOpen: false }))}
          category={pixelArtModal.category}
          presetName={pixelArtModal.name}
          initialDataUrl={pixelArtModal.initialDataUrl}
          initialDirectionalFrames={pixelArtModal.initialDirectionalFrames}
          initialWidth={pixelArtModal.initialWidth}
          initialHeight={pixelArtModal.initialHeight}
          initialPixelWidth={pixelArtModal.initialPixelWidth}
          initialPixelHeight={pixelArtModal.initialPixelHeight}
          initialIsObstacle={pixelArtModal.initialIsObstacle}
          initialSubCategory={pixelArtModal.initialSubCategory}
          onSave={handleSaveFromStudio}
        />
      )}

      {/* Interactive Spritesheet Slicer Modal */}
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

      {/* Atlas Importer Modal */}
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
    </>
  )
}
