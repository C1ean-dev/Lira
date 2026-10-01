import React, { useState, useRef, useEffect } from 'react'
import {
  Check,
  Pencil,
  Plus,
  Trash2,
  Download,
  Upload,
  Scissors,
  Paintbrush,
  Heart,
  Ban,
  Sparkles,
} from 'lucide-react'
import { AvatarConfig, AvatarComponentSlot, PetConfig, PetType, Direction } from '../../types/game'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { CustomAsset } from '../../types/customAsset'
import { PetRenderer } from '../../engine/pet/PetRenderer'
import { cropContentDataUrl } from '../../engine/avatar/avatarBakeService'
import { exportCategoryAtlas } from '../../engine/avatar/avatarAtlasExporter'
import { AtlasImportModal } from './AtlasImportModal'
import { AvatarSpritesheetSlicerModal } from './AvatarSpritesheetSlicerModal'
import { savePetAtlasToDisk } from '../../utils/diskAssetPersistence'
import {
  detectAssetCreationSource,
  resolveAssetSourceImage,
  resolveAssetXmlContent,
  convertAssetToSlicedPresets,
} from '../../utils/avatarAssetOrigin'

interface Props {
  avatar: AvatarConfig
  onChangeAvatar: (avatar: AvatarConfig) => void
  onEditPreset?: (category: AvatarComponentSlot, presetId: string, label: string) => void
  onCreatePreset?: (category: AvatarComponentSlot) => void
}

interface BuiltinPetOption {
  id: PetType
  name: string
  subtitle: string
  emoji: string
  badge: string
  defaultColor?: string
}

const BUILTIN_PETS: BuiltinPetOption[] = [
  {
    id: 'none',
    name: 'Nenhum',
    subtitle: 'Sem mascote',
    emoji: '🚫',
    badge: 'Desativado',
  },
]

/**
 * Auto-cropped close-up thumbnail preview for pixel art assets
 */
const AutoCroppedThumbnail: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
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
    <div className="w-12 h-12 rounded-xl mb-1 flex items-center justify-center relative shadow-sm overflow-hidden border border-slate-700/50 bg-[#18191c]">
      <img
        src={displayUrl}
        alt={alt}
        className="w-full h-full object-contain [image-rendering:pixelated]"
      />
    </div>
  )
}

export const PetSelectorPanel: React.FC<Props> = ({
  avatar,
  onChangeAvatar,
  onEditPreset,
  onCreatePreset,
}) => {
  const { customAssets, deleteCustomAsset } = useCustomAssetsStore()
  const currentPet: PetConfig = avatar.pet || { type: 'none' }

  // Custom assets that belong to the pet slot
  const petCustomAssets = customAssets.filter(
    (a) => a.type === 'avatar' && a.avatarSlot === 'pet'
  )

  // Reset any legacy procedural pet type (cat, dog, slime, chick) to none
  useEffect(() => {
    if (avatar.pet && ['cat', 'dog', 'slime', 'chick'].includes(avatar.pet.type)) {
      onChangeAvatar({
        ...avatar,
        pet: { type: 'none' },
      })
    }
  }, [avatar.pet, onChangeAvatar])

  // Auto-sync custom pets to public/assets/pet/ on disk
  useEffect(() => {
    for (const asset of petCustomAssets) {
      if (asset.directionalFrames) {
        const cleanBase = asset.name.toLowerCase().replace(/[^a-z0-9]/g, '_') || `pet_${asset.id}`
        savePetAtlasToDisk(cleanBase, asset.directionalFrames as Record<Direction, string>).catch((e) =>
          console.warn('[PetSelectorPanel] Auto-sync pet to disk error:', e)
        )
      }
    }
  }, [petCustomAssets])

  // Modals state
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

  // Opens the exact same editor modal that created the pet!
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
      onEditPreset('pet', asset.id, asset.name)
    }
  }

  // Edit built-in pet (cat, slime, chick) in Pixel Art Studio
  const handleEditBuiltinPet = (pet: BuiltinPetOption) => {
    if (onEditPreset) {
      onEditPreset('pet', pet.id, pet.name)
    }
  }

  const handleSelectBuiltin = (type: PetType) => {
    if (type === 'none') {
      onChangeAvatar({
        ...avatar,
        pet: { type: 'none' },
      })
      return
    }

    const opt = BUILTIN_PETS.find((p) => p.id === type)
    onChangeAvatar({
      ...avatar,
      pet: {
        type,
        name: currentPet.name || PetRenderer.getDefaultPetName(type),
        color: currentPet.color || opt?.defaultColor || '#10b981',
      },
    })
  }

  const handleSelectCustomPet = (asset: CustomAsset) => {
    onChangeAvatar({
      ...avatar,
      pet: {
        type: 'custom',
        customAssetId: asset.id,
        name: asset.name,
        directionalFrames: asset.directionalFrames,
      },
    })
  }

  const handleConfirmDelete = (asset: CustomAsset) => {
    deleteCustomAsset(asset.id)
    if (currentPet.customAssetId === asset.id) {
      onChangeAvatar({
        ...avatar,
        pet: { type: 'none' },
      })
    }
    setDeletingAsset(null)
  }

  const handleNameChange = (newName: string) => {
    onChangeAvatar({
      ...avatar,
      pet: {
        ...currentPet,
        name: newName,
      },
    })
  }


  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Top action bar with Slicer, Import, and Export buttons */}
      <div className="flex items-center justify-between mb-3 px-1 shrink-0">
        <span className="text-xs font-bold text-slate-300">Opções & Presets</span>
        <div className="flex items-center gap-2">
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
            title="Abrir Fatiador Interativo para recortar frames de uma folha de spritesheet de Pet e gerar XML"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#18191c] hover:bg-[#383a40] border border-[#383a40] text-indigo-400 hover:text-indigo-300 text-[11px] font-semibold transition-all shadow-xs cursor-pointer"
          >
            <Scissors className="w-3.5 h-3.5 text-indigo-400" />
            <span>Fatiar Imagem</span>
          </button>

          <button
            type="button"
            onClick={() => setIsImportModalOpen(true)}
            title="Importar folha de spritesheet PNG e arquivo XML (Sparrow) para Pet"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#18191c] hover:bg-[#383a40] border border-[#383a40] text-emerald-400 hover:text-emerald-300 text-[11px] font-semibold transition-all shadow-xs cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-400" />
            <span>Importar Atlas</span>
          </button>

          <button
            type="button"
            onClick={() => exportCategoryAtlas('pet', customAssets, avatar)}
            title="Exportar todos os Mascotes personalizados em uma folha de spritesheet PNG e arquivo XML (Sparrow)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#18191c] hover:bg-[#383a40] border border-[#383a40] text-slate-300 hover:text-white text-[11px] font-semibold transition-all shadow-xs cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#3b82f6]" />
            <span>Exportar Atlas</span>
          </button>
        </div>
      </div>

      {/* Grid of Pets - 3x3 matching the rest of the menu */}
      <div className="flex-1 overflow-y-auto pr-1 min-h-0 mb-3">
        <div className="grid grid-cols-3 gap-3 pb-2">
          {/* 1. Create New Pet Button (Pixel Art Studio) */}
          {onCreatePreset && (
            <button
              type="button"
              onClick={() => onCreatePreset('pet')}
              className="group relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 border-dashed border-[#3b82f6]/50 bg-[#3b82f6]/5 hover:bg-[#3b82f6]/15 hover:border-[#3b82f6] transition-all aspect-square text-[#3b82f6] cursor-pointer"
              title="Criar novo pet do zero no estúdio pixel art"
            >
              <div className="w-12 h-12 rounded-xl mb-1.5 flex items-center justify-center bg-[#3b82f6]/10 group-hover:bg-[#3b82f6] group-hover:text-white transition-all shadow-sm">
                <Plus className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-bold truncate max-w-[80px]">Criar Pet</span>
            </button>
          )}

          {/* 2. Builtin Pets */}
          {BUILTIN_PETS.map((pet) => {
            const isSelected =
              currentPet.type === pet.id && !currentPet.customAssetId

            return (
              <button
                key={pet.id}
                type="button"
                onClick={() => handleSelectBuiltin(pet.id)}
                className={`group relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all aspect-square cursor-pointer ${
                  isSelected
                    ? 'border-[#3b82f6] bg-[#3b82f6]/20 shadow-md ring-2 ring-[#3b82f6]/30'
                    : 'border-[#383a40] bg-[#1e1f22] hover:border-slate-500'
                }`}
              >
                {/* Edit Button for built-in pets (except 'none') */}
                {pet.id !== 'none' && onEditPreset && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation()
                      handleEditBuiltinPet(pet)
                    }}
                    title={
                      pet.id === 'meowth'
                        ? 'Editar Meowth no Fatiador de Imagem'
                        : `Editar ${pet.name} no Estúdio Pixel Art`
                    }
                    className="absolute top-1.5 left-1.5 w-6 h-6 rounded-lg bg-[#2b2d31]/90 hover:bg-[#3b82f6] text-slate-300 hover:text-white flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 z-10 shadow-md cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </div>
                )}

                <div className="w-12 h-12 rounded-xl mb-1.5 flex items-center justify-center bg-slate-800/60 border border-slate-700/50 text-2xl group-hover:scale-110 transition-transform shadow-xs">
                  {pet.emoji}
                </div>

                <span className="text-[11px] font-bold text-white truncate max-w-[80px]">
                  {pet.name}
                </span>

                {isSelected && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-[#3b82f6] text-white rounded-full flex items-center justify-center shadow">
                    <Check className="w-2.5 h-2.5" />
                  </div>
                )}
              </button>
            )
          })}

          {/* 3. Custom Pets Created by User (via Studio, Slicer, or Atlas) */}
          {petCustomAssets.map((asset) => {
            const isSelected = currentPet.customAssetId === asset.id
            const thumbSrc =
              asset.thumbnail ||
              (typeof asset.directionalFrames?.down === 'string'
                ? asset.directionalFrames.down
                : Array.isArray(asset.directionalFrames?.down)
                ? asset.directionalFrames.down[0]
                : asset.frames[0])

            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => handleSelectCustomPet(asset)}
                className={`group relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all aspect-square cursor-pointer ${
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
                      onEditPreset('pet', asset.id, asset.name)
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

                {/* Delete Button */}
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeletingAsset(asset)
                  }}
                  title={`Excluir ${asset.name}`}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-lg bg-[#2b2d31]/90 hover:bg-rose-600 text-slate-300 hover:text-white flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 z-10 shadow-md cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </div>

                {/* Cropped Thumbnail */}
                <AutoCroppedThumbnail src={thumbSrc} alt={asset.name} />

                <span className="text-[11px] font-bold text-[#60a5fa] truncate max-w-[80px]">
                  {asset.name}
                </span>

                {isSelected && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-[#3b82f6] text-white rounded-full flex items-center justify-center shadow">
                    <Check className="w-2.5 h-2.5" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Bottom Customization: Pet Name */}
      {currentPet.type !== 'none' && (
        <div className="pt-3 border-t border-[#383a40] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5 shrink-0">
              <Heart className="w-3.5 h-3.5 text-rose-400" />
              Nome do Mascote:
            </span>
            <input
              type="text"
              value={currentPet.name || ''}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Ex: Rex, Mingau..."
              maxLength={14}
              className="flex-1 bg-[#1e1f22] border border-[#383a40] focus:border-blue-500 rounded-xl px-2.5 py-1 text-xs font-semibold text-white outline-none"
            />
            <button
              type="button"
              onClick={() =>
                handleNameChange(PetRenderer.getDefaultPetName(currentPet.type))
              }
              className="px-2 py-1 rounded-xl bg-[#1e1f22] hover:bg-[#383a40] text-slate-300 text-[10px] font-semibold border border-[#383a40] transition-colors shrink-0"
              title="Restaurar nome padrão"
            >
              Padrão
            </button>
          </div>
        </div>
      )}

      {/* Delete Custom Pet Confirmation Modal */}
      {deletingAsset && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-[#1e1f22] border border-[#2b2d31] rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-500" />
              Excluir Mascote?
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Tem certeza que deseja excluir o mascote{' '}
              <strong className="text-white">{deletingAsset.name}</strong>? Esta
              ação não pode ser desfeita.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDeletingAsset(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-[#2b2d31] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleConfirmDelete(deletingAsset)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-colors"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Atlas Import Modal for Pets */}
      {isImportModalOpen && (
        <AtlasImportModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          category="pet"
        />
      )}

      {/* Spritesheet Slicer Modal for Pets */}
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
          imageFileName={slicerImageName || 'pet.png'}
          category="pet"
          onSaveComplete={(createdAssets) => {
            if (createdAssets && createdAssets.length > 0) {
              const lastAsset = createdAssets[createdAssets.length - 1]
              onChangeAvatar({
                ...avatar,
                pet: {
                  type: 'custom',
                  customAssetId: lastAsset.id,
                  name: lastAsset.name,
                  directionalFrames: lastAsset.directionalFrames,
                },
              })
            }
          }}
        />
      )}
    </div>
  )
}
