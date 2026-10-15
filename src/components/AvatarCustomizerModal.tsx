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
  } | null>(null)

  useEffect(() => {
    if (isOpen) {
      setName(localPlayer.name || 'Player')
      setStatus(localPlayer.status || 'available')
      setProfilePicture(localPlayer.profilePicture || '')
      setAvatar({
        ...localPlayer.avatar,
        pet: localPlayer.avatar?.pet || { type: 'none' },
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
    name: string
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
        creationSource: 'studio',
      })
    } else {
      const newAsset: CustomAsset = {
        id: `avatar_${category}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: customName,
        type: 'avatar' as const,
        category: 'Geral',
        avatarSlot: category,
        thumbnail,
        width: 1,
        height: 1,
        isObstacle: false,
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 animate-in fade-in duration-200 select-none">
      <div className="bg-[#1e1f22] border border-[#2b2d31] rounded-2xl sm:rounded-3xl w-full max-w-5xl lg:max-w-6xl overflow-hidden shadow-2xl flex flex-col h-[94vh] sm:h-[680px]">
        <div className="flex flex-wrap items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3 border-b border-[#2b2d31] bg-[#18191c] gap-2">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h2 className="text-sm sm:text-base font-extrabold text-slate-100 tracking-tight">Editar Avatar</h2>
            <div className="hidden sm:block h-4 w-px bg-[#2b2d31]" />
            <div className="flex items-center gap-1.5 bg-[#2b2d31] px-2.5 py-1 rounded-xl border border-[#383a40]">
              <span className="text-[11px] font-semibold text-slate-400">Nome:</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu Nickname"
                maxLength={32}
                className="bg-transparent text-xs font-bold text-slate-100 focus:outline-none focus:text-white w-24 sm:w-36 md:w-48"
              />
            </div>

            <CustomDropdown<PresenceStatus>
              value={status}
              options={statusDropdownOptions}
              onChange={setStatus}
              labelPrefix="Status:"
              buttonClassName="bg-[#2b2d31] hover:bg-[#34373d] border-[#383a40] text-xs py-1"
            />

            <div className="hidden sm:block">
              <CustomDropdown<'show' | 'hide'>
                value={showNameTags ? 'show' : 'hide'}
                options={[
                  { value: 'show', label: 'Mostrar', icon: <Eye className="w-3.5 h-3.5 text-blue-400" /> },
                  { value: 'hide', label: 'Ocultar', icon: <EyeOff className="w-3.5 h-3.5 text-slate-400" /> },
                ]}
                onChange={(val) => setShowNameTags(val === 'show')}
                labelPrefix="Nomes:"
                buttonClassName="bg-[#2b2d31] hover:bg-[#34373d] border-[#383a40] text-xs py-1"
                title="Mostrar ou ocultar nomes em cima do personagem e do pet"
              />
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-[#2b2d31] transition-colors ml-auto sm:ml-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex md:hidden overflow-x-auto p-1.5 bg-[#18191c] border-b border-[#2b2d31] gap-1.5 shrink-0">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon
            const isActive = activeCategory === cat.id
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id as CategoryKey)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-[#3b82f6] text-white shadow-md shadow-blue-500/20'
                    : 'text-slate-300 hover:bg-[#2b2d31] hover:text-white bg-[#222428]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{cat.label}</span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          <CategoryTabs activeCategory={activeCategory} onSelectCategory={setActiveCategory} className="hidden md:flex w-48 bg-[#18191c] border-r border-[#2b2d31] p-3 flex-col gap-1 overflow-y-auto shrink-0" />

        {activeCategory !== 'profile' && (
          <AvatarPreviewCanvas
            isOpen={isOpen}
            avatar={avatar}
            name={name}
            status={status}
            localPlayer={localPlayer}
            onRandomize={handleRandomize}
            showNameTags={showNameTags}
            className="md:hidden w-full h-28 sm:h-36 bg-[#1e1f22] border-b border-[#2b2d31] relative flex items-center justify-center p-1.5 shrink-0 overflow-hidden"
            canvasWidth={320}
            canvasHeight={140}
          />
        )}

        <div className="flex-1 bg-[#2b2d31] flex flex-col justify-between p-2 sm:p-5 overflow-y-auto">
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
            className="hidden md:flex w-80 bg-[#1e1f22] border-l border-[#2b2d31] relative items-center justify-center p-4 shrink-0 overflow-hidden"
          />
        </div>

        <div className="p-3 sm:p-4 border-t border-[#2b2d31] bg-[#18191c] flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 sm:px-5 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 hover:bg-[#2b2d31] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-6 sm:px-7 py-2 sm:py-2.5 rounded-xl text-xs font-extrabold bg-[#3b82f6] hover:bg-blue-500 text-white shadow-lg shadow-blue-500/30 transition-all active:scale-95 flex items-center gap-1.5"
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
          onSave={handleSavePresetFromStudio}
        />
      )}
    </div>
  )
}
