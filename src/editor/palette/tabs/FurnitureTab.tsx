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
    <div className="space-y-3 font-mono text-lira-ink">
      <div className="grid grid-cols-4 gap-1 p-1 bg-lira-ground border border-lira-quiet rounded-[8px]">
        <button
          type="button"
          onClick={onOpenStudioCreate}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-[6px] bg-lira-surface hover:bg-lira-accent text-lira-accent hover:text-lira-ground text-[10px] font-mono font-bold border border-lira-rule transition-colors"
          title="Desenhar mobília no estúdio de elementos"
        >
          <Pencil className="w-3 h-3" />
          <span>Criar elemento</span>
        </button>
        <button
          type="button"
          onClick={() => onOpenSlicer?.()}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-[6px] bg-lira-surface hover:border-lira-amber text-lira-amber text-[10px] font-mono font-bold border border-lira-rule transition-colors"
          title="Fatiar spritesheet ou imagem"
        >
          <Scissors className="w-3 h-3 text-lira-amber" />
          <span>Fatiar</span>
        </button>
        <button
          type="button"
          onClick={onOpenAtlasImport}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-[6px] bg-lira-surface hover:border-lira-online text-lira-online text-[10px] font-mono font-bold border border-lira-rule transition-colors"
          title="Importar pacote / Atlas ZIP de mobílias"
        >
          <FolderInput className="w-3 h-3 text-lira-online" />
          <span>Importar</span>
        </button>
        <button
          type="button"
          onClick={onExportAtlas}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-[6px] bg-lira-surface hover:border-lira-accent text-lira-muted hover:text-lira-ink text-[10px] font-mono font-bold border border-lira-rule transition-colors"
          title="Exportar catálogo de mobílias como Atlas ZIP"
        >
          <Download className="w-3 h-3 text-lira-muted" />
          <span>Exportar</span>
        </button>
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 max-w-full">
        {categories.map((cat) => {
          const isActive = furnitureCategory === cat
          const catCount = allFurniture.filter((f) => f.category === cat).length
          return (
            <div key={cat} className="flex items-center shrink-0">
              <button
                onClick={() => setFurnitureCategory(cat)}
                className={`px-2.5 py-1 rounded-[6px] text-xs font-mono font-semibold whitespace-nowrap flex items-center gap-1.5 transition-colors border ${
                  isActive
                    ? 'bg-lira-surface text-lira-accent border-lira-accent'
                    : 'bg-lira-ground text-lira-muted border-lira-quiet hover:text-lira-ink'
                }`}
              >
                <span>{cat}</span>
                <span className="text-[10px] opacity-60">({catCount})</span>
              </button>
            </div>
          )
        })}

        {isAddingCategory ? (
          <div className="flex items-center gap-1 shrink-0 bg-lira-ground border border-lira-accent rounded-[6px] p-0.5">
            <input
              type="text"
              value={newCategoryText}
              onChange={(e) => setNewCategoryText(e.target.value)}
              placeholder="Nome..."
              autoFocus
              className="px-2 py-0.5 bg-transparent text-xs font-mono text-lira-ink focus:outline-none w-24"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveCategory()
                else if (e.key === 'Escape') setIsAddingCategory(false)
              }}
            />
            <button
              onClick={handleSaveCategory}
              className="px-1.5 py-0.5 bg-lira-accent hover:bg-lira-ink text-lira-ground rounded text-[10px] font-mono font-bold"
            >
              OK
            </button>
            <button
              onClick={() => setIsAddingCategory(false)}
              className="px-1 text-lira-muted hover:text-lira-ink text-xs"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsAddingCategory(true)}
            className="px-2 py-1 rounded-[6px] text-xs font-mono font-semibold whitespace-nowrap bg-lira-surface hover:border-lira-accent text-lira-accent border border-lira-rule flex items-center gap-1 transition-colors shrink-0"
            title="Criar nova categoria personalizada"
          >
            <Plus className="w-3 h-3" />
            <span>Nova Categoria</span>
          </button>
        )}
      </div>

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
                className={`group relative aspect-square rounded-[8px] border flex flex-col items-center justify-between p-1.5 transition-colors select-none cursor-pointer ${
                  isSelected
                    ? 'border-lira-accent bg-lira-surface ring-1 ring-lira-accent'
                    : 'border-lira-quiet bg-lira-ground hover:border-lira-rule hover:bg-lira-surface'
                }`}
                title={`${item.name} (${item.width}×${item.height} tiles • ${item.isObstacle ? 'Obstáculo' : 'Livre'})`}
              >
                <div className="w-full flex items-center justify-between z-10 pointer-events-none">
                  <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-lira-panel text-lira-muted border border-lira-quiet leading-none">
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
                        className="p-1 rounded-[4px] bg-lira-surface hover:bg-lira-accent text-lira-accent hover:text-lira-ground border border-lira-rule opacity-0 group-hover:opacity-100 transition-opacity"
                        title={`Editar no estúdio: "${item.name}"`}
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
                        className="p-1 rounded-[4px] bg-lira-surface hover:bg-lira-amber text-lira-amber hover:text-lira-ground border border-lira-rule opacity-0 group-hover:opacity-100 transition-opacity"
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
                        className="p-1 rounded-[4px] bg-lira-error/20 hover:bg-lira-error text-lira-error hover:text-lira-ground border border-lira-error/40 opacity-0 group-hover:opacity-100 transition-opacity"
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

                <div className="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden py-0.5">
                  <PixelArtThumbnail
                    key={`${item.id}_${(item as any).updatedAt || ''}`}
                    type="furniture"
                    id={item.id}
                    size={48}
                  />
                </div>

                <div className="w-full text-center px-0.5">
                  <div className="text-[11px] font-mono font-semibold text-lira-ink truncate leading-tight">
                    {item.name}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-xs font-mono text-lira-muted text-center py-6 bg-lira-ground rounded-[8px] border border-dashed border-lira-rule/60">
          Nenhum item nesta categoria. Crie um novo no botão acima!
        </div>
      )}

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
