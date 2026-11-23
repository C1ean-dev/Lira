import React, { useState } from 'react'
import { Trash2, Pencil, ShieldCheck, Scissors, FolderInput, Download } from 'lucide-react'
import { PixelArtThumbnail } from '../../PixelArtThumbnail'
import { FloorType } from '../../../types/map'
import { ConfirmModal } from '../../../components/ConfirmModal'

interface Props {
  floors: { id: string; name: string; isCustom?: boolean; width?: number; height?: number; updatedAt?: number }[]
  selectedFloor: FloorType
  setSelectedFloor: (floor: FloorType) => void
  activeTool: string
  setActiveTool: (tool: any) => void
  deleteCustomAsset: (id: string) => void
  openEditModal?: (id: string, mode?: 'crop' | 'compose') => void
  onDeleteFloor?: (id: string) => void
  onOpenStudioCreate?: () => void
  onOpenStudioEdit?: (id: string) => void
  onOpenSlicer?: (id?: string) => void
  onOpenAtlasImport?: () => void
  onExportAtlas?: () => void
}

export const FloorsTab: React.FC<Props> = ({
  floors,
  selectedFloor,
  setSelectedFloor,
  activeTool,
  setActiveTool,
  deleteCustomAsset,
  openEditModal,
  onDeleteFloor,
  onOpenStudioCreate,
  onOpenStudioEdit,
  onOpenSlicer,
  onOpenAtlasImport,
  onExportAtlas,
}) => {
  const [assetToDelete, setAssetToDelete] = useState<{ id: string; name: string } | null>(null)

  return (
    <div className="space-y-3 font-mono text-lira-ink">
      <div className="grid grid-cols-4 gap-1 p-1 bg-lira-ground border border-lira-quiet rounded-[8px]">
        <button
          type="button"
          onClick={onOpenStudioCreate}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-[6px] bg-lira-surface hover:bg-lira-accent text-lira-accent hover:text-lira-ground text-[10px] font-mono font-bold border border-lira-rule transition-colors"
          title="Desenhar piso no estúdio de elementos"
        >
          <Pencil className="w-3 h-3" />
          <span>Criar elemento</span>
        </button>
        <button
          type="button"
          onClick={() => onOpenSlicer?.()}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-[6px] bg-lira-surface hover:border-lira-amber text-lira-amber text-[10px] font-mono font-bold border border-lira-rule transition-colors"
          title="Fatiar spritesheet ou imagem para criar piso"
        >
          <Scissors className="w-3 h-3 text-lira-amber" />
          <span>Fatiar</span>
        </button>
        <button
          type="button"
          onClick={onOpenAtlasImport}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-[6px] bg-lira-surface hover:border-lira-online text-lira-online text-[10px] font-mono font-bold border border-lira-rule transition-colors"
          title="Importar pacote / Atlas ZIP de pisos"
        >
          <FolderInput className="w-3 h-3 text-lira-online" />
          <span>Importar</span>
        </button>
        <button
          type="button"
          onClick={onExportAtlas}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-[6px] bg-lira-surface hover:border-lira-accent text-lira-muted hover:text-lira-ink text-[10px] font-mono font-bold border border-lira-rule transition-colors"
          title="Selecionar e exportar pisos como Atlas (.png e .xml)"
        >
          <Download className="w-3 h-3 text-lira-muted" />
          <span>Exportar</span>
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 max-h-80 overflow-y-auto p-0.5">
        {floors.map((floor) => {
          const isSelected = selectedFloor === floor.id && activeTool === 'paint_floor'
          const isDefaultFloor = floor.id === 'wood_parquet' || floor.id === 'habbo_parquet' || !floor.isCustom
          return (
            <div
              key={floor.id}
              onClick={() => {
                if (isSelected) {
                  setActiveTool('select')
                } else {
                  setSelectedFloor(floor.id as any)
                  setActiveTool('paint_floor')
                }
              }}
              className={`group relative aspect-square rounded-[8px] border flex flex-col items-center justify-between p-1.5 transition-colors select-none cursor-pointer ${
                isSelected
                  ? 'border-lira-accent bg-lira-surface ring-1 ring-lira-accent'
                  : 'border-lira-quiet bg-lira-ground hover:border-lira-rule hover:bg-lira-surface'
              }`}
              title={floor.name}
            >
              <div className="w-full flex items-center justify-between z-10 pointer-events-none">
                <div>
                  {((floor.width && floor.width > 1) || (floor.height && floor.height > 1)) && (
                    <div
                      className="px-1 py-0.5 rounded text-[8px] font-mono font-bold bg-lira-surface text-lira-accent border border-lira-rule"
                      title={`Dimensão: ${floor.width || 1}×${floor.height || 1} tiles`}
                    >
                      {floor.width || 1}×{floor.height || 1}
                    </div>
                  )}
                </div>
                {isDefaultFloor ? (
                  <div
                    className="px-1 py-0.5 rounded text-[8px] font-mono font-bold bg-lira-online/15 text-lira-online border border-lira-online/40 flex items-center gap-0.5"
                    title="Piso padrão protegido"
                  >
                    <ShieldCheck className="w-2.5 h-2.5 text-lira-online" />
                    <span>Padrão</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-0.5 pointer-events-auto">
                    {onOpenStudioEdit && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenStudioEdit(floor.id)
                        }}
                        className="p-1 rounded-[4px] bg-lira-surface hover:bg-lira-accent text-lira-accent hover:text-lira-ground border border-lira-rule opacity-0 group-hover:opacity-100 transition-opacity"
                        title={`Editar no estúdio: "${floor.name}"`}
                      >
                        <Pencil className="w-2.5 h-2.5" />
                      </button>
                    )}

                    {onOpenSlicer && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenSlicer(floor.id)
                        }}
                        className="p-1 rounded-[4px] bg-lira-surface hover:bg-lira-amber text-lira-amber hover:text-lira-ground border border-lira-rule opacity-0 group-hover:opacity-100 transition-opacity"
                        title={`Fatiar / reajustar sprites: "${floor.name}"`}
                      >
                        <Scissors className="w-2.5 h-2.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setAssetToDelete({ id: floor.id, name: floor.name })
                      }}
                      className="p-1 rounded-[4px] bg-lira-error/20 hover:bg-lira-error text-lira-error hover:text-lira-ground border border-lira-error/40 opacity-0 group-hover:opacity-100 transition-opacity"
                      title={`Excluir piso "${floor.name}"`}
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden py-0.5">
                <PixelArtThumbnail
                  key={`${floor.id}_${floor.updatedAt || ''}`}
                  type="floor"
                  id={floor.id}
                  size={48}
                />
              </div>

              <div className="w-full text-center px-0.5">
                <div className="text-[11px] font-mono font-semibold text-lira-ink truncate leading-tight">
                  {floor.name.replace(/^✨\s*/, '')}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <ConfirmModal
        isOpen={!!assetToDelete}
        title="Excluir Piso"
        message={`Deseja realmente excluir o piso "${assetToDelete?.name}"? Áreas com este piso serão restauradas para o Piso Padrão.`}
        confirmText="Excluir Piso"
        confirmVariant="danger"
        onConfirm={() => {
          if (assetToDelete) {
            deleteCustomAsset(assetToDelete.id)
            if (onDeleteFloor) {
              onDeleteFloor(assetToDelete.id)
            }
            if (selectedFloor === assetToDelete.id) {
              setSelectedFloor('wood_parquet')
            }
            setAssetToDelete(null)
          }
        }}
        onCancel={() => setAssetToDelete(null)}
      />
    </div>
  )
}
