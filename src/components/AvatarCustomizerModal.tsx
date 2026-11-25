import React, { useState, useEffect, useMemo } from 'react'
import { X, Check, Eye, EyeOff } from 'lucide-react'
import { CustomDropdown } from './common/CustomDropdown'
import { MoonPhaseIcon } from './common/MoonPhaseIcon'
import { useGameStore } from '../store/useGameStore'
import { useLocalPlayerDetails } from '../hooks/usePlayerDetails'
import { useSettingsStore } from '../store/useSettingsStore'
import { AvatarConfig, AvatarComponentSlot, PresenceStatus, Direction, PetType, STATUS_OPTIONS, STATUS_META } from '../types/game'
import { PeerManager } from '../p2p/PeerManager'
import { idleManager } from '../services/idleManager'
import { PetRenderer } from '../engine/pet/PetRenderer'
import { CategoryKey, CategoryTabs, CATEGORIES } from './avatar-customizer/CategoryTabs'
import { OptionSelectorGrid } from './avatar-customizer/OptionSelectorGrid'
import { AvatarEffectsPanel } from './avatar-customizer/AvatarEffectsPanel'
import { PetSelectorPanel } from './avatar-customizer/PetSelectorPanel'
import { ProfileSettingsPanel } from './avatar-customizer/ProfileSettingsPanel'
import { AvatarPreviewCanvas } from './avatar-customizer/AvatarPreviewCanvas'
import { AvatarPixelArtModal } from '../editor/avatar/AvatarPixelArtModal'
import { bakeAllAvatarDirections, cropContentDataUrl } from '../engine/avatar/avatarBakeService'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { CustomAsset } from '../types/customAsset'
import { resolveUniquePlayerName } from '../utils/playerName'
import { presetNameForStudio } from '../utils/studioNaming'

import { DEFAULT_AVATAR } from '../engine/Constants'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export const AvatarCustomizerModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const localPlayer = useLocalPlayerDetails()
  const setLocalPlayer = useGameStore((s) => s.setLocalPlayer)
  const setLocalStatus = useGameStore((s) => s.setLocalStatus)
  const showNameTags = useSettingsStore((s) => s.showNameTags)
  const setShowNameTags = useSettingsStore((s) => s.setShowNameTags)

  const [activeCategory, setActiveCategory] = useState<CategoryKey>('other')
  const [name, setName] = useState(localPlayer.name || 'Player')
  const [status, setStatus] = useState<PresenceStatus>(localPlayer.status || 'available')
  const [profilePicture, setProfilePicture] = useState(localPlayer.profilePicture || '')
  const [avatar, setAvatar] = useState<AvatarConfig>({
    ...DEFAULT_AVATAR,
    ...localPlayer.avatar,
    pet: localPlayer.avatar?.pet || { type: 'none' },
    aura: localPlayer.avatar?.aura || DEFAULT_AVATAR.aura,
    steps: localPlayer.avatar?.steps || DEFAULT_AVATAR.steps,
    customSkinUrl: localPlayer.avatar?.customSkinUrl,
    customAvatarId: localPlayer.avatar?.customAvatarId,
    customComponents: localPlayer.avatar?.customComponents,
    otherType: localPlayer.avatar?.otherType || 'default',
  })

  const [editingPreset, setEditingPreset] = useState<{
    isOpen: boolean
    category: AvatarComponentSlot
    presetId: string
    presetName: string
    directionalFrames?: Record<Direction, string | string[]>
    width?: number
    height?: number
    pixelWidth?: number
    pixelHeight?: number
  } | null>(null)

  useEffect(() => {
    if (isOpen) {
      setName(localPlayer.name || 'Player')
      setStatus(localPlayer.status || 'available')
      setProfilePicture(localPlayer.profilePicture || '')
      setAvatar({
        ...localPlayer.avatar,
        pet: localPlayer.avatar?.pet || { type: 'none' },
        aura: localPlayer.avatar?.aura || DEFAULT_AVATAR.aura,
        steps: localPlayer.avatar?.steps || DEFAULT_AVATAR.steps,
        customSkinUrl: localPlayer.avatar?.customSkinUrl,
        customAvatarId: localPlayer.avatar?.customAvatarId,
        customComponents: localPlayer.avatar?.customComponents,
        otherType: localPlayer.avatar?.otherType || 'default',
      })
    }
  }, [isOpen, localPlayer])

  const statusDropdownOptions = useMemo(() => {
    return STATUS_OPTIONS.map((opt) => ({
      value: opt.value,
      label: `${opt.label} (${opt.moonPhase})`,
      icon: <MoonPhaseIcon status={opt.value} className="w-3.5 h-3.5 rounded-full overflow-hidden" withBackground={true} />,
    }))
  }, [])

  if (!isOpen) return null

  const handleOpenEditPreset = (category: AvatarComponentSlot, presetId: string, label: string) => {
    const customAsset = useCustomAssetsStore.getState().customAssets.find((a) => a.id === presetId)
    let directionalFrames: Record<Direction, string | string[]>

    if (customAsset && customAsset.directionalFrames) {
      directionalFrames = customAsset.directionalFrames as Record<Direction, string | string[]>
    } else if (customAsset && customAsset.frames?.length) {
      directionalFrames = {
        down: customAsset.frames[0] || '',
        up: customAsset.frames[1] || '',
        left: customAsset.frames[2] || '',
        right: customAsset.frames[3] || '',
      }
    } else if (category === 'pet') {
      directionalFrames = PetRenderer.bakeBuiltinPetFrames(presetId as PetType, avatar.pet?.color)
    } else {
      directionalFrames = bakeAllAvatarDirections(category, presetId, avatar)
    }

    setEditingPreset({
      isOpen: true,
      category,
      presetId,
      presetName: presetNameForStudio(label, !!customAsset),
      directionalFrames,
      width: customAsset?.width,
      height: customAsset?.height,
      pixelWidth: customAsset?.pixelWidth,
      pixelHeight: customAsset?.pixelHeight,
    })
  }

  const handleOpenCreatePreset = (category: AvatarComponentSlot) => {
    setEditingPreset({
      isOpen: true,
      category,
      presetId: '',
      presetName: '',
      directionalFrames: undefined,
    })
  }

  const handleSavePresetFromStudio = async (
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
    if (!editingPreset) return
    const category = editingPreset.category

    const getFirstFrame = (val?: string | string[]): string => {
      if (Array.isArray(val)) return val[0] || ''
      return val || ''
    }

    const firstDown = getFirstFrame(directionalFrames.down)
    const firstUp = getFirstFrame(directionalFrames.up)
    const firstLeft = getFirstFrame(directionalFrames.left)
    const firstRight = getFirstFrame(directionalFrames.right)

    const customName = name || `Preset ${category}`
    const thumbnail = await cropContentDataUrl(
      firstDown || firstUp || firstLeft || firstRight || ''
    )

    const store = useCustomAssetsStore.getState()
    const existingAsset = editingPreset.presetId
      ? store.customAssets.find((a) => a.id === editingPreset.presetId)
      : null

    let savedAssetId = ''

    if (existingAsset) {
      savedAssetId = existingAsset.id
      await store.updateCustomAsset(existingAsset.id, {
        name: customName,
        thumbnail,
        frames: [firstDown, firstUp, firstLeft, firstRight],
        directionalFrames,
        width: options?.width ?? existingAsset.width,
        height: options?.height ?? existingAsset.height,
        pixelWidth: options?.pixelWidth ?? existingAsset.pixelWidth,
        pixelHeight: options?.pixelHeight ?? existingAsset.pixelHeight,
        creationSource: 'studio',
      })
    } else {
      const finalPixelW = options?.pixelWidth || (options?.width ? options.width * 32 : 32)
      const finalPixelH = options?.pixelHeight || (options?.height ? options.height * 32 : 32)
      const newAsset: CustomAsset = {
        id: `avatar_${category}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: customName,
        type: 'avatar' as const,
        category: 'Geral',
        avatarSlot: category,
        thumbnail,
        width: options?.width || Math.max(1, Math.ceil(finalPixelW / 32)),
        height: options?.height || Math.max(1, Math.ceil(finalPixelH / 32)),
        pixelWidth: finalPixelW,
        pixelHeight: finalPixelH,
        isObstacle: options?.isObstacle ?? false,
        frames: [firstDown, firstUp, firstLeft, firstRight],
        directionalFrames,
        frameRateMs: 160,
        createdAt: Date.now(),
        creationSource: 'studio',
      }
      savedAssetId = newAsset.id
      await store.addCustomAsset(newAsset)
    }

    let updatedAvatar: AvatarConfig
    if (category === 'pet') {
      updatedAvatar = {
        ...avatar,
        pet: {
          type: 'custom',
          customAssetId: savedAssetId,
          name: customName,
        },
      }
    } else {
      updatedAvatar = {
        ...avatar,
        customComponents: {
          ...avatar.customComponents,
          [category]: savedAssetId,
        },
      }
    }
    setAvatar(updatedAvatar)
    setEditingPreset(null)
  }

  const handleSave = () => {
    const rawName = name.trim() || localPlayer.name
    const otherNames = Object.values(useGameStore.getState().remotePlayers).map((p) => p.name)
    const finalName = resolveUniquePlayerName(rawName, otherNames)
    const statusMeta = STATUS_META[status]
    const chosenStatusText = statusMeta?.label || 'Disponível'

    idleManager.cancelAutoAway()
    setLocalPlayer({
      name: finalName,
      profilePicture,
      avatar,
      status,
      statusText: chosenStatusText,
      statusEmoji: '',
    })
    setLocalStatus({
      status,
      statusText: chosenStatusText,
      statusEmoji: '',
    })
    PeerManager.getInstance().sendPlayerUpdate({
      name: finalName,
      profilePicture,
      avatar,
      status,
      statusText: chosenStatusText,
      statusEmoji: '',
    })
    onClose()
  }

  const handleRandomize = () => {
    const chars = useCustomAssetsStore
      .getState()
      .customAssets.filter((a) => a.type === 'avatar' && a.avatarSlot === 'other')
    const retroAsset = chars.find((c) => c.id === 'avatar_other_sliced_1788355059618_ozg3' || c.name.toLowerCase() === 'retro') || chars[0]
    const picked = chars.length > 0 && Math.random() > 0.25
      ? chars[Math.floor(Math.random() * chars.length)]
      : retroAsset
    if (picked) {
      setAvatar({
        ...avatar,
        customSkinUrl: undefined,
        customAvatarId: picked.id,
        customComponents: { other: picked.id },
        otherType: picked.id,
      })
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-lira-ground/80 p-2 sm:p-4 select-none font-mono text-lira-ink">
      <div className="bg-lira-panel border border-dashed border-lira-rule rounded-[12px] w-full max-w-5xl lg:max-w-6xl overflow-hidden flex flex-col h-[94vh] sm:h-[680px]">
        <div className="flex flex-wrap items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3 border-b border-dashed border-lira-rule/60 bg-lira-sidebar gap-2">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h2 className="text-sm sm:text-base font-display font-bold text-lira-accent tracking-tight">Editar Avatar</h2>
            <div className="hidden sm:block h-4 w-px bg-lira-quiet" />
            <div className="flex items-center gap-1.5 bg-lira-ground px-2.5 py-1 rounded-[8px] border border-lira-rule">
              <span className="text-[11px] font-mono font-semibold text-lira-muted">Nome:</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu Nickname"
                maxLength={32}
                className="bg-transparent text-xs font-mono font-bold text-lira-ink focus:outline-none w-24 sm:w-36 md:w-48"
              />
            </div>

            <CustomDropdown<PresenceStatus>
              value={status}
              options={statusDropdownOptions}
              onChange={setStatus}
              labelPrefix="Status:"
              buttonClassName="bg-lira-surface hover:border-lira-accent border-lira-rule text-xs py-1"
            />

            <div className="hidden sm:block">
              <CustomDropdown<'show' | 'hide'>
                value={showNameTags ? 'show' : 'hide'}
                options={[
                  { value: 'show', label: 'Mostrar', icon: <Eye className="w-3.5 h-3.5 text-lira-accent" /> },
                  { value: 'hide', label: 'Ocultar', icon: <EyeOff className="w-3.5 h-3.5 text-lira-muted" /> },
                ]}
                onChange={(val) => setShowNameTags(val === 'show')}
                labelPrefix="Nomes:"
                buttonClassName="bg-lira-surface hover:border-lira-accent border-lira-rule text-xs py-1"
                title="Mostrar ou ocultar nomes em cima do personagem e do pet"
              />
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[8px] border border-transparent text-lira-muted hover:text-lira-ink hover:bg-lira-surface hover:border-lira-rule transition-colors ml-auto sm:ml-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex md:hidden overflow-x-auto p-1.5 bg-lira-sidebar border-b border-dashed border-lira-rule/60 gap-1.5 shrink-0">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon
            const isActive = activeCategory === cat.id
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id as CategoryKey)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-mono font-bold whitespace-nowrap transition-colors border ${
                  isActive
                    ? 'bg-lira-accent text-lira-ground border-lira-accent'
                    : 'text-lira-muted hover:bg-lira-surface hover:text-lira-ink bg-lira-panel border-lira-quiet'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{cat.label}</span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          <CategoryTabs activeCategory={activeCategory} onSelectCategory={setActiveCategory} className="hidden md:flex w-48 bg-lira-sidebar border-r border-lira-quiet p-3 flex-col gap-1 overflow-y-auto shrink-0" />

        {activeCategory !== 'profile' && (
          <AvatarPreviewCanvas
            isOpen={isOpen}
            avatar={avatar}
            name={name}
            status={status}
            localPlayer={localPlayer}
            onRandomize={handleRandomize}
            showNameTags={showNameTags}
            className="md:hidden w-full h-28 sm:h-36 bg-lira-panel border-b border-lira-quiet relative flex items-center justify-center p-1.5 shrink-0 overflow-hidden"
            canvasWidth={320}
            canvasHeight={140}
          />
        )}

        <div className="flex-1 bg-lira-panel flex flex-col justify-between p-2 sm:p-5 overflow-y-auto">
          {activeCategory === 'profile' ? (
            <ProfileSettingsPanel
                name={name}
                onChangeName={setName}
                profilePicture={profilePicture}
                onChangeProfilePicture={setProfilePicture}
                avatar={avatar}
                status={status}
                onChangeStatus={setStatus}
              />
            ) : activeCategory === 'aura' || activeCategory === 'steps' ? (
              <AvatarEffectsPanel
                kind={activeCategory}
                avatar={avatar}
                onChangeAvatar={setAvatar}
              />
            ) : activeCategory === 'pet' ? (
              <PetSelectorPanel
                avatar={avatar}
                onChangeAvatar={setAvatar}
                onEditPreset={handleOpenEditPreset}
                onCreatePreset={handleOpenCreatePreset}
              />
            ) : (
              <OptionSelectorGrid
                activeCategory={activeCategory}
                avatar={avatar}
                onChangeAvatar={setAvatar}
                onEditPreset={handleOpenEditPreset}
                onCreatePreset={handleOpenCreatePreset}
              />
            )}
          </div>

          <AvatarPreviewCanvas
            isOpen={isOpen}
            avatar={avatar}
            name={name}
            status={status}
            localPlayer={localPlayer}
            onRandomize={handleRandomize}
            showNameTags={showNameTags}
            className="hidden md:flex w-80 bg-lira-sidebar border-l border-lira-quiet relative items-center justify-center p-4 shrink-0 overflow-hidden"
          />
        </div>

        <div className="p-3 sm:p-4 border-t border-dashed border-lira-rule/60 bg-lira-sidebar flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 sm:px-5 py-2 rounded-[8px] text-xs font-mono font-bold text-lira-muted hover:text-lira-ink bg-lira-surface border border-lira-rule hover:border-lira-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-6 sm:px-7 py-2 sm:py-2.5 rounded-[8px] text-xs font-mono font-extrabold bg-lira-accent hover:bg-lira-ink text-lira-ground border-2 border-lira-accent hover:border-lira-ink transition-colors flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>Feito</span>
          </button>
        </div>
      </div>

      {editingPreset?.isOpen && (
        <AvatarPixelArtModal
          isOpen={editingPreset.isOpen}
          onClose={() => setEditingPreset(null)}
          category={editingPreset.category}
          presetName={editingPreset.presetName}
          initialDirectionalFrames={editingPreset.directionalFrames}
          avatar={avatar}
          initialWidth={editingPreset.width}
          initialHeight={editingPreset.height}
          initialPixelWidth={editingPreset.pixelWidth}
          initialPixelHeight={editingPreset.pixelHeight}
          onSave={handleSavePresetFromStudio}
        />
      )}
    </div>
  )
}
