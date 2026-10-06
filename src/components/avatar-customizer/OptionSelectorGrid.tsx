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
import { cropContentDataUrl } from '../../engine/avatar/avatarBakeService'
import { AtlasImportModal } from './AtlasImportModal'
import { AvatarSpritesheetSlicerModal } from './AvatarSpritesheetSlicerModal'
import {
  detectAssetCreationSource,
  resolveAssetSourceImage,
  resolveAssetXmlContent,
  convertAssetToSlicedPresets,
} from '../../utils/avatarAssetOrigin'

interface Props {
  activeCategory: CategoryKey
  avatar: AvatarConfig
  onChangeAvatar: (newAvatar: AvatarConfig) => void
  onEditPreset?: (category: AvatarComponentSlot, presetId: string, label: string) => void
  onCreatePreset?: (category: AvatarComponentSlot) => void
}

/**
 * Renders an auto-cropped close-up preview of the pixel art,
 * eliminating all surrounding empty space and centering the item.
 */
const AutoCroppedThumbnail: React.FC<{
  src: string
  alt: string
  isSkinCategory?: boolean
  skinTone?: string
}> = ({ src, alt, isSkinCategory, skinTone }) => {
  const [displayUrl, setDisplayUrl] = useState<string>(src)

  useEffect(() => {
    let active = true
    cropContentDataUrl(src).then((cropped) => {
      if (active && cropped) {
        setDisplayUrl(cropped)
      }
    })
    return () => {
      active = false
    }
  }, [src])

  return (
    <div
      className="w-12 h-12 rounded-xl mb-1.5 flex items-center justify-center relative shadow-sm overflow-hidden border border-slate-700/50"
      style={{ backgroundColor: isSkinCategory && skinTone ? skinTone : '#18191c' }}
    >
      <img
        src={displayUrl}
        alt={alt}
        className="w-full h-full object-contain [image-rendering:pixelated]"
      />
    </div>
  )
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

  // Direct Spritesheet Slicer state
  const directSlicerInputRef = useRef<HTMLInputElement | null>(null)
  const [slicerImageSrc, setSlicerImageSrc] = useState<string>('')
  const [slicerImageName, setSlicerImageName] = useState<string>('')
  const [isDirectSlicerOpen, setIsDirectSlicerOpen] = useState<boolean>(false)
  const [editingSlicerAsset, setEditingSlicerAsset] = useState<CustomAsset | null>(null)

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

  // Opens the exact same editor modal that created the asset!
  const handleEditAsset = async (asset: CustomAsset) => {
    const source = detectAssetCreationSource(asset)
    if (source === 'slicer' || source === 'atlas') {
      const resolvedImage = resolveAssetSourceImage(asset)
      const xmlContent = await resolveAssetXmlContent(asset)
      const initialPresets = convertAssetToSlicedPresets(asset, xmlContent || undefined)

      setEditingSlicerAsset({
        ...asset,
        slicerPresets: initialPresets,
        sourceXmlContent: xmlContent || asset.sourceXmlContent,
      })
      setSlicerImageSrc(resolvedImage)
      setSlicerImageName(asset.sourceFileName || `${asset.name}.png`)
      setIsDirectSlicerOpen(true)
      return
    }

    // Default to Studio (Pixel Art Editor)
    if (onEditPreset) {
      onEditPreset(activeCategory as AvatarComponentSlot, asset.id, asset.name)
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

  const handleConfirmDelete = (asset: CustomAsset) => {
    deleteCustomAsset(asset.id)

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
        className="group relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 border-dashed border-[#3b82f6]/50 bg-[#3b82f6]/5 hover:bg-[#3b82f6]/15 hover:border-[#3b82f6] transition-all aspect-square text-[#3b82f6]"
        title="Criar novo preset do zero no estúdio"
      >
        <div className="w-12 h-12 rounded-xl mb-1.5 flex items-center justify-center bg-[#3b82f6]/10 group-hover:bg-[#3b82f6] group-hover:text-white transition-all shadow-sm">
          <Plus className="w-5 h-5" />
        </div>
        <span className="text-[11px] font-bold truncate max-w-[80px]">Criar Novo</span>
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
                [activeCategory as AvatarComponentSlot]: asset.directionalFrames || asset.frames[0],
              },
            })
          }}
          className={`group relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all aspect-square ${
            isSelected
              ? 'border-[#3b82f6] bg-[#3b82f6]/20 shadow-md ring-2 ring-[#3b82f6]/30'
              : 'border-[#383a40] bg-[#1e1f22] hover:border-slate-500'
          }`}
        >
          {/* Pintar Pixels no Estúdio Pixel Art */}
          {onEditPreset && (
            <div
              onClick={(e) => {
                e.stopPropagation()
                onEditPreset(activeCategory as AvatarComponentSlot, asset.id, asset.name)
              }}
              title={`Pintar / Editar Pixels de ${asset.name} no Estúdio Pixel Art`}
              className="absolute top-1.5 left-1.5 w-6 h-6 rounded-lg bg-[#2b2d31]/90 hover:bg-[#3b82f6] text-slate-300 hover:text-white flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 z-10 shadow-md cursor-pointer"
            >
              <Paintbrush className="w-3.5 h-3.5 text-blue-400" />
            </div>
          )}

          {/* Fatiar Folha de Sprites (se possuir spritesheet fonte) */}
          {(detectAssetCreationSource(asset) === 'slicer' || detectAssetCreationSource(asset) === 'atlas') && (
            <div
              onClick={(e) => {
                e.stopPropagation()
                handleEditAsset(asset)
              }}
              title={`Fatiar / Recortar Folha de Sprites de ${asset.name}`}
              className="absolute top-1.5 left-8 w-6 h-6 rounded-lg bg-[#2b2d31]/90 hover:bg-indigo-600 text-slate-300 hover:text-white flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 z-10 shadow-md cursor-pointer"
            >
              <Scissors className="w-3.5 h-3.5 text-indigo-300" />
            </div>
          )}

          <div
            onClick={(e) => {
              e.stopPropagation()
              setDeletingAsset(asset)
            }}
            title={`Excluir ${asset.name}`}
            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-lg bg-[#2b2d31]/90 hover:bg-rose-600 text-slate-400 hover:text-white flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 z-10 shadow-md cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </div>

          {/* Close-up Cropped Thumbnail Preview */}
          <AutoCroppedThumbnail
            src={asset.thumbnail || asset.frames[0]}
            alt={asset.name}
            isSkinCategory={false}
            skinTone={avatar.skinTone}
          />

          <span className="text-[11px] font-bold text-[#60a5fa] truncate max-w-[80px]" title={asset.name}>
            {asset.name}
          </span>

          {isSelected && (
            <div className="absolute bottom-1.5 right-1.5 w-4 h-4 bg-[#3b82f6] text-white rounded-full flex items-center justify-center shadow">
              <Check className="w-2.5 h-2.5" />
            </div>
          )}
        </button>
      )
    })
  }

  return (
    <div className="flex-1 overflow-y-auto pr-1">
      {/* Top action bar with Export, Import and Slicer Buttons */}
      {activeCategory === 'other' && (
        <div className="flex flex-wrap items-center justify-between mb-3 px-1 gap-2">
          <span className="text-xs font-bold text-slate-300">Modelos & Presets</span>
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Hidden input for direct Spritesheet Slicer */}
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
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-[#18191c] hover:bg-[#383a40] border border-[#383a40] text-indigo-400 hover:text-indigo-300 text-[11px] font-semibold transition-all shadow-xs cursor-pointer"
            >
              <Scissors className="w-3.5 h-3.5 text-indigo-400" />
              <span>Fatiar Imagem</span>
            </button>

            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              title={`Importar Folha PNG e Arquivo Sparrow XML para personagens`}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-[#18191c] hover:bg-[#383a40] border border-[#383a40] text-emerald-400 hover:text-emerald-300 text-[11px] font-semibold transition-all shadow-xs cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              <span>Importar Atlas</span>
            </button>

            <button
              type="button"
              onClick={() => exportCategoryAtlas(activeCategory, customAssets, avatar)}
              title={`Exportar Folha PNG e Arquivo Sparrow XML para personagens`}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-[#18191c] hover:bg-[#383a40] border border-[#383a40] text-slate-300 hover:text-white text-[11px] font-semibold transition-all shadow-xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#3b82f6]" />
              <span>Exportar Atlas</span>
            </button>
          </div>
        </div>
      )}

      {/* CATEGORY: PERSONAGEM */}
      {activeCategory === 'other' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
          {renderCreateCard()}
          {renderCustomPresetCards()}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingAsset && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none">
          <div className="bg-[#1e1f22] border border-[#383a40] rounded-2xl p-5 max-w-sm w-full shadow-2xl flex flex-col gap-4 text-slate-100">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">Excluir Preset</h3>
                <p className="text-xs text-slate-400">Esta ação é permanente.</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Tem certeza que deseja excluir o preset customizado <strong className="text-white font-semibold">"{deletingAsset.name}"</strong>?
            </p>

            <div className="flex items-center justify-end gap-2.5 mt-1">
              <button
                onClick={() => setDeletingAsset(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-[#2b2d31] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleConfirmDelete(deletingAsset)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-600/30 transition-all"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Atlas Import Modal */}
      {isImportModalOpen && (
        <AtlasImportModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          category={activeCategory as AvatarComponentSlot}
        />
      )}

      {/* Direct Interactive Spritesheet Slicer Modal */}
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
                    lastAsset.directionalFrames || lastAsset.frames[0],
                },
              })
            }
          }}
        />
      )}
    </div>
  )
}
