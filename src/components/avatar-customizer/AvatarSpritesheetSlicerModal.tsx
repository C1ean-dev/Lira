import { CharacterAnimationTabs } from './CharacterAnimationTabs'
import { characterAnimationTabs, activityTextureName } from '../../utils/characterAnimations'
import { RasterImage } from '../common/RasterImage'
import { setRasterImageSource } from '../../utils/rasterImageSource'
import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  X,
  Scissors,
  Download,
  Check,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
  Grid,
  FlipHorizontal,
  FileCode,
  CheckCircle,
  Play,
  Pause,
  Layers,
  Sparkles,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  ArrowRightLeft,
  GripVertical,
  Pipette,
  Wand2,
  Paintbrush,
} from 'lucide-react'
import { AvatarActivityAnimation, AvatarComponentSlot, Direction } from '../../types/game'
import { AssetSourceSheet, CustomAsset } from '../../types/customAsset'
import { loadAtlasImage } from '../../assets/atlasService'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useGameStore } from '../../store/useGameStore'
import { DEFAULT_AVATAR } from '../../engine/Constants'
import { AvatarPixelArtModal } from '../../editor/avatar/AvatarPixelArtModal'
import { resolveStudioHitbox, type SpriteCollision } from '../../utils/spriteHitbox'
import { generateSparrowXml, downloadFile, PackedSubTexture } from '../../engine/avatar/avatarAtlasExporter'
import { cropContentDataUrl } from '../../engine/avatar/avatarBakeService'
import {
  applyBackgroundRemoval,
  RGBColor,
  detectBackgroundColor,
  rgbToHex,
  hexToRgb,
} from '../../utils/imageTransparency'
import { convertAssetToSlicedPresets } from '../../utils/avatarAssetOrigin'
import { activitySequence } from '../../utils/avatarActivityAnimations'

export interface SlicedFrameSlot {
  x: number
  y: number
  w?: number
  h?: number
  dataUrl: string
  sheetId?: string
}

export interface SlicedPreset {
  id: string
  name: string
  directions: Record<Direction, SlicedFrameSlot[]>
  animations?: Partial<Record<AvatarActivityAnimation, SlicedFrameSlot[]>>
  animationNames?: Record<string, string>
}

interface Props {
  isOpen: boolean
  onClose: () => void
  imageSrc: string
  imageFileName?: string
  category: AvatarComponentSlot | 'furniture' | 'floor' | 'wall'
  onSaveComplete?: (createdAssets: CustomAsset[], xmlContent: string) => void
  editingAsset?: CustomAsset | null
}

const CATEGORY_LABELS: Record<string, string> = {
  hair: 'Cabelo',
  top: 'Parte de Cima',
  jacket: 'Jaqueta',
  bottom: 'Parte de Baixo',
  shoes: 'Sapatos',
  hat: 'Chapéu / Laço',
  glasses: 'Óculos',
  facialHair: 'Pelos Faciais',
  eyes: 'Olhos',
  skin: 'Maquiagem',
  other: 'Personagem',
  pet: 'Pet / Mascote',
  furniture: 'Mobília',
  floor: 'Piso',
  wall: 'Parede',
}

const DIRECTIONS: { id: Direction; label: string; icon: string }[] = [
  { id: 'down', label: 'Frente', icon: '⬇️' },
  { id: 'up', label: 'Costas', icon: '⬆️' },
  { id: 'left', label: 'Esquerda', icon: '⬅️' },
  { id: 'right', label: 'Direita', icon: '➡️' },
]

const emptyDirections = (): Record<Direction, SlicedFrameSlot[]> => ({ down: [], up: [], left: [], right: [] })

export const AvatarSpritesheetSlicerModal: React.FC<Props> = ({
  isOpen,
  onClose,
  imageSrc,
  imageFileName = 'spritesheet.png',
  category,
  onSaveComplete,
  editingAsset,
}) => {
  const [sourceSheets, setSourceSheets] = useState<AssetSourceSheet[]>(() => editingAsset?.sourceSheets?.length
    ? editingAsset.sourceSheets : [{ id: 'primary', name: imageFileName, src: imageSrc, width: 0, height: 0 }])
  const [activeSheetId, setActiveSheetId] = useState(() => editingAsset?.sourceSheets?.[0]?.id || 'primary')
  const activeSheet = sourceSheets.find(sheet => sheet.id === activeSheetId) || sourceSheets[0]
  const sourceFileInput = useRef<HTMLInputElement | null>(null)
  const [sheetError, setSheetError] = useState('')
  const [isAddingSheets, setIsAddingSheets] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const pendingFrame = useRef<SlicedFrameSlot | null>(null)
  const [activeAnimation, setActiveAnimation] = useState<'walk' | AvatarActivityAnimation>('walk')
  const [sourceImg, setSourceImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState<number>(0.5)
  const [showGrid, setShowGrid] = useState<boolean>(true)
  const [gridSnapSize, setGridSnapSize] = useState<number>(16)

  const [enableBgRemoval, setEnableBgRemoval] = useState<boolean>(false)
  const [targetColorHex, setTargetColorHex] = useState<string>('#21232a')
  const [tolerance, setTolerance] = useState<number>(25)
  const [isPickingColor, setIsPickingColor] = useState<boolean>(false)

  const [selection, setSelection] = useState<{ x: number; y: number; w: number; h: number }>(() => {
    const firstSlot =
      editingAsset?.slicerPresets?.[0]?.directions.down[0] ||
      editingAsset?.slicerPresets?.[0]?.directions.up[0] ||
      editingAsset?.slicerPresets?.[0]?.directions.left[0] ||
      editingAsset?.slicerPresets?.[0]?.directions.right[0]

    if (firstSlot && firstSlot.w && firstSlot.h) {
      return {
        x: firstSlot.x,
        y: firstSlot.y,
        w: firstSlot.w,
        h: firstSlot.h,
      }
    }
    return {
      x: 0,
      y: 0,
      w: editingAsset ? (editingAsset.width || 1) * 32 : 16,
      h: editingAsset ? (editingAsset.height || 1) * 32 : 16,
    }
  })
  const [selectedRegionDataUrl, setSelectedRegionDataUrl] = useState<string>('')

  const isSelectingRef = useRef<boolean>(false)
  const selectionStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const isMovingSelectionRef = useRef<boolean>(false)
  const moveOffsetRef = useRef<{ offsetX: number; offsetY: number }>({ offsetX: 0, offsetY: 0 })
  const [isHoveringSelection, setIsHoveringSelection] = useState<boolean>(false)

  const [draggedFrameIndex, setDraggedFrameIndex] = useState<number | null>(null)
  const [dragOverFrameIndex, setDragOverFrameIndex] = useState<number | null>(null)
  const [directionMenuIndex, setDirectionMenuIndex] = useState<number | null>(null)

  const [isPanning, setIsPanning] = useState<boolean>(false)
  const panStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({
    mouseX: 0,
    mouseY: 0,
    startX: 0,
    startY: 0,
  })
  const stageRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [allPresets, setAllPresets] = useState<SlicedPreset[]>(() => {
    if (editingAsset) {
      return convertAssetToSlicedPresets(editingAsset, editingAsset.sourceXmlContent)
    }
    return [
      {
        id: `preset_${Date.now()}`,
        name: `${CATEGORY_LABELS[category]} 1`,
        directions: {
          down: [],
          up: [],
          left: [],
          right: [],
        },
      },
    ]
  })

  // Existing frame editing operations work on the selected animation, while
  // the complete preset retains every sequence and its display name.
  const projectPreset = (preset: SlicedPreset): SlicedPreset => activeAnimation === 'walk' ? preset : {
    ...preset, directions: { ...emptyDirections(), down: activitySequence(preset.animations?.[activeAnimation]) },
  }
  const presets = allPresets.map(projectPreset)
  const setPresets = (update: React.SetStateAction<SlicedPreset[]>) => {
    setAllPresets(previous => {
      const projected = previous.map(projectPreset)
      const next = typeof update === 'function' ? update(projected) : update
      return next.map(preset => {
        if (activeAnimation === 'walk') return preset
        const original = previous.find(p => p.id === preset.id)
        return { ...preset, directions: original?.directions || emptyDirections(),
          animations: { ...original?.animations, [activeAnimation]: preset.directions.down } }
      })
    })
  }

  useEffect(() => {
    if (editingAsset) {
      const converted = convertAssetToSlicedPresets(editingAsset, editingAsset.sourceXmlContent)
      setAllPresets(converted)
      setActivePresetIndex(0)

      const firstSlot =
        converted[0]?.directions.down[0] ||
        converted[0]?.directions.up[0] ||
        converted[0]?.directions.left[0] ||
        converted[0]?.directions.right[0]

      if (firstSlot && firstSlot.w && firstSlot.h) {
        setSelection({
          x: firstSlot.x,
          y: firstSlot.y,
          w: firstSlot.w,
          h: firstSlot.h,
        })
        if (sourceImg) {
          sliceRegion(sourceImg, firstSlot.x, firstSlot.y, firstSlot.w, firstSlot.h)
        }
      }
    }
  }, [editingAsset])

  const [activePresetIndex, setActivePresetIndex] = useState<number>(0)
  const [walkingDirection, setActiveDirectionTab] = useState<Direction>('down')
  const activeDirectionTab = activeAnimation === 'walk' ? walkingDirection : 'down'
  useEffect(() => {
    if (!characterAnimationTabs(allPresets[activePresetIndex] || {}).some(animation => animation.id === activeAnimation)) setActiveAnimation('walk')
  }, [activePresetIndex, allPresets, activeAnimation])
  const [showXmlModal, setShowXmlModal] = useState<boolean>(false)
  const [savedSuccessCount, setSavedSuccessCount] = useState<number | null>(null)

  const [isPlayingWalk, setIsPlayingWalk] = useState<boolean>(true)
  const [walkTick, setWalkTick] = useState<number>(0)

  const [isPixelStudioOpen, setIsPixelStudioOpen] = useState<boolean>(false)

  const getCurrentDirectionalFrames = useCallback((): Record<Direction, string[]> => {
    const p = presets[activePresetIndex] || presets[0]

    const getDirectionList = (dir: Direction): string[] => {
      const slots = p?.directions?.[dir] || []
      const urls = slots.map((s) => s.dataUrl).filter(Boolean)
      if (urls.length > 0) return urls

      if (activeAnimation === 'walk' && editingAsset?.directionalFrames?.[dir]) {
        const raw = editingAsset.directionalFrames[dir]
        if (Array.isArray(raw)) {
          const filtered = raw.filter(Boolean)
          if (filtered.length > 0) return filtered
        } else if (raw) {
          return [raw]
        }
      }

      if (activeAnimation === 'walk' && dir === 'down') {
        if (editingAsset?.frames?.[0]) {
          return [editingAsset.frames[0]]
        }
        if (selectedRegionDataUrl) {
          return [selectedRegionDataUrl]
        }
      }

      return ['']
    }

    return {
      down: getDirectionList('down'),
      up: getDirectionList('up'),
      left: getDirectionList('left'),
      right: getDirectionList('right'),
    }
  }, [presets, activePresetIndex, editingAsset, selectedRegionDataUrl])

  const getStudioDimensions = useCallback(() => {
    let maxW = selection.w || 32
    let maxH = selection.h || 32
    const currentPreset = presets[activePresetIndex]
    if (currentPreset) {
      for (const dir of ['down', 'up', 'left', 'right'] as Direction[]) {
        const slots = currentPreset.directions[dir] || []
        for (const slot of slots) {
          if (slot.w && slot.w > maxW) maxW = slot.w
          if (slot.h && slot.h > maxH) maxH = slot.h
        }
      }
    }
    if (editingAsset?.pixelWidth && editingAsset.pixelWidth > maxW) {
      maxW = editingAsset.pixelWidth
    }
    if (editingAsset?.pixelHeight && editingAsset.pixelHeight > maxH) {
      maxH = editingAsset.pixelHeight
    }
    return {
      pixelWidth: maxW,
      pixelHeight: maxH,
      width: Math.max(1, Math.ceil(maxW / 32)),
      height: Math.max(1, Math.ceil(maxH / 32)),
    }
  }, [selection, presets, activePresetIndex, editingAsset])

  const handleSaveFromStudio = async (
    newDirectionalFrames: Record<Direction, string | string[]>,
    newName: string,
    options?: {
      width?: number
      height?: number
      pixelWidth?: number
      pixelHeight?: number
      isObstacle?: boolean
      category?: string
      spriteCollision?: SpriteCollision | null
    }
  ) => {
    const toArray = (v?: string | string[]): string[] => {
      if (!v) return []
      return Array.isArray(v) ? v.filter(Boolean) : [v]
    }

    const downFrames = toArray(newDirectionalFrames.down)
    const upFrames = toArray(newDirectionalFrames.up)
    const leftFrames = toArray(newDirectionalFrames.left)
    const rightFrames = toArray(newDirectionalFrames.right)

    const finalW = options?.pixelWidth || selection.w
    const finalH = options?.pixelHeight || selection.h

    const updateEditedPresets = (prev: SlicedPreset[]) =>
      prev.map((p, idx) => {
        if (idx !== activePresetIndex) return p
        return {
          ...p,
          name: newName || p.name,
          directions: {
            down: downFrames.map((url, i) => ({
              x: p.directions.down[i]?.x || 0,
              y: p.directions.down[i]?.y || 0,
              w: finalW,
              h: finalH,
              dataUrl: url,
              sheetId: p.directions.down[i]?.sheetId || activeSheetId,
            })),
            up: upFrames.map((url, i) => ({
              x: p.directions.up[i]?.x || 0,
              y: p.directions.up[i]?.y || 0,
              w: finalW,
              h: finalH,
              dataUrl: url,
              sheetId: p.directions.up[i]?.sheetId || activeSheetId,
            })),
            left: leftFrames.map((url, i) => ({
              x: p.directions.left[i]?.x || 0,
              y: p.directions.left[i]?.y || 0,
              w: finalW,
              h: finalH,
              dataUrl: url,
              sheetId: p.directions.left[i]?.sheetId || activeSheetId,
            })),
            right: rightFrames.map((url, i) => ({
              x: p.directions.right[i]?.x || 0,
              y: p.directions.right[i]?.y || 0,
              w: finalW,
              h: finalH,
              dataUrl: url,
              sheetId: p.directions.right[i]?.sheetId || activeSheetId,
            })),
          },
        }
      })
    const edited = updateEditedPresets(presets)[activePresetIndex]
    const updatedPresets = allPresets.map((preset, index) => index !== activePresetIndex ? preset : activeAnimation === 'walk' ? edited : {
      ...preset, name: edited.name, animations: { ...preset.animations, [activeAnimation]: edited.directions.down },
    })
    setAllPresets(updatedPresets)
    const activityAnimations = Object.fromEntries(Object.entries(updatedPresets[activePresetIndex]?.animations || {}).map(([id, frames]) => [id, activitySequence(frames).map(frame => frame.dataUrl)]))
    const activityAnimationNames = updatedPresets[activePresetIndex]?.animationNames || {}

    if (finalW > 0 && finalH > 0) {
      setSelection((prev) => ({ ...prev, w: finalW, h: finalH }))
    }

    if (editingAsset) {
      const store = useCustomAssetsStore.getState()
      if (activeAnimation !== 'walk') {
        await store.updateCustomAsset(editingAsset.id, {
          name: newName || editingAsset.name, activityAnimations, activityAnimationNames, sourceSheets,
          slicerPresets: updatedPresets,
        })
        setSavedSuccessCount(1)
        setIsPixelStudioOpen(false)
        return
      }
      const firstDown = downFrames[0] || ''
      const firstUp = upFrames[0] || ''
      const firstLeft = leftFrames[0] || ''
      const firstRight = rightFrames[0] || ''

      const thumbnail = await cropContentDataUrl(firstDown || firstUp || firstLeft || firstRight || '')

      const isObstacle = options?.isObstacle !== undefined ? options.isObstacle : editingAsset.isObstacle
      await store.updateCustomAsset(editingAsset.id, {
        name: newName || editingAsset.name,
        thumbnail,
        width: options?.width || Math.max(1, Math.ceil(finalW / 32)),
        height: options?.height || Math.max(1, Math.ceil(finalH / 32)),
        pixelWidth: finalW,
        pixelHeight: finalH,
        isObstacle,
        ...(editingAsset.type === 'furniture' ? resolveStudioHitbox(editingAsset, isObstacle, options?.spriteCollision) : {}),
        category: options?.category || editingAsset.category,
        directionalFrames: newDirectionalFrames,
        activityAnimations, activityAnimationNames, slicerPresets: updatedPresets, sourceSheets,
        frames: [firstDown, firstUp, firstLeft, firstRight],
      })

      const gameStore = useGameStore.getState()
      const currentAvatar = gameStore.localPlayer.avatar
      if (
        currentAvatar.customAvatarId === editingAsset.id ||
        currentAvatar.otherType === editingAsset.id ||
        category === 'other'
      ) {
        gameStore.setLocalPlayer({
          avatar: {
            ...currentAvatar,
            customComponents: {
              ...currentAvatar.customComponents,
              [category]: editingAsset.id,
            },
          },
        })
      }
    }

    setSavedSuccessCount(1)
    setIsPixelStudioOpen(false)
  }

  const sliceRegion = useCallback(
    (img: HTMLImageElement, x: number, y: number, w: number, h: number): string => {
      if (typeof document === 'undefined') return ''
      const safeW = Math.max(1, Math.floor(w))
      const safeH = Math.max(1, Math.floor(h))
      const canvas = document.createElement('canvas')
      canvas.width = safeW
      canvas.height = safeH
      const ctx = canvas.getContext('2d')
      if (!ctx) return ''
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, x, y, safeW, safeH, 0, 0, safeW, safeH)

      let resultCanvas: HTMLCanvasElement = canvas
      if (enableBgRemoval) {
        const rgb = hexToRgb(targetColorHex)
        resultCanvas = applyBackgroundRemoval(canvas, rgb, tolerance, true)
      }

      const dataUrl = resultCanvas.toDataURL('image/png')
      setSelectedRegionDataUrl(dataUrl)
      return dataUrl
    },
    [enableBgRemoval, targetColorHex, tolerance]
  )

  const fitSpritesheet = useCallback(() => {
    const stage = stageRef.current
    if (!stage || !sourceImg) return
    setZoom(Math.min(1, Math.max(0.01, Math.min(
      (stage.clientWidth - 64) / sourceImg.naturalWidth,
      (stage.clientHeight - 160) / sourceImg.naturalHeight,
    ))))
    viewportRef.current?.scrollTo(0, 0)
  }, [sourceImg])

  const fitToScreen = fitSpritesheet

  const handleAddSheets = async (files: FileList | null) => {
    if (!files?.length) return
    setIsAddingSheets(true)
    setSheetError('')
    try {
      const added: AssetSourceSheet[] = []
      for (const file of Array.from(files)) {
        if (file.type !== 'image/png') throw new Error('Selecione spritesheets no formato PNG.')
        const src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`))
          reader.readAsDataURL(file)
        })
        const image = await loadAtlasImage(src).catch(() => { throw new Error(`${file.name} não é um PNG válido ou não pôde ser aberto.`) })
        if (image.naturalWidth > 8192 || image.naturalHeight > 8192) throw new Error(`${file.name} excede o limite de 8192px por lado.`)
        added.push({ id: crypto.randomUUID(), name: file.name, src, width: image.naturalWidth, height: image.naturalHeight })
      }
      setSourceSheets(previous => [...previous, ...added])
      setActiveSheetId(added[0].id)
    } catch (error) {
      setSheetError(error instanceof Error ? error.message : 'Não foi possível adicionar os spritesheets.')
    } finally {
      setIsAddingSheets(false)
      if (sourceFileInput.current) sourceFileInput.current.value = ''
    }
  }

  useEffect(() => {
    if (isOpen) {
      fitSpritesheet()
    }
  }, [isOpen, fitSpritesheet])

  useEffect(() => {
    if (!activeSheet?.src) return
    let cancelled = false
    setSourceImg(null)
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setSourceImg(img)
      setSourceSheets(previous => previous.map(sheet => sheet.id === activeSheetId
        ? { ...sheet, width: img.naturalWidth, height: img.naturalHeight } : sheet))
      const firstSlot = pendingFrame.current ||
        Object.values(presets[activePresetIndex]?.directions || {}).flat().find(frame => (frame.sheetId || 'primary') === activeSheetId)
      pendingFrame.current = null

      if (firstSlot && firstSlot.w && firstSlot.h) {
        setSelection({
          x: firstSlot.x,
          y: firstSlot.y,
          w: firstSlot.w,
          h: firstSlot.h,
        })
      } else {
        setSelection(previous => ({ x: 0, y: 0, w: Math.min(previous.w, img.naturalWidth), h: Math.min(previous.h, img.naturalHeight) }))
      }
    }
    img.onerror = () => { if (!cancelled) setSheetError('Não foi possível abrir este spritesheet.') }
    setRasterImageSource(img, activeSheet.src)
    return () => { cancelled = true }
  }, [activeSheet?.src, activeSheetId])

  useEffect(() => {
    if (sourceImg) {
      sliceRegion(sourceImg, selection.x, selection.y, selection.w, selection.h)
    }
  }, [enableBgRemoval, targetColorHex, tolerance, sourceImg, selection, sliceRegion])

  const handleAutoDetectBg = useCallback(() => {
    if (!sourceImg) return
    let detected = detectBackgroundColor(sourceImg, selection)
    if (!detected) {
      detected = detectBackgroundColor(sourceImg)
    }
    if (detected) {
      const hex = rgbToHex(detected)
      setTargetColorHex(hex)
      setEnableBgRemoval(true)
      setIsPickingColor(false)
    }
  }, [sourceImg, selection])

  const handleToggleEyedropper = async () => {
    if (typeof window !== 'undefined' && (window as any).EyeDropper) {
      try {
        const dropper = new (window as any).EyeDropper()
        const res = await dropper.open()
        if (res?.sRGBHex) {
          setTargetColorHex(res.sRGBHex)
          setEnableBgRemoval(true)
          setIsPickingColor(false)
          return
        }
      } catch {
      }
    }
    setIsPickingColor((prev) => !prev)
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPickingColor) {
        setIsPickingColor(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPickingColor])

  useEffect(() => {
    if (!isPlayingWalk) {
      setWalkTick(0)
      return
    }
    const interval = setInterval(() => {
      setWalkTick((t) => (t + 1) % 1000)
    }, 180)
    return () => clearInterval(interval)
  }, [isPlayingWalk])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        const multiplier = e.deltaY < 0 ? 1.15 : 0.85
        setZoom((prevZoom) => {
          const next = Math.round(prevZoom * multiplier * 100) / 100
          return Math.max(0.01, Math.min(10, next))
        })
      }
    }

    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => stage.removeEventListener('wheel', handleWheel)
  }, [isOpen])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !sourceImg) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = sourceImg.naturalWidth || sourceImg.width
    canvas.height = sourceImg.naturalHeight || sourceImg.height

    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(sourceImg, 0, 0)

    if (showGrid && gridSnapSize > 0) {
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'

      for (let x = 0; x <= canvas.width; x += gridSnapSize) {
        ctx.beginPath()
        ctx.moveTo(x + 0.5, 0)
        ctx.lineTo(x + 0.5, canvas.height)
        ctx.stroke()
      }

      for (let y = 0; y <= canvas.height; y += gridSnapSize) {
        ctx.beginPath()
        ctx.moveTo(0, y + 0.5)
        ctx.lineTo(canvas.width, y + 0.5)
        ctx.stroke()
      }
    }

    const activePreset = presets[activePresetIndex]
    if (activePreset) {
      DIRECTIONS.forEach(({ id: dir }) => {
        const frames = activePreset.directions[dir] || []
        frames.forEach((frame, idx) => {
          if ((frame.sheetId || 'primary') !== activeSheetId) return
          const fw = frame.w || 16
          const fh = frame.h || 16
          ctx.fillStyle = dir === activeDirectionTab ? 'rgba(59, 130, 246, 0.35)' : 'rgba(16, 185, 129, 0.3)'
          ctx.fillRect(frame.x, frame.y, fw, fh)
          ctx.strokeStyle = dir === activeDirectionTab ? '#60a5fa' : '#10b981'
          ctx.lineWidth = 2
          ctx.strokeRect(frame.x + 0.5, frame.y + 0.5, fw - 1, fh - 1)

          ctx.fillStyle = dir === activeDirectionTab ? '#3b82f6' : '#10b981'
          ctx.fillRect(frame.x, frame.y, 24, 11)
          ctx.fillStyle = '#ffffff'
          ctx.font = 'bold 8px sans-serif'
          ctx.fillText(activeAnimation === 'walk' ? `${dir[0].toUpperCase()}${idx}` : `${idx + 1}`, frame.x + 2, frame.y + 9)
        })
      })
    }

    ctx.lineWidth = 2
    ctx.strokeStyle = '#f59e0b'
    ctx.fillStyle = 'rgba(245, 158, 11, 0.22)'
    ctx.fillRect(selection.x, selection.y, selection.w, selection.h)
    ctx.strokeRect(selection.x + 0.5, selection.y + 0.5, selection.w - 1, selection.h - 1)

    const tagText = `${selection.w}×${selection.h}px`
    ctx.fillStyle = '#f59e0b'
    const tagW = tagText.length * 6.2 + 8
    const tagY = Math.max(0, selection.y - 14)
    ctx.fillRect(selection.x, tagY, tagW, 13)
    ctx.fillStyle = '#000000'
    ctx.font = 'bold 8px sans-serif'
    ctx.fillText(tagText, selection.x + 4, tagY + 9)
  }, [sourceImg, showGrid, gridSnapSize, selection, presets, activePresetIndex, activeDirectionTab, activeSheetId])

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!sourceImg) return
    const canvas = canvasRef.current
    if (!canvas) return

    if (e.button === 2 || e.button === 1) {
      e.preventDefault()
      setIsPanning(true)
      panStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        startX: viewportRef.current?.scrollLeft || 0,
        startY: viewportRef.current?.scrollTop || 0,
      }
      return
    }

    if (e.button === 0) {
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height

      const clientX = (e.clientX - rect.left) * scaleX
      const clientY = (e.clientY - rect.top) * scaleY

      if (isPickingColor) {
        e.preventDefault()
        e.stopPropagation()
        const cx = Math.max(0, Math.min(canvas.width - 1, Math.floor(clientX)))
        const cy = Math.max(0, Math.min(canvas.height - 1, Math.floor(clientY)))
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const p = ctx.getImageData(cx, cy, 1, 1).data
          const hex = rgbToHex({ r: p[0], g: p[1], b: p[2] })
          setTargetColorHex(hex)
          setEnableBgRemoval(true)
        }
        setIsPickingColor(false)
        return
      }

      const isInside =
        clientX >= selection.x &&
        clientX <= selection.x + selection.w &&
        clientY >= selection.y &&
        clientY <= selection.y + selection.h

      if (isInside && !e.shiftKey) {
        isMovingSelectionRef.current = true
        moveOffsetRef.current = {
          offsetX: clientX - selection.x,
          offsetY: clientY - selection.y,
        }
        return
      }

      const snap = Math.max(1, gridSnapSize)
      const tileX = Math.max(0, Math.min(canvas.width - snap, Math.floor(clientX / snap) * snap))
      const tileY = Math.max(0, Math.min(canvas.height - snap, Math.floor(clientY / snap) * snap))

      isSelectingRef.current = true
      selectionStartRef.current = { x: tileX, y: tileY }

      const currentW = Math.max(4, Math.min(selection.w || snap, canvas.width - tileX))
      const currentH = Math.max(4, Math.min(selection.h || snap, canvas.height - tileY))

      setSelection({ x: tileX, y: tileY, w: currentW, h: currentH })
      sliceRegion(sourceImg, tileX, tileY, currentW, currentH)
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.mouseX
      const dy = e.clientY - panStartRef.current.mouseY
      viewportRef.current?.scrollTo(panStartRef.current.startX - dx, panStartRef.current.startY - dy)
      return
    }

    if (!canvasRef.current || !sourceImg) return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    const clientX = (e.clientX - rect.left) * scaleX
    const clientY = (e.clientY - rect.top) * scaleY

    if (isMovingSelectionRef.current) {
      const snap = Math.max(1, gridSnapSize)
      const rawX = clientX - moveOffsetRef.current.offsetX
      const rawY = clientY - moveOffsetRef.current.offsetY

      const targetX = Math.max(0, Math.min(canvas.width - selection.w, Math.floor(rawX / snap) * snap))
      const targetY = Math.max(0, Math.min(canvas.height - selection.h, Math.floor(rawY / snap) * snap))

      setSelection((prev) => ({
        ...prev,
        x: targetX,
        y: targetY,
      }))
      return
    }

    if (isSelectingRef.current) {
      const snap = Math.max(1, gridSnapSize)
      const curTileX = Math.max(0, Math.min(canvas.width - snap, Math.floor(clientX / snap) * snap))
      const curTileY = Math.max(0, Math.min(canvas.height - snap, Math.floor(clientY / snap) * snap))

      const minX = Math.min(selectionStartRef.current.x, curTileX)
      const minY = Math.min(selectionStartRef.current.y, curTileY)
      const maxX = Math.max(selectionStartRef.current.x, curTileX) + snap
      const maxY = Math.max(selectionStartRef.current.y, curTileY) + snap

      const newW = maxX - minX
      const newH = maxY - minY

      setSelection({ x: minX, y: minY, w: newW, h: newH })
      return
    }

    const isInside =
      clientX >= selection.x &&
      clientX <= selection.x + selection.w &&
      clientY >= selection.y &&
      clientY <= selection.y + selection.h
    setIsHoveringSelection(isInside)
  }

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false)
    }
    if (isMovingSelectionRef.current && sourceImg) {
      isMovingSelectionRef.current = false
      sliceRegion(sourceImg, selection.x, selection.y, selection.w, selection.h)
    }
    if (isSelectingRef.current && sourceImg) {
      isSelectingRef.current = false
      sliceRegion(sourceImg, selection.x, selection.y, selection.w, selection.h)
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || !sourceImg) return
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        const step = Math.max(1, gridSnapSize)
        setSelection((prev) => {
          let nx = prev.x
          let ny = prev.y
          if (e.key === 'ArrowLeft') nx = Math.max(0, prev.x - step)
          if (e.key === 'ArrowRight') nx = Math.min(sourceImg.naturalWidth - prev.w, prev.x + step)
          if (e.key === 'ArrowUp') ny = Math.max(0, prev.y - step)
          if (e.key === 'ArrowDown') ny = Math.min(sourceImg.naturalHeight - prev.h, prev.y + step)
          const updated = { ...prev, x: nx, y: ny }
          sliceRegion(sourceImg, nx, ny, prev.w, prev.h)
          return updated
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, sourceImg, gridSnapSize, sliceRegion])

  const setExactDimensions = (w: number, h: number) => {
    if (!sourceImg) return
    const maxW = sourceImg.naturalWidth - selection.x
    const maxH = sourceImg.naturalHeight - selection.y
    const targetW = Math.max(1, Math.min(w, maxW))
    const targetH = Math.max(1, Math.min(h, maxH))

    const updated = {
      ...selection,
      w: targetW,
      h: targetH,
    }
    setSelection(updated)
    sliceRegion(sourceImg, updated.x, updated.y, updated.w, updated.h)
  }

  const handleUpdateGridSize = (newGridSize: number) => {
    const maxLimit = Math.max(sourceImg?.naturalWidth || 64, sourceImg?.naturalHeight || 64, 4096)
    const safeSize = Math.max(1, Math.min(maxLimit, Math.round(newGridSize)))
    setGridSnapSize(safeSize)

    if (sourceImg) {
      const maxW = sourceImg.naturalWidth
      const maxH = sourceImg.naturalHeight
      const targetW = Math.min(safeSize, maxW)
      const targetH = Math.min(safeSize, maxH)

      const snappedX = Math.max(0, Math.min(maxW - targetW, Math.floor(selection.x / safeSize) * safeSize))
      const snappedY = Math.max(0, Math.min(maxH - targetH, Math.floor(selection.y / safeSize) * safeSize))

      const updated = {
        x: snappedX,
        y: snappedY,
        w: targetW,
        h: targetH,
      }
      setSelection(updated)
      sliceRegion(sourceImg, updated.x, updated.y, updated.w, updated.h)
    } else {
      setSelection((prev) => ({
        ...prev,
        w: safeSize,
        h: safeSize,
      }))
    }
  }

  const handleAddSequentialFrames = (dir: Direction) => {
    if (!sourceImg) return
    const newFrames: SlicedFrameSlot[] = sequentialRegions.map(region => ({
      ...region,
      sheetId: activeSheetId,
      dataUrl: sliceRegion(sourceImg, region.x, region.y, region.w, region.h),
    }))

    setPresets((prev) => {
      const updated = [...prev]
      const current = { ...updated[activePresetIndex] }
      const existing = current.directions[dir] || []
      current.directions = {
        ...current.directions,
        [dir]: [...existing, ...newFrames],
      }
      updated[activePresetIndex] = current
      return updated
    })
  }

  const handleAddCompositeFrame = (dir: Direction) => {
    if (!sourceImg) return
    const dataUrl = sliceRegion(sourceImg, selection.x, selection.y, selection.w, selection.h)

    setPresets((prev) => {
      const updated = [...prev]
      const current = { ...updated[activePresetIndex] }
      const existing = current.directions[dir] || []
      current.directions = {
        ...current.directions,
        [dir]: [
          ...existing,
          {
            x: selection.x,
            y: selection.y,
            w: selection.w,
            h: selection.h,
            dataUrl,
            sheetId: activeSheetId,
          },
        ],
      }
      updated[activePresetIndex] = current
      return updated
    })
  }

  const handleRemoveDirectionFrame = (dir: Direction, frameIndex: number) => {
    setPresets((prev) => {
      const updated = [...prev]
      const current = { ...updated[activePresetIndex] }
      const existing = current.directions[dir] || []
      current.directions = {
        ...current.directions,
        [dir]: existing.filter((_, idx) => idx !== frameIndex),
      }
      updated[activePresetIndex] = current
      return updated
    })
  }

  const handleMoveFrameOrder = (dir: Direction, fromIndex: number, toIndex: number) => {
    setPresets((prev) => {
      const updated = [...prev]
      const current = { ...updated[activePresetIndex] }
      const list = [...(current.directions[dir] || [])]
      if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) {
        return prev
      }
      const [item] = list.splice(fromIndex, 1)
      list.splice(toIndex, 0, item)
      current.directions = {
        ...current.directions,
        [dir]: list,
      }
      updated[activePresetIndex] = current
      return updated
    })
  }

  const handleMoveFrameToDirection = (fromDir: Direction, frameIndex: number, targetDir: Direction) => {
    if (fromDir === targetDir) return
    setPresets((prev) => {
      const updated = [...prev]
      const current = { ...updated[activePresetIndex] }
      const sourceList = [...(current.directions[fromDir] || [])]
      if (frameIndex < 0 || frameIndex >= sourceList.length) return prev
      const [item] = sourceList.splice(frameIndex, 1)
      const targetList = [...(current.directions[targetDir] || []), item]
      current.directions = {
        ...current.directions,
        [fromDir]: sourceList,
        [targetDir]: targetList,
      }
      updated[activePresetIndex] = current
      return updated
    })
    setDirectionMenuIndex(null)
  }

  const handleMirrorLateral = (fromDir: 'left' | 'right', toDir: 'left' | 'right') => {
    const currentPreset = presets[activePresetIndex]
    const sourceFrames = currentPreset?.directions[fromDir] || []
    if (sourceFrames.length === 0) return

    const mirroredFrames: SlicedFrameSlot[] = sourceFrames.map((f) => {
      const canvas = document.createElement('canvas')
      const fw = f.w || 16
      const fh = f.h || 16
      canvas.width = fw
      canvas.height = fh
      const ctx = canvas.getContext('2d')
      if (!ctx) return f

      const img = new Image()
      setRasterImageSource(img, f.dataUrl)
      ctx.imageSmoothingEnabled = false
      ctx.translate(fw, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0)

      return {
        ...f,
        x: f.x,
        y: f.y,
        w: fw,
        h: fh,
        dataUrl: canvas.toDataURL('image/png'),
      }
    })

    setPresets((prev) => {
      const updated = [...prev]
      const current = { ...updated[activePresetIndex] }
      current.directions = {
        ...current.directions,
        [toDir]: mirroredFrames,
      }
      updated[activePresetIndex] = current
      return updated
    })
  }

  const handleAddNewPreset = () => {
    const newIdx = presets.length + 1
    const newPreset: SlicedPreset = {
      id: `preset_${Date.now()}_${newIdx}`,
      name: `${CATEGORY_LABELS[category]} ${newIdx}`,
      directions: {
        down: [],
        up: [],
        left: [],
        right: [],
      },
    }
    setPresets([...presets, newPreset])
    setActivePresetIndex(presets.length)
  }

  const handleRemovePreset = (idx: number) => {
    if (presets.length <= 1) return
    const next = presets.filter((_, i) => i !== idx)
    setPresets(next)
    setActivePresetIndex(Math.max(0, idx - 1))
  }

  const generateXmlString = (): string => {
    const subTextures: PackedSubTexture[] = []
    const imagePath = sourceSheets.length > 1 ? `${imageFileName.replace(/\.[^/.]+$/, '')}_combined.png` : sourceSheets[0].name
    const offsets = new Map<string, number>()
    let offset = 0
    for (const sheet of sourceSheets) { offsets.set(sheet.id, offset); offset += sheet.height }

    allPresets.forEach((preset) => {
      const cleanName = (preset.name || 'custom').toLowerCase().replace(/[^a-z0-9]/g, '_')
      for (const animation of characterAnimationTabs(preset)) {
        const directions: Partial<Record<Direction, SlicedFrameSlot[]>> = animation.id === 'walk' ? preset.directions : { down: activitySequence(preset.animations?.[animation.id]) }
        const frameDirections = animation.id === 'walk' ? DIRECTIONS : DIRECTIONS.filter(direction => direction.id === 'down')
        frameDirections.forEach(({ id: dir }) => {
          const frames = directions?.[dir] || []
          frames.forEach((frame, idx) => {
            subTextures.push({
              name: animation.id === 'walk' ? `${category}_${cleanName}_${dir}_${idx}` : activityTextureName(category, cleanName, animation.id, animation.label, idx),
              x: frame.x,
              y: frame.y + (offsets.get(frame.sheetId || 'primary') || 0),
              width: frame.w || 16,
              height: frame.h || 16,
            })
          })
        })
      }
    })

    return generateSparrowXml(imagePath, subTextures)
  }

  const handleDownloadXml = async () => {
    setSheetError('')
    try {
      const xml = generateXmlString()
      const xmlFileName = imageFileName.replace(/\.[^/.]+$/, '') + '.xml'
      if (sourceSheets.length > 1) {
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(...sourceSheets.map(sheet => sheet.width))
        canvas.height = sourceSheets.reduce((height, sheet) => height + sheet.height, 0)
        if (canvas.width > 16384 || canvas.height > 16384) throw new Error('As folhas combinadas excedem o limite de exportação de 16384px.')
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Não foi possível preparar o PNG combinado.')
        let offset = 0
        for (const sheet of sourceSheets) { ctx.drawImage(await loadAtlasImage(sheet.src), 0, offset); offset += sheet.height }
        downloadFile(`${imageFileName.replace(/\.[^/.]+$/, '')}_combined.png`, canvas.toDataURL('image/png'), 'image/png')
      }
      downloadFile(xmlFileName, xml, 'application/xml')
    } catch (error) { setSheetError(error instanceof Error ? error.message : 'Não foi possível exportar as folhas.') }
  }

  const handleSaveAndEquip = async () => {
    setIsSaving(true)
    setSheetError('')
    try {
      const createdAssets: CustomAsset[] = []
      const store = useCustomAssetsStore.getState()

      for (const p of allPresets) {
        const directionalFrames: Record<Direction, string | string[]> = {
          down: '',
          up: '',
          left: '',
          right: '',
        }

        const allFramesList: string[] = []

        DIRECTIONS.forEach(({ id: dir }) => {
          const fList = p.directions[dir] || []
          if (fList.length === 1) {
            directionalFrames[dir] = fList[0].dataUrl
            allFramesList.push(fList[0].dataUrl)
          } else if (fList.length > 1) {
            directionalFrames[dir] = fList.map((f) => f.dataUrl)
            allFramesList.push(...fList.map((f) => f.dataUrl))
          }
        })

        if (allFramesList.length === 0) continue

        const firstDown = Array.isArray(directionalFrames.down)
          ? directionalFrames.down[0]
          : directionalFrames.down || allFramesList[0]

        const thumbnail = await cropContentDataUrl(firstDown)
        const baseFrame = DIRECTIONS.flatMap(({ id }) => p.directions[id]).find(Boolean)
        const pixelWidth = baseFrame?.w || selection.w
        const pixelHeight = baseFrame?.h || selection.h
        const activityAnimations = Object.fromEntries(Object.entries(p.animations || {}).map(([animation, frames]) => [
          animation, activitySequence(frames).map(frame => frame.dataUrl),
        ]))

        if (editingAsset) {
          await store.updateCustomAsset(editingAsset.id, {
            name: p.name.trim() || editingAsset.name,
            thumbnail,
            width: Math.max(1, Math.ceil(pixelWidth / 32)),
            height: Math.max(1, Math.ceil(pixelHeight / 32)),
            pixelWidth,
            pixelHeight,
            frames: [
              Array.isArray(directionalFrames.down) ? directionalFrames.down[0] : (directionalFrames.down || ''),
              Array.isArray(directionalFrames.up) ? directionalFrames.up[0] : (directionalFrames.up || ''),
              Array.isArray(directionalFrames.left) ? directionalFrames.left[0] : (directionalFrames.left || ''),
              Array.isArray(directionalFrames.right) ? directionalFrames.right[0] : (directionalFrames.right || ''),
            ],
            directionalFrames,
            activityAnimations,
            activityAnimationNames: p.animationNames || {},
            creationSource: 'slicer',
            sourceImageSrc: sourceSheets[0].src,
            sourceSheets,
            sourceFileName: imageFileName,
            slicerPresets: [p],
          })
          const updated = useCustomAssetsStore.getState().customAssets.find((a) => a.id === editingAsset.id) || {
            ...editingAsset,
            name: p.name.trim() || editingAsset.name,
            thumbnail,
            directionalFrames,
            activityAnimations,
            activityAnimationNames: p.animationNames || {},
          }
          createdAssets.push(updated)
        } else {
          const isMapAsset = category === 'furniture' || category === 'floor' || category === 'wall'
          const assetType = isMapAsset ? category : 'avatar'
          const avatarSlot = isMapAsset ? undefined : (category as AvatarComponentSlot)
          const isObstacle = category === 'furniture' || category === 'wall'

          const asset: CustomAsset = {
            id: `${assetType}_${category}_sliced_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: p.name.trim() || `Preset ${CATEGORY_LABELS[category] || 'Custom'}`,
            type: assetType,
            category: 'Geral',
            avatarSlot,
            thumbnail,
            width: Math.max(1, Math.ceil(pixelWidth / 32)),
            height: Math.max(1, Math.ceil(pixelHeight / 32)),
            pixelWidth,
            pixelHeight,
            isObstacle,
            frames: [
              Array.isArray(directionalFrames.down) ? directionalFrames.down[0] : (directionalFrames.down || ''),
              Array.isArray(directionalFrames.up) ? directionalFrames.up[0] : (directionalFrames.up || ''),
              Array.isArray(directionalFrames.left) ? directionalFrames.left[0] : (directionalFrames.left || ''),
              Array.isArray(directionalFrames.right) ? directionalFrames.right[0] : (directionalFrames.right || ''),
            ],
            directionalFrames,
            activityAnimations,
            activityAnimationNames: p.animationNames || {},
            frameRateMs: 160,
            createdAt: Date.now(),
            creationSource: 'slicer',
            sourceImageSrc: sourceSheets[0].src,
            sourceSheets,
            sourceFileName: imageFileName,
            slicerPresets: [p],
          }

          createdAssets.push(asset)
        }
      }

      if (!editingAsset) await store.addCustomAssets(createdAssets)

      setSavedSuccessCount(createdAssets.length)
      if (onSaveComplete) {
        onSaveComplete(createdAssets, generateXmlString())
      }

      setTimeout(() => {
        onClose()
      }, 1200)
    } catch (error) {
      setSheetError(error instanceof Error ? error.message : 'Não foi possível salvar os spritesheets.')
    } finally { setIsSaving(false) }
  }

  if (!isOpen) return null

  const activePreset = presets[activePresetIndex]
  const animations = characterAnimationTabs(allPresets[activePresetIndex] || {})
  const activeDirectionFrames = activePreset?.directions[activeDirectionTab] || []

  const currentPreviewFrame =
    activeDirectionFrames.length > 0
      ? isPlayingWalk
        ? activeDirectionFrames[walkTick % activeDirectionFrames.length]?.dataUrl
        : activeDirectionFrames[0]?.dataUrl
      : selectedRegionDataUrl

  // Only complete frames on the selected row belong to a horizontal sequence.
  const sequenceCount = sourceImg && selection.w > 0 && selection.h > 0 && selection.x >= 0 &&
    selection.y >= 0 && selection.y + selection.h <= sourceImg.naturalHeight
    ? Math.max(0, Math.floor((sourceImg.naturalWidth - selection.x) / selection.w))
    : 0
  const sequentialRegions = Array.from({ length: sequenceCount }, (_, index) => ({
    x: selection.x + index * selection.w,
    y: selection.y,
    w: selection.w,
    h: selection.h,
  }))

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-lira-ground/80 p-4 select-none font-mono text-lira-ink"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="bg-lira-panel border border-dashed border-lira-rule w-full max-w-7xl h-[92vh] rounded-[12px] flex flex-col overflow-hidden">
        <div className="px-6 py-3 border-b border-dashed border-lira-rule/60 flex items-center justify-between bg-lira-sidebar">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[8px] bg-lira-surface border border-lira-rule flex items-center justify-center text-lira-accent">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-display font-bold text-lira-accent flex items-center gap-2">
                {editingAsset ? `Editar: ${editingAsset.name}` : 'Fatiador com Seletor Livre (Qualquer Tamanho)'}
                <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-[6px] bg-lira-surface text-lira-accent border border-lira-rule">
                  {CATEGORY_LABELS[category]}
                </span>
                {editingAsset && (
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-[6px] bg-lira-ground text-lira-accent border border-lira-rule">
                    Modo Edição
                  </span>
                )}
              </h2>
              <p className="text-xs font-mono text-lira-muted">
                {editingAsset
                  ? 'Reorganize frames, recorte novos passos da folha ou ajuste as direções deste personagem.'
                  : 'Recorte sprites de qualquer dimensão (16×16, 32×32, 64×64, 128×128 ou o tamanho máximo da folha).'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPixelStudioOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[8px] bg-lira-accent hover:bg-lira-ink text-lira-ground text-xs font-mono font-bold border-2 border-lira-accent hover:border-lira-ink transition-colors cursor-pointer"
              title="Pintar e editar os pixels deste personagem no Estúdio Pixel Art"
            >
              <Paintbrush className="w-4 h-4" />
              <span>Pintar</span>
            </button>

            <button
              type="button"
              onClick={() => setShowXmlModal(true)}
              disabled={!sourceImg || isAddingSheets}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-accent text-lira-muted hover:text-lira-ink text-xs font-mono font-semibold border border-lira-rule transition-colors cursor-pointer"
            >
              <FileCode className="w-4 h-4 text-lira-accent" />
              <span>Ver XML Gerado</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadXml}
              disabled={!sourceImg || isAddingSheets}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-online text-lira-muted hover:text-lira-ink text-xs font-mono font-semibold border border-lira-rule transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4 text-lira-online" />
              <span>Baixar .xml</span>
            </button>

            <div className="w-px h-6 bg-lira-quiet mx-1" />

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-[8px] bg-lira-surface border border-lira-rule hover:border-lira-accent text-lira-muted hover:text-lira-ink flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div
            ref={stageRef}
            data-spritesheet-stage
            className="flex-1 min-w-0 min-h-0 relative bg-lira-ground overflow-hidden cursor-crosshair"
          >
            <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5 bg-lira-sidebar border border-lira-rule p-1.5 rounded-[8px]">
              <button
                type="button"
                onClick={() =>
                  setZoom((z) => {
                    const step = z <= 0.2 ? 0.02 : z <= 0.5 ? 0.05 : z <= 1 ? 0.1 : 0.25
                    return Math.max(0.01, Math.round((z - step) * 100) / 100)
                  })
                }
                className="w-8 h-8 rounded-[6px] hover:bg-lira-surface text-lira-muted hover:text-lira-ink flex items-center justify-center transition-colors cursor-pointer"
                title="Diminuir Zoom"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono font-bold text-lira-ink px-2 min-w-[45px] text-center tabular-nums">
                {zoom < 1 ? zoom.toFixed(2) : zoom}x
              </span>
              <button
                type="button"
                onClick={() =>
                  setZoom((z) => {
                    const step = z < 0.2 ? 0.02 : z < 0.5 ? 0.05 : z < 1 ? 0.1 : 0.25
                    return Math.min(10, Math.round((z + step) * 100) / 100)
                  })
                }
                className="w-8 h-8 rounded-[6px] hover:bg-lira-surface text-lira-muted hover:text-lira-ink flex items-center justify-center transition-colors cursor-pointer"
                title="Aumentar Zoom"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={fitSpritesheet}
                className="flex items-center gap-1.5 px-2 py-1 rounded-[6px] text-xs font-mono font-semibold text-lira-muted hover:bg-lira-surface hover:text-lira-ink"
                title="Ajustar spritesheet à área de edição"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Ajustar</span>
              </button>
              <div className="w-px h-4 bg-lira-quiet mx-1" />
              <button
                type="button"
                onClick={() => setShowGrid(!showGrid)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-xs font-mono font-semibold transition-colors cursor-pointer ${
                  showGrid ? 'bg-lira-accent text-lira-ground' : 'hover:bg-lira-surface text-lira-muted hover:text-lira-ink'
                }`}
                title="Alternar Grade"
              >
                <Grid className="w-3.5 h-3.5" />
                <span>Grade {gridSnapSize}px</span>
              </button>
            </div>

            {isPickingColor ? (
              <div className="absolute bottom-4 z-10 flex items-center gap-2 bg-lira-amber text-lira-ground font-mono font-bold px-4 py-2 rounded-[8px] text-xs">
                <Pipette className="w-4 h-4" />
                <span>Conta-gotas ativo: Clique em qualquer ponto da imagem para selecionar a cor de fundo!</span>
                <button
                  type="button"
                  onClick={() => setIsPickingColor(false)}
                  className="ml-2 px-2 py-0.5 rounded-[6px] bg-lira-ground/30 hover:bg-lira-ground/50 text-lira-ground text-[10px]"
                >
                  Cancelar (Esc)
                </button>
              </div>
            ) : (
              <div className="absolute bottom-4 left-4 right-4 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 bg-lira-sidebar border border-lira-rule px-4 py-2 rounded-[8px] text-xs font-mono text-lira-muted pointer-events-none">
                <span>
                  Seleção:{' '}
                  <strong className="text-lira-ink">
                    x: {selection.x}, y: {selection.y} ({selection.w}×{selection.h}px)
                  </strong>
                </span>
                <div className="w-px h-3 bg-lira-quiet" />
                <span>🖱️ Arraste dentro da seleção ou use setas do teclado para movê-la</span>
                <span>•</span>
                <span>🔍 Ctrl + Scroll: Zoom</span>
                <span>•</span>
                <span>🖱️ Botão Direito: Mover tela</span>
              </div>
            )}

            <div ref={viewportRef} className="absolute inset-0 overflow-auto">
              <div className="min-w-full min-h-full w-max flex items-center justify-center px-6 pt-20 pb-20">
                <div
                  style={{ width: (sourceImg?.naturalWidth || 0) * zoom, height: (sourceImg?.naturalHeight || 0) * zoom }}
                  className="relative shrink-0 outline outline-1 outline-lira-rule"
                >
                  <canvas
                    ref={canvasRef}
                    onMouseDown={handleCanvasMouseDown}
                    style={{ width: '100%', height: '100%' }}
                    className={`block [image-rendering:pixelated] ${
                      isPickingColor ? 'cursor-crosshair' : isHoveringSelection ? 'cursor-move' : 'cursor-crosshair'
                    }`}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="w-96 shrink-0 border-l border-lira-quiet bg-lira-sidebar flex flex-col p-4 gap-3.5 overflow-y-auto">
            <div className="flex flex-col gap-2 bg-lira-panel border border-lira-quiet p-3 rounded-[12px]">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="slicer-source-sheet" className="text-[11px] font-mono font-bold text-lira-muted uppercase tracking-wider">Spritesheets ({sourceSheets.length})</label>
                <button type="button" onClick={() => sourceFileInput.current?.click()} disabled={isAddingSheets}
                  className="flex items-center gap-1 px-2 py-1 rounded-[6px] bg-lira-surface hover:bg-lira-accent text-lira-accent hover:text-lira-ground border border-lira-rule text-[11px] font-mono font-bold disabled:opacity-50">
                  <Plus className="w-3 h-3" />{isAddingSheets ? 'Adicionando…' : 'Adicionar'}
                </button>
              </div>
              <select id="slicer-source-sheet" value={activeSheetId} onChange={event => setActiveSheetId(event.target.value)}
                className="w-full min-w-0 bg-lira-ground border border-lira-rule text-lira-ink font-mono text-xs px-3 py-2 rounded-[8px]">
                {sourceSheets.map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}
              </select>
              <input ref={sourceFileInput} type="file" accept="image/png" multiple className="hidden" aria-label="Adicionar spritesheets PNG" onChange={event => void handleAddSheets(event.target.files)} />
              {sheetError && <p role="alert" className="text-xs font-mono text-lira-error">{sheetError}</p>}
            </div>
            <div className="flex flex-col gap-2.5 bg-lira-panel border border-lira-quiet p-3 rounded-[12px]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-lira-accent" />
                  <span className="text-[11px] font-mono font-bold text-lira-muted uppercase tracking-wider">
                    Remoção de Fundo
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableBgRemoval}
                    onChange={(e) => setEnableBgRemoval(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-lira-ground border border-lira-rule peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-lira-ground after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-lira-ink peer-checked:after:bg-lira-ground after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-lira-accent"></div>
                </label>
              </div>

              {enableBgRemoval && (
                <div className="flex flex-col gap-2.5 pt-1 border-t border-dashed border-lira-rule/60">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleAutoDetectBg}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-[8px] bg-lira-accent hover:bg-lira-ink text-lira-ground text-xs font-mono font-bold transition-colors cursor-pointer"
                      title="Detecta automaticamente a cor de fundo analisando as bordas e cantos da imagem e a remove"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      <span>Modo Automático</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleEyedropper}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-[8px] text-xs font-mono font-bold border transition-colors cursor-pointer ${
                        isPickingColor
                          ? 'bg-lira-amber text-lira-ground border-lira-amber'
                          : 'bg-lira-surface hover:border-lira-accent text-lira-ink border-lira-rule'
                      }`}
                      title="Clique para ativar o conta-gotas e selecionar a cor diretamente na imagem"
                    >
                      <Pipette className="w-3.5 h-3.5 text-lira-accent" />
                      <span>{isPickingColor ? 'Clique...' : 'Conta-gotas'}</span>
                    </button>

                    <div className="relative group/picker shrink-0">
                      <div
                        className="w-7 h-7 rounded-[6px] border border-lira-rule flex items-center justify-center cursor-pointer overflow-hidden"
                        style={{ backgroundColor: targetColorHex }}
                        title={`Cor de fundo: ${targetColorHex} (Clique para ajustar)`}
                      >
                        <input
                          type="color"
                          value={targetColorHex}
                          onChange={(e) => setTargetColorHex(e.target.value)}
                          className="opacity-0 w-full h-full cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono text-lira-ink bg-lira-ground px-2.5 py-1.5 rounded-[8px] border border-lira-quiet">
                    <span className="text-[11px] font-mono font-semibold text-lira-muted">Tolerância:</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={tolerance}
                      onChange={(e) => setTolerance(parseInt(e.target.value))}
                      className="w-28 accent-[#d1b5ff] cursor-pointer"
                    />
                    <span className="font-mono font-bold text-lira-ink w-8 text-right tabular-nums">{tolerance}%</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 bg-lira-panel border border-lira-quiet p-3 rounded-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-lira-muted uppercase tracking-wider">
                  Presets ({presets.length})
                </span>
                <button
                  type="button"
                  onClick={handleAddNewPreset}
                  className="flex items-center gap-1 px-2 py-1 rounded-[6px] bg-lira-surface hover:bg-lira-accent text-lira-accent hover:text-lira-ground border border-lira-rule text-[11px] font-mono font-bold transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Novo Preset</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={activePreset?.name || ''}
                  onChange={(e) => {
                    const val = e.target.value
                    setPresets((prev) => {
                      const updated = [...prev]
                      updated[activePresetIndex].name = val
                      return updated
                    })
                  }}
                  placeholder="Nome do Preset"
                  className="flex-1 bg-lira-ground border border-lira-rule focus:border-lira-accent text-lira-ink font-mono text-xs px-3 py-1.5 rounded-[8px] outline-none"
                />

                {presets.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemovePreset(activePresetIndex)}
                    className="w-8 h-8 rounded-[8px] bg-lira-error/15 hover:bg-lira-error text-lira-error hover:text-lira-ground border border-lira-error/40 flex items-center justify-center transition-colors cursor-pointer"
                    title="Excluir este preset"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {presets.length > 1 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mt-1">
                  {presets.map((p, idx) => (
                    <button
                      key={p.id}
                      onClick={() => setActivePresetIndex(idx)}
                      className={`px-2.5 py-1 rounded-[6px] text-xs font-mono font-semibold whitespace-nowrap transition-colors cursor-pointer border ${
                        activePresetIndex === idx
                          ? 'bg-lira-accent text-lira-ground border-lira-accent'
                          : 'bg-lira-ground text-lira-muted border-lira-quiet hover:text-lira-ink'
                      }`}
                    >
                      {p.name || `Preset ${idx + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-lira-panel border border-lira-quiet p-3 rounded-[12px] flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-lira-muted uppercase tracking-wider">
                  Tamanho da Seleção
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-[6px] bg-lira-ground text-lira-accent border border-lira-rule">
                    Grade: {gridSnapSize}px
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-[6px] bg-lira-ground text-lira-amber border border-lira-rule">
                    {selection.w}×{selection.h}px
                  </span>
                </div>
              </div>



              <div className="flex flex-col gap-1.5 bg-lira-ground p-2 rounded-[8px] border border-lira-quiet">
                <div className="flex items-center justify-between text-xs font-mono text-lira-muted">
                  <span className="text-[10px] font-mono font-bold text-lira-ink">Grade / Snap:</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={Math.max(4096, sourceImg ? Math.max(sourceImg.naturalWidth, sourceImg.naturalHeight) : 4096)}
                      value={gridSnapSize}
                      onChange={(e) => handleUpdateGridSize(parseInt(e.target.value) || 1)}
                      className="w-14 bg-lira-panel border border-lira-rule focus:border-lira-accent text-lira-accent font-mono text-center text-xs px-1 py-0.5 rounded-[6px] outline-none"
                    />
                    <span className="text-[10px] font-mono text-lira-muted">px</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1}
                    max={Math.min(512, Math.max(64, sourceImg ? Math.min(sourceImg.naturalWidth, sourceImg.naturalHeight) : 64))}
                    value={gridSnapSize}
                    onChange={(e) => handleUpdateGridSize(parseInt(e.target.value) || 1)}
                    className="flex-1 accent-[#d1b5ff] cursor-pointer h-1.5"
                    title="Ajuste fino da grade (sincroniza o seletor)"
                  />
                  <span className="text-[9px] font-mono text-lira-muted min-w-[32px] text-right tabular-nums">
                    {gridSnapSize}×{gridSnapSize}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-1 pt-1 border-t border-dashed border-lira-rule/60">
                  {[1, 8, 16, 24, 32, 48, 64, 128].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleUpdateGridSize(s)}
                      className={`flex-1 py-0.5 rounded-[6px] text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
                        gridSnapSize === s
                          ? 'bg-lira-accent border-lira-accent text-lira-ground'
                          : 'bg-lira-panel border-lira-quiet text-lira-muted hover:text-lira-ink'
                      }`}
                      title={`Ajusta a grade para ${s}px e o seletor para ${s}×${s}px`}
                    >
                      {s}px
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 bg-lira-ground p-2 rounded-[8px] border border-lira-quiet">
                <div className="flex items-center justify-between text-xs font-mono text-lira-muted">
                  <span className="text-[10px] font-mono font-semibold">Largura:</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={Math.max(4096, sourceImg ? Math.max(sourceImg.naturalWidth, sourceImg.naturalHeight) : 4096)}
                      step={gridSnapSize > 0 ? gridSnapSize : 1}
                      value={selection.w}
                      onChange={(e) => setExactDimensions(parseInt(e.target.value) || 1, selection.h)}
                      className="w-16 bg-lira-panel border border-lira-rule text-lira-amber font-mono text-center text-xs px-1 py-0.5 rounded-[6px] outline-none"
                    />
                    <span className="text-[10px] font-mono text-lira-muted">px</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs font-mono text-lira-muted">
                  <span className="text-[10px] font-mono font-semibold">Altura:</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={Math.max(4096, sourceImg ? Math.max(sourceImg.naturalWidth, sourceImg.naturalHeight) : 4096)}
                      step={gridSnapSize > 0 ? gridSnapSize : 1}
                      value={selection.h}
                      onChange={(e) => setExactDimensions(selection.w, parseInt(e.target.value) || 1)}
                      className="w-16 bg-lira-panel border border-lira-rule text-lira-amber font-mono text-center text-xs px-1 py-0.5 rounded-[6px] outline-none"
                    />
                    <span className="text-[10px] font-mono text-lira-muted">px</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 bg-lira-ground p-2.5 rounded-[8px] border border-lira-quiet">
                <div className="w-16 h-16 rounded-[6px] bg-lira-panel border border-lira-quiet flex items-center justify-center overflow-hidden shrink-0">
                  {selectedRegionDataUrl ? (
                    <RasterImage
                      src={selectedRegionDataUrl}
                      alt="Selection Preview"
                      style={{
                        maxWidth: '56px',
                        maxHeight: '56px',
                      }}
                      className="object-contain [image-rendering:pixelated]"
                    />
                  ) : (
                    <span className="text-[9px] font-mono text-lira-muted">Vazio</span>
                  )}
                </div>

                <div className="flex-1 flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleAddSequentialFrames(activeDirectionTab)}
                    disabled={sequenceCount === 0}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-[8px] bg-lira-online hover:bg-lira-ink text-lira-ground text-[11px] font-mono font-extrabold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title={`Adiciona o frame selecionado e os frames à direita, de ${selection.w}×${selection.h}px, até o fim da linha`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>+ {sequenceCount} Frames Sequenciais</span>
                  </button>
                  <span className="text-[10px] font-mono text-lira-muted">
                    Da seleção à direita: {selection.w}×{selection.h}px por frame.
                  </span>

                  <button
                    type="button"
                    onClick={() => handleAddCompositeFrame(activeDirectionTab)}
                    className="flex items-center justify-center gap-1 py-1 px-2 rounded-[6px] bg-lira-surface hover:border-lira-accent border border-lira-rule text-lira-muted hover:text-lira-ink text-[10px] font-mono font-semibold transition-colors cursor-pointer"
                    title="Adiciona o recorte exato como 1 frame"
                  >
                    <Maximize2 className="w-3 h-3" />
                    <span>+ 1 Frame ({selection.w}×{selection.h}px)</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-lira-panel border border-lira-quiet p-3 rounded-[12px] flex flex-col gap-3">
              {allPresets[activePresetIndex] && <CharacterAnimationTabs key={allPresets[activePresetIndex].id}
                preset={allPresets[activePresetIndex]} activeAnimation={activeAnimation}
                onSelect={id => { setActiveAnimation(id); setWalkTick(0); setDirectionMenuIndex(null); setDraggedFrameIndex(null); setDragOverFrameIndex(null) }}
                onChange={next => setAllPresets(previous => previous.map(preset => preset.id === next.id ? next : preset))} />}
              {activeAnimation !== 'walk' && <p className="text-[11px] font-mono text-lira-muted">
                {activeAnimation === 'yawn' ? 'Boceja a cada minuto sem interação.' : activeAnimation === 'sleep' ? 'Dorme após 5 minutos sem interação. Interaja para acordar.' : 'Adicione ou pinte os frames desta animação. Depois de salvar, ela aparece no botão de animações do mini display.'}
              </p>}
              {activeAnimation === 'walk' && <div className="grid grid-cols-4 gap-1.5">
                {DIRECTIONS.map((d) => {
                  const frameCount = activePreset?.directions[d.id]?.length || 0
                  const isSelectedTab = activeDirectionTab === d.id
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setActiveDirectionTab(d.id)}
                      className={`flex flex-col items-center py-2 px-1 rounded-[8px] text-xs font-mono font-bold transition-colors border cursor-pointer ${
                        isSelectedTab
                          ? 'bg-lira-accent border-lira-accent text-lira-ground'
                          : 'bg-lira-ground border-lira-quiet text-lira-muted hover:text-lira-ink'
                      }`}
                    >
                      <span className="text-sm">{d.icon}</span>
                      <span className="text-[10px] mt-0.5">{d.label}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded-full mt-1 ${
                          frameCount > 0
                            ? isSelectedTab
                              ? 'bg-lira-ground text-lira-accent font-extrabold'
                              : 'bg-lira-online/20 text-lira-online'
                            : 'opacity-40'
                        }`}
                      >
                        {frameCount} {frameCount === 1 ? 'frame' : 'frames'}
                      </span>
                    </button>
                  )
                })}
              </div>}

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[11px] font-mono text-lira-muted font-bold uppercase tracking-wider">
                  <span>{activeAnimation === 'walk' ? `Frames de ${DIRECTIONS.find(d => d.id === activeDirectionTab)?.label}:` : `Frames de ${animations.find(animation => animation.id === activeAnimation)?.label}:`}</span>
                  {activeDirectionFrames.length > 1 && (
                    <span className="text-lira-online lowercase font-mono font-semibold text-[10px]">
                      {animations.find(animation => animation.id === activeAnimation)?.label.toLowerCase()} ({activeDirectionFrames.length} frames)
                    </span>
                  )}
                </div>

                {activeDirectionFrames.length === 0 ? (
                  <div className="py-4 text-center text-xs font-mono text-lira-muted border border-dashed border-lira-rule/60 rounded-[8px]">
                    Nenhum frame atribuído ainda. Selecione na imagem para adicionar.
                  </div>
                ) : (
                  <div className="flex items-center gap-2 overflow-x-auto pb-2 pt-1 px-1">
                    {activeDirectionFrames.map((frame, idx) => {
                      const isDragged = draggedFrameIndex === idx
                      const isDragOver = dragOverFrameIndex === idx
                      const isMenuOpen = directionMenuIndex === idx

                      return (
                        <div
                          key={`${frame.x}_${frame.y}_${idx}`}
                          draggable
                          onDragStart={(e) => {
                            setDraggedFrameIndex(idx)
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', String(idx))
                          }}
                          onDragOver={(e) => {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                            if (dragOverFrameIndex !== idx) {
                              setDragOverFrameIndex(idx)
                            }
                          }}
                          onDragLeave={() => {
                            if (dragOverFrameIndex === idx) {
                              setDragOverFrameIndex(null)
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            if (draggedFrameIndex !== null && draggedFrameIndex !== idx) {
                              handleMoveFrameOrder(activeDirectionTab, draggedFrameIndex, idx)
                            }
                            setDraggedFrameIndex(null)
                            setDragOverFrameIndex(null)
                          }}
                          onDragEnd={() => {
                            setDraggedFrameIndex(null)
                            setDragOverFrameIndex(null)
                          }}
                          className={`group relative flex flex-col items-center p-1.5 rounded-[8px] bg-lira-ground border transition-colors shrink-0 ${
                            isDragOver
                              ? 'border-lira-accent bg-lira-surface'
                              : isDragged
                              ? 'opacity-40 border-dashed border-lira-accent'
                              : 'border-lira-quiet hover:border-lira-rule'
                          }`}
                        >
                          <div className="w-full flex items-center justify-between pb-1 cursor-grab active:cursor-grabbing">
                            <span className="text-lira-muted hover:text-lira-ink" title="Arraste para mover de lugar">
                              <GripVertical className="w-3 h-3" />
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveDirectionFrame(activeDirectionTab, idx)}
                              className="w-4 h-4 rounded-full bg-lira-error/20 hover:bg-lira-error text-lira-error hover:text-lira-ground flex items-center justify-center transition-colors cursor-pointer"
                              title="Remover este frame"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              const sheetId = frame.sheetId || 'primary'
                              if (sheetId !== activeSheetId) {
                                pendingFrame.current = frame
                                setActiveSheetId(sheetId)
                              }
                              const fw = frame.w || 16
                              const fh = frame.h || 16
                              setSelection({ x: frame.x, y: frame.y, w: fw, h: fh })
                              if (sourceImg && sheetId === activeSheetId) {
                                sliceRegion(sourceImg, frame.x, frame.y, fw, fh)
                              }
                            }}
                            className="w-12 h-12 rounded-[6px] bg-lira-panel hover:ring-2 hover:ring-lira-accent flex items-center justify-center overflow-hidden transition-colors cursor-pointer"
                            title="Clique para posicionar a seleção neste frame"
                          >
                            <RasterImage
                              src={frame.dataUrl}
                              alt={`Frame ${idx}`}
                              className="w-10 h-10 object-contain [image-rendering:pixelated]"
                            />
                          </button>

                          <span className="text-[9px] font-mono font-bold text-lira-ink mt-1">
                            {activeAnimation === 'walk' ? idx === 0 ? '0 (Parado)' : `Passo ${idx}` : `Frame ${idx + 1}`}
                          </span>
                          <span className="text-[8px] text-lira-muted font-mono">
                            {frame.w || 16}×{frame.h || 16}
                          </span>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setIsPixelStudioOpen(true)
                            }}
                            className="flex items-center gap-1 px-1.5 py-0.5 mt-1 rounded-[6px] bg-lira-surface hover:bg-lira-accent text-lira-ink hover:text-lira-ground text-[9px] font-mono font-bold transition-colors cursor-pointer"
                            title="Pintar e editar pixels no Estúdio Pixel Art"
                          >
                            <Paintbrush className="w-2.5 h-2.5" />
                            <span>Pintar</span>
                          </button>

                          <div className="flex items-center gap-1 mt-1.5 pt-1 border-t border-lira-quiet w-full justify-center">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveFrameOrder(activeDirectionTab, idx, idx - 1)}
                              className={`p-1 rounded transition-colors ${
                                idx === 0
                                  ? 'opacity-30 cursor-not-allowed text-lira-muted'
                                  : 'hover:bg-lira-surface text-lira-muted hover:text-lira-ink cursor-pointer'
                              }`}
                              title="Mover frame para a esquerda"
                            >
                              <ChevronLeft className="w-3 h-3" />
                            </button>

                            {activeAnimation === 'walk' && <button
                              type="button"
                              onClick={() => setDirectionMenuIndex(isMenuOpen ? null : idx)}
                              className={`p-1 rounded transition-colors ${
                                isMenuOpen
                                  ? 'bg-lira-accent text-lira-ground'
                                  : 'hover:bg-lira-surface text-lira-accent hover:text-lira-ink cursor-pointer'
                              }`}
                              title="Mover para outra direção (Frente, Costas, etc.)"
                            >
                              <ArrowRightLeft className="w-3 h-3" />
                            </button>}

                            <button
                              type="button"
                              disabled={idx === activeDirectionFrames.length - 1}
                              onClick={() => handleMoveFrameOrder(activeDirectionTab, idx, idx + 1)}
                              className={`p-1 rounded transition-colors ${
                                idx === activeDirectionFrames.length - 1
                                  ? 'opacity-30 cursor-not-allowed text-lira-muted'
                                  : 'hover:bg-lira-surface text-lira-muted hover:text-lira-ink cursor-pointer'
                              }`}
                              title="Mover frame para a direita"
                            >
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          </div>

                          {activeAnimation === 'walk' && isMenuOpen && (
                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-30 bg-lira-panel border border-dashed border-lira-rule rounded-[8px] p-1.5 flex flex-col gap-1 w-28">
                              <span className="text-[9px] font-mono font-bold text-lira-muted px-1 border-b border-dashed border-lira-rule/60 pb-0.5">
                                Mover para:
                              </span>
                              {DIRECTIONS.filter((d) => d.id !== activeDirectionTab).map((d) => (
                                <button
                                  key={d.id}
                                  type="button"
                                  onClick={() => handleMoveFrameToDirection(activeDirectionTab, idx, d.id)}
                                  className="text-[10px] font-mono font-semibold text-lira-ink hover:text-lira-accent hover:bg-lira-surface px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors text-left cursor-pointer"
                                >
                                  <span>{d.icon}</span>
                                  <span>{d.label}</span>
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() => setDirectionMenuIndex(null)}
                                className="text-[9px] font-mono text-lira-muted hover:text-lira-ink pt-0.5 text-center cursor-pointer"
                              >
                                Fechar
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {activeAnimation === 'walk' && (activeDirectionTab === 'left' || activeDirectionTab === 'right') && (
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-dashed border-lira-rule/60">
                  <button
                    type="button"
                    onClick={() => handleMirrorLateral('left', 'right')}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[8px] bg-lira-ground hover:bg-lira-surface border border-lira-rule text-lira-muted hover:text-lira-ink text-[11px] font-mono font-semibold transition-colors cursor-pointer"
                  >
                    <FlipHorizontal className="w-3.5 h-3.5 text-lira-accent" />
                    <span>Espelhar Esq ➔ Dir</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleMirrorLateral('right', 'left')}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[8px] bg-lira-ground hover:bg-lira-surface border border-lira-rule text-lira-muted hover:text-lira-ink text-[11px] font-mono font-semibold transition-colors cursor-pointer"
                  >
                    <FlipHorizontal className="w-3.5 h-3.5 text-lira-accent" />
                    <span>Espelhar Dir ➔ Esq</span>
                  </button>
                </div>
              )}
            </div>

            <div className="bg-lira-panel border border-lira-quiet p-3 rounded-[12px] flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-lira-muted uppercase tracking-wider">
                  Pré-visualização do Loop
                </span>
                <button
                  type="button"
                  onClick={() => setIsPlayingWalk(!isPlayingWalk)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-xs font-mono font-bold transition-colors cursor-pointer border ${
                    isPlayingWalk
                      ? 'bg-lira-surface text-lira-accent border-lira-accent'
                      : 'bg-lira-ground text-lira-muted border-lira-quiet hover:text-lira-ink'
                  }`}
                >
                  {isPlayingWalk ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  <span>{isPlayingWalk ? `${animations.find(animation => animation.id === activeAnimation)?.label} (Loop)` : 'Parado (Frame 0)'}</span>
                </button>
              </div>

              <div className="flex items-center justify-center bg-lira-ground p-3 rounded-[8px] border border-lira-quiet">
                <div className="w-16 h-16 rounded-[8px] bg-lira-panel flex items-center justify-center overflow-hidden border border-lira-quiet">
                  {currentPreviewFrame ? (
                    <RasterImage
                      src={currentPreviewFrame}
                      alt="Preview"
                      className="w-12 h-12 object-contain [image-rendering:pixelated]"
                    />
                  ) : (
                    <span className="text-xs font-mono text-lira-muted">-</span>
                  )}
                </div>
              </div>
            </div>

            {savedSuccessCount !== null && (
              <div className="flex items-center gap-2 p-3 rounded-[8px] bg-lira-online/15 border border-lira-online/40 text-lira-online text-xs font-mono">
                <CheckCircle className="w-4 h-4 shrink-0 text-lira-online" />
                <span>
                  {editingAsset
                    ? `Alterações em "${editingAsset.name}" salvas com sucesso!`
                    : `${savedSuccessCount} presets salvos e prontos para uso!`}
                </span>
              </div>
            )}

            <div className="mt-auto pt-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleSaveAndEquip}
                disabled={isSaving || isAddingSheets || !sourceImg}
                className="w-full py-3 rounded-[12px] text-xs font-mono font-extrabold bg-lira-accent hover:bg-lira-ink text-lira-ground border-2 border-lira-accent hover:border-lira-ink transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>{isSaving ? 'Salvando…' : editingAsset ? `Salvar Alterações em "${editingAsset.name}"` : 'Salvar Presets no Avatar'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {showXmlModal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-lira-ground/80 p-4 font-mono">
          <div className="bg-lira-panel border border-dashed border-lira-rule w-full max-w-xl rounded-[12px] flex flex-col overflow-hidden max-h-[80vh]">
            <div className="px-6 py-4 border-b border-dashed border-lira-rule/60 flex items-center justify-between bg-lira-sidebar">
              <div className="flex items-center gap-2">
                <FileCode className="w-5 h-5 text-lira-accent" />
                <h3 className="text-sm font-display font-bold text-lira-accent">Sparrow TextureAtlas XML Gerado</h3>
              </div>
              <button
                onClick={() => setShowXmlModal(false)}
                className="w-7 h-7 rounded-[6px] bg-lira-surface border border-lira-rule text-lira-muted hover:text-lira-ink flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto">
              <pre className="text-[11px] font-mono bg-lira-ground p-4 rounded-[8px] border border-lira-quiet text-lira-online overflow-x-auto select-text">
                {generateXmlString()}
              </pre>
            </div>

            <div className="px-6 py-3 border-t border-dashed border-lira-rule/60 bg-lira-sidebar flex items-center justify-end gap-2">
              <button
                onClick={() => setShowXmlModal(false)}
                className="px-4 py-2 rounded-[8px] text-xs font-mono font-semibold text-lira-muted hover:text-lira-ink bg-lira-surface border border-lira-rule"
              >
                Fechar
              </button>
              <button
                onClick={handleDownloadXml}
                className="flex items-center gap-1.5 px-4 py-2 rounded-[8px] text-xs font-mono font-bold bg-lira-accent text-lira-ground hover:bg-lira-ink cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Baixar Arquivo .xml</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {isPixelStudioOpen && (() => {
        const studioDims = getStudioDimensions()
        return (
          <AvatarPixelArtModal
            isOpen={isPixelStudioOpen}
            singleSequence={activeAnimation !== 'walk'}
            onClose={() => setIsPixelStudioOpen(false)}
            category={category}
            presetName={presets[activePresetIndex]?.name || editingAsset?.name || 'Personagem'}
            initialDirectionalFrames={getCurrentDirectionalFrames()}
            avatar={useGameStore.getState().localPlayer.avatar || DEFAULT_AVATAR}
            initialWidth={studioDims.width}
            initialHeight={studioDims.height}
            initialPixelWidth={studioDims.pixelWidth}
            initialPixelHeight={studioDims.pixelHeight}
            onSave={handleSaveFromStudio}
          />
        )
      })()}
    </div>
  )
}
