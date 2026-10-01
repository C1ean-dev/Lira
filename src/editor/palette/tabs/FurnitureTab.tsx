import React, { useState } from 'react'
import { Plus, Trash2, Pencil, Scissors, FolderInput, Download, Sparkles } from 'lucide-react'
import { PixelArtThumbnail } from '../../PixelArtThumbnail'
import { ConfirmModal } from '../../../components/ConfirmModal'

interface FurnitureTabItem {
  id: string
  name: string
  category?: string
  width: number
  height: number
  isObstacle?: boolean
  isCustom?: boolean
  [key: string]: any
}

interface Props {
  categories: string[]
  furnitureCategory: string
  setFurnitureCategory: (cat: string) => void
  addCategory: (cat: string) => void
  allFurniture: FurnitureTabItem[]
  filteredFurniture: FurnitureTabItem[]
  selectedFurnitureDefId: string
  setSelectedFurnitureDefId: (id: string) => void
  activeTool: string
  setActiveTool: (tool: any) => void
  deleteCustomAsset: (id: string) => void
  openEditModal?: (id: string, mode?: 'crop' | 'compose') => void
  onDeleteFurniture?: (id: string) => void
  onOpenStudioCreate?: () => void
  onOpenStudioEdit?: (id: string) => void
  onOpenSlicer?: (id?: string) => void
  onOpenAtlasImport?: () => void
  onExportAtlas?: () => void
}

export const FurnitureTab: React.FC<Props> = ({
  categories,
  furnitureCategory,
  setFurnitureCategory,
  addCategory,
  allFurniture,
  filteredFurniture,
  selectedFurnitureDefId,
  setSelectedFurnitureDefId,
  activeTool,
  setActiveTool,
  deleteCustomAsset,
  openEditModal,
  onDeleteFurniture,
  onOpenStudioCreate,
  onOpenStudioEdit,
  onOpenSlicer,
  onOpenAtlasImport,
  onExportAtlas,
}) => {
  const [isAddingCategory, setIsAddingCategory] = useState(false)
  const [newCategoryText, setNewCategoryText] = useState('')
  const [assetToDelete, setAssetToDelete] = useState<{ id: string; name: string } | null>(null)

  const handleSaveCategory = () => {
    const trimmed = newCategoryText.trim()
    if (trimmed) {
      addCategory(trimmed)
      setFurnitureCategory(trimmed)
      setNewCategoryText('')
      setIsAddingCategory(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Creator Suite Actions Bar */}
      <div className="grid grid-cols-4 gap-1 p-1 bg-slate-900/80 border border-slate-800 rounded-xl">
        <button
          type="button"
          onClick={onOpenStudioCreate}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white text-[10px] font-bold border border-indigo-500/30 transition-all shadow-xs"
          title="Desenhar mobília no Estúdio Pixel Art"
        >
          <Pencil className="w-3 h-3 text-indigo-400" />
          <span>Estúdio</span>
        </button>
        <button
          type="button"
          onClick={() => onOpenSlicer?.()}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg bg-amber-600/30 hover:bg-amber-600 text-amber-200 hover:text-white text-[10px] font-bold border border-amber-500/30 transition-all shadow-xs"
          title="Fatiar spritesheet ou imagem"
        >
          <Scissors className="w-3 h-3 text-amber-400" />
          <span>Fatiar</span>
        </button>
        <button
          type="button"
          onClick={onOpenAtlasImport}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 hover:text-white text-[10px] font-bold border border-emerald-500/30 transition-all shadow-xs"
          title="Importar pacote / Atlas ZIP de mobílias"
        >
          <FolderInput className="w-3 h-3 text-emerald-400" />
          <span>Importar</span>
        </button>
        <button
          type="button"
          onClick={onExportAtlas}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-bold border border-slate-700 transition-all shadow-xs"
          title="Exportar catálogo de mobílias como Atlas ZIP"
        >
          <Download className="w-3 h-3 text-slate-400" />
          <span>Exportar</span>
        </button>
      </div>
      {/* Dynamic Category Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 max-w-full">
        {categories.map((cat) => {
          const isActive = furnitureCategory === cat
          const catCount = allFurniture.filter((f) => f.category === cat).length
          return (
            <div key={cat} className="flex items-center shrink-0">
              <button
                onClick={() => setFurnitureCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition-colors ${
                  isActive
                    ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                    : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>{cat}</span>
                <span className="text-[10px] opacity-60">({catCount})</span>
              </button>
            </div>
          )
        })}

        {/* Add Category Button / Input */}
        {isAddingCategory ? (
          <div className="flex items-center gap-1 shrink-0 bg-slate-900 border border-blue-500/60 rounded-lg p-0.5">
            <input
              type="text"
              value={newCategoryText}
              onChange={(e) => setNewCategoryText(e.target.value)}
              placeholder="Nome..."
              autoFocus
              className="px-2 py-0.5 bg-transparent text-xs text-white focus:outline-none w-24"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveCategory()
                else if (e.key === 'Escape') setIsAddingCategory(false)
              }}
            />
            <button
              onClick={handleSaveCategory}
              className="px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-[10px] font-bold"
            >
              OK
            </button>
            <button
              onClick={() => setIsAddingCategory(false)}
              className="px-1 text-slate-400 hover:text-white text-xs"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsAddingCategory(true)}
            className="px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 flex items-center gap-1 transition-colors shrink-0"
            title="Criar nova categoria personalizada"
          >
            <Plus className="w-3 h-3" />
            <span>Nova Categoria</span>
          </button>
        )}
      </div>

      {/* Item Grid - Compact Square Tiles */}
      {filteredFurniture.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 max-h-80 overflow-y-auto p-0.5">
          {filteredFurniture.map((item) => {
            const isSelected = selectedFurnitureDefId === item.id && activeTool === 'place_furniture'
            return (
              <div
                key={item.id}
                onClick={() => {
                  if (isSelected) {
                    setSelectedFurnitureDefId('')
                    setActiveTool('select')
                  } else {
                    setSelectedFurnitureDefId(item.id)
                    setActiveTool('place_furniture')
                  }
                }}
                className={`group relative aspect-square rounded-xl border flex flex-col items-center justify-between p-1.5 transition-all select-none cursor-pointer ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-500/20 shadow-md shadow-indigo-500/20 ring-2 ring-indigo-500/40'
                    : 'border-[#2a3142] bg-[#12151d]/60 hover:border-slate-500 hover:bg-[#181d28]'
                }`}
                title={`${item.name} (${item.width}×${item.height} tiles • ${item.isObstacle ? 'Obstáculo' : 'Livre'})`}
              >
                {/* Top Indicators & Actions */}
                <div className="w-full flex items-center justify-between z-10 pointer-events-none">
                  <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-black/60 text-slate-300 backdrop-blur-xs leading-none">
                    {item.width}×{item.height}
                  </span>

                  <div className="flex items-center gap-0.5 pointer-events-auto">
                    {item.isCustom && onOpenStudioEdit && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenStudioEdit(item.id)
                        }}
                        className="p-1 rounded-md bg-indigo-500/30 hover:bg-indigo-500/60 text-indigo-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        title={`Editar pixels no Estúdio: "${item.name}"`}
                      >
                        <Pencil className="w-2.5 h-2.5" />
                      </button>
                    )}

                    {item.isCustom && onOpenSlicer && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenSlicer(item.id)
                        }}
                        className="p-1 rounded-md bg-amber-500/30 hover:bg-amber-500/60 text-amber-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        title={`Fatiar / reajustar sprites: "${item.name}"`}
                      >
                        <Scissors className="w-2.5 h-2.5" />
                      </button>
                    )}

                    {item.isCustom && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setAssetToDelete({ id: item.id, name: item.name })
                        }}
                        className="p-1 rounded-md bg-rose-500/30 hover:bg-rose-500/60 text-rose-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        title={`Excluir mobília "${item.name}"`}
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    )}

                    {item.isObstacle ? (
                      <span
                        className="text-[10px] leading-none opacity-80 group-hover:hidden"
                        title="Obstáculo com colisão"
                      >
                        🛡️
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Center Sprite Thumbnail */}
                <div className="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden py-0.5">
                  <PixelArtThumbnail type="furniture" id={item.id} size={48} />
                </div>

                {/* Bottom Label */}
                <div className="w-full text-center px-0.5">
                  <div className="text-[11px] font-semibold text-slate-200 truncate leading-tight">
                    {item.name}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-xs text-slate-500 text-center py-6 bg-[#12151d]/40 rounded-xl border border-[#2a3142]">
          Nenhum item nesta categoria. Crie um novo no botão acima!
        </div>
      )}

      {/* Confirm Delete Furniture Modal */}
      <ConfirmModal
        isOpen={!!assetToDelete}
        title="Excluir Mobília"
        message={`Deseja realmente excluir a mobília "${assetToDelete?.name}"? Esta ação removerá a mobília do catálogo e do mapa.`}
        confirmText="Excluir Mobília"
        confirmVariant="danger"
        onConfirm={() => {
          if (assetToDelete) {
            deleteCustomAsset(assetToDelete.id)
            if (onDeleteFurniture) {
              onDeleteFurniture(assetToDelete.id)
            }
            if (selectedFurnitureDefId === assetToDelete.id) {
              setSelectedFurnitureDefId('')
            }
            setAssetToDelete(null)
          }
        }}
        onCancel={() => setAssetToDelete(null)}
      />
    </div>
  )
}
