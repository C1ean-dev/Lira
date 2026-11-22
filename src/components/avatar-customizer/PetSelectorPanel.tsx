import { AutoCroppedThumbnail } from './AutoCroppedThumbnail'
import { PetPersonalityEditor } from './PetPersonalityEditor'
import { withSavedPetPersonality } from '../../services/petPersonalities'
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
import { exportCategoryAtlas } from '../../engine/avatar/avatarAtlasExporter'
import { AtlasImportModal } from './AtlasImportModal'
import { AvatarSpritesheetSlicerModal } from './AvatarSpritesheetSlicerModal'
import { prepareAssetForSlicer } from '../../utils/avatarAssetOrigin'

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



export const PetSelectorPanel: React.FC<Props> = ({
  avatar,
  onChangeAvatar,
  onEditPreset,
  onCreatePreset,
}) => {
  const { customAssets, deleteCustomAsset } = useCustomAssetsStore()
  const currentPet: PetConfig = avatar.pet || { type: 'none' }

  const petCustomAssets = customAssets.filter(
    (a) => a.type === 'avatar' && a.avatarSlot === 'pet'
  )

  useEffect(() => {
    if (avatar.pet && ['cat', 'dog', 'slime', 'chick'].includes(avatar.pet.type)) {
      onChangeAvatar({
        ...avatar,
        pet: { type: 'none' },
      })
    }
  }, [avatar.pet, onChangeAvatar])

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
      pet: withSavedPetPersonality({
        type,
        name: currentPet.name || PetRenderer.getDefaultPetName(type),
        color: currentPet.color || opt?.defaultColor || '#10b981',
      }),
    })
  }

  const handleSelectCustomPet = (asset: CustomAsset) => {
    onChangeAvatar({
      ...avatar,
      pet: withSavedPetPersonality({
        type: 'custom',
        customAssetId: asset.id,
        name: asset.name,
      }),
    })
  }

  const handleConfirmDelete = async (asset: CustomAsset) => {
    await deleteCustomAsset(asset.id)
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
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 font-mono text-lira-ink">
      {slicerError && <p role="alert" className="text-xs font-mono text-lira-error mb-3">{slicerError}</p>}
      <div className="flex flex-wrap items-center justify-between mb-3 pb-2 border-b border-dashed border-lira-rule/60 px-1 shrink-0 gap-2">
        <span className="text-xs font-display font-bold text-lira-accent">Opções & Presets</span>
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
            title="Abrir Fatiador Interativo para recortar frames de uma folha de spritesheet de Pet e gerar XML"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-rule text-lira-accent hover:text-lira-ink text-[11px] font-mono font-semibold transition-colors cursor-pointer"
          >
            <Scissors className="w-3.5 h-3.5 text-lira-accent" />
            <span>Fatiar Imagem</span>
          </button>

          <button
            type="button"
            onClick={() => setIsImportModalOpen(true)}
            title="Importar folha de spritesheet PNG e arquivo XML (Sparrow) para Pet"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-online border border-lira-rule text-lira-online text-[11px] font-mono font-semibold transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-lira-online" />
            <span>Importar Atlas</span>
          </button>

          <button
            type="button"
            onClick={() => exportCategoryAtlas('pet', customAssets, avatar)}
            title="Exportar todos os Mascotes personalizados em uma folha de spritesheet PNG e arquivo XML (Sparrow)"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-rule text-lira-muted hover:text-lira-ink text-[11px] font-mono font-semibold transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-lira-accent" />
            <span>Exportar Atlas</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1 min-h-0 mb-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3 pb-2">
          {onCreatePreset && (
            <button
              type="button"
              onClick={() => onCreatePreset('pet')}
              className="group relative flex flex-col items-center justify-center p-3 rounded-[12px] border-2 border-dashed border-lira-rule/60 bg-lira-surface/40 hover:bg-lira-surface hover:border-lira-accent transition-colors aspect-square text-lira-accent cursor-pointer"
              title="Criar novo pet do zero no estúdio pixel art"
            >
              <div className="w-12 h-12 rounded-[8px] mb-1.5 flex items-center justify-center bg-lira-ground border border-lira-rule group-hover:bg-lira-accent group-hover:text-lira-ground transition-colors">
                <Plus className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-mono font-bold truncate max-w-[80px]">Criar Pet</span>
            </button>
          )}

          {BUILTIN_PETS.map((pet) => {
            const isSelected =
              currentPet.type === pet.id && !currentPet.customAssetId

            return (
              <button
                key={pet.id}
                type="button"
                onClick={() => handleSelectBuiltin(pet.id)}
                className={`group relative flex flex-col items-center justify-center p-3 rounded-[12px] border-2 transition-colors aspect-square cursor-pointer ${
                  isSelected
                    ? 'border-lira-accent bg-lira-surface'
                    : 'border-lira-quiet bg-lira-sidebar hover:border-lira-rule hover:bg-lira-surface'
                }`}
              >
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
                    className="absolute top-1.5 left-1.5 w-6 h-6 rounded-[6px] bg-lira-ground hover:bg-lira-accent text-lira-accent hover:text-lira-ground border border-lira-rule flex items-center justify-center transition-opacity opacity-0 group-hover:opacity-100 z-10 cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </div>
                )}

                <div className="w-12 h-12 rounded-[8px] mb-1.5 flex items-center justify-center bg-lira-ground border border-lira-quiet text-2xl">
                  {pet.emoji}
                </div>

                <span className="text-[11px] font-mono font-bold text-lira-ink truncate max-w-[80px]">
                  {pet.name}
                </span>

                {isSelected && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-lira-accent text-lira-ground rounded-full flex items-center justify-center">
                    <Check className="w-2.5 h-2.5" />
                  </div>
                )}
              </button>
            )
          })}

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
                className={`group relative flex flex-col items-center justify-center p-3 rounded-[12px] border-2 transition-colors aspect-square cursor-pointer ${
                  isSelected
                    ? 'border-lira-accent bg-lira-surface'
                    : 'border-lira-quiet bg-lira-sidebar hover:border-lira-rule hover:bg-lira-surface'
                }`}
              >
                {onEditPreset && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditPreset('pet', asset.id, asset.name)
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
                  src={thumbSrc}
                  alt={asset.name}
                  className="w-12 h-12 rounded-[8px] mb-1 flex items-center justify-center relative overflow-hidden border border-lira-quiet bg-lira-ground"
                  fallbackIcon="pet"
                />

                <span className="text-[11px] font-mono font-bold text-lira-ink truncate max-w-[80px]">
                  {asset.name}
                </span>

                {isSelected && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-lira-accent text-lira-ground rounded-full flex items-center justify-center">
                    <Check className="w-2.5 h-2.5" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {currentPet.type !== 'none' && (
        <div className="pt-2 sm:pt-3 border-t border-dashed border-lira-rule/60 flex flex-wrap items-center justify-between gap-2 sm:gap-3 shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
            <span className="text-[11px] font-mono font-bold text-lira-ink flex items-center gap-1.5 shrink-0">
              <Heart className="w-3.5 h-3.5 text-lira-error" />
              Nome do Mascote:
            </span>
            <input
              type="text"
              value={currentPet.name || ''}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Ex: Rex, Mingau..."
              maxLength={14}
              className="flex-1 bg-lira-ground border border-lira-rule focus:border-lira-accent rounded-[8px] px-2.5 py-1 text-xs font-mono font-semibold text-lira-ink outline-none"
            />
            <button
              type="button"
              onClick={() =>
                handleNameChange(PetRenderer.getDefaultPetName(currentPet.type))
              }
              className="px-2 py-1 rounded-[6px] bg-lira-surface hover:border-lira-accent text-lira-muted hover:text-lira-ink text-[10px] font-mono font-semibold border border-lira-rule transition-colors shrink-0"
              title="Restaurar nome padrão"
            >
              Padrão
            </button>
          </div>
        </div>
      )}

      {currentPet.type !== 'none' && <PetPersonalityEditor key={currentPet.type + ':' + (currentPet.customAssetId || '')} pet={currentPet}
        onSave={personality => onChangeAvatar({ ...avatar, pet: { ...currentPet, personality } })} />}

      {deletingAsset && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-lira-ground/80 p-4 font-mono">
          <div className="bg-lira-panel border border-dashed border-lira-rule rounded-[12px] p-6 max-w-sm w-full space-y-4 text-lira-ink">
            <h3 className="text-sm font-display font-bold text-lira-ink flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-lira-error" />
              Excluir Mascote?
            </h3>
            <p className="text-xs font-mono text-lira-muted leading-relaxed">
              Tem certeza que deseja excluir o mascote{' '}
              <strong className="text-lira-ink">{deletingAsset.name}</strong>? Esta
              ação não pode ser desfeita.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-dashed border-lira-rule/60">
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
          category="pet"
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
                },
              })
            }
          }}
        />
      )}
    </div>
  )
}
