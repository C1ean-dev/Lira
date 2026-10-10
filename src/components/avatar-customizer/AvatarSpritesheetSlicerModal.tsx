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
import { AvatarComponentSlot, Direction } from '../../types/game'
import { CustomAsset } from '../../types/customAsset'
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
import { saveAssetFileToDisk } from '../../utils/diskAssetPersistence'

export interface SlicedFrameSlot {
  x: number
  y: number
  w?: number
  h?: number
  dataUrl: string
}

export interface SlicedPreset {
  id: string
  name: string
  directions: Record<Direction, SlicedFrameSlot[]>
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

export const AvatarSpritesheetSlicerModal: React.FC<Props> = ({
  isOpen,
  onClose,
  imageSrc,
  imageFileName = 'spritesheet.png',
  category,
  onSaveComplete,
  editingAsset,
}) => {
  const [sourceImg, setSourceImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState<number>(0.5)
  const [showGrid, setShowGrid] = useState<boolean>(true)
  const [gridSnapSize, setGridSnapSize] = useState<number>(16) // Supports 8, 16, 24, 32 or custom sizes

  // Background Removal State (disabled by default)
  const [enableBgRemoval, setEnableBgRemoval] = useState<boolean>(false)
  const [targetColorHex, setTargetColorHex] = useState<string>('#21232a')
  const [tolerance, setTolerance] = useState<number>(25)
  const [isPickingColor, setIsPickingColor] = useState<boolean>(false)

  // Selection Box (supports any pixel size, smaller than 32x32)
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

  // Drag-Selection State
  const isSelectingRef = useRef<boolean>(false)
  const selectionStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const isMovingSelectionRef = useRef<boolean>(false)
  const moveOffsetRef = useRef<{ offsetX: number; offsetY: number }>({ offsetX: 0, offsetY: 0 })
  const [isHoveringSelection, setIsHoveringSelection] = useState<boolean>(false)

  // Frame Drag & Drop and Direction Transfer State
  const [draggedFrameIndex, setDraggedFrameIndex] = useState<number | null>(null)
  const [dragOverFrameIndex, setDragOverFrameIndex] = useState<number | null>(null)
  const [directionMenuIndex, setDirectionMenuIndex] = useState<number | null>(null)

  // Panning State
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState<boolean>(false)
  const panStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({
    mouseX: 0,
    mouseY: 0,
    startX: 0,
    startY: 0,
  })
  const stageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Presets List with Multi-Frame Support per Direction
  const [presets, setPresets] = useState<SlicedPreset[]>(() => {
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

  // Sync presets whenever editingAsset changes
  useEffect(() => {
    if (editingAsset) {
      const converted = convertAssetToSlicedPresets(editingAsset, editingAsset.sourceXmlContent)
      setPresets(converted)
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
  const [activeDirectionTab, setActiveDirectionTab] = useState<Direction>('down')
  const [showXmlModal, setShowXmlModal] = useState<boolean>(false)
  const [savedSuccessCount, setSavedSuccessCount] = useState<number | null>(null)

  // Walk Cycle Animation Preview State
  const [isPlayingWalk, setIsPlayingWalk] = useState<boolean>(true)
  const [walkTick, setWalkTick] = useState<number>(0)

  // Pixel Art Studio Direct Integration ("Pintar")
  const [isPixelStudioOpen, setIsPixelStudioOpen] = useState<boolean>(false)

  const getCurrentDirectionalFrames = useCallback((): Record<Direction, string[]> => {
    const p = presets[activePresetIndex] || presets[0]

    const getDirectionList = (dir: Direction): string[] => {
      const slots = p?.directions?.[dir] || []
      const urls = slots.map((s) => s.dataUrl).filter(Boolean)
      if (urls.length > 0) return urls

      if (editingAsset?.directionalFrames?.[dir]) {
        const raw = editingAsset.directionalFrames[dir]
        if (Array.isArray(raw)) {
          const filtered = raw.filter(Boolean)
          if (filtered.length > 0) return filtered
        } else if (raw) {
          return [raw]
        }
      }

      if (dir === 'down' && editingAsset?.frames?.[0]) {
        return [editingAsset.frames[0]]
      }

      return ['']
    }

    return {
      down: getDirectionList('down'),
      up: getDirectionList('up'),
      left: getDirectionList('left'),
      right: getDirectionList('right'),
    }
  }, [presets, activePresetIndex, editingAsset])

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

    setPresets((prev) =>
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
            })),
            up: upFrames.map((url, i) => ({
              x: p.directions.up[i]?.x || 0,
              y: p.directions.up[i]?.y || 0,
              w: finalW,
              h: finalH,
              dataUrl: url,
            })),
            left: leftFrames.map((url, i) => ({
              x: p.directions.left[i]?.x || 0,
              y: p.directions.left[i]?.y || 0,
              w: finalW,
              h: finalH,
              dataUrl: url,
            })),
            right: rightFrames.map((url, i) => ({
              x: p.directions.right[i]?.x || 0,
              y: p.directions.right[i]?.y || 0,
              w: finalW,
              h: finalH,
              dataUrl: url,
            })),
          },
        }
      })
    )

    if (finalW > 0 && finalH > 0) {
      setSelection((prev) => ({ ...prev, w: finalW, h: finalH }))
    }

    if (editingAsset) {
      const store = useCustomAssetsStore.getState()
      const firstDown = downFrames[0] || ''
      const firstUp = upFrames[0] || ''
      const firstLeft = leftFrames[0] || ''
      const firstRight = rightFrames[0] || ''

      const thumbnail = await cropContentDataUrl(firstDown || firstUp || firstLeft || firstRight || '')

      const isObstacle = options?.isObstacle !== undefined ? options.isObstacle : editingAsset.isObstacle
      store.updateCustomAsset(editingAsset.id, {
        name: newName || editingAsset.name,
        thumbnail,
        width: options?.width || Math.max(1, Math.ceil(finalW / 32)),
        height: options?.height || Math.max(1, Math.ceil(finalH / 32)),
        pixelWidth: finalW,
        pixelHeight: finalH,
        isObstacle,
        // Furniture: the hitbox follows the drawing, so the transparent parts do not block (spriteHitbox.ts)
        ...(editingAsset.type === 'furniture' ? resolveStudioHitbox(editingAsset, isObstacle, options?.spriteCollision) : {}),
        category: options?.category || editingAsset.category,
        directionalFrames: newDirectionalFrames,
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
              [category]: newDirectionalFrames,
            },
          },
        })
      }
    }

    setSavedSuccessCount(1)
    setIsPixelStudioOpen(false)
  }

  // Extract and process any rectangular region from source image
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

  // Reset zoom and pan on open
  useEffect(() => {
    if (isOpen) {
      setZoom(0.5)
      setPanOffset({ x: 0, y: 0 })
    }
  }, [isOpen])

  // Load Source Image
  useEffect(() => {
    if (!imageSrc) return
    const img = new Image()
    img.src = imageSrc
    img.onload = () => {
      setSourceImg(img)
      const firstSlot =
        presets[0]?.directions.down[0] ||
        presets[0]?.directions.up[0] ||
        presets[0]?.directions.left[0] ||
        presets[0]?.directions.right[0]

      if (firstSlot && firstSlot.w && firstSlot.h) {
        setSelection({
          x: firstSlot.x,
          y: firstSlot.y,
          w: firstSlot.w,
          h: firstSlot.h,
        })
        sliceRegion(img, firstSlot.x, firstSlot.y, firstSlot.w, firstSlot.h)
      } else {
        sliceRegion(img, selection.x, selection.y, selection.w || 16, selection.h || 16)
      }
    }
  }, [imageSrc, sliceRegion])

  // Re-slice when background removal params change
  useEffect(() => {
    if (sourceImg) {
      sliceRegion(sourceImg, selection.x, selection.y, selection.w, selection.h)
    }
  }, [enableBgRemoval, targetColorHex, tolerance, sourceImg, selection, sliceRegion])

  // Automatically detects the background color and applies removal
  const handleAutoDetectBg = useCallback(() => {
    if (!sourceImg) return
    // 1. Try region around current selection
    let detected = detectBackgroundColor(sourceImg, selection)
    // 2. If not found or transparent, sample whole sheet
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

  // Eyedropper activation: native browser API if supported, or interactive canvas click
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
        // Cancelled by user
      }
    }
    setIsPickingColor((prev) => !prev)
  }

  // Cancel color picker on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPickingColor) {
        setIsPickingColor(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPickingColor])

  // Walk Cycle Loop Timer
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

  // Zoom control with Ctrl + mouse wheel scroll
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const handleWheel = (e: WheelEvent) => {
      // Zoom with Ctrl + mouse wheel scroll
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        const zoomDelta = e.deltaY < 0 ? 0.25 : -0.25
        setZoom((prevZoom) => {
          const next = Math.round((prevZoom + zoomDelta) * 100) / 100
          return Math.max(0.5, Math.min(10, next))
        })
      }
    }

    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => stage.removeEventListener('wheel', handleWheel)
  }, [isOpen])

  // Render Spritesheet on Canvas
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

    // Draw Grid with configurable snap size (8, 16, 24, 32, etc.)
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

    // Draw assigned markers for active preset
    const activePreset = presets[activePresetIndex]
    if (activePreset) {
      DIRECTIONS.forEach(({ id: dir }) => {
        const frames = activePreset.directions[dir] || []
        frames.forEach((frame, idx) => {
          const fw = frame.w || 16
          const fh = frame.h || 16
          ctx.fillStyle = dir === activeDirectionTab ? 'rgba(59, 130, 246, 0.35)' : 'rgba(16, 185, 129, 0.3)'
          ctx.fillRect(frame.x, frame.y, fw, fh)
          ctx.strokeStyle = dir === activeDirectionTab ? '#60a5fa' : '#10b981'
          ctx.lineWidth = 2
          ctx.strokeRect(frame.x + 0.5, frame.y + 0.5, fw - 1, fh - 1)

          // Direction and frame index badge
          ctx.fillStyle = dir === activeDirectionTab ? '#3b82f6' : '#10b981'
          ctx.fillRect(frame.x, frame.y, 24, 11)
          ctx.fillStyle = '#ffffff'
          ctx.font = 'bold 8px sans-serif'
          ctx.fillText(`${dir[0].toUpperCase()}${idx}`, frame.x + 2, frame.y + 9)
        })
      })
    }

    // Draw highlighted selection box
    ctx.lineWidth = 2
    ctx.strokeStyle = '#f59e0b'
    ctx.fillStyle = 'rgba(245, 158, 11, 0.22)'
    ctx.fillRect(selection.x, selection.y, selection.w, selection.h)
    ctx.strokeRect(selection.x + 0.5, selection.y + 0.5, selection.w - 1, selection.h - 1)

    // Selection dimension tag overlay
    const tagText = `${selection.w}×${selection.h}px`
    ctx.fillStyle = '#f59e0b'
    const tagW = tagText.length * 6.2 + 8
    const tagY = Math.max(0, selection.y - 14)
    ctx.fillRect(selection.x, tagY, tagW, 13)
    ctx.fillStyle = '#000000'
    ctx.font = 'bold 8px sans-serif'
    ctx.fillText(tagText, selection.x + 4, tagY + 9)
  }, [sourceImg, showGrid, gridSnapSize, selection, presets, activePresetIndex, activeDirectionTab])

  // Handle Canvas Mouse Down (Left click = Drag Select, Right click = Pan)
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
        startX: panOffset.x,
        startY: panOffset.y,
      }
      return
    }

    if (e.button === 0) {
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height

      const clientX = (e.clientX - rect.left) * scaleX
      const clientY = (e.clientY - rect.top) * scaleY

      // If in Eyedropper mode: sample pixel directly from canvas
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

      // Check if clicking inside the existing selection box to drag/move it
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
      setPanOffset({
        x: panStartRef.current.startX + dx,
        y: panStartRef.current.startY + dy,
      })
      return
    }

    if (!canvasRef.current || !sourceImg) return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    const clientX = (e.clientX - rect.left) * scaleX
    const clientY = (e.clientY - rect.top) * scaleY

    // Moving existing selection box
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

    // Creating new drag selection
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

    // Update hover state for cursor
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

  // Keyboard arrow nudge support to move selection box on canvas
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

  // Adjust selection dimensions to exact pixel sizes (from 1px up to max image size)
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

  // Update grid size (1 to 64px) and automatically synchronize selector dimensions!
  const handleUpdateGridSize = (newGridSize: number) => {
    const safeSize = Math.max(1, Math.min(64, Math.round(newGridSize)))
    setGridSnapSize(safeSize)

    if (sourceImg) {
      const maxW = sourceImg.naturalWidth
      const maxH = sourceImg.naturalHeight
      const targetW = Math.min(safeSize, maxW)
      const targetH = Math.min(safeSize, maxH)

      // Snap current selection coordinates to new grid size
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

  // Add individual blocks sequentially (Walk Cycle)
  const handleAddSequentialFrames = (dir: Direction) => {
    if (!sourceImg) return
    const step = Math.max(1, gridSnapSize)
    const cols = Math.max(1, Math.round(selection.w / step))
    const rows = Math.max(1, Math.round(selection.h / step))

    const newFrames: SlicedFrameSlot[] = []

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const bx = selection.x + c * step
        const by = selection.y + r * step
        const dataUrl = sliceRegion(sourceImg, bx, by, step, step)
        newFrames.push({
          x: bx,
          y: by,
          w: step,
          h: step,
          dataUrl,
        })
      }
    }

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

  // Add entire selection as 1 composite frame
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
          },
        ],
      }
      updated[activePresetIndex] = current
      return updated
    })
  }

  // Remove a frame from a direction
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

  // Move frame order (left or right in walk animation loop)
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

  // Move a frame to another direction (Frente, Costas, Esquerda, Direita)
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

  // Mirror lateral direction (Left <-> Right)
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
      img.src = f.dataUrl
      ctx.imageSmoothingEnabled = false
      ctx.translate(fw, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0)

      return {
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

  // Add new preset
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

  // Remove preset
  const handleRemovePreset = (idx: number) => {
    if (presets.length <= 1) return
    const next = presets.filter((_, i) => i !== idx)
    setPresets(next)
    setActivePresetIndex(Math.max(0, idx - 1))
  }

  // Generate Sparrow XML
  const generateXmlString = (): string => {
    const subTextures: PackedSubTexture[] = []
    const imagePath = imageFileName.endsWith('.png') ? imageFileName : `${category}.png`

    presets.forEach((preset) => {
      const cleanName = (preset.name || 'custom').toLowerCase().replace(/[^a-z0-9]/g, '_')
      DIRECTIONS.forEach(({ id: dir }) => {
        const frames = preset.directions[dir] || []
        frames.forEach((frame, idx) => {
          subTextures.push({
            name: `${category}_${cleanName}_${dir}_${idx}`,
            x: frame.x,
            y: frame.y,
            width: frame.w || 16,
            height: frame.h || 16,
          })
        })
      })
    })

    return generateSparrowXml(imagePath, subTextures)
  }

  // Download Generated XML
  const handleDownloadXml = () => {
    const xml = generateXmlString()
    const xmlFileName = imageFileName.replace(/\.[^/.]+$/, '') + '.xml'
    downloadFile(xmlFileName, xml, 'application/xml')
  }

  // Save Presets into Store
  const handleSaveAndEquip = async () => {
    const createdAssets: CustomAsset[] = []
    const store = useCustomAssetsStore.getState()

    for (const p of presets) {
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

      if (editingAsset) {
        store.updateCustomAsset(editingAsset.id, {
          name: p.name.trim() || editingAsset.name,
          thumbnail,
          width: Math.max(1, Math.ceil(selection.w / 32)),
          height: Math.max(1, Math.ceil(selection.h / 32)),
          pixelWidth: selection.w,
          pixelHeight: selection.h,
          frames: [
            Array.isArray(directionalFrames.down) ? directionalFrames.down[0] : (directionalFrames.down || ''),
            Array.isArray(directionalFrames.up) ? directionalFrames.up[0] : (directionalFrames.up || ''),
            Array.isArray(directionalFrames.left) ? directionalFrames.left[0] : (directionalFrames.left || ''),
            Array.isArray(directionalFrames.right) ? directionalFrames.right[0] : (directionalFrames.right || ''),
          ],
          directionalFrames,
          creationSource: 'slicer',
          sourceImageSrc: imageSrc,
          sourceFileName: imageFileName,
          slicerPresets: presets,
        })
        const updated = store.customAssets.find((a) => a.id === editingAsset.id) || {
          ...editingAsset,
          name: p.name.trim() || editingAsset.name,
          thumbnail,
          directionalFrames,
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
          width: Math.max(1, Math.ceil(selection.w / 32)),
          height: Math.max(1, Math.ceil(selection.h / 32)),
          pixelWidth: selection.w,
          pixelHeight: selection.h,
          isObstacle,
          frames: [
            Array.isArray(directionalFrames.down) ? directionalFrames.down[0] : (directionalFrames.down || ''),
            Array.isArray(directionalFrames.up) ? directionalFrames.up[0] : (directionalFrames.up || ''),
            Array.isArray(directionalFrames.left) ? directionalFrames.left[0] : (directionalFrames.left || ''),
            Array.isArray(directionalFrames.right) ? directionalFrames.right[0] : (directionalFrames.right || ''),
          ],
          directionalFrames,
          frameRateMs: 160,
          createdAt: Date.now(),
          creationSource: 'slicer',
          sourceImageSrc: imageSrc,
          sourceFileName: imageFileName,
          slicerPresets: presets,
        }

        store.addCustomAsset(asset)
        createdAssets.push(asset)
      }
    }

    // Save XML and PNG directly to appropriate subfolder so they are tracked in Git
    const subfolder =
      category === 'pet'
        ? 'pet'
        : category === 'furniture'
        ? 'furniture'
        : category === 'floor'
        ? 'floor'
        : category === 'wall'
        ? 'wall'
        : 'avatar'
    const cleanBase = imageFileName.replace(/\.[^/.]+$/, '') || `${category}_atlas`
    saveAssetFileToDisk(
      `public/assets/${subfolder}/${cleanBase}.xml`,
      generateXmlString(),
      'utf-8'
    ).catch((e) => console.warn('Could not auto-save atlas XML to disk:', e))

    if (imageSrc) {
      saveAssetFileToDisk(
        `public/assets/${subfolder}/${cleanBase}.png`,
        imageSrc,
        'base64'
      ).catch((e) => console.warn('Could not auto-save atlas PNG to disk:', e))
    }

    setSavedSuccessCount(createdAssets.length)
    if (onSaveComplete) {
      onSaveComplete(createdAssets, generateXmlString())
    }

    setTimeout(() => {
      onClose()
    }, 1200)
  }

  if (!isOpen) return null

  const activePreset = presets[activePresetIndex]
  const activeDirectionFrames = activePreset?.directions[activeDirectionTab] || []

  // Current active frame in animated preview
  const currentPreviewFrame =
    activeDirectionFrames.length > 0
      ? isPlayingWalk
        ? activeDirectionFrames[walkTick % activeDirectionFrames.length]?.dataUrl
        : activeDirectionFrames[0]?.dataUrl
      : selectedRegionDataUrl

  // Selection step calculations
  const snapStep = Math.max(1, gridSnapSize)
  const isMultiBlock = selection.w > snapStep || selection.h > snapStep
  const totalBlocks = Math.max(1, Math.round(selection.w / snapStep) * Math.round(selection.h / snapStep))

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 select-none animate-in fade-in duration-200"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="bg-[#1e1f22] border border-[#383a40] w-full max-w-7xl h-[92vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="px-6 py-3 border-b border-[#2b2d31] flex items-center justify-between bg-[#18191c]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#3b82f6]/20 border border-[#3b82f6]/40 flex items-center justify-center text-[#3b82f6]">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                {editingAsset ? `Editar: ${editingAsset.name}` : 'Fatiador com Seletor Livre (Qualquer Tamanho)'}
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#2b2d31] text-blue-400 border border-[#383a40]">
                  {CATEGORY_LABELS[category]}
                </span>
                {editingAsset && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    Modo Edição
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                {editingAsset
                  ? 'Reorganize frames, recorte novos passos da folha ou ajuste as direções deste personagem.'
                  : 'Selecione regiões menores que 32×32 (ex: 16×16, 8×8, 24×24) ou qualquer dimensão livre para recortar sprites.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPixelStudioOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25 transition-all cursor-pointer"
              title="Pintar e editar os pixels deste personagem no Estúdio Pixel Art"
            >
              <Paintbrush className="w-4 h-4" />
              <span>Pintar</span>
            </button>

            <button
              type="button"
              onClick={() => setShowXmlModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#2b2d31] hover:bg-[#383a40] text-slate-300 hover:text-white text-xs font-semibold border border-[#383a40] transition-colors cursor-pointer"
            >
              <FileCode className="w-4 h-4 text-blue-400" />
              <span>Ver XML Gerado</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadXml}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#2b2d31] hover:bg-[#383a40] text-slate-300 hover:text-white text-xs font-semibold border border-[#383a40] transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span>Baixar .xml</span>
            </button>

            <div className="w-px h-6 bg-[#383a40] mx-1" />

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-[#2b2d31] hover:bg-[#383a40] text-slate-400 hover:text-white flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Center Stage: Interactive Spritesheet Canvas */}
          <div
            ref={stageRef}
            className="flex-1 relative bg-[#121316] flex items-center justify-center overflow-hidden cursor-crosshair"
          >
            {/* Stage Controls Overlay */}
            <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5 bg-[#18191c]/90 border border-[#383a40] backdrop-blur-md p-1.5 rounded-2xl shadow-xl">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.5) * 10) / 10))}
                className="w-8 h-8 rounded-xl hover:bg-[#2b2d31] text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Diminuir Zoom"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono font-bold text-slate-300 px-2">{zoom}x</span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(10, Math.round((z + 0.5) * 10) / 10))}
                className="w-8 h-8 rounded-xl hover:bg-[#2b2d31] text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Aumentar Zoom"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <div className="w-px h-4 bg-[#383a40] mx-1" />
              <button
                type="button"
                onClick={() => setShowGrid(!showGrid)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  showGrid ? 'bg-[#3b82f6] text-white' : 'hover:bg-[#2b2d31] text-slate-400 hover:text-slate-200'
                }`}
                title="Alternar Grade"
              >
                <Grid className="w-3.5 h-3.5" />
                <span>Grade {gridSnapSize}px</span>
              </button>
            </div>

            {/* Bottom Status Tips */}
            {isPickingColor ? (
              <div className="absolute bottom-4 z-10 flex items-center gap-2 bg-amber-500 text-slate-950 font-bold px-4 py-2 rounded-2xl text-xs shadow-xl animate-bounce">
                <Pipette className="w-4 h-4" />
                <span>Conta-gotas ativo: Clique em qualquer ponto da imagem para selecionar a cor de fundo!</span>
                <button
                  type="button"
                  onClick={() => setIsPickingColor(false)}
                  className="ml-2 px-2 py-0.5 rounded-lg bg-slate-900/30 hover:bg-slate-900/50 text-slate-950 text-[10px]"
                >
                  Cancelar (Esc)
                </button>
              </div>
            ) : (
              <div className="absolute bottom-4 z-10 flex items-center gap-3 bg-[#18191c]/90 border border-[#383a40] backdrop-blur-md px-4 py-2 rounded-2xl text-xs text-slate-400 shadow-lg">
                <span>
                  Seleção:{' '}
                  <strong className="text-white">
                    x: {selection.x}, y: {selection.y} ({selection.w}×{selection.h}px)
                  </strong>
                </span>
                <div className="w-px h-3 bg-[#383a40]" />
                <span>🖱️ Arraste dentro da seleção ou use setas do teclado para movê-la</span>
                <span>•</span>
                <span>🔍 Ctrl + Scroll: Zoom</span>
                <span>•</span>
                <span>🖱️ Botão Direito: Mover tela</span>
              </div>
            )}

            {/* Canvas Container with Pan & Zoom */}
            <div
              style={{
                transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                transition: isPanning ? 'none' : 'transform 0.05s ease-out',
              }}
              className="relative shadow-2xl border border-slate-700/60 rounded overflow-hidden"
            >
              <canvas
                ref={canvasRef}
                onMouseDown={handleCanvasMouseDown}
                className={`block [image-rendering:pixelated] ${
                  isPickingColor ? 'cursor-crosshair' : isHoveringSelection ? 'cursor-move' : 'cursor-crosshair'
                }`}
              />
            </div>
          </div>

          {/* Right Inspector & Assignment Panel */}
          <div className="w-96 border-l border-[#2b2d31] bg-[#18191c]/90 flex flex-col p-4 gap-3.5 overflow-y-auto">
            {/* 1. Background Removal Controls */}
            <div className="flex flex-col gap-2.5 bg-[#2b2d31]/70 border border-[#383a40] p-3 rounded-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
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
                  <div className="w-8 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#3b82f6]"></div>
                </label>
              </div>

              {enableBgRemoval && (
                <div className="flex flex-col gap-2.5 pt-1 border-t border-[#383a40]/60">
                  {/* Conta-gotas, Modo Automático e Amostra de Cor */}
                  <div className="flex items-center gap-2">
                    {/* Botão Modo Automático */}
                    <button
                      type="button"
                      onClick={handleAutoDetectBg}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-sm transition-all active:scale-95 cursor-pointer"
                      title="Detecta automaticamente a cor de fundo analisando as bordas e cantos da imagem e a remove"
                    >
                      <Wand2 className="w-3.5 h-3.5 text-amber-300" />
                      <span>Modo Automático</span>
                    </button>

                    {/* Botão Conta-gotas */}
                    <button
                      type="button"
                      onClick={handleToggleEyedropper}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl text-xs font-bold border transition-all active:scale-95 cursor-pointer ${
                        isPickingColor
                          ? 'bg-amber-500 text-slate-900 border-amber-400 shadow-md shadow-amber-500/20 animate-pulse'
                          : 'bg-[#1e1f22] hover:bg-[#2b2d31] text-slate-200 border-[#383a40]'
                      }`}
                      title="Clique para ativar o conta-gotas e selecionar a cor diretamente na imagem"
                    >
                      <Pipette className="w-3.5 h-3.5 text-blue-400" />
                      <span>{isPickingColor ? 'Clique...' : 'Conta-gotas'}</span>
                    </button>

                    {/* Preview e ajuste da cor selecionada */}
                    <div className="relative group/picker shrink-0">
                      <div
                        className="w-7 h-7 rounded-xl border border-white/30 shadow-inner flex items-center justify-center cursor-pointer overflow-hidden transition-transform hover:scale-105"
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

                  {/* Slider de Tolerância */}
                  <div className="flex items-center justify-between text-xs text-slate-300 bg-[#1e1f22]/60 px-2.5 py-1.5 rounded-xl border border-[#383a40]/40">
                    <span className="text-[11px] font-semibold text-slate-400">Tolerância:</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={tolerance}
                      onChange={(e) => setTolerance(parseInt(e.target.value))}
                      className="w-28 accent-[#3b82f6] cursor-pointer"
                    />
                    <span className="font-mono font-bold text-slate-200 w-8 text-right">{tolerance}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Preset Selector / Management */}
            <div className="flex flex-col gap-2 bg-[#2b2d31]/70 border border-[#383a40] p-3 rounded-2xl">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  Presets ({presets.length})
                </span>
                <button
                  type="button"
                  onClick={handleAddNewPreset}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#3b82f6]/20 hover:bg-[#3b82f6] text-[#60a5fa] hover:text-white text-[11px] font-bold transition-all cursor-pointer"
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
                  className="flex-1 bg-[#1e1f22] border border-[#383a40] focus:border-[#3b82f6] text-white text-xs px-3 py-1.5 rounded-xl outline-none"
                />

                {presets.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemovePreset(activePresetIndex)}
                    className="w-8 h-8 rounded-xl bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
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
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                        activePresetIndex === idx
                          ? 'bg-[#3b82f6] text-white'
                          : 'bg-[#1e1f22] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {p.name || `Preset ${idx + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Seletor de Tamanho Livre & Grade (1x1 até 64x64) */}
            <div className="bg-[#2b2d31]/70 border border-[#383a40] p-3 rounded-2xl flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  Tamanho da Seleção
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#1e1f22] text-blue-400 border border-[#383a40]">
                    Grade: {gridSnapSize}px
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#1e1f22] text-amber-400 border border-[#383a40]">
                    {selection.w}×{selection.h}px
                  </span>
                </div>
              </div>

              {/* Snap da Grade (1 a 64px) com sincronização automática do seletor */}
              <div className="flex flex-col gap-1.5 bg-[#1e1f22] p-2 rounded-xl border border-[#383a40]/60">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="text-[10px] font-bold text-slate-300">Grade / Snap (1 a 64px):</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={64}
                      value={gridSnapSize}
                      onChange={(e) => handleUpdateGridSize(parseInt(e.target.value) || 1)}
                      className="w-12 bg-[#141517] border border-[#383a40] focus:border-blue-500 text-blue-400 font-mono text-center text-xs px-1 py-0.5 rounded-lg outline-none"
                    />
                    <span className="text-[10px] text-slate-500">px</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1}
                    max={64}
                    value={gridSnapSize}
                    onChange={(e) => handleUpdateGridSize(parseInt(e.target.value) || 1)}
                    className="flex-1 accent-blue-500 cursor-pointer h-1.5"
                    title="Ajuste fino da grade (sincroniza o seletor)"
                  />
                  <span className="text-[9px] font-mono text-slate-400 min-w-[32px] text-right">
                    {gridSnapSize}×{gridSnapSize}
                  </span>
                </div>

                {/* Botões Rápidos de Grade */}
                <div className="flex items-center justify-between gap-1 pt-1 border-t border-white/5">
                  {[1, 8, 16, 24, 32, 48, 64].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleUpdateGridSize(s)}
                      className={`flex-1 py-0.5 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                        gridSnapSize === s
                          ? 'bg-blue-600 border-blue-400 text-white shadow'
                          : 'bg-[#141517] border-[#383a40] text-slate-400 hover:text-white'
                      }`}
                      title={`Ajusta a grade para ${s}px e o seletor para ${s}×${s}px`}
                    >
                      {s}px
                    </button>
                  ))}
                </div>
              </div>

              {/* Presets Rápidos de Tamanho (1x1 até 64x64) */}
              <div className="flex flex-wrap gap-1">
                {[
                  { label: '1×1', w: 1, h: 1 },
                  { label: '8×8', w: 8, h: 8 },
                  { label: '16×16', w: 16, h: 16 },
                  { label: '16×32', w: 16, h: 32 },
                  { label: '24×24', w: 24, h: 24 },
                  { label: '32×32', w: 32, h: 32 },
                  { label: '32×64', w: 32, h: 64 },
                  { label: '48×48', w: 48, h: 48 },
                  { label: '64×64', w: 64, h: 64 },
                ].map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => {
                      if (s.w === s.h) {
                        handleUpdateGridSize(s.w)
                      } else {
                        setGridSnapSize(s.w)
                        setExactDimensions(s.w, s.h)
                      }
                    }}
                    className={`flex-1 min-w-[36px] py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                      selection.w === s.w && selection.h === s.h
                        ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                        : 'bg-[#1e1f22] border-[#383a40] text-slate-400 hover:text-white'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Ajuste Numérico Direto em Pixels */}
              <div className="grid grid-cols-2 gap-2 bg-[#1e1f22] p-2 rounded-xl border border-[#383a40]/60">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="text-[10px] font-semibold">Largura:</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={512}
                      step={gridSnapSize > 0 ? gridSnapSize : 1}
                      value={selection.w}
                      onChange={(e) => setExactDimensions(parseInt(e.target.value) || 1, selection.h)}
                      className="w-14 bg-[#141517] border border-[#383a40] text-amber-300 font-mono text-center text-xs px-1 py-0.5 rounded-lg outline-none"
                    />
                    <span className="text-[10px] text-slate-500">px</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="text-[10px] font-semibold">Altura:</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={512}
                      step={gridSnapSize > 0 ? gridSnapSize : 1}
                      value={selection.h}
                      onChange={(e) => setExactDimensions(selection.w, parseInt(e.target.value) || 1)}
                      className="w-14 bg-[#141517] border border-[#383a40] text-amber-300 font-mono text-center text-xs px-1 py-0.5 rounded-lg outline-none"
                    />
                    <span className="text-[10px] text-slate-500">px</span>
                  </div>
                </div>
              </div>

              {/* Preview & Botões de Captura */}
              <div className="flex items-center gap-3 bg-[#1e1f22] p-2.5 rounded-xl border border-[#383a40]/60">
                <div className="w-16 h-16 rounded-lg bg-[#141517] border border-[#383a40] flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                  {selectedRegionDataUrl ? (
                    <img
                      src={selectedRegionDataUrl}
                      alt="Selection Preview"
                      style={{
                        maxWidth: '56px',
                        maxHeight: '56px',
                      }}
                      className="object-contain [image-rendering:pixelated]"
                    />
                  ) : (
                    <span className="text-[9px] text-slate-600">Vazio</span>
                  )}
                </div>

                <div className="flex-1 flex flex-col gap-1.5">
                  {isMultiBlock ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleAddSequentialFrames(activeDirectionTab)}
                        className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-extrabold shadow-md shadow-emerald-600/30 transition-all cursor-pointer"
                        title={`Fatia em blocos de ${gridSnapSize}px sequenciais`}
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>+ {totalBlocks} Frames Sequenciais</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAddCompositeFrame(activeDirectionTab)}
                        className="flex items-center justify-center gap-1 py-1 px-2 rounded-lg bg-[#2b2d31] hover:bg-[#383a40] border border-[#383a40] text-slate-300 hover:text-white text-[10px] font-semibold transition-all cursor-pointer"
                        title="Adiciona o recorte exato como 1 frame"
                      >
                        <Maximize2 className="w-3 h-3" />
                        <span>+ 1 Frame ({selection.w}×{selection.h}px)</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAddCompositeFrame(activeDirectionTab)}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-md shadow-emerald-600/30 transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>
                        + Adicionar Frame ({selection.w}×{selection.h}px) à {DIRECTIONS.find((d) => d.id === activeDirectionTab)?.label}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 4. Direction Tabs & Captured Frames List */}
            <div className="bg-[#2b2d31]/70 border border-[#383a40] p-3 rounded-2xl flex flex-col gap-3">
              {/* Direction Tabs */}
              <div className="grid grid-cols-4 gap-1.5">
                {DIRECTIONS.map((d) => {
                  const frameCount = activePreset?.directions[d.id]?.length || 0
                  const isSelectedTab = activeDirectionTab === d.id
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setActiveDirectionTab(d.id)}
                      className={`flex flex-col items-center py-2 px-1 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                        isSelectedTab
                          ? 'bg-[#3b82f6] border-[#60a5fa] text-white shadow-md'
                          : 'bg-[#1e1f22] border-[#383a40] text-slate-400 hover:text-white'
                      }`}
                    >
                      <span className="text-sm">{d.icon}</span>
                      <span className="text-[10px] mt-0.5">{d.label}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded-full mt-1 ${
                          frameCount > 0
                            ? isSelectedTab
                              ? 'bg-white text-blue-600 font-extrabold'
                              : 'bg-emerald-500/20 text-emerald-400'
                            : 'opacity-40'
                        }`}
                      >
                        {frameCount} {frameCount === 1 ? 'frame' : 'frames'}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Frames List for Active Direction */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-300 font-bold uppercase tracking-wider">
                  <span>Frames de {DIRECTIONS.find((d) => d.id === activeDirectionTab)?.label}:</span>
                  {activeDirectionFrames.length > 1 && (
                    <span className="text-emerald-400 lowercase font-semibold text-[10px]">
                      loop de caminhada ativo ({activeDirectionFrames.length} passos)
                    </span>
                  )}
                </div>

                {activeDirectionFrames.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-500 border border-dashed border-[#383a40] rounded-xl">
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
                          className={`group relative flex flex-col items-center p-1.5 rounded-xl bg-[#141517] border transition-all shrink-0 ${
                            isDragOver
                              ? 'border-indigo-400 bg-indigo-500/20 shadow-lg scale-105'
                              : isDragged
                              ? 'opacity-40 border-dashed border-blue-500 scale-95'
                              : 'border-slate-700 hover:border-slate-500'
                          }`}
                        >
                          {/* Top Drag Grip & Delete */}
                          <div className="w-full flex items-center justify-between pb-1 cursor-grab active:cursor-grabbing">
                            <span className="text-slate-600 hover:text-slate-400" title="Arraste para mover de lugar">
                              <GripVertical className="w-3 h-3" />
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveDirectionFrame(activeDirectionTab, idx)}
                              className="w-4 h-4 rounded-full bg-rose-500/20 hover:bg-rose-500 text-rose-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                              title="Remover este frame"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>

                          {/* Thumbnail (Click to Focus / Select Region on Spritesheet) */}
                          <button
                            type="button"
                            onClick={() => {
                              const fw = frame.w || 16
                              const fh = frame.h || 16
                              setSelection({ x: frame.x, y: frame.y, w: fw, h: fh })
                              if (sourceImg) {
                                sliceRegion(sourceImg, frame.x, frame.y, fw, fh)
                              }
                            }}
                            className="w-12 h-12 rounded-lg bg-[#18191c] hover:ring-2 hover:ring-blue-400 flex items-center justify-center overflow-hidden transition-all cursor-pointer"
                            title="Clique para posicionar a seleção neste frame"
                          >
                            <img
                              src={frame.dataUrl}
                              alt={`Frame ${idx}`}
                              className="w-10 h-10 object-contain [image-rendering:pixelated]"
                            />
                          </button>

                          <span className="text-[9px] font-bold text-slate-300 mt-1">
                            {idx === 0 ? '0 (Parado)' : `Passo ${idx}`}
                          </span>
                          <span className="text-[8px] text-slate-500 font-mono">
                            {frame.w || 16}×{frame.h || 16}
                          </span>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setIsPixelStudioOpen(true)
                            }}
                            className="flex items-center gap-1 px-1.5 py-0.5 mt-1 rounded bg-[#1e1f22] hover:bg-[#3b82f6] text-slate-300 hover:text-white text-[9px] font-bold transition-colors cursor-pointer"
                            title="Pintar e editar pixels no Estúdio Pixel Art"
                          >
                            <Paintbrush className="w-2.5 h-2.5 text-blue-400" />
                            <span>Pintar</span>
                          </button>

                          {/* Move Controls Strip (Move Left, Move Right, Transfer Direction) */}
                          <div className="flex items-center gap-1 mt-1.5 pt-1 border-t border-slate-800/80 w-full justify-center">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveFrameOrder(activeDirectionTab, idx, idx - 1)}
                              className={`p-1 rounded transition-colors ${
                                idx === 0
                                  ? 'opacity-30 cursor-not-allowed text-slate-600'
                                  : 'hover:bg-[#2b2d31] text-slate-400 hover:text-white cursor-pointer'
                              }`}
                              title="Mover frame para a esquerda"
                            >
                              <ChevronLeft className="w-3 h-3" />
                            </button>

                            <button
                              type="button"
                              onClick={() => setDirectionMenuIndex(isMenuOpen ? null : idx)}
                              className={`p-1 rounded transition-colors ${
                                isMenuOpen
                                  ? 'bg-indigo-600 text-white'
                                  : 'hover:bg-[#2b2d31] text-indigo-400 hover:text-white cursor-pointer'
                              }`}
                              title="Mover para outra direção (Frente, Costas, etc.)"
                            >
                              <ArrowRightLeft className="w-3 h-3" />
                            </button>

                            <button
                              type="button"
                              disabled={idx === activeDirectionFrames.length - 1}
                              onClick={() => handleMoveFrameOrder(activeDirectionTab, idx, idx + 1)}
                              className={`p-1 rounded transition-colors ${
                                idx === activeDirectionFrames.length - 1
                                  ? 'opacity-30 cursor-not-allowed text-slate-600'
                                  : 'hover:bg-[#2b2d31] text-slate-400 hover:text-white cursor-pointer'
                              }`}
                              title="Mover frame para a direita"
                            >
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Move to Direction Popover */}
                          {isMenuOpen && (
                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-30 bg-[#1e1f22] border border-indigo-500/40 rounded-xl p-1.5 shadow-2xl flex flex-col gap-1 w-28 animate-in fade-in zoom-in-95">
                              <span className="text-[9px] font-bold text-slate-400 px-1 border-b border-white/10 pb-0.5">
                                Mover para:
                              </span>
                              {DIRECTIONS.filter((d) => d.id !== activeDirectionTab).map((d) => (
                                <button
                                  key={d.id}
                                  type="button"
                                  onClick={() => handleMoveFrameToDirection(activeDirectionTab, idx, d.id)}
                                  className="text-[10px] font-semibold text-slate-200 hover:text-white hover:bg-indigo-600/30 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors text-left cursor-pointer"
                                >
                                  <span>{d.icon}</span>
                                  <span>{d.label}</span>
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() => setDirectionMenuIndex(null)}
                                className="text-[9px] text-slate-400 hover:text-white pt-0.5 text-center cursor-pointer"
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

              {/* Mirror Helper */}
              {(activeDirectionTab === 'left' || activeDirectionTab === 'right') && (
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#383a40]/60">
                  <button
                    type="button"
                    onClick={() => handleMirrorLateral('left', 'right')}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl bg-[#1e1f22] hover:bg-[#383a40] border border-[#383a40] text-slate-300 hover:text-white text-[11px] font-semibold transition-colors cursor-pointer"
                  >
                    <FlipHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Espelhar Esq ➔ Dir</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleMirrorLateral('right', 'left')}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl bg-[#1e1f22] hover:bg-[#383a40] border border-[#383a40] text-slate-300 hover:text-white text-[11px] font-semibold transition-colors cursor-pointer"
                  >
                    <FlipHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Espelhar Dir ➔ Esq</span>
                  </button>
                </div>
              )}
            </div>

            {/* 5. Live Walk Animation Preview */}
            <div className="bg-[#2b2d31]/70 border border-[#383a40] p-3 rounded-2xl flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  Pré-visualização do Loop
                </span>
                <button
                  type="button"
                  onClick={() => setIsPlayingWalk(!isPlayingWalk)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    isPlayingWalk
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-[#1e1f22] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {isPlayingWalk ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  <span>{isPlayingWalk ? 'Andando (Loop)' : 'Parado (Frame 0)'}</span>
                </button>
              </div>

              <div className="flex items-center justify-center bg-[#141517] p-3 rounded-xl border border-[#383a40]/60">
                <div className="w-16 h-16 rounded-xl bg-[#1e1f22] flex items-center justify-center overflow-hidden border border-slate-700/60 shadow-inner">
                  {currentPreviewFrame ? (
                    <img
                      src={currentPreviewFrame}
                      alt="Preview"
                      className="w-12 h-12 object-contain [image-rendering:pixelated]"
                    />
                  ) : (
                    <span className="text-xs text-slate-600">-</span>
                  )}
                </div>
              </div>
            </div>

            {/* Success Feedback */}
            {savedSuccessCount !== null && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs animate-in fade-in">
                <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>
                  {editingAsset
                    ? `Alterações em "${editingAsset.name}" salvas com sucesso!`
                    : `${savedSuccessCount} presets salvos e prontos para uso!`}
                </span>
              </div>
            )}

            {/* Bottom Final Action Button */}
            <div className="mt-auto pt-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleSaveAndEquip}
                className="w-full py-3 rounded-2xl text-xs font-extrabold bg-[#3b82f6] hover:bg-blue-500 text-white shadow-lg shadow-blue-500/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>{editingAsset ? `Salvar Alterações em "${editingAsset.name}"` : 'Salvar Presets no Avatar'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Generated XML Preview Modal */}
      {showXmlModal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-[#1e1f22] border border-[#383a40] w-full max-w-xl rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[80vh]">
            <div className="px-6 py-4 border-b border-[#2b2d31] flex items-center justify-between bg-[#18191c]">
              <div className="flex items-center gap-2">
                <FileCode className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-bold text-white">Sparrow TextureAtlas XML Gerado</h3>
              </div>
              <button
                onClick={() => setShowXmlModal(false)}
                className="w-7 h-7 rounded-lg bg-[#2b2d31] text-slate-400 hover:text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto">
              <pre className="text-[11px] font-mono bg-[#141517] p-4 rounded-xl border border-[#383a40] text-emerald-300 overflow-x-auto select-text">
                {generateXmlString()}
              </pre>
            </div>

            <div className="px-6 py-3 border-t border-[#2b2d31] bg-[#18191c] flex items-center justify-end gap-2">
              <button
                onClick={() => setShowXmlModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Fechar
              </button>
              <button
                onClick={handleDownloadXml}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#3b82f6] text-white hover:bg-blue-500 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Baixar Arquivo .xml</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pixel Art Painting Studio Modal */}
      {isPixelStudioOpen && (
        <AvatarPixelArtModal
          isOpen={isPixelStudioOpen}
          onClose={() => setIsPixelStudioOpen(false)}
          category={category}
          presetName={presets[activePresetIndex]?.name || editingAsset?.name || 'Personagem'}
          initialDirectionalFrames={getCurrentDirectionalFrames()}
          avatar={useGameStore.getState().localPlayer.avatar || DEFAULT_AVATAR}
          initialWidth={Math.max(1, Math.ceil(selection.w / 32))}
          initialHeight={Math.max(1, Math.ceil(selection.h / 32))}
          initialPixelWidth={selection.w}
          initialPixelHeight={selection.h}
          onSave={handleSaveFromStudio}
        />
      )}
    </div>
  )
}
