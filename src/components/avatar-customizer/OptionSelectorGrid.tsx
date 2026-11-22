import { AutoCroppedThumbnail } from './AutoCroppedThumbnail'
import React, { useState, useEffect, useRef } from 'react'
import { Check, Pencil, Plus, Trash2, Download, Upload, Scissors, Paintbrush } from 'lucide-react'
import {
  AvatarConfig,
  AvatarComponentSlot,
} from '../../types/game'
import { CategoryKey } from './CategoryTabs'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { CustomAsset } from '../../types/customAsset'
import { exportCategoryAtlas } from '../../engine/avatar/avatarAtlasExporter'
import { AtlasImportModal } from './AtlasImportModal'
import { AvatarSpritesheetSlicerModal } from './AvatarSpritesheetSlicerModal'
import { prepareAssetForSlicer } from '../../utils/avatarAssetOrigin'

interface Props {
  activeCategory: CategoryKey
  avatar: AvatarConfig
  onChangeAvatar: (newAvatar: AvatarConfig) => void
  onEditPreset?: (category: AvatarComponentSlot, presetId: string, label: string) => void
  onCreatePreset?: (category: AvatarComponentSlot) => void
}



export const OptionSelectorGrid: React.FC<Props> = ({
  activeCategory,
  avatar,
  onChangeAvatar,
  onEditPreset,
  onCreatePreset,
}) => {
  const { customAssets, deleteCustomAsset } = useCustomAssetsStore()
  const [deletingAsset, setDeletingAsset] = useState<CustomAsset | null>(null)
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false)

  const directSlicerInputRef = useRef<HTMLInputElement | null>(null)
  const [slicerImageSrc, setSlicerImageSrc] = useState<string>('')
  const [slicerImageName, setSlicerImageName] = useState<string>('')
  const [isDirectSlicerOpen, setIsDirectSlicerOpen] = useState<boolean>(false)
  const [editingSlicerAsset, setEditingSlicerAsset] = useState<CustomAsset | null>(null)
  const [slicerError, setSlicerError] = useState<string | null>(null)

  const handleDirectSlicerFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setEditingSlicerAsset(null)
    setSlicerImageName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      setSlicerImageSrc(dataUrl)
      setIsDirectSlicerOpen(true)
    }
    reader.readAsDataURL(file)
  }

  const handleEditAsset = async (asset: CustomAsset) => {
    setSlicerError(null)
    try {
      const prepared = await prepareAssetForSlicer(asset)
      setEditingSlicerAsset(prepared.asset)
      setSlicerImageSrc(prepared.imageSrc)
      setSlicerImageName(asset.sourceFileName || `${asset.name}.png`)
      setIsDirectSlicerOpen(true)
    } catch {
      setSlicerError(`Não foi possível carregar as imagens de ${asset.name} para edição. Tente novamente.`)
    }
  }

  const categoryCustomAssets = customAssets
    .filter((a) => a.type === 'avatar' && a.avatarSlot === activeCategory)
    .sort((a, b) => {
      const isRetroA = a.id === 'avatar_other_sliced_1788355059618_ozg3' || a.name.toLowerCase() === 'retro'
      const isRetroB = b.id === 'avatar_other_sliced_1788355059618_ozg3' || b.name.toLowerCase() === 'retro'
      if (isRetroA) return -1
      if (isRetroB) return 1
      return 0
    })

  const handleConfirmDelete = async (asset: CustomAsset) => {
    await deleteCustomAsset(asset.id)

    const slot = activeCategory as AvatarComponentSlot
    const currentComp = avatar.customComponents?.[slot]
    const isEquipped =
      avatar.customAvatarId === asset.id ||
      avatar.otherType === asset.id ||
      currentComp === asset.directionalFrames ||
      currentComp === asset.frames[0] ||
      currentComp === asset.id

    if (isEquipped) {
      onChangeAvatar({
        ...avatar,
        customSkinUrl: undefined,
        customAvatarId: 'avatar_other_sliced_1788355059618_ozg3',
        otherType: 'avatar_other_sliced_1788355059618_ozg3',
        customComponents: {},
      })
    }

    setDeletingAsset(null)
  }

  const renderCreateCard = () => {
    if (!onCreatePreset) return null
    return (
      <button
        key="__create_new__"
        onClick={() => onCreatePreset(activeCategory as AvatarComponentSlot)}
        className="group relative flex flex-col items-center justify-center p-3 rounded-[12px] border-2 border-dashed border-lira-rule/60 bg-lira-surface/40 hover:bg-lira-surface hover:border-lira-accent transition-colors aspect-square text-lira-accent font-mono"
        title="Criar novo preset do zero no estúdio"
      >
        <div className="w-12 h-12 rounded-[8px] mb-1.5 flex items-center justify-center bg-lira-ground border border-lira-rule group-hover:bg-lira-accent group-hover:text-lira-ground transition-colors">
          <Plus className="w-5 h-5" />
        </div>
        <span className="text-[11px] font-mono font-bold truncate max-w-[80px]">Criar Novo</span>
      </button>
    )
  }

  const renderCustomPresetCards = () => {
    return categoryCustomAssets.map((asset) => {
      const currentComp = avatar.customComponents?.[activeCategory as AvatarComponentSlot]
      const isSelected =
        avatar.customAvatarId === asset.id ||
        avatar.otherType === asset.id ||
        (!avatar.customAvatarId && (!avatar.otherType || avatar.otherType === 'default') && (asset.id === 'avatar_other_sliced_1788355059618_ozg3' || asset.name.toLowerCase() === 'retro')) ||
        currentComp === asset.directionalFrames ||
        currentComp === asset.frames[0] ||
        currentComp === asset.id ||
        (typeof currentComp === 'object' && (currentComp as any)?.down === asset.frames[0])

      return (
        <button
          key={asset.id}
          onClick={() => {
            onChangeAvatar({
              ...avatar,
              customSkinUrl: undefined,
              customAvatarId: asset.id,
              otherType: asset.id,
              customComponents: {
                ...avatar.customComponents,
                [activeCategory as AvatarComponentSlot]: asset.id,
              },
            })
          }}
          className={`group relative flex flex-col items-center justify-center p-3 rounded-[12px] border-2 transition-colors aspect-square font-mono ${
            isSelected
              ? 'border-lira-accent bg-lira-surface'
              : 'border-lira-quiet bg-lira-sidebar hover:border-lira-rule hover:bg-lira-surface'
          }`}
        >
          {onEditPreset && (
            <div
              onClick={(e) => {
                e.stopPropagation()
                onEditPreset(activeCategory as AvatarComponentSlot, asset.id, asset.name)
              }}
              title={`Pintar / Editar Pixels de ${asset.name} no Estúdio Pixel Art`}
              className="absolute top-1.5 left-1.5 w-6 h-6 rounded-[6px] bg-lira-ground hover:bg-lira-accent text-lira-accent hover:text-lira-ground border border-lira-rule flex items-center justify-center transition-opacity opacity-0 group-hover:opacity-100 z-10 cursor-pointer"
            >
              <Paintbrush className="w-3.5 h-3.5" />
            </div>
          )}

          {(
            <div
              onClick={(e) => {
                e.stopPropagation()
                handleEditAsset(asset)
              }}
              title={`Fatiar / Recortar Folha de Sprites de ${asset.name}`}
              className="absolute top-1.5 left-8 w-6 h-6 rounded-[6px] bg-lira-ground hover:bg-lira-accent text-lira-accent hover:text-lira-ground border border-lira-rule flex items-center justify-center transition-opacity opacity-0 group-hover:opacity-100 z-10 cursor-pointer"
            >
              <Scissors className="w-3.5 h-3.5" />
            </div>
          )}

          <div
            onClick={(e) => {
              e.stopPropagation()
              setDeletingAsset(asset)
            }}
            title={`Excluir ${asset.name}`}
            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-[6px] bg-lira-ground hover:bg-lira-error text-lira-muted hover:text-lira-ground border border-lira-rule flex items-center justify-center transition-opacity opacity-0 group-hover:opacity-100 z-10 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </div>

          <AutoCroppedThumbnail
            src={asset.thumbnail || asset.frames[0]}
            alt={asset.name}
            isSkinCategory={false}
            skinTone={avatar.skinTone}
          />

          <span className="text-[11px] font-mono font-bold text-lira-ink truncate max-w-[80px]" title={asset.name}>
            {asset.name}
          </span>

          {isSelected && (
            <div className="absolute bottom-1.5 right-1.5 w-4 h-4 bg-lira-accent text-lira-ground rounded-full flex items-center justify-center">
              <Check className="w-2.5 h-2.5" />
            </div>
          )}
        </button>
      )
    })
  }

  return (
    <div className="flex-1 overflow-y-auto pr-1 font-mono text-lira-ink">
      {slicerError && <p role="alert" className="text-xs font-mono text-lira-error mb-3">{slicerError}</p>}
      {activeCategory === 'other' && (
        <div className="flex flex-wrap items-center justify-between mb-3 pb-2 border-b border-dashed border-lira-rule/60 px-1 gap-2">
          <span className="text-xs font-display font-bold text-lira-accent">Modelos & Presets</span>
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <input
              ref={directSlicerInputRef}
              type="file"
              accept="image/*,.png"
              onChange={handleDirectSlicerFile}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => directSlicerInputRef.current?.click()}
              title={`Abrir Fatiador Interativo para recortar frames de uma folha de spritesheet PNG e gerar o arquivo XML`}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-rule text-lira-accent hover:text-lira-ink text-[11px] font-mono font-semibold transition-colors cursor-pointer"
            >
              <Scissors className="w-3.5 h-3.5 text-lira-accent" />
              <span>Fatiar Imagem</span>
            </button>

            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              title={`Importar Folha PNG e Arquivo Sparrow XML para personagens`}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-online border border-lira-rule text-lira-online text-[11px] font-mono font-semibold transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-lira-online" />
              <span>Importar Atlas</span>
            </button>

            <button
              type="button"
              onClick={() => exportCategoryAtlas(activeCategory, customAssets, avatar)}
              title={`Exportar Folha PNG e Arquivo Sparrow XML para personagens`}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-rule text-lira-muted hover:text-lira-ink text-[11px] font-mono font-semibold transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-lira-accent" />
              <span>Exportar Atlas</span>
            </button>
          </div>
        </div>
      )}

      {activeCategory === 'other' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
          {renderCreateCard()}
          {renderCustomPresetCards()}
        </div>
      )}

      {deletingAsset && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-lira-ground/80 p-4 select-none font-mono">
          <div className="bg-lira-panel border border-dashed border-lira-rule rounded-[12px] p-5 max-w-sm w-full flex flex-col gap-4 text-lira-ink">
            <div className="flex items-center gap-3 text-lira-error">
              <div className="w-10 h-10 rounded-[8px] bg-lira-error/15 border border-lira-error/40 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-bold text-sm text-lira-ink">Excluir Preset</h3>
                <p className="text-xs font-mono text-lira-muted">Esta ação é permanente.</p>
              </div>
            </div>

            <p className="text-xs font-mono text-lira-muted leading-relaxed">
              Tem certeza que deseja excluir o preset customizado <strong className="text-lira-ink font-semibold">"{deletingAsset.name}"</strong>?
            </p>

            <div className="flex items-center justify-end gap-2.5 mt-1 pt-2 border-t border-dashed border-lira-rule/60">
              <button
                onClick={() => setDeletingAsset(null)}
                className="px-4 py-2 rounded-[8px] text-xs font-mono font-semibold text-lira-muted hover:text-lira-ink bg-lira-surface border border-lira-rule transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleConfirmDelete(deletingAsset)}
                className="px-4 py-2 rounded-[8px] text-xs font-mono font-bold bg-lira-error/20 hover:bg-lira-error text-lira-error hover:text-lira-ground border border-lira-error transition-colors"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {isImportModalOpen && (
        <AtlasImportModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          category={activeCategory as AvatarComponentSlot}
        />
      )}

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
          imageFileName={slicerImageName || `${activeCategory}.png`}
          category={activeCategory as AvatarComponentSlot}
          onSaveComplete={(createdAssets) => {
            if (createdAssets && createdAssets.length > 0) {
              const lastAsset = createdAssets[createdAssets.length - 1]
              onChangeAvatar({
                ...avatar,
                customComponents: {
                  ...avatar.customComponents,
                  [activeCategory as AvatarComponentSlot]:
                    lastAsset.id,
                },
              })
            }
          }}
        />
      )}
    </div>
  )
}
