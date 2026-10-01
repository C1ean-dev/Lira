import React, { useState, useEffect } from 'react'
import { X, Check, Eye, EyeOff } from 'lucide-react'
import { CustomDropdown } from './common/CustomDropdown'
import { useGameStore } from '../store/useGameStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { AvatarConfig, AvatarComponentSlot, PresenceStatus, Direction, PetType, STATUS_OPTIONS, STATUS_META } from '../types/game'
import { PeerManager } from '../p2p/PeerManager'
import { idleManager } from '../services/idleManager'
import { PetRenderer } from '../engine/pet/PetRenderer'
import { CategoryKey, CategoryTabs } from './avatar-customizer/CategoryTabs'
import { OptionSelectorGrid } from './avatar-customizer/OptionSelectorGrid'
import { PetSelectorPanel } from './avatar-customizer/PetSelectorPanel'
import { AvatarPreviewCanvas } from './avatar-customizer/AvatarPreviewCanvas'
import { AvatarPixelArtModal } from '../editor/avatar/AvatarPixelArtModal'
import { bakeAllAvatarDirections, cropContentDataUrl } from '../engine/avatar/avatarBakeService'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { CustomAsset } from '../types/customAsset'
import { saveAssetFileToDisk, savePetAtlasToDisk } from '../utils/diskAssetPersistence'
import { resolveUniquePlayerName } from '../utils/playerName'

import { DEFAULT_AVATAR } from '../engine/Constants'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export const AvatarCustomizerModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { localPlayer, setLocalPlayer, setLocalStatus } = useGameStore()
  const { showNameTags, setShowNameTags } = useSettingsStore()

  const [activeCategory, setActiveCategory] = useState<CategoryKey>('other')
  const [name, setName] = useState(localPlayer.name || 'Player')
  const [status, setStatus] = useState<PresenceStatus>(localPlayer.status || 'available')
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

  // Sync state when opened
  useEffect(() => {
    if (isOpen) {
      setName(localPlayer.name || 'Player')
      setStatus(localPlayer.status || 'available')
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
      presetName: label,
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

    // 1. Create and persist CustomAsset permanently into nativeAssets & mesh
    const customName = name || `Preset ${category}`
    const thumbnail = await cropContentDataUrl(
      firstDown || firstUp || firstLeft || firstRight || ''
    )

    const store = useCustomAssetsStore.getState()
    const existingAsset = editingPreset.presetId
      ? store.customAssets.find((a) => a.id === editingPreset.presetId)
      : null

    let savedAssetId = ''

    let petAtlasInfo: { pngDataUrl: string; xmlContent: string } | null = null
    const cleanBase = customName.toLowerCase().replace(/[^a-z0-9]/g, '_') || `${category}_${Date.now()}`

    // 1. If it's a pet, generate and save the full spritesheet PNG and Sparrow XML to public/assets/pet/
    if (category === 'pet') {
      try {
        petAtlasInfo = await savePetAtlasToDisk(cleanBase, directionalFrames)
      } catch (e) {
        console.warn('Could not auto-save pet atlas file to disk:', e)
      }
    } else if (thumbnail) {
      saveAssetFileToDisk(`public/assets/avatar/${cleanBase}.png`, thumbnail, 'base64')
    }

    if (existingAsset) {
      savedAssetId = existingAsset.id
      store.updateCustomAsset(existingAsset.id, {
        name: customName,
        thumbnail,
        frames: [firstDown, firstUp, firstLeft, firstRight],
        directionalFrames,
        creationSource: 'studio',
        ...(petAtlasInfo
          ? {
              sourceImageSrc: petAtlasInfo.pngDataUrl,
              sourceFileName: `${cleanBase}.png`,
              sourceXmlContent: petAtlasInfo.xmlContent,
            }
          : {}),
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
        ...(petAtlasInfo
          ? {
              sourceImageSrc: petAtlasInfo.pngDataUrl,
              sourceFileName: `${cleanBase}.png`,
              sourceXmlContent: petAtlasInfo.xmlContent,
            }
          : {}),
      }
      savedAssetId = newAsset.id
      store.addCustomAsset(newAsset)
    }

    // 2. Equip immediately onto player avatar
    let updatedAvatar: AvatarConfig
    if (category === 'pet') {
      updatedAvatar = {
        ...avatar,
        pet: {
          type: 'custom',
          customAssetId: savedAssetId,
          name: customName,
          directionalFrames,
        },
      }
    } else {
      updatedAvatar = {
        ...avatar,
        customComponents: {
          ...avatar.customComponents,
          [category]: directionalFrames,
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
      avatar,
      status,
      statusText: chosenStatusText,
      statusEmoji: '',
    })
    onClose()
  }

  // Randomize Avatar (Dice 🎲 feature)
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
        customComponents: { other: picked.directionalFrames || picked.frames[0] || picked.id },
        otherType: picked.id,
      })
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none">
      <div className="bg-[#1e1f22] border border-[#2b2d31] rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col h-[600px] max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[#2b2d31] bg-[#18191c]">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-extrabold text-slate-100 tracking-tight">Editar Avatar</h2>
            <div className="h-4 w-px bg-[#2b2d31]" />
            <div className="flex items-center gap-1.5 bg-[#2b2d31] px-2.5 py-1 rounded-xl border border-[#383a40]">
              <span className="text-[11px] font-semibold text-slate-400">Nome:</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu Nickname"
                maxLength={16}
                className="bg-transparent text-xs font-bold text-slate-100 focus:outline-none focus:text-white w-28"
              />
            </div>

            {/* Current Status Selector */}
            <CustomDropdown<PresenceStatus>
              value={status}
              options={STATUS_OPTIONS}
              onChange={setStatus}
              labelPrefix="Status:"
              buttonClassName="bg-[#2b2d31] hover:bg-[#34373d] border-[#383a40]"
            />

            {/* Show / Hide Names Selector (Character & Pet) */}
            <CustomDropdown<'show' | 'hide'>
              value={showNameTags ? 'show' : 'hide'}
              options={[
                { value: 'show', label: 'Mostrar', icon: <Eye className="w-3.5 h-3.5 text-blue-400" /> },
                { value: 'hide', label: 'Ocultar', icon: <EyeOff className="w-3.5 h-3.5 text-slate-400" /> },
              ]}
              onChange={(val) => setShowNameTags(val === 'show')}
              labelPrefix="Nomes:"
              buttonClassName="bg-[#2b2d31] hover:bg-[#34373d] border-[#383a40]"
              title="Mostrar ou ocultar nomes em cima do personagem e do pet"
            />
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-[#2b2d31] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3-Column Main Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* 1. LEFT SIDEBAR: CATEGORIES LIST */}
          <CategoryTabs activeCategory={activeCategory} onSelectCategory={setActiveCategory} />

          {/* 2. MIDDLE COLUMN: OPTIONS GRID */}
          <div className="flex-1 bg-[#2b2d31] flex flex-col justify-between p-5 overflow-hidden">
            {activeCategory === 'pet' ? (
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

          {/* 3. RIGHT COLUMN: 2D ROOM LIVE PREVIEW */}
          <AvatarPreviewCanvas
            isOpen={isOpen}
            avatar={avatar}
            name={name}
            status={status}
            localPlayer={localPlayer}
            onRandomize={handleRandomize}
            showNameTags={showNameTags}
          />
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-[#2b2d31] bg-[#18191c] flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 hover:bg-[#2b2d31] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-7 py-2.5 rounded-xl text-xs font-extrabold bg-[#3b82f6] hover:bg-blue-500 text-white shadow-lg shadow-blue-500/30 transition-all active:scale-95 flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>Feito</span>
          </button>
        </div>
      </div>

      {/* Pixel Art Drawing & Editing Studio Modal */}
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
