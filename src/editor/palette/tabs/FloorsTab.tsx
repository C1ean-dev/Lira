import React, { useState } from 'react'
import { Trash2, Pencil, ShieldCheck, Scissors, FolderInput, Download } from 'lucide-react'
import { PixelArtThumbnail } from '../../PixelArtThumbnail'
import { FloorType } from '../../../types/map'
import { ConfirmModal } from '../../../components/ConfirmModal'

interface Props {
  floors: { id: string; name: string; isCustom?: boolean; width?: number; height?: number }[]
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
    <div className="space-y-3">
      {/* Creator Suite Actions Bar */}
      <div className="grid grid-cols-4 gap-1 p-1 bg-slate-900/80 border border-slate-800 rounded-xl">
        <button
          type="button"
          onClick={onOpenStudioCreate}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white text-[10px] font-bold border border-indigo-500/30 transition-all shadow-xs"
          title="Desenhar piso no Estúdio Pixel Art"
        >
          <Pencil className="w-3 h-3 text-indigo-400" />
          <span>Estúdio</span>
        </button>
        <button
          type="button"
          onClick={() => onOpenSlicer?.()}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg bg-amber-600/30 hover:bg-amber-600 text-amber-200 hover:text-white text-[10px] font-bold border border-amber-500/30 transition-all shadow-xs"
          title="Fatiar spritesheet ou imagem para criar piso"
        >
          <Scissors className="w-3 h-3 text-amber-400" />
          <span>Fatiar</span>
        </button>
        <button
          type="button"
          onClick={onOpenAtlasImport}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 hover:text-white text-[10px] font-bold border border-emerald-500/30 transition-all shadow-xs"
          title="Importar pacote / Atlas ZIP de pisos"
        >
          <FolderInput className="w-3 h-3 text-emerald-400" />
          <span>Importar</span>
        </button>
        <button
          type="button"
          onClick={onExportAtlas}
          className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-bold border border-slate-700 transition-all shadow-xs"
          title="Exportar pisos como Atlas ZIP"
        >
          <Download className="w-3 h-3 text-slate-400" />
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
              className={`group relative aspect-square rounded-xl border flex flex-col items-center justify-between p-1.5 transition-all select-none cursor-pointer ${
                isSelected
                  ? 'border-indigo-500 bg-indigo-500/20 shadow-md shadow-indigo-500/20 ring-2 ring-indigo-500/40'
                  : 'border-[#2a3142] bg-[#12151d]/60 hover:border-slate-500 hover:bg-[#181d28]'
              }`}
              title={floor.name}
            >
              {/* Top Badge / Actions */}
              <div className="w-full flex items-center justify-between z-10 pointer-events-none">
                <div>
                  {((floor.width && floor.width > 1) || (floor.height && floor.height > 1)) && (
                    <div
                      className="px-1 py-0.5 rounded text-[8px] font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-500/40 shadow-sm"
                      title={`Dimensão: ${floor.width || 1}×${floor.height || 1} tiles`}
                    >
                      {floor.width || 1}×{floor.height || 1}
                    </div>
                  )}
                </div>
                {isDefaultFloor ? (
                  <div
                    className="px-1 py-0.5 rounded text-[8px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-0.5 shadow-sm"
                    title="Piso padrão protegido"
                  >
                    <ShieldCheck className="w-2.5 h-2.5 text-emerald-400" />
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
                        className="p-1 rounded-md bg-indigo-500/30 hover:bg-indigo-500/60 text-indigo-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        title={`Editar pixels no Estúdio: "${floor.name}"`}
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
                        className="p-1 rounded-md bg-amber-500/30 hover:bg-amber-500/60 text-amber-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
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
                      className="p-1 rounded-md bg-rose-500/30 hover:bg-rose-500/60 text-rose-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                      title={`Excluir piso "${floor.name}"`}
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Center Floor Thumbnail */}
              <div className="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden py-0.5">
                <PixelArtThumbnail type="floor" id={floor.id} size={48} />
              </div>

              {/* Bottom Label */}
              <div className="w-full text-center px-0.5">
                <div className="text-[11px] font-semibold text-slate-200 truncate leading-tight">
                  {floor.name.replace(/^✨\s*/, '')}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Confirm Delete Floor Modal */}
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
