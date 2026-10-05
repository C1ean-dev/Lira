import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Pencil,
  Eraser,
  PaintBucket,
  Pipette,
  Move,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Grid,
  X,
  Check,
  RotateCcw,
  Sparkles,
  FlipHorizontal,
  Play,
  Pause,
  Plus,
  Copy,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { AvatarConfig, AvatarComponentSlot, Direction } from '../../types/game'
import { ColorWheelPicker } from '../../components/common/ColorWheelPicker'
import { smartRescalePixelArt, smartRescaleDataUrl } from '../../utils/imageResize'
import { spriteCollisionFromFrames, type SpriteCollision } from '../../utils/spriteHitbox'
import { centerOffset, clampedSizeText, composeFrameSource, parseSizeInput } from '../../utils/studioResize'

export type DrawTool = 'pencil' | 'eraser' | 'bucket' | 'picker' | 'move'

export type PixelArtCategory = AvatarComponentSlot | 'furniture' | 'floor' | 'wall'

interface Props {
  isOpen: boolean
  onClose: () => void
  category: PixelArtCategory
  presetName: string
  initialDataUrl?: string
  initialDirectionalFrames?: Partial<Record<Direction, string | string[]>>
  avatar?: AvatarConfig
  initialWidth?: number
  initialHeight?: number
  initialPixelWidth?: number
  initialPixelHeight?: number
  initialIsObstacle?: boolean
  initialSubCategory?: string
  onSave: (
    directionalFrames: Record<Direction, string | string[]>,
    name: string,
    options?: {
      width?: number
      height?: number
      pixelWidth?: number
      pixelHeight?: number
      isObstacle?: boolean
      category?: string
      /** Furniture with "Obstáculo" on: the tiles that have something visible in the drawing, per direction.
       *  null if the drawing could not be read; absent otherwise. */
      spriteCollision?: SpriteCollision | null
    }
  ) => void
}

// How long the canvas waits after the last key typed in Dimensões before it is resized
const LIVE_RESIZE_DELAY_MS = 180

const PRESET_PALETTE = [
  '#000000', '#1e1f22', '#475569', '#94a3b8', '#cbd5e1', '#ffffff',
  '#451a03', '#78350f', '#92400e', '#ffd1a4', '#d4a373', '#b07d62',
  '#e03131', '#ff6b6b', '#ff922b', '#fab005', '#fcc419', '#82c91e',
  '#20c997', '#2f9e44', '#15aabf', '#339af0', '#4c6ef5', '#be4bdb',
]

const CATEGORY_LABELS: Record<string, string> = {
  hair: 'Cabelo',
  top: 'Parte de Cima (Roupa)',
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

export const AvatarPixelArtModal: React.FC<Props> = ({
  isOpen,
  onClose,
  category,
  presetName,
  initialDataUrl,
  initialDirectionalFrames,
  avatar,
  initialWidth,
  initialHeight,
  initialPixelWidth,
  initialPixelHeight,
  initialIsObstacle,
  initialSubCategory,
  onSave,
}) => {
  if (!isOpen) return null

  // Canvas Dimensions in Pixels (allows from 1x1 up to any arbitrary size)
  const [pixelWidth, setPixelWidth] = useState<number>(() => {
    if (initialPixelWidth && initialPixelWidth > 0) return initialPixelWidth
    if (initialWidth && initialWidth > 0) return initialWidth * 32
    return 32
  })
  const [pixelHeight, setPixelHeight] = useState<number>(() => {
    if (initialPixelHeight && initialPixelHeight > 0) return initialPixelHeight
    if (initialHeight && initialHeight > 0) return initialHeight * 32
    return 32
  })
  const initialLoadedRef = useRef<boolean>(false)
  // Saving reads the drawing to work out the hitbox, which takes a moment: a second click must not save twice
  const savingRef = useRef<boolean>(false)

  useEffect(() => {
    initialLoadedRef.current = false
  }, [isOpen])
  const [inputWidthStr, setInputWidthStr] = useState<string>(() => String(pixelWidth))
  const [inputHeightStr, setInputHeightStr] = useState<string>(() => String(pixelHeight))

  // In-Game Display Size (Tamanho real no mapa em pixels)
  const [tamanhoWidth, setTamanhoWidth] = useState<number>(() => {
    if (initialPixelWidth && initialPixelWidth > 0) return initialPixelWidth
    if (initialWidth && initialWidth > 0) return initialWidth * 32
    return pixelWidth
  })
  const [tamanhoHeight, setTamanhoHeight] = useState<number>(() => {
    if (initialPixelHeight && initialPixelHeight > 0) return initialPixelHeight
    if (initialHeight && initialHeight > 0) return initialHeight * 32
    return pixelHeight
  })
  const [inputTamanhoWStr, setInputTamanhoWStr] = useState<string>(() => String(tamanhoWidth))
  const [inputTamanhoHStr, setInputTamanhoHStr] = useState<string>(() => String(tamanhoHeight))

  useEffect(() => {
    setInputTamanhoWStr(String(tamanhoWidth))
  }, [tamanhoWidth])

  useEffect(() => {
    setInputTamanhoHStr(String(tamanhoHeight))
  }, [tamanhoHeight])

  // The Dimensões fields show the size applied to the canvas, except while one of them is being edited
  const dimensionsFocusedRef = useRef<boolean>(false)
  // Size typed in Dimensões that the canvas has still to follow
  const [requestedCanvasSize, setRequestedCanvasSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    if (!dimensionsFocusedRef.current) setInputWidthStr(String(pixelWidth))
  }, [pixelWidth])

  useEffect(() => {
    if (!dimensionsFocusedRef.current) setInputHeightStr(String(pixelHeight))
  }, [pixelHeight])
  const [isObstacle, setIsObstacle] = useState<boolean>(initialIsObstacle !== undefined ? initialIsObstacle : true)
  const [furnitureCategory, setFurnitureCategory] = useState<string>(initialSubCategory || 'Geral')

  const canvasPixelWidth = Math.max(1, pixelWidth)
  const canvasPixelHeight = Math.max(1, pixelHeight)
  const tileWidth = Math.max(1, Math.ceil(canvasPixelWidth / 32))
  const tileHeight = Math.max(1, Math.ceil(canvasPixelHeight / 32))

  // Directional Multi-Frames State
  const [activeDirection, setActiveDirection] = useState<Direction>('down')
  const [activeFrameIndex, setActiveFrameIndex] = useState<number>(0)
  const [frameEpoch, setFrameEpoch] = useState<number>(0)
  const activeDirectionRef = useRef(activeDirection)
  activeDirectionRef.current = activeDirection
  const activeFrameIndexRef = useRef(activeFrameIndex)
  activeFrameIndexRef.current = activeFrameIndex

  // Drag & drop state for reordering frames in the timeline
  const [draggedFrameIndex, setDraggedFrameIndex] = useState<number | null>(null)
  const [dragOverFrameIndex, setDragOverFrameIndex] = useState<number | null>(null)

  const [directionalFrames, setDirectionalFrames] = useState<Record<Direction, string[]>>(() => {
    const parseFrames = (raw?: string | string[]): string[] => {
      if (!raw) return ['']
      if (Array.isArray(raw)) {
        const valid = raw.filter((f) => typeof f === 'string')
        return valid.length > 0 ? valid : ['']
      }
      return [raw]
    }

    return {
      down: parseFrames(initialDirectionalFrames?.down || initialDataUrl),
      up: parseFrames(initialDirectionalFrames?.up),
      left: parseFrames(initialDirectionalFrames?.left),
      right: parseFrames(initialDirectionalFrames?.right),
    }
  })

  // Master/original resolution frames cache (allows resampling from highest quality when resizing repeatedly)
  const masterFramesRef = useRef<Record<Direction, string[]>>({
    down: [],
    up: [],
    left: [],
    right: [],
  })
  const isResizingRef = useRef<boolean>(false)



  // Tools & Styling
  const [tool, setTool] = useState<DrawTool>('pencil')
  const toolRef = useRef<DrawTool>(tool)
  toolRef.current = tool

  const [color, setColor] = useState<string>('#4c6ef5')
  const [showColorWheel, setShowColorWheel] = useState<boolean>(false)
  const [recentColors, setRecentColors] = useState<string[]>([
    '#4c6ef5',
    '#ffffff',
    '#1e1f22',
    '#e03131',
    '#fab005',
    '#ffd1a4',
  ])

  // View state & Panning
  const [zoom, setZoom] = useState<number>(14)
  const [defaultZoom, setDefaultZoom] = useState<number>(14)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const defaultZoomRef = useRef(defaultZoom)
  defaultZoomRef.current = defaultZoom

  const [showGrid, setShowGrid] = useState<boolean>(true)
  // The name is what the caller gives: editing something keeps its name. A caller that saves a copy of a
  // built-in preset says so in the name it passes (utils/studioNaming.ts).
  const [customName, setCustomName] = useState<string>(
    presetName || `Novo ${CATEGORY_LABELS[category]}`
  )

  // Canvas Panning (Right Click Drag, Middle Click Drag, Space + Left Click, Mouse Scroll)
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const panOffsetRef = useRef(panOffset)
  panOffsetRef.current = panOffset

  const [isPanning, setIsPanning] = useState<boolean>(false)
  const isPanningRef = useRef(false)
  const panStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({
    mouseX: 0,
    mouseY: 0,
    startX: 0,
    startY: 0,
  })

  // Image Content Transform Mode (Move Tool: Pan & Scale Artwork)
  const [scaleDisplay, setScaleDisplay] = useState<string | null>(null)
  const [transformScaleState, setTransformScaleState] = useState<number>(1.0)
  const transformSourceCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const unclippedFramesMapRef = useRef<Map<string, HTMLCanvasElement>>(new Map())
  const transformOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const transformScaleRef = useRef<number>(1.0)
  const transformCommitTimerRef = useRef<any>(null)
  const handleMoveFrameRef = useRef<(from: number, to: number) => void>(() => {})
  const isMovingContentRef = useRef<boolean>(false)
  const [isMovingContent, setIsMovingContent] = useState<boolean>(false)
  const moveStartRef = useRef<{ clientX: number; clientY: number; startX: number; startY: number }>({
    clientX: 0,
    clientY: 0,
    startX: 0,
    startY: 0,
  })

  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false)
  const isSpacePressedRef = useRef(false)
  const stageRef = useRef<HTMLDivElement | null>(null)

  const startPanning = useCallback((clientX: number, clientY: number) => {
    setIsPanning(true)
    isPanningRef.current = true
    panStartRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      startX: panOffsetRef.current.x,
      startY: panOffsetRef.current.y,
    }
  }, [])

  const calcBestZoom = (w: number, h: number) => {
    const maxDim = Math.max(w, h)
    if (maxDim <= 16) return 20
    if (maxDim <= 24) return 16
    if (maxDim <= 32) return 14
    if (maxDim <= 48) return 10
    if (maxDim <= 64) return 8
    if (maxDim <= 96) return 5
    if (maxDim <= 128) return 4
    if (maxDim <= 256) return 2
    return 1
  }



  // Drawing state
  const [isDrawing, setIsDrawing] = useState<boolean>(false)
  const [hoverPixel, setHoverPixel] = useState<{ x: number; y: number } | null>(null)
  const [previewDataUrl, setPreviewDataUrl] = useState<string>('')

  // Right Panel Animation Player Loop
  const [isPlaying, setIsPlaying] = useState<boolean>(true)
  const [animSpeedMs, setAnimSpeedMs] = useState<number>(160)
  const [animFrameIndex, setAnimFrameIndex] = useState<number>(0)

  // Canvas Refs
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Undo / Redo History per active frame
  const historyRef = useRef<ImageData[]>([])
  const historyStepRef = useRef<number>(-1)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // Save current canvas state to history and sync with directionalFrames
  const pushHistoryState = useCallback(() => {
    const canvas = drawCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const dataUrl = canvas.toDataURL('image/png')
    setPreviewDataUrl(dataUrl)

    setDirectionalFrames((prev) => {
      const list = [...(prev[activeDirection] || [''])]
      if (list[activeFrameIndex] === dataUrl) return prev
      list[activeFrameIndex] = dataUrl
      return {
        ...prev,
        [activeDirection]: list,
      }
    })

    if (!masterFramesRef.current[activeDirection]) {
      masterFramesRef.current[activeDirection] = []
    }
    masterFramesRef.current[activeDirection][activeFrameIndex] = dataUrl

    const currentState = ctx.getImageData(0, 0, canvasPixelWidth, canvasPixelHeight)
    const nextStep = historyStepRef.current + 1
    historyRef.current = historyRef.current.slice(0, nextStep)
    historyRef.current.push(currentState)

    if (historyRef.current.length > 40) {
      historyRef.current.shift()
    } else {
      historyStepRef.current = nextStep
    }

    setCanUndo(historyStepRef.current > 0)
    setCanRedo(historyStepRef.current < historyRef.current.length - 1)
  }, [activeDirection, activeFrameIndex, canvasPixelWidth, canvasPixelHeight])

  // Capture a pristine unclipped snapshot of current drawing canvas as the baseline for Move/Scale
  const captureTransformSource = useCallback(() => {
    const frameKey = `${activeDirection}_${activeFrameIndex}`
    const existingUnclipped = unclippedFramesMapRef.current.get(frameKey)
    const canvas = drawCanvasRef.current

    if (
      existingUnclipped &&
      canvas &&
      (existingUnclipped.width > canvas.width || existingUnclipped.height > canvas.height)
    ) {
      transformSourceCanvasRef.current = existingUnclipped
      transformOffsetRef.current = { x: 0, y: 0 }
      transformScaleRef.current = 1.0
      setTransformScaleState(1.0)
      setScaleDisplay(null)
      return
    }

    if (!canvas) return
    const temp = document.createElement('canvas')
    temp.width = canvas.width
    temp.height = canvas.height
    const ctx = temp.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(canvas, 0, 0)
    transformSourceCanvasRef.current = temp
    unclippedFramesMapRef.current.set(frameKey, temp)
    transformOffsetRef.current = { x: 0, y: 0 }
    transformScaleRef.current = 1.0
    setTransformScaleState(1.0)
    setScaleDisplay(null)
  }, [activeDirection, activeFrameIndex])

  // Redraw image from pristine source with exact scale and offset (centered within canvas)
  const redrawTransformedImage = useCallback(
    (
      source: HTMLCanvasElement,
      offsetX: number,
      offsetY: number,
      scale: number
    ) => {
      const canvas = drawCanvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const w = canvas.width
      const h = canvas.height

      const srcW = source.width
      const srcH = source.height

      const S = scale
      const destW = Math.round(srcW * S)
      const destH = Math.round(srcH * S)
      // Scale anchored symmetrically to the center of the canvas:
      const destX = Math.round((w - destW) / 2 + offsetX)
      const destY = Math.round((h - destH) / 2 + offsetY)

      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(source, 0, 0, srcW, srcH, destX, destY, destW, destH)

      setPreviewDataUrl(canvas.toDataURL('image/png'))
    },
    []
  )

  // Commit transform result to history and directionalFrames
  const commitTransform = useCallback(() => {
    if (transformCommitTimerRef.current) {
      clearTimeout(transformCommitTimerRef.current)
      transformCommitTimerRef.current = null
    }
    pushHistoryState()
  }, [pushHistoryState])

  // Reset transform to 100% scale and center offset
  const resetTransform = useCallback(() => {
    if (!transformSourceCanvasRef.current) return
    transformOffsetRef.current = { x: 0, y: 0 }
    transformScaleRef.current = 1.0
    setTransformScaleState(1.0)
    setScaleDisplay(null)
    redrawTransformedImage(transformSourceCanvasRef.current, 0, 0, 1.0)
    commitTransform()
  }, [redrawTransformedImage, commitTransform])

  // Fit entire source image inside the canvas dimensions without cropping
  const fitTransform = useCallback(() => {
    if (!transformSourceCanvasRef.current) {
      captureTransformSource()
    }
    const source = transformSourceCanvasRef.current
    const canvas = drawCanvasRef.current
    if (!source || !canvas) return

    const fitScale = Math.min(1.0, canvas.width / source.width, canvas.height / source.height)
    const roundedScale = Math.max(0.05, Math.round(fitScale * 100) / 100)
    transformOffsetRef.current = { x: 0, y: 0 }
    transformScaleRef.current = roundedScale
    setTransformScaleState(roundedScale)
    setScaleDisplay(null)
    redrawTransformedImage(source, 0, 0, roundedScale)
    commitTransform()
  }, [captureTransformSource, redrawTransformedImage, commitTransform])

  // Nudge transform by (dx, dy) pixels (via arrows or keys)
  const nudgeTransform = useCallback(
    (dx: number, dy: number) => {
      if (!transformSourceCanvasRef.current) {
        captureTransformSource()
      }
      const source = transformSourceCanvasRef.current
      if (!source) return

      const newX = transformOffsetRef.current.x + dx
      const newY = transformOffsetRef.current.y + dy
      transformOffsetRef.current = { x: newX, y: newY }

      redrawTransformedImage(source, newX, newY, transformScaleRef.current)

      if (transformCommitTimerRef.current) {
        clearTimeout(transformCommitTimerRef.current)
      }
      transformCommitTimerRef.current = setTimeout(() => {
        commitTransform()
      }, 500)
    },
    [captureTransformSource, redrawTransformedImage, commitTransform]
  )

  // Step scale transform by multiplier (+10% or -10%)
  const stepScaleTransform = useCallback(
    (multiplier: number) => {
      if (!transformSourceCanvasRef.current) {
        captureTransformSource()
      }
      const source = transformSourceCanvasRef.current
      if (!source) return

      const newScale = Math.max(0.1, Math.min(10.0, Math.round(transformScaleRef.current * multiplier * 100) / 100))
      transformScaleRef.current = newScale
      setTransformScaleState(newScale)

      redrawTransformedImage(
        source,
        transformOffsetRef.current.x,
        transformOffsetRef.current.y,
        newScale
      )

      setScaleDisplay(`${Math.round(newScale * 100)}%`)

      if (transformCommitTimerRef.current) {
        clearTimeout(transformCommitTimerRef.current)
      }
      transformCommitTimerRef.current = setTimeout(() => {
        setScaleDisplay(null)
        commitTransform()
      }, 600)
    },
    [captureTransformSource, redrawTransformedImage, commitTransform]
  )

  // Animation Loop for Right Panel Preview
  useEffect(() => {
    if (!isPlaying) return
    const activeFrames = directionalFrames[activeDirection] || []
    if (activeFrames.length <= 1) return

    const timer = setInterval(() => {
      setAnimFrameIndex((prev) => (prev + 1) % activeFrames.length)
    }, animSpeedMs)

    return () => clearInterval(timer)
  }, [isPlaying, animSpeedMs, activeDirection, directionalFrames])

  // Sync toolRef and capture/flush transform when switching tools
  useEffect(() => {
    toolRef.current = tool
    if (tool === 'move') {
      captureTransformSource()
    } else {
      transformSourceCanvasRef.current = null
      transformOffsetRef.current = { x: 0, y: 0 }
      transformScaleRef.current = 1.0
      setTransformScaleState(1.0)
      setScaleDisplay(null)
    }
  }, [tool, captureTransformSource])

  // Spacebar tracking for Photoshop/Figma-style Space+Drag pan & Move Tool Nudge / Scale
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return
      }

      // Keyboard shortcut to move active frame in timeline: Alt + ArrowLeft / Alt + ArrowRight
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        const curIdx = activeFrameIndexRef.current
        if (e.key === 'ArrowLeft') {
          handleMoveFrameRef.current(curIdx, curIdx - 1)
        } else {
          handleMoveFrameRef.current(curIdx, curIdx + 1)
        }
        return
      }

      // Keyboard pixel nudge & image scale when Move Tool is active
      if (toolRef.current === 'move') {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault()
          stepScaleTransform(1.1)
          return
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault()
          stepScaleTransform(0.9)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          nudgeTransform(0, -1)
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          nudgeTransform(0, 1)
          return
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          nudgeTransform(-1, 0)
          return
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          nudgeTransform(1, 0)
          return
        }
      }

      if (e.code === 'Space' && !e.repeat) {
        setIsSpacePressed(true)
        isSpacePressedRef.current = true
      } else if (e.code === 'KeyV' || e.code === 'KeyM') {
        setTool('move')
      } else if (e.code === 'KeyB' || e.code === 'KeyP') {
        setTool('pencil')
      } else if (e.code === 'KeyE') {
        setTool('eraser')
      } else if (e.code === 'KeyG') {
        setTool('bucket')
      } else if (e.code === 'KeyI') {
        setTool('picker')
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false)
        isSpacePressedRef.current = false
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [stepScaleTransform, nudgeTransform])

  // Mouse Wheel (Ctrl/Meta + Wheel = Zoom at Cursor, Normal Wheel = Pan/Scroll, Move Tool = Scale Artwork Image)
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Case 0: When Move Tool is active ('mover espaço'), mouse scroll scales the artwork IMAGE itself!
      // Always scales from the unclipped pristine source canvas anchored to the center; does NOT zoom or pan viewport.
      if (toolRef.current === 'move') {
        if (!transformSourceCanvasRef.current) {
          captureTransformSource()
        }
        const source = transformSourceCanvasRef.current
        if (!source) return

        // Step by 5% per standard wheel notch (or 12% if Shift is held)
        const step = e.shiftKey ? 0.12 : 0.05
        const multiplier = e.deltaY < 0 ? (1 + step) : (1 / (1 + step))
        const newScale = Math.max(0.1, Math.min(10.0, Math.round(transformScaleRef.current * multiplier * 100) / 100))
        transformScaleRef.current = newScale
        setTransformScaleState(newScale)

        redrawTransformedImage(
          source,
          transformOffsetRef.current.x,
          transformOffsetRef.current.y,
          newScale
        )

        setScaleDisplay(`${Math.round(newScale * 100)}%`)

        if (transformCommitTimerRef.current) {
          clearTimeout(transformCommitTimerRef.current)
        }
        transformCommitTimerRef.current = setTimeout(() => {
          setScaleDisplay(null)
          commitTransform()
        }, 600)
        return
      }

      // Case 1: Zooming with Ctrl/Meta (or touchpad pinch-to-zoom)
      if (e.ctrlKey || e.metaKey) {
        const stageRect = stage.getBoundingClientRect()
        const stageCenterX = stageRect.left + stageRect.width / 2
        const stageCenterY = stageRect.top + stageRect.height / 2
        const relMouseX = e.clientX - stageCenterX
        const relMouseY = e.clientY - stageCenterY

        const currentZoom = zoomRef.current
        const currentPan = panOffsetRef.current

        let deltaZoom = 0
        if (e.deltaY < 0) {
          // Zoom IN
          deltaZoom = currentZoom < 4 ? 1 : currentZoom < 12 ? 2 : 4
        } else if (e.deltaY > 0) {
          // Zoom OUT
          deltaZoom = currentZoom <= 4 ? -1 : currentZoom <= 12 ? -2 : -4
        }

        if (deltaZoom === 0) return

        const nextZoom = Math.min(32, Math.max(1, currentZoom + deltaZoom))
        if (nextZoom === currentZoom) return

        const k = nextZoom / currentZoom
        // Keep the exact pixel under mouse cursor stationary!
        const nextPanX = relMouseX - (relMouseX - currentPan.x) * k
        const nextPanY = relMouseY - (relMouseY - currentPan.y) * k

        setZoom(nextZoom)
        setPanOffset({ x: nextPanX, y: nextPanY })
        return
      }

      // Case 2: Normal Wheel = Pan/Scroll
      const currentPan = panOffsetRef.current
      if (e.shiftKey) {
        setPanOffset({
          x: currentPan.x - e.deltaY,
          y: currentPan.y,
        })
      } else {
        setPanOffset({
          x: currentPan.x - (e.deltaX || 0),
          y: currentPan.y - e.deltaY,
        })
      }
    }

    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      stage.removeEventListener('wheel', handleWheel)
    }
  }, [captureTransformSource, redrawTransformedImage, commitTransform])

  // Global mouse tracking while panning (Right Click, Middle Click, or Space + Left Click)
  useEffect(() => {
    if (!isPanning) return

    const onGlobalMouseMove = (e: MouseEvent) => {
      if (!isPanningRef.current) return
      // If mouse buttons are released without triggering mouseup (e.g. outside window)
      if (e.buttons === 0) {
        setIsPanning(false)
        isPanningRef.current = false
        return
      }
      const dx = e.clientX - panStartRef.current.mouseX
      const dy = e.clientY - panStartRef.current.mouseY
      setPanOffset({
        x: panStartRef.current.startX + dx,
        y: panStartRef.current.startY + dy,
      })
    }

    const onGlobalMouseUp = (e: MouseEvent) => {
      if (isPanningRef.current) {
        setIsPanning(false)
        isPanningRef.current = false
      }
    }

    const onGlobalContextMenu = (e: MouseEvent) => {
      // Prevent browser context menu on right-click drag release
      e.preventDefault()
    }

    window.addEventListener('mousemove', onGlobalMouseMove)
    window.addEventListener('mouseup', onGlobalMouseUp)
    window.addEventListener('contextmenu', onGlobalContextMenu)
    return () => {
      window.removeEventListener('mousemove', onGlobalMouseMove)
      window.removeEventListener('mouseup', onGlobalMouseUp)
      window.removeEventListener('contextmenu', onGlobalContextMenu)
    }
  }, [isPanning])

  // Global mouse tracking while dragging content with Move Tool
  useEffect(() => {
    if (!isMovingContent) return

    const onGlobalMouseMove = (e: MouseEvent) => {
      if (!isMovingContentRef.current || !transformSourceCanvasRef.current) return
      const canvas = drawCanvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      const deltaX = Math.round((e.clientX - moveStartRef.current.clientX) * scaleX)
      const deltaY = Math.round((e.clientY - moveStartRef.current.clientY) * scaleY)

      const newOffsetX = moveStartRef.current.startX + deltaX
      const newOffsetY = moveStartRef.current.startY + deltaY

      transformOffsetRef.current = { x: newOffsetX, y: newOffsetY }

      redrawTransformedImage(
        transformSourceCanvasRef.current,
        newOffsetX,
        newOffsetY,
        transformScaleRef.current
      )
    }

    const onGlobalMouseUp = () => {
      if (isMovingContentRef.current) {
        isMovingContentRef.current = false
        setIsMovingContent(false)
        commitTransform()
      }
    }

    window.addEventListener('mousemove', onGlobalMouseMove)
    window.addEventListener('mouseup', onGlobalMouseUp)
    return () => {
      window.removeEventListener('mousemove', onGlobalMouseMove)
      window.removeEventListener('mouseup', onGlobalMouseUp)
    }
  }, [isMovingContent, redrawTransformedImage, commitTransform])

  // Load artwork for activeDirection and activeFrameIndex onto drawing canvas
  useEffect(() => {
    if (isResizingRef.current) return
    const canvas = drawCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvasPixelWidth, canvasPixelHeight)

    const currentFrames = directionalFrames[activeDirection] || ['']
    const safeIndex = Math.min(activeFrameIndex, Math.max(0, currentFrames.length - 1))
    const currentImgUrl = currentFrames[safeIndex] || ''

    if (currentImgUrl) {
      const img = new Image()
      img.src = currentImgUrl
      img.onload = () => {
        // On initial load of an image, the canvas dimensions MUST adapt to the image's actual resolution!
        if (!initialLoadedRef.current && img.naturalWidth > 0 && img.naturalHeight > 0) {
          initialLoadedRef.current = true
          if (img.naturalWidth !== canvasPixelWidth || img.naturalHeight !== canvasPixelHeight) {
            setPixelWidth(img.naturalWidth)
            setPixelHeight(img.naturalHeight)
            setInputWidthStr(String(img.naturalWidth))
            setInputHeightStr(String(img.naturalHeight))
            const bestZ = calcBestZoom(img.naturalWidth, img.naturalHeight)
            setZoom(bestZ)
            setDefaultZoom(bestZ)
            setPanOffset({ x: 0, y: 0 })
            return // Re-runs effect with the exact canvas dimensions!
          }
        }

        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, canvasPixelWidth, canvasPixelHeight)

        // Draw 1:1 pixel perfect!
        ctx.drawImage(img, 0, 0)

        // Store unclipped version in map
        const fKey = `${activeDirection}_${safeIndex}`
        if (!unclippedFramesMapRef.current.has(fKey)) {
          const uCanvas = document.createElement('canvas')
          uCanvas.width = img.naturalWidth
          uCanvas.height = img.naturalHeight
          const uCtx = uCanvas.getContext('2d')
          if (uCtx) {
            uCtx.imageSmoothingEnabled = false
            uCtx.drawImage(img, 0, 0)
            unclippedFramesMapRef.current.set(fKey, uCanvas)
          }
        }

        setPreviewDataUrl(currentImgUrl)
        historyRef.current = [ctx.getImageData(0, 0, canvasPixelWidth, canvasPixelHeight)]
        historyStepRef.current = 0
        setCanUndo(false)
        setCanRedo(false)
      }
      img.onerror = () => {
        ctx.clearRect(0, 0, canvasPixelWidth, canvasPixelHeight)
        setPreviewDataUrl('')
        historyRef.current = [ctx.getImageData(0, 0, canvasPixelWidth, canvasPixelHeight)]
        historyStepRef.current = 0
        setCanUndo(false)
        setCanRedo(false)
      }
    } else {
      ctx.clearRect(0, 0, canvasPixelWidth, canvasPixelHeight)
      setPreviewDataUrl('')
      historyRef.current = [ctx.getImageData(0, 0, canvasPixelWidth, canvasPixelHeight)]
      historyStepRef.current = 0
      setCanUndo(false)
      setCanRedo(false)
    }
  }, [activeDirection, activeFrameIndex, canvasPixelWidth, canvasPixelHeight, frameEpoch])

  // Helper to commit current drawing canvas to state
  const commitCurrentCanvas = () => {
    const canvas = drawCanvasRef.current
    if (!canvas) return
    const currentData = canvas.toDataURL('image/png')
    setDirectionalFrames((prev) => {
      const list = [...(prev[activeDirection] || [''])]
      list[activeFrameIndex] = currentData
      return { ...prev, [activeDirection]: list }
    })
    if (!masterFramesRef.current[activeDirection]) {
      masterFramesRef.current[activeDirection] = []
    }
    masterFramesRef.current[activeDirection][activeFrameIndex] = currentData
    transformSourceCanvasRef.current = null
    transformOffsetRef.current = { x: 0, y: 0 }
    transformScaleRef.current = 1.0
    setTransformScaleState(1.0)
    setScaleDisplay(null)
  }

  // Resize Dimensions handler with smart high-fidelity downsampling / upsampling
  const handleResizeDimensions = async (newW: number, newH: number) => {
    const targetW = Math.max(1, Math.round(newW))
    const targetH = Math.max(1, Math.round(newH))
    if (targetW === pixelWidth && targetH === pixelHeight) return

    isResizingRef.current = true

    const canvas = drawCanvasRef.current
    const activeFrameKey = `${activeDirection}_${activeFrameIndex}`

    commitCurrentCanvas()

    const activeFrameUrl = canvas ? canvas.toDataURL('image/png') : ''

    // Current working snapshot across all directions
    const currentFramesSnapshot: Record<Direction, string[]> = {
      down: [...(directionalFrames.down || [])],
      up: [...(directionalFrames.up || [])],
      left: [...(directionalFrames.left || [])],
      right: [...(directionalFrames.right || [])],
    }

    if (activeFrameUrl) {
      const list = [...(currentFramesSnapshot[activeDirection] || [''])]
      list[activeFrameIndex] = activeFrameUrl
      currentFramesSnapshot[activeDirection] = list
    }

    const directions: Direction[] = ['down', 'up', 'left', 'right']

    // Keep artwork at 1:1 pixel scale centered within the new canvas dimensions (no stretching or distortion)
    const resizedCanvasFrames: Record<Direction, string[]> = {
      down: [],
      up: [],
      left: [],
      right: [],
    }

    await Promise.all(
      directions.map(async (dir) => {
        const list = currentFramesSnapshot[dir] || []
        const resizedList = await Promise.all(
          list.map(async (frameUrl, fIdx) => {
            if (!frameUrl) return ''

            // The frame as it is on the canvas now, plus whatever of it lies outside a smaller canvas
            const fKey = `${dir}_${fIdx}`
            const source = await composeFrameSource(unclippedFramesMapRef.current.get(fKey), frameUrl)
            if (!source) return ''
            unclippedFramesMapRef.current.set(fKey, source)

            const off = document.createElement('canvas')
            off.width = targetW
            off.height = targetH
            const oCtx = off.getContext('2d')
            if (!oCtx) return ''
            oCtx.imageSmoothingEnabled = false
            const offset = centerOffset(
              { width: targetW, height: targetH },
              { width: source.width, height: source.height }
            )
            oCtx.drawImage(source, offset.x, offset.y)
            return off.toDataURL('image/png')
          })
        )
        resizedCanvasFrames[dir] = resizedList
      })
    )

    const activeUnclipped = unclippedFramesMapRef.current.get(activeFrameKey)

    masterFramesRef.current = {
      down: [...resizedCanvasFrames.down],
      up: [...resizedCanvasFrames.up],
      left: [...resizedCanvasFrames.left],
      right: [...resizedCanvasFrames.right],
    }

    // Update active drawing canvas directly with newly placed image
    if (canvas) {
      canvas.width = targetW
      canvas.height = targetH
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, targetW, targetH)

        if (activeUnclipped) {
          const srcW = activeUnclipped.width
          const srcH = activeUnclipped.height
          const destX = Math.round((targetW - srcW) / 2)
          const destY = Math.round((targetH - srcH) / 2)
          ctx.drawImage(activeUnclipped, destX, destY)
        } else {
          const newActiveDataUrl = resizedCanvasFrames[activeDirection]?.[activeFrameIndex] || ''
          if (newActiveDataUrl) {
            const img = new Image()
            img.src = newActiveDataUrl
            await new Promise<void>((resolve) => {
              img.onload = () => {
                ctx.drawImage(img, 0, 0)
                resolve()
              }
              img.onerror = () => resolve()
            })
          }
        }
        historyRef.current = [ctx.getImageData(0, 0, targetW, targetH)]
        historyStepRef.current = 0
        setCanUndo(false)
        setCanRedo(false)
        setPreviewDataUrl(canvas.toDataURL('image/png'))
      }
    }

    // Keep the pristine unclipped source active for the Move Tool!
    if (activeUnclipped) {
      transformSourceCanvasRef.current = activeUnclipped
      transformOffsetRef.current = { x: 0, y: 0 }
      transformScaleRef.current = 1.0
      setTransformScaleState(1.0)
      setScaleDisplay(null)
    } else {
      transformSourceCanvasRef.current = null
      transformOffsetRef.current = { x: 0, y: 0 }
      transformScaleRef.current = 1.0
      setTransformScaleState(1.0)
      setScaleDisplay(null)
    }

    // Automatically switch to 'move' tool so user can immediately scroll to scale or reposition
    setTool('move')
    toolRef.current = 'move'

    // Adaptive zoom scaling for comfortable editing
    const bestZ = calcBestZoom(targetW, targetH)
    setZoom(bestZ)
    setDefaultZoom(bestZ)
    setPanOffset({ x: 0, y: 0 })

    setDirectionalFrames(resizedCanvasFrames)
    setPixelWidth(targetW)
    setPixelHeight(targetH)
    isResizingRef.current = false
  }

  const handleApplyDimensions = () => {
    const parsedW = parseInt(inputWidthStr, 10)
    const parsedH = parseInt(inputHeightStr, 10)
    const safeW = isNaN(parsedW) || parsedW < 1 ? pixelWidth : Math.min(4096, parsedW)
    const safeH = isNaN(parsedH) || parsedH < 1 ? pixelHeight : Math.min(4096, parsedH)
    setInputWidthStr(String(safeW))
    setInputHeightStr(String(safeH))
    if (isResizingRef.current) {
      // a resize is running: this one is applied when it ends
      setRequestedCanvasSize({ width: safeW, height: safeH })
      return
    }
    setRequestedCanvasSize(null)
    if (safeW !== pixelWidth || safeH !== pixelHeight) {
      initialLoadedRef.current = true
      handleResizeDimensions(safeW, safeH)
    }
  }

  const handleDimensionsBlur = () => {
    dimensionsFocusedRef.current = false
    handleApplyDimensions()
  }

  // Dimensões and Tamanho follow what is typed: the size is applied while typing, not only on blur / Enter.
  // A field that is empty or below 1 changes nothing until it holds a valid size; above 4096 it becomes 4096.
  const handleDimensionsInput = (axis: 'width' | 'height', typedText: string) => {
    const shownText = clampedSizeText(typedText)
    if (axis === 'width') setInputWidthStr(shownText)
    else setInputHeightStr(shownText)
    const typedSize = parseSizeInput(shownText)
    if (typedSize === null) {
      setRequestedCanvasSize(null)
      return
    }
    const requestedWidth = axis === 'width' ? typedSize : parseSizeInput(inputWidthStr) ?? pixelWidth
    const requestedHeight = axis === 'height' ? typedSize : parseSizeInput(inputHeightStr) ?? pixelHeight
    setRequestedCanvasSize({ width: requestedWidth, height: requestedHeight })
  }

  const handleTamanhoInput = (axis: 'width' | 'height', typedText: string) => {
    const shownText = clampedSizeText(typedText)
    if (axis === 'width') setInputTamanhoWStr(shownText)
    else setInputTamanhoHStr(shownText)
    const typedSize = parseSizeInput(shownText)
    if (typedSize === null) return
    if (axis === 'width') setTamanhoWidth(typedSize)
    else setTamanhoHeight(typedSize)
  }

  // The canvas follows the size typed in Dimensões once the typing pauses, one resize at a time
  const resizeHandlerRef = useRef(handleResizeDimensions)
  resizeHandlerRef.current = handleResizeDimensions

  useEffect(() => {
    const requestedSize = requestedCanvasSize
    if (!requestedSize || (requestedSize.width === pixelWidth && requestedSize.height === pixelHeight)) return
    const timer = setTimeout(() => {
      // a resize that is running re-runs this effect when it ends (the applied size changes)
      if (isResizingRef.current) return
      initialLoadedRef.current = true
      void resizeHandlerRef.current(requestedSize.width, requestedSize.height).finally(() => {
        isResizingRef.current = false
      })
    }, LIVE_RESIZE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [requestedCanvasSize, pixelWidth, pixelHeight])

  const handleApplyTamanho = () => {
    const parsedW = parseInt(inputTamanhoWStr, 10)
    const parsedH = parseInt(inputTamanhoHStr, 10)
    const safeW = isNaN(parsedW) || parsedW < 1 ? tamanhoWidth : Math.min(4096, parsedW)
    const safeH = isNaN(parsedH) || parsedH < 1 ? tamanhoHeight : Math.min(4096, parsedH)
    setInputTamanhoWStr(String(safeW))
    setInputTamanhoHStr(String(safeH))
    setTamanhoWidth(safeW)
    setTamanhoHeight(safeH)
  }

  // Direction Switcher
  const switchDirection = (newDir: Direction) => {
    if (newDir === activeDirection) return
    commitCurrentCanvas()
    setActiveDirection(newDir)
    const targetFrames = directionalFrames[newDir] || ['']
    setActiveFrameIndex((prevIdx) => Math.min(prevIdx, Math.max(0, targetFrames.length - 1)))
  }

  // Frame Navigation
  const switchFrame = (newIndex: number) => {
    if (newIndex === activeFrameIndex) return
    commitCurrentCanvas()
    setActiveFrameIndex(newIndex)
  }

  // Add a new blank frame
  const handleAddFrame = () => {
    commitCurrentCanvas()
    const currentList = directionalFrames[activeDirection] || ['']
    const newIndex = currentList.length

    setDirectionalFrames((prev) => {
      const list = [...(prev[activeDirection] || [''])]
      return {
        ...prev,
        [activeDirection]: [...list, ''],
      }
    })
    setActiveFrameIndex(newIndex)
  }

  // Duplicate current active frame (crucial for walk cycles!)
  const handleDuplicateFrame = () => {
    const canvas = drawCanvasRef.current
    const currentData = canvas ? canvas.toDataURL('image/png') : ''
    const currentList = directionalFrames[activeDirection] || ['']
    const duplicateData = currentData || currentList[activeFrameIndex] || ''
    const newIndex = activeFrameIndex + 1

    setDirectionalFrames((prev) => {
      const list = [...(prev[activeDirection] || [''])]
      list[activeFrameIndex] = currentData
      const newList = [
        ...list.slice(0, newIndex),
        duplicateData,
        ...list.slice(newIndex),
      ]
      return {
        ...prev,
        [activeDirection]: newList,
      }
    })

    if (masterFramesRef.current[activeDirection]) {
      const masterList = [...masterFramesRef.current[activeDirection]]
      masterList[activeFrameIndex] = currentData
      const duplicateMaster = currentData || masterList[activeFrameIndex] || ''
      masterFramesRef.current[activeDirection] = [
        ...masterList.slice(0, newIndex),
        duplicateMaster,
        ...masterList.slice(newIndex),
      ]
    }

    // Duplicate unclipped canvas if present
    const map = unclippedFramesMapRef.current
    const activeUnclipped = map.get(`${activeDirection}_${activeFrameIndex}`)
    const listLen = currentList.length
    const shiftCanvases: (HTMLCanvasElement | undefined)[] = []
    for (let i = 0; i < listLen; i++) {
      const key = `${activeDirection}_${i}`
      shiftCanvases.push(map.get(key))
      map.delete(key)
    }
    let clonedActive: HTMLCanvasElement | undefined
    if (activeUnclipped) {
      clonedActive = document.createElement('canvas')
      clonedActive.width = activeUnclipped.width
      clonedActive.height = activeUnclipped.height
      const cCtx = clonedActive.getContext('2d')
      if (cCtx) cCtx.drawImage(activeUnclipped, 0, 0)
    }
    const newCanvasList = [
      ...shiftCanvases.slice(0, newIndex),
      clonedActive,
      ...shiftCanvases.slice(newIndex),
    ]
    for (let i = 0; i < newCanvasList.length; i++) {
      const c = newCanvasList[i]
      if (c) map.set(`${activeDirection}_${i}`, c)
    }

    setActiveFrameIndex(newIndex)
  }

  // Delete a frame
  const handleDeleteFrame = (e: React.MouseEvent, indexToDelete: number) => {
    e.stopPropagation()
    const currentList = directionalFrames[activeDirection] || ['']
    if (currentList.length <= 1) {
      handleClear()
      return
    }

    const newList = currentList.filter((_, i) => i !== indexToDelete)
    setDirectionalFrames((prev) => ({
      ...prev,
      [activeDirection]: newList,
    }))

    if (masterFramesRef.current[activeDirection]) {
      masterFramesRef.current[activeDirection] = masterFramesRef.current[activeDirection].filter(
        (_, i) => i !== indexToDelete
      )
    }

    // Re-key unclipped pristine canvases
    const map = unclippedFramesMapRef.current
    const listLen = currentList.length
    const remainingCanvases: (HTMLCanvasElement | undefined)[] = []
    for (let i = 0; i < listLen; i++) {
      const key = `${activeDirection}_${i}`
      if (i !== indexToDelete) {
        remainingCanvases.push(map.get(key))
      }
      map.delete(key)
    }
    for (let i = 0; i < remainingCanvases.length; i++) {
      const c = remainingCanvases[i]
      if (c) map.set(`${activeDirection}_${i}`, c)
    }
    if (activeFrameIndex === indexToDelete) {
      const nextIndex = Math.min(indexToDelete, newList.length - 1)
      setActiveFrameIndex(nextIndex)
    } else if (activeFrameIndex > indexToDelete) {
      setActiveFrameIndex(activeFrameIndex - 1)
    }
    setFrameEpoch((prev) => prev + 1)
  }

  // Move / Reorder animation frames in active direction
  const handleMoveFrame = (fromIndex: number, toIndex: number) => {
    const dir = activeDirectionRef.current
    const list = directionalFrames[dir] || ['']
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= list.length ||
      toIndex >= list.length ||
      fromIndex === toIndex
    ) {
      return
    }

    const currentActiveIndex = activeFrameIndexRef.current

    // Commit current canvas state so in-progress pixel edits are preserved
    const canvas = drawCanvasRef.current
    const currentData = canvas ? canvas.toDataURL('image/png') : ''

    const reorder = <T,>(arr: T[], from: number, to: number): T[] => {
      const result = [...arr]
      const [removed] = result.splice(from, 1)
      result.splice(to, 0, removed)
      return result
    }

    setDirectionalFrames((prev) => {
      const frames = [...(prev[dir] || [''])]
      if (currentData && currentActiveIndex < frames.length) {
        frames[currentActiveIndex] = currentData
      }
      return {
        ...prev,
        [dir]: reorder(frames, fromIndex, toIndex),
      }
    })

    if (masterFramesRef.current[dir]) {
      const masterList = [...masterFramesRef.current[dir]]
      if (currentData && currentActiveIndex < masterList.length) {
        masterList[currentActiveIndex] = currentData
      }
      masterFramesRef.current[dir] = reorder(masterList, fromIndex, toIndex)
    }

    // Re-key unclipped pristine canvases in unclippedFramesMapRef for this direction
    const map = unclippedFramesMapRef.current
    const listLen = list.length
    const extractedCanvases: (HTMLCanvasElement | undefined)[] = []
    for (let i = 0; i < listLen; i++) {
      const key = `${dir}_${i}`
      extractedCanvases.push(map.get(key))
      map.delete(key)
    }
    const reorderedCanvases = reorder(extractedCanvases, fromIndex, toIndex)
    for (let i = 0; i < reorderedCanvases.length; i++) {
      const c = reorderedCanvases[i]
      if (c) {
        map.set(`${dir}_${i}`, c)
      }
    }

    // Update activeFrameIndex so selection stays with the moved frame
    if (currentActiveIndex === fromIndex) {
      setActiveFrameIndex(toIndex)
    } else if (fromIndex < currentActiveIndex && toIndex >= currentActiveIndex) {
      setActiveFrameIndex(currentActiveIndex - 1)
    } else if (fromIndex > currentActiveIndex && toIndex <= currentActiveIndex) {
      setActiveFrameIndex(currentActiveIndex + 1)
    }
  }
  handleMoveFrameRef.current = handleMoveFrame

  // Mirror Left/Right Side (mirrors all frames of current direction to opposite side)
  const handleMirrorOppositeSide = () => {
    const canvas = drawCanvasRef.current
    const currentData = canvas ? canvas.toDataURL('image/png') : ''
    const sourceFrames = [...(directionalFrames[activeDirection] || [''])]
    sourceFrames[activeFrameIndex] = currentData

    const targetDir: Direction = activeDirection === 'left' ? 'right' : 'left'

    const flipCanvas = document.createElement('canvas')
    flipCanvas.width = canvasPixelWidth
    flipCanvas.height = canvasPixelHeight
    const flipCtx = flipCanvas.getContext('2d')
    if (!flipCtx) return

    const mirrored: string[] = new Array(sourceFrames.length).fill('')
    let loaded = 0

    sourceFrames.forEach((frameUrl, idx) => {
      if (!frameUrl) {
        mirrored[idx] = ''
        loaded++
        if (loaded === sourceFrames.length) {
          setDirectionalFrames((prev) => ({
            ...prev,
            [activeDirection]: sourceFrames,
            [targetDir]: mirrored,
          }))
        }
        return
      }

      const img = new Image()
      img.src = frameUrl
      img.onload = () => {
        flipCtx.clearRect(0, 0, canvasPixelWidth, canvasPixelHeight)
        flipCtx.imageSmoothingEnabled = false
        flipCtx.save()
        flipCtx.translate(canvasPixelWidth, 0)
        flipCtx.scale(-1, 1)
        const drawW = Math.min(img.naturalWidth || canvasPixelWidth, canvasPixelWidth)
        const drawH = Math.min(img.naturalHeight || canvasPixelHeight, canvasPixelHeight)
        flipCtx.drawImage(img, 0, 0, drawW, drawH, 0, 0, drawW, drawH)
        flipCtx.restore()
        mirrored[idx] = flipCanvas.toDataURL('image/png')
        loaded++
        if (loaded === sourceFrames.length) {
          setDirectionalFrames((prev) => ({
            ...prev,
            [activeDirection]: sourceFrames,
            [targetDir]: mirrored,
          }))
        }
      }
      img.onerror = () => {
        mirrored[idx] = ''
        loaded++
        if (loaded === sourceFrames.length) {
          setDirectionalFrames((prev) => ({
            ...prev,
            [activeDirection]: sourceFrames,
            [targetDir]: mirrored,
          }))
        }
      }
    })
  }

  // Pixel Coordinates calculation
  const getCanvasPixelCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = drawCanvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const clientX = e.clientX - rect.left
    const clientY = e.clientY - rect.top
    const px = Math.floor(clientX * scaleX)
    const py = Math.floor(clientY * scaleY)

    if (px < 0 || px >= canvasPixelWidth || py < 0 || py >= canvasPixelHeight) return null
    return { x: px, y: py }
  }

  // Draw Pixel onto Context
  const applyPixel = useCallback(
    (x: number, y: number, currentTool: DrawTool, paintColor: string) => {
      const canvas = drawCanvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return

      if (currentTool === 'pencil') {
        ctx.fillStyle = paintColor
        ctx.fillRect(x, y, 1, 1)
      } else if (currentTool === 'eraser') {
        ctx.clearRect(x, y, 1, 1)
      }
    },
    []
  )

  // Flood Fill (Bucket)
  const floodFill = (startX: number, startY: number, fillColor: string) => {
    const canvas = drawCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const imgData = ctx.getImageData(0, 0, canvasPixelWidth, canvasPixelHeight)
    const data = imgData.data

    const startIndex = (startY * canvasPixelWidth + startX) * 4
    const targetR = data[startIndex]
    const targetG = data[startIndex + 1]
    const targetB = data[startIndex + 2]
    const targetA = data[startIndex + 3]

    // Convert fillColor hex to RGBA
    const hex = fillColor.replace('#', '')
    const fillR = parseInt(hex.substring(0, 2), 16) || 0
    const fillG = parseInt(hex.substring(2, 4), 16) || 0
    const fillB = parseInt(hex.substring(4, 6), 16) || 0
    const fillA = 255

    if (
      targetR === fillR &&
      targetG === fillG &&
      targetB === fillB &&
      targetA === fillA
    ) {
      return
    }

    const queue: [number, number][] = [[startX, startY]]
    const visited = new Uint8Array(canvasPixelWidth * canvasPixelHeight)

    while (queue.length > 0) {
      const [cx, cy] = queue.pop()!
      const idx = (cy * canvasPixelWidth + cx) * 4
      const pIdx = cy * canvasPixelWidth + cx

      if (visited[pIdx]) continue
      visited[pIdx] = 1

      if (
        data[idx] === targetR &&
        data[idx + 1] === targetG &&
        data[idx + 2] === targetB &&
        data[idx + 3] === targetA
      ) {
        data[idx] = fillR
        data[idx + 1] = fillG
        data[idx + 2] = fillB
        data[idx + 3] = fillA

        if (cx > 0) queue.push([cx - 1, cy])
        if (cx < canvasPixelWidth - 1) queue.push([cx + 1, cy])
        if (cy > 0) queue.push([cx, cy - 1])
        if (cy < canvasPixelHeight - 1) queue.push([cx, cy + 1])
      }
    }

    ctx.putImageData(imgData, 0, 0)
    pushHistoryState()
  }

  // Pipette (Eyedropper)
  const pickColor = (x: number, y: number) => {
    const canvas = drawCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const pixel = ctx.getImageData(x, y, 1, 1).data
    if (pixel[3] === 0) return

    const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2])
      .toString(16)
      .slice(1)}`

    setColor(hex)
    if (!recentColors.includes(hex)) {
      setRecentColors([hex, ...recentColors.slice(0, 7)])
    }
    setTool('pencil')
  }

  // Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Panning ONLY on Right Click (2), Middle Click (1), or Space + Left Click
    // Regular Left Click (0) on canvas NEVER drags where we are editing!
    if (
      e.button === 2 ||
      e.button === 1 ||
      (e.button === 0 && isSpacePressedRef.current)
    ) {
      e.preventDefault()
      startPanning(e.clientX, e.clientY)
      return
    }

    if (e.button === 0) {
      if (tool === 'move') {
        if (!transformSourceCanvasRef.current) {
          captureTransformSource()
        }
        moveStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          startX: transformOffsetRef.current.x,
          startY: transformOffsetRef.current.y,
        }
        setIsMovingContent(true)
        isMovingContentRef.current = true
        return
      }

      const pt = getCanvasPixelCoords(e)
      if (!pt) return

      if (tool === 'picker') {
        pickColor(pt.x, pt.y)
        return
      }

      if (tool === 'bucket') {
        floodFill(pt.x, pt.y, color)
        return
      }

      setIsDrawing(true)
      applyPixel(pt.x, pt.y, tool, color)
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning || isMovingContent) return

    const pt = getCanvasPixelCoords(e)
    setHoverPixel(pt)

    if (!isDrawing || !pt) return
    applyPixel(pt.x, pt.y, tool, color)
  }

  const handleCanvasMouseUp = () => {
    if (isDrawing) {
      setIsDrawing(false)
      pushHistoryState()
    }
  }

  const handleCanvasMouseLeave = () => {
    setHoverPixel(null)
    if (isDrawing) {
      setIsDrawing(false)
      pushHistoryState()
    }
  }

  // Undo & Redo
  const handleUndo = () => {
    if (historyStepRef.current <= 0) return
    const canvas = drawCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const nextStep = historyStepRef.current - 1
    const imgData = historyRef.current[nextStep]
    ctx.putImageData(imgData, 0, 0)
    historyStepRef.current = nextStep

    setCanUndo(nextStep > 0)
    setCanRedo(nextStep < historyRef.current.length - 1)
    const dataUrl = canvas.toDataURL('image/png')
    setPreviewDataUrl(dataUrl)
    setDirectionalFrames((prev) => {
      const list = [...(prev[activeDirection] || [''])]
      list[activeFrameIndex] = dataUrl
      return { ...prev, [activeDirection]: list }
    })
    if (toolRef.current === 'move') {
      captureTransformSource()
    }
  }

  const handleRedo = () => {
    if (historyStepRef.current >= historyRef.current.length - 1) return
    const canvas = drawCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const nextStep = historyStepRef.current + 1
    const imgData = historyRef.current[nextStep]
    ctx.putImageData(imgData, 0, 0)
    historyStepRef.current = nextStep

    setCanUndo(nextStep > 0)
    setCanRedo(nextStep < historyRef.current.length - 1)
    const dataUrl = canvas.toDataURL('image/png')
    setPreviewDataUrl(dataUrl)
    setDirectionalFrames((prev) => {
      const list = [...(prev[activeDirection] || [''])]
      list[activeFrameIndex] = dataUrl
      return { ...prev, [activeDirection]: list }
    })
    if (toolRef.current === 'move') {
      captureTransformSource()
    }
  }

  // Clear Canvas
  const handleClear = () => {
    const canvas = drawCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    ctx.clearRect(0, 0, canvasPixelWidth, canvasPixelHeight)
    pushHistoryState()
    if (toolRef.current === 'move') {
      captureTransformSource()
    }
  }

  // Final Save Handler
  const handleFinalSave = () => {
    const canvas = drawCanvasRef.current
    const currentData = canvas ? canvas.toDataURL('image/png') : ''
    const currentDirFrames = [...(directionalFrames[activeDirection] || [''])]
    currentDirFrames[activeFrameIndex] = currentData

    const finalFrames: Record<Direction, string[]> = {
      ...directionalFrames,
      [activeDirection]: currentDirFrames,
    }

    const finalPixelW = Math.max(1, tamanhoWidth)
    const finalPixelH = Math.max(1, tamanhoHeight)
    const finalTileW = Math.max(1, Math.ceil(finalPixelW / 32))
    const finalTileH = Math.max(1, Math.ceil(finalPixelH / 32))

    const saveOptions = {
      width: finalTileW,
      height: finalTileH,
      pixelWidth: finalPixelW,
      pixelHeight: finalPixelH,
      isObstacle,
      category: furnitureCategory,
    }

    // The hitbox follows the drawing: only the tiles with something visible in them block (spriteHitbox.ts)
    const commit = async (frames: Record<Direction, string[]>) => {
      if (savingRef.current) return
      savingRef.current = true
      try {
        const spriteCollision =
          category === 'furniture' && isObstacle
            ? await spriteCollisionFromFrames(frames, finalPixelW, finalPixelH)
            : undefined
        onSave(frames, customName.trim() || `Preset ${CATEGORY_LABELS[category]}`, { ...saveOptions, spriteCollision })
        onClose()
      } finally {
        savingRef.current = false
      }
    }

    if (category === 'floor') {
      finalFrames.up = [...finalFrames.down]
      finalFrames.left = [...finalFrames.down]
      finalFrames.right = [...finalFrames.down]
      onSave(finalFrames, customName.trim() || `Preset ${CATEGORY_LABELS[category]}`, saveOptions)
      onClose()
      return
    }

    // Auto-mirror: If left was drawn but right is completely empty, mirror left into right
    const hasLeft = finalFrames.left.some((f) => !!f)
    const hasRight = finalFrames.right.some((f) => !!f)

    if (hasLeft && !hasRight) {
      const flipCanvas = document.createElement('canvas')
      flipCanvas.width = canvasPixelWidth
      flipCanvas.height = canvasPixelHeight
      const flipCtx = flipCanvas.getContext('2d')
      if (flipCtx) {
        flipCtx.imageSmoothingEnabled = false
        const mirrored: string[] = new Array(finalFrames.left.length).fill('')
        let loaded = 0
        const leftFrames = finalFrames.left

        const completeSave = () => {
          finalFrames.right = mirrored
          void commit(finalFrames)
        }

        leftFrames.forEach((frameUrl, idx) => {
          if (!frameUrl) {
            mirrored[idx] = ''
            loaded++
            if (loaded === leftFrames.length) completeSave()
            return
          }
          const img = new Image()
          img.src = frameUrl
          img.onload = () => {
            flipCtx.clearRect(0, 0, canvasPixelWidth, canvasPixelHeight)
            flipCtx.save()
            flipCtx.translate(canvasPixelWidth, 0)
            flipCtx.scale(-1, 1)
            const drawW = Math.min(img.naturalWidth || canvasPixelWidth, canvasPixelWidth)
            const drawH = Math.min(img.naturalHeight || canvasPixelHeight, canvasPixelHeight)
            flipCtx.drawImage(img, 0, 0, drawW, drawH, 0, 0, drawW, drawH)
            flipCtx.restore()
            mirrored[idx] = flipCanvas.toDataURL('image/png')
            loaded++
            if (loaded === leftFrames.length) completeSave()
          }
          img.onerror = () => {
            mirrored[idx] = ''
            loaded++
            if (loaded === leftFrames.length) completeSave()
          }
        })
        return
      }
    }

    // Auto-mirror: If right was drawn but left is completely empty, mirror right into left
    if (hasRight && !hasLeft) {
      const flipCanvas = document.createElement('canvas')
      flipCanvas.width = canvasPixelWidth
      flipCanvas.height = canvasPixelHeight
      const flipCtx = flipCanvas.getContext('2d')
      if (flipCtx) {
        flipCtx.imageSmoothingEnabled = false
        const mirrored: string[] = new Array(finalFrames.right.length).fill('')
        let loaded = 0
        const rightFrames = finalFrames.right

        const completeSave = () => {
          finalFrames.left = mirrored
          void commit(finalFrames)
        }

        rightFrames.forEach((frameUrl, idx) => {
          if (!frameUrl) {
            mirrored[idx] = ''
            loaded++
            if (loaded === rightFrames.length) completeSave()
            return
          }
          const img = new Image()
          img.src = frameUrl
          img.onload = () => {
            flipCtx.clearRect(0, 0, canvasPixelWidth, canvasPixelHeight)
            flipCtx.save()
            flipCtx.translate(canvasPixelWidth, 0)
            flipCtx.scale(-1, 1)
            const drawW = Math.min(img.naturalWidth || canvasPixelWidth, canvasPixelWidth)
            const drawH = Math.min(img.naturalHeight || canvasPixelHeight, canvasPixelHeight)
            flipCtx.drawImage(img, 0, 0, drawW, drawH, 0, 0, drawW, drawH)
            flipCtx.restore()
            mirrored[idx] = flipCanvas.toDataURL('image/png')
            loaded++
            if (loaded === rightFrames.length) completeSave()
          }
          img.onerror = () => {
            mirrored[idx] = ''
            loaded++
            if (loaded === rightFrames.length) completeSave()
          }
        })
        return
      }
    }

    void commit(finalFrames)
  }

  const pixelScale = zoom
  const currentDirectionFrames = directionalFrames[activeDirection] || ['']
  const isMultiFrame = currentDirectionFrames.length > 1
  const displayPreviewUrl =
    isMultiFrame && isPlaying
      ? currentDirectionFrames[animFrameIndex] || previewDataUrl
      : previewDataUrl

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-6xl h-[92vh] max-h-[860px] bg-[#1e1f22] border border-[#383a40] rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-2.5 border-b border-[#2b2d31] bg-[#18191c]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-[#3b82f6]/20 border border-[#3b82f6]/40 flex items-center justify-center text-[#3b82f6]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Estúdio Pixel Art: <span className="text-[#3b82f6]">{CATEGORY_LABELS[category]}</span>
              </h2>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Dimensions & Tamanho Controls */}
            <div className="flex flex-col gap-1">
              {/* Row 1: Dimensions Input (Resolução da Tela de Desenho / Canvas) */}
              <div className="flex items-center justify-between gap-1.5 bg-[#2b2d31] border border-[#3f4147] px-2.5 py-1 rounded-xl text-xs">
                <span className="text-[10px] font-bold text-slate-400 min-w-[55px]" title="Resolução da tela trabalhada (área de desenho)">Dimensões:</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={4096}
                    value={inputWidthStr}
                    onChange={(event) => handleDimensionsInput('width', event.target.value)}
                    onFocus={() => {
                      dimensionsFocusedRef.current = true
                    }}
                    onBlur={handleDimensionsBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleApplyDimensions()
                        e.currentTarget.blur()
                      }
                    }}
                    className="w-12 bg-[#18191c] border border-[#383a40] rounded px-1 py-0.5 text-center text-white font-bold text-xs focus:outline-none focus:border-[#3b82f6]"
                    title="Resolução da tela trabalhada em pixels"
                  />
                  <span className="text-slate-400 text-xs">×</span>
                  <input
                    type="number"
                    min={1}
                    max={4096}
                    value={inputHeightStr}
                    onChange={(event) => handleDimensionsInput('height', event.target.value)}
                    onFocus={() => {
                      dimensionsFocusedRef.current = true
                    }}
                    onBlur={handleDimensionsBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleApplyDimensions()
                        e.currentTarget.blur()
                      }
                    }}
                    className="w-12 bg-[#18191c] border border-[#383a40] rounded px-1 py-0.5 text-center text-white font-bold text-xs focus:outline-none focus:border-[#3b82f6]"
                    title="Resolução da tela trabalhada em pixels"
                  />
                  <span className="text-[10px] text-slate-400 font-medium">px</span>
                </div>
              </div>

              {/* Row 2: Tamanho Input (Tamanho final de exibição no mapa / jogo e preview) */}
              <div className="flex items-center justify-between gap-1.5 bg-[#2b2d31] border border-[#3f4147] px-2.5 py-1 rounded-xl text-xs">
                <span className="text-[10px] font-bold text-slate-400 min-w-[55px]" title="Tamanho final de exibição do asset no mapa/jogo e no preview">Tamanho:</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={4096}
                    value={inputTamanhoWStr}
                    onChange={(event) => handleTamanhoInput('width', event.target.value)}
                    onBlur={handleApplyTamanho}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleApplyTamanho()
                        e.currentTarget.blur()
                      }
                    }}
                    className="w-12 bg-[#18191c] border border-[#383a40] rounded px-1 py-0.5 text-center text-white font-bold text-xs focus:outline-none focus:border-[#3b82f6]"
                    title="Tamanho final de exibição do asset no mapa/jogo e preview em pixels"
                  />
                  <span className="text-slate-400 text-xs">×</span>
                  <input
                    type="number"
                    min={1}
                    max={4096}
                    value={inputTamanhoHStr}
                    onChange={(event) => handleTamanhoInput('height', event.target.value)}
                    onBlur={handleApplyTamanho}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleApplyTamanho()
                        e.currentTarget.blur()
                      }
                    }}
                    className="w-12 bg-[#18191c] border border-[#383a40] rounded px-1 py-0.5 text-center text-white font-bold text-xs focus:outline-none focus:border-[#3b82f6]"
                    title="Tamanho final de exibição do asset no mapa/jogo e preview em pixels"
                  />
                  <span className="text-[10px] text-slate-400 font-medium">px</span>
                </div>
              </div>
            </div>

            {/* Obstacle Checkbox for Furniture and Walls */}
            {(category === 'furniture' || category === 'wall') && (
              <label
                className="flex items-center gap-1.5 cursor-pointer bg-[#2b2d31] border border-[#3f4147] px-2.5 py-1 rounded-xl text-xs"
                title={
                  category === 'furniture'
                    ? 'Bloqueia a passagem só nos quadrados de 32 px que têm pixels visíveis. As partes transparentes ficam livres.'
                    : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={isObstacle}
                  onChange={(e) => setIsObstacle(e.target.checked)}
                  className="rounded text-indigo-500 cursor-pointer"
                />
                <span className="text-[11px] font-bold text-slate-300">🛡️ Obstáculo</span>
              </label>
            )}

            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Nome do Preset..."
              className="bg-[#2b2d31] border border-[#3f4147] rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#3b82f6] w-48"
            />
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#2b2d31] hover:bg-[#383a40] text-slate-300 hover:text-white text-xs font-semibold border border-[#3f4147] transition-all cursor-pointer"
              title="Cancelar e descartar alterações"
            >
              <X className="w-4 h-4" /> Cancelar
            </button>
            <button
              onClick={handleFinalSave}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#3b82f6] hover:bg-[#2563eb] text-white text-xs font-bold shadow-lg shadow-[#3b82f6]/25 transition-all cursor-pointer"
            >
              <Check className="w-4 h-4" /> Salvar Preset
            </button>
          </div>
        </div>

        {/* Main Work Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Toolbar */}
          <div className="w-20 border-r border-[#2b2d31] bg-[#18191c]/80 flex flex-col items-center py-4 gap-3">
            {/* Draw Tools */}
            <div className="flex flex-col gap-1.5 bg-[#2b2d31] p-1.5 rounded-2xl border border-[#383a40]">
              <button
                onClick={() => setTool('pencil')}
                title="Lápis (Pincel)"
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  tool === 'pencil' ? 'bg-[#3b82f6] text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={() => setTool('eraser')}
                title="Borracha"
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  tool === 'eraser' ? 'bg-[#3b82f6] text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Eraser className="w-4 h-4" />
              </button>
              <button
                onClick={() => setTool('bucket')}
                title="Preencher (Balde)"
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  tool === 'bucket' ? 'bg-[#3b82f6] text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <PaintBucket className="w-4 h-4" />
              </button>
              <button
                onClick={() => setTool('picker')}
                title="Conta-gotas (Pipeta) - Tecla I"
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  tool === 'picker' ? 'bg-[#3b82f6] text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Pipette className="w-4 h-4" />
              </button>
              <button
                onClick={() => setTool('move')}
                title="Mover e Redimensionar Imagem (V) - Arraste com o botão esquerdo para mover, scroll do mouse para expandir ou diminuir a imagem"
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  tool === 'move' ? 'bg-[#3b82f6] text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Move className="w-4 h-4" />
              </button>
            </div>

            <div className="w-10 h-px bg-[#2b2d31]" />

            {/* History Actions */}
            <div className="flex flex-col gap-1.5">
              <button
                onClick={handleUndo}
                disabled={!canUndo}
                title="Desfazer (Ctrl+Z)"
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  canUndo ? 'text-slate-300 hover:bg-[#2b2d31]' : 'text-slate-600 opacity-40 cursor-not-allowed'
                }`}
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                onClick={handleRedo}
                disabled={!canRedo}
                title="Refazer (Ctrl+Y)"
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  canRedo ? 'text-slate-300 hover:bg-[#2b2d31]' : 'text-slate-600 opacity-40 cursor-not-allowed'
                }`}
              >
                <Redo2 className="w-4 h-4" />
              </button>
              <button
                onClick={handleClear}
                title="Limpar Grade"
                className="p-2.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-[#2b2d31] transition-all cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            <div className="w-10 h-px bg-[#2b2d31]" />

            {/* Active Color Preview & Free Color Picker */}
            <div className="flex flex-col items-center gap-1.5">
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value)
                  if (!recentColors.includes(e.target.value)) {
                    setRecentColors([e.target.value, ...recentColors.slice(0, 7)])
                  }
                }}
                className="w-9 h-9 rounded-xl cursor-pointer border border-[#4e5058] bg-transparent"
                title="Escolher Cor Livre"
              />
              <span className="text-[10px] font-mono text-slate-400 uppercase">{color.slice(1, 7)}</span>
            </div>
          </div>

          {/* Center Canvas Stage */}
          <div
            ref={stageRef}
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={(e) => {
              // Dragging ONLY works with Right click (2), Middle click (1), or Space + Left click.
              // Regular Left click (0) must NEVER drag!
              if (e.button === 2 || e.button === 1 || (e.button === 0 && isSpacePressedRef.current)) {
                e.preventDefault()
                startPanning(e.clientX, e.clientY)
              }
            }}
            className={`flex-1 overflow-hidden relative select-none bg-[#141517] ${
              isPanning
                ? 'cursor-grabbing'
                : isSpacePressed
                ? 'cursor-grab'
                : 'cursor-default'
            }`}
          >
            {/* Real-time Image Scale Badge Indicator */}
            {scaleDisplay && (
              <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-blue-600/90 text-white font-bold text-xs px-3.5 py-1.5 rounded-full shadow-2xl backdrop-blur-md pointer-events-none flex items-center gap-1.5 border border-blue-400/50 animate-pulse">
                <span>🔍 Redimensionando Imagem:</span>
                <span className="font-mono bg-blue-800/80 px-2 py-0.5 rounded-md text-yellow-300">
                  {scaleDisplay}
                </span>
              </div>
            )}

            {/* Stage Controls Float Bar (Top Left) */}
            <div className="absolute top-4 left-6 z-10 flex items-center gap-2 bg-[#18191c]/90 border border-[#383a40] backdrop-blur-md px-3 py-1.5 rounded-2xl shadow-lg">
              <button
                onClick={() => {
                  const currentZ = zoom
                  const nextZoom = Math.max(1, currentZ <= 4 ? currentZ - 1 : currentZ - 2)
                  if (nextZoom !== currentZ) {
                    const k = nextZoom / currentZ
                    setZoom(nextZoom)
                    setPanOffset((prev) => ({ x: prev.x * k, y: prev.y * k }))
                  }
                }}
                className="p-1.5 rounded-lg hover:bg-[#2b2d31] text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Diminuir Zoom (Ctrl + Scroll para baixo)"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono font-bold text-slate-300 min-w-[36px] text-center">{zoom}x</span>
              <button
                onClick={() => {
                  const currentZ = zoom
                  const nextZoom = Math.min(32, currentZ < 4 ? currentZ + 1 : currentZ + 2)
                  if (nextZoom !== currentZ) {
                    const k = nextZoom / currentZ
                    setZoom(nextZoom)
                    setPanOffset((prev) => ({ x: prev.x * k, y: prev.y * k }))
                  }
                }}
                className="p-1.5 rounded-lg hover:bg-[#2b2d31] text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Aumentar Zoom (Ctrl + Scroll para cima)"
              >
                <ZoomIn className="w-4 h-4" />
              </button>

              <div className="w-px h-4 bg-[#383a40] mx-1" />

              {(panOffset.x !== 0 || panOffset.y !== 0 || zoom !== defaultZoom) && (
                <button
                  onClick={() => {
                    setPanOffset({ x: 0, y: 0 })
                    setZoom(defaultZoom)
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#2b2d31] hover:bg-[#383a40] text-slate-300 text-[11px] font-semibold transition-all cursor-pointer"
                  title="Centralizar e redefinir zoom original"
                >
                  Centralizar
                </button>
              )}

              <button
                onClick={() => setShowGrid(!showGrid)}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                  showGrid ? 'bg-[#3b82f6]/20 text-[#3b82f6]' : 'text-slate-400 hover:text-white'
                }`}
                title="Alternar Grade de Pixels"
              >
                <Grid className="w-4 h-4" />
              </button>
            </div>

            {/* Viewport Canvas Wrapper - Absolute Centered (Never shrunk by flexbox, keeps true dimensions) */}
            <div
              className="absolute rounded-2xl shadow-2xl overflow-hidden border-2 border-[#383a40] shrink-0"
              style={{
                width: canvasPixelWidth * pixelScale,
                height: canvasPixelHeight * pixelScale,
                minWidth: canvasPixelWidth * pixelScale,
                minHeight: canvasPixelHeight * pixelScale,
                maxWidth: 'none',
                maxHeight: 'none',
                left: '50%',
                top: '50%',
                transform: `translate(calc(-50% + ${panOffset.x}px), calc(-50% + ${panOffset.y}px))`,
                backgroundImage: `
                  linear-gradient(45deg, #18191c 25%, transparent 25%),
                  linear-gradient(-45deg, #18191c 25%, transparent 25%),
                  linear-gradient(45deg, transparent 75%, #18191c 75%),
                  linear-gradient(-45deg, transparent 75%, #18191c 75%)
                `,
                backgroundSize: `${pixelScale * 2}px ${pixelScale * 2}px`,
                backgroundColor: '#232428',
              }}
            >
              {/* Interactive Drawing Canvas */}
              <canvas
                ref={drawCanvasRef}
                width={canvasPixelWidth}
                height={canvasPixelHeight}
                onContextMenu={(e) => e.preventDefault()}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseLeave}
                className={`absolute top-0 left-0 ${
                  isPanning
                    ? 'cursor-grabbing'
                    : isSpacePressed
                    ? 'cursor-grab'
                    : tool === 'move'
                    ? isMovingContent
                      ? 'cursor-grabbing'
                      : 'cursor-move'
                    : 'cursor-crosshair'
                }`}
                style={{
                  width: canvasPixelWidth * pixelScale,
                  height: canvasPixelHeight * pixelScale,
                  imageRendering: 'pixelated',
                }}
              />

              {/* Pixel Grid Lines Overlay */}
              {showGrid && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage: `
                      linear-gradient(to right, rgba(255, 255, 255, 0.07) 1px, transparent 1px),
                      linear-gradient(to bottom, rgba(255, 255, 255, 0.07) 1px, transparent 1px)
                    `,
                    backgroundSize: `${pixelScale}px ${pixelScale}px`,
                  }}
                />
              )}

              {/* Pixel Hover Cursor */}
              {hoverPixel && !isPanning && tool !== 'move' && (
                <div
                  className="absolute pointer-events-none border border-white/80 shadow-xs"
                  style={{
                    left: hoverPixel.x * pixelScale,
                    top: hoverPixel.y * pixelScale,
                    width: pixelScale,
                    height: pixelScale,
                    backgroundColor: tool === 'eraser' ? 'rgba(255,0,0,0.25)' : `${color}88`,
                  }}
                />
              )}
            </div>

            {/* Bottom Dock: Status & Controls (the direction selector is in the right column) */}
            <div className="absolute bottom-3 z-10 flex flex-col items-center gap-2 max-w-[95%] pointer-events-none">
              {/* Status & Controls Bar */}
              <div className="flex items-center gap-4 bg-[#18191c]/90 border border-[#383a40] backdrop-blur-md px-4 py-1.5 rounded-2xl text-xs text-slate-400 shadow-lg pointer-events-auto">
                <span>
                  Pixel: <strong className="text-white">{hoverPixel ? `${hoverPixel.x}, ${hoverPixel.y}` : '-'}</strong>
                </span>

                <div className="w-px h-3 bg-[#383a40]" />
                <div className="text-[11px] text-slate-400 flex items-center gap-2 select-none">
                  {tool === 'move' ? (
                    <>
                      <span>🖐️ <strong className="text-blue-300">Mover Imagem:</strong> Arraste ou use setas</span>
                      <div className="flex items-center gap-1 ml-1 bg-[#2b2d31] p-0.5 rounded-lg border border-[#383a40]">
                        <button
                          onClick={() => nudgeTransform(-1, 0)}
                          title="Mover 1px para a Esquerda (Seta Esquerda)"
                          className="px-1.5 py-0.5 rounded hover:bg-[#383a40] text-slate-300 hover:text-white text-xs font-mono font-bold cursor-pointer"
                        >
                          ←
                        </button>
                        <button
                          onClick={() => nudgeTransform(0, -1)}
                          title="Mover 1px para Cima (Seta Cima)"
                          className="px-1.5 py-0.5 rounded hover:bg-[#383a40] text-slate-300 hover:text-white text-xs font-mono font-bold cursor-pointer"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => nudgeTransform(0, 1)}
                          title="Mover 1px para Baixo (Seta Baixo)"
                          className="px-1.5 py-0.5 rounded hover:bg-[#383a40] text-slate-300 hover:text-white text-xs font-mono font-bold cursor-pointer"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => nudgeTransform(1, 0)}
                          title="Mover 1px para a Direita (Seta Direita)"
                          className="px-1.5 py-0.5 rounded hover:bg-[#383a40] text-slate-300 hover:text-white text-xs font-mono font-bold cursor-pointer"
                        >
                          →
                        </button>
                      </div>
                      <span>•</span>
                      <span>🔍 <strong className="text-blue-300">Scroll:</strong> Redimensionar</span>
                      <div className="flex items-center gap-1 ml-1 bg-[#2b2d31] p-0.5 rounded-lg border border-[#383a40]">
                        <button
                          onClick={() => stepScaleTransform(0.9)}
                          title="Diminuir Imagem (-10%) (Scroll para baixo ou Tecla -)"
                          className="px-2 py-0.5 rounded hover:bg-[#383a40] text-slate-300 hover:text-white text-xs font-mono font-bold cursor-pointer"
                        >
                          -
                        </button>
                        <span className="text-[11px] font-mono font-semibold text-slate-300 px-1 min-w-[36px] text-center">
                          {Math.round(transformScaleState * 100)}%
                        </span>
                        <button
                          onClick={() => stepScaleTransform(1.1)}
                          title="Aumentar Imagem (+10%) (Scroll para cima ou Tecla +)"
                          className="px-2 py-0.5 rounded hover:bg-[#383a40] text-slate-300 hover:text-white text-xs font-mono font-bold cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                      <span>•</span>
                      <button
                        onClick={fitTransform}
                        title="Enquadrar arte inteira dentro da tela (ajusta a escala para caber 100% sem cortes)"
                        className="px-2 py-0.5 rounded-lg bg-[#2b2d31] hover:bg-[#383a40] text-emerald-300 hover:text-emerald-200 text-xs font-semibold border border-[#383a40] transition-colors cursor-pointer"
                      >
                        📐 Enquadrar
                      </button>
                      <span>•</span>
                      <button
                        onClick={resetTransform}
                        title="Restaurar tamanho (100%) e posição original do desenho"
                        className="px-2 py-0.5 rounded-lg bg-[#2b2d31] hover:bg-[#383a40] text-yellow-300 hover:text-yellow-200 text-xs font-semibold border border-[#383a40] transition-colors cursor-pointer"
                      >
                        ↺ Resetar
                      </button>
                      <span>•</span>
                      <span>🖐️ <strong className="text-slate-300">Dir / Espaço:</strong> Mover tela</span>
                    </>
                  ) : (
                    <>
                      <span>🖱️ <strong className="text-slate-300">Esq:</strong> Pintar</span>
                      <span>•</span>
                      <span>🖐️ <strong className="text-slate-300">Botão Direito / Espaço:</strong> Mover</span>
                      <span>•</span>
                      <span>🔄 <strong className="text-slate-300">Scroll:</strong> Rolar</span>
                      <span>•</span>
                      <span>🔍 <strong className="text-slate-300">Ctrl+Scroll:</strong> Zoom no Cursor</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel: Palette & Live Animation Preview */}
          <div className="w-72 border-l border-[#2b2d31] bg-[#18191c]/80 flex flex-col p-4 gap-4 overflow-y-auto">
            {/* Live Animation Player & Size Previews */}
            <div className="bg-[#2b2d31] border border-[#383a40] rounded-2xl p-3 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  Pré-visualização {isMultiFrame ? 'Animada' : ''}
                </span>
                {isMultiFrame && (
                  <span className="text-[10px] font-mono font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-md border border-blue-500/30">
                    Q{animFrameIndex + 1}/{currentDirectionFrames.length}
                  </span>
                )}
              </div>

              {/* Display 1x and 2x */}
              <div className="flex items-center justify-around bg-[#1e1f22] p-3 rounded-xl border border-[#383a40]/60">
                <div className="flex flex-col items-center gap-1">
                  <div
                    className="border border-slate-700 rounded bg-[#18191c] flex items-center justify-center overflow-hidden"
                    style={{ width: Math.min(64, Math.max(16, tamanhoWidth)), height: Math.min(64, Math.max(16, tamanhoHeight)) }}
                  >
                    {displayPreviewUrl && (
                      <img src={displayPreviewUrl} alt="1x" className="w-full h-full object-contain [image-rendering:pixelated]" />
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400">1x ({tamanhoWidth}×{tamanhoHeight})</span>
                </div>

                <div className="flex flex-col items-center gap-1">
                  <div
                    className="border border-slate-700 rounded-lg bg-[#18191c] flex items-center justify-center overflow-hidden"
                    style={{ width: Math.min(96, canvasPixelWidth * 1.5), height: Math.min(96, canvasPixelHeight * 1.5) }}
                  >
                    {displayPreviewUrl && (
                      <img src={displayPreviewUrl} alt="2x" className="w-full h-full object-contain [image-rendering:pixelated]" />
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400">Preview</span>
                </div>
              </div>

              {/* Animation Play/Pause & Speed Selector */}
              {isMultiFrame && (
                <div className="flex items-center justify-between bg-[#1e1f22] px-2.5 py-1.5 rounded-xl border border-[#383a40]/60 text-xs">
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="flex items-center gap-1 text-slate-200 hover:text-white font-semibold cursor-pointer"
                    title={isPlaying ? 'Pausar Animação' : 'Reproduzir Animação'}
                  >
                    {isPlaying ? (
                      <Pause className="w-3.5 h-3.5 text-amber-400" />
                    ) : (
                      <Play className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span>{isPlaying ? 'Pausar' : 'Play'}</span>
                  </button>

                  <div className="flex items-center gap-1">
                    {[
                      { label: '100ms', val: 100 },
                      { label: '160ms', val: 160 },
                      { label: '250ms', val: 250 },
                    ].map((spd) => (
                      <button
                        key={spd.val}
                        onClick={() => setAnimSpeedMs(spd.val)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                          animSpeedMs === spd.val
                            ? 'bg-blue-500 text-white'
                            : 'text-slate-400 hover:text-white bg-[#2b2d31]'
                        }`}
                        title={`Velocidade de reprodução: ${spd.label}`}
                      >
                        {spd.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Animation frames of the active direction. They used to be a floating bar over the canvas,
                  which hid part of the drawing: they live in this column now. */}
              <div className="flex flex-col gap-1.5 mt-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {category === 'floor' ? 'Quadros' : `Quadros (${DIRECTIONS.find((direction) => direction.id === activeDirection)?.label})`}
                </span>
                <div className="flex flex-col gap-2 bg-[#1e1f22] p-2 rounded-xl border border-[#383a40]/60">
                  {/* Frame List */}
                  <div className="flex flex-wrap items-start gap-1 max-h-[9.5rem] overflow-y-auto px-0.5 pt-2 pb-1">
                    {currentDirectionFrames.map((frameData, idx) => {
                      const isFrameActive = idx === activeFrameIndex
                      const isDragged = draggedFrameIndex === idx
                      const isDragOver = dragOverFrameIndex === idx && draggedFrameIndex !== idx
                      return (
                        <div
                          key={idx}
                          draggable={currentDirectionFrames.length > 1}
                          onDragStart={(event) => {
                            setDraggedFrameIndex(idx)
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', String(idx))
                          }}
                          onDragOver={(event) => {
                            event.preventDefault()
                            event.dataTransfer.dropEffect = 'move'
                            if (dragOverFrameIndex !== idx) {
                              setDragOverFrameIndex(idx)
                            }
                          }}
                          onDragLeave={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                              if (dragOverFrameIndex === idx) {
                                setDragOverFrameIndex(null)
                              }
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault()
                            setDragOverFrameIndex(null)
                            const rawFrom = event.dataTransfer.getData('text/plain')
                            const fromIdx = draggedFrameIndex !== null ? draggedFrameIndex : rawFrom ? parseInt(rawFrom, 10) : null
                            if (fromIdx !== null && !isNaN(fromIdx) && fromIdx !== idx) {
                              handleMoveFrame(fromIdx, idx)
                            }
                            setDraggedFrameIndex(null)
                          }}
                          onDragEnd={() => {
                            setDraggedFrameIndex(null)
                            setDragOverFrameIndex(null)
                          }}
                          onClick={() => switchFrame(idx)}
                          title={
                            currentDirectionFrames.length > 1
                              ? `Quadro Q${idx + 1} (Clique para selecionar, arraste ou use as setas para reposicionar)`
                              : `Quadro Q${idx + 1}`
                          }
                          className={`group relative flex flex-col items-center p-1 rounded-xl border transition-all select-none min-w-[44px] ${
                            currentDirectionFrames.length > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                          } ${
                            isDragged
                              ? 'opacity-35 scale-95 border-dashed border-blue-400 bg-blue-500/10'
                              : isDragOver
                              ? 'border-blue-400 bg-blue-500/25 ring-2 ring-blue-500/60 scale-105 shadow-lg shadow-blue-500/30'
                              : isFrameActive
                              ? 'bg-[#3b82f6]/25 border-[#3b82f6] shadow-md shadow-blue-500/25 scale-105'
                              : 'bg-[#2b2d31] border-[#383a40] hover:border-slate-500 hover:bg-[#32353b]'
                          }`}
                        >
                          <div className="w-9 h-9 rounded-lg bg-[#141517] border border-slate-700/60 flex items-center justify-center overflow-hidden pointer-events-none">
                            {frameData ? (
                              <img
                                src={isFrameActive ? previewDataUrl || frameData : frameData}
                                alt={`Q${idx + 1}`}
                                draggable={false}
                                className="w-8 h-8 [image-rendering:pixelated]"
                              />
                            ) : (
                              <span className="text-[9px] text-slate-500 italic">Vazio</span>
                            )}
                          </div>

                          {currentDirectionFrames.length > 1 ? (
                            <div className="flex items-center justify-between w-full mt-0.5 px-0.5 gap-0.5">
                              {idx > 0 ? (
                                <button
                                  type="button"
                                  draggable={false}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleMoveFrame(idx, idx - 1)
                                  }}
                                  title="Mover para a esquerda"
                                  className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-700/80 transition-all cursor-pointer opacity-70 group-hover:opacity-100"
                                >
                                  <ChevronLeft className="w-2.5 h-2.5" />
                                </button>
                              ) : (
                                <div className="w-3.5" />
                              )}

                              <span
                                className={`text-[9px] font-bold leading-none ${
                                  isFrameActive ? 'text-blue-300' : 'text-slate-400'
                                }`}
                              >
                                Q{idx + 1}
                              </span>

                              {idx < currentDirectionFrames.length - 1 ? (
                                <button
                                  type="button"
                                  draggable={false}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleMoveFrame(idx, idx + 1)
                                  }}
                                  title="Mover para a direita"
                                  className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-700/80 transition-all cursor-pointer opacity-70 group-hover:opacity-100"
                                >
                                  <ChevronRight className="w-2.5 h-2.5" />
                                </button>
                              ) : (
                                <div className="w-3.5" />
                              )}
                            </div>
                          ) : (
                            <span
                              className={`text-[9px] font-bold mt-0.5 ${
                                isFrameActive ? 'text-blue-300' : 'text-slate-400'
                              }`}
                            >
                              Q{idx + 1}
                            </span>
                          )}

                          {/* Delete Frame Button */}
                          {currentDirectionFrames.length > 1 && (
                            <button
                              type="button"
                              draggable={false}
                              onClick={(event) => handleDeleteFrame(event, idx)}
                              onMouseDown={(event) => event.stopPropagation()}
                              title="Excluir este quadro"
                              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity shadow cursor-pointer z-10"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Timeline Action Buttons */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={handleAddFrame}
                      title="Adicionar Novo Quadro em Branco"
                      className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-xl bg-[#2b2d31] hover:bg-[#383a40] border border-[#383a40] text-blue-400 hover:text-white text-[11px] font-bold transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Novo</span>
                    </button>

                    <button
                      onClick={handleDuplicateFrame}
                      title="Duplicar Quadro Atual (Perfeito para ajustar passos de caminhada!)"
                      className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-xl bg-[#2b2d31] hover:bg-[#383a40] border border-[#383a40] text-indigo-300 hover:text-white text-[11px] font-bold transition-all cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Duplicar</span>
                    </button>

                    {/* Reorder / Move Active Frame Buttons: only with 2+ frames, there is nothing to move otherwise */}
                    {currentDirectionFrames.length > 1 && (
                      <div
                        className="col-span-2 flex items-center justify-between bg-[#2b2d31] border border-[#383a40] rounded-xl p-0.5"
                        title="Mover a posição do quadro ativo na animação (ou arraste os quadros diretamente)"
                      >
                        <button
                          onClick={() => handleMoveFrame(activeFrameIndex, activeFrameIndex - 1)}
                          disabled={activeFrameIndex <= 0}
                          title="Mover quadro ativo para a esquerda (Alt + ←)"
                          className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-[#383a40] disabled:opacity-20 disabled:cursor-not-allowed transition-all cursor-pointer"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[10px] font-bold text-slate-400 px-1 select-none flex items-center gap-1">
                          Mover quadro
                        </span>
                        <button
                          onClick={() => handleMoveFrame(activeFrameIndex, activeFrameIndex + 1)}
                          disabled={activeFrameIndex >= currentDirectionFrames.length - 1}
                          title="Mover quadro ativo para a direita (Alt + →)"
                          className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-[#383a40] disabled:opacity-20 disabled:cursor-not-allowed transition-all cursor-pointer"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 4 Directions Mini Previews (Hidden when editing floors) */}
              {category !== 'floor' && (
                <div className="flex flex-col gap-1.5 mt-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Quadros das 4 Direções
                  </span>
                  <div className="grid grid-cols-4 gap-1.5 bg-[#1e1f22] p-2 rounded-xl border border-[#383a40]/60">
                    {DIRECTIONS.map((dirItem) => {
                      const frames = directionalFrames[dirItem.id] || []
                      const frameCount = frames.length
                      const thumbUrl =
                        dirItem.id === activeDirection
                          ? previewDataUrl || frames[activeFrameIndex] || frames[0]
                          : frames[0]
                      return (
                        <div
                          key={dirItem.id}
                          onClick={() => switchDirection(dirItem.id)}
                          className={`flex flex-col items-center gap-1 p-1 rounded-lg cursor-pointer border transition-all ${
                            activeDirection === dirItem.id
                              ? 'border-[#3b82f6] bg-[#3b82f6]/10 scale-105'
                              : 'border-transparent hover:bg-[#2b2d31]'
                          }`}
                        >
                          <div className="w-8 h-8 rounded bg-[#18191c] border border-slate-700/60 flex items-center justify-center overflow-hidden relative">
                            {thumbUrl ? (
                              <img
                                src={thumbUrl}
                                alt={dirItem.label}
                                className="w-7 h-7 [image-rendering:pixelated]"
                              />
                            ) : (
                              <span className="text-[11px] opacity-40">{dirItem.icon}</span>
                            )}
                            {frameCount > 1 && (
                              <span className="absolute bottom-0 right-0 bg-blue-600/90 text-[8px] font-bold text-white px-1 rounded-tl">
                                {frameCount}
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] font-semibold text-slate-400">{dirItem.label}</span>
                        </div>
                      )
                    })}
                  </div>

                  {/* Mirror the sides into each other: only while a side is the active direction */}
                  {(activeDirection === 'left' || activeDirection === 'right') && (
                    <button
                      onClick={handleMirrorOppositeSide}
                      title={
                        activeDirection === 'left'
                          ? 'Espelhar todos os quadros da Esquerda para a Direita'
                          : 'Espelhar todos os quadros da Direita para a Esquerda'
                      }
                      className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#2b2d31] hover:bg-[#383a40] border border-[#383a40] text-indigo-300 hover:text-white text-[11px] font-semibold transition-all cursor-pointer"
                    >
                      <FlipHorizontal className="w-3.5 h-3.5" />
                      <span>Espelhar {activeDirection === 'left' ? 'p/ Direita ➡️' : 'p/ Esquerda ⬅️'}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Curated Color Swatches & Color Wheel */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  Paleta Pixel Art
                </span>
                <button
                  onClick={() => setShowColorWheel(!showColorWheel)}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                    showColorWheel
                      ? 'bg-[#3b82f6] text-white border-blue-400 shadow-md'
                      : 'bg-[#2b2d31] hover:bg-[#383a40] text-slate-300 border-[#383a40]'
                  }`}
                  title="Abrir Roda de Cores Livre"
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0 shadow-xs"
                    style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
                  />
                  <span>Roda de Cores</span>
                </button>
              </div>

              {showColorWheel && (
                <div className="flex justify-center animate-in fade-in zoom-in-95 duration-150 my-1">
                  <ColorWheelPicker
                    color={color}
                    onChange={(newCol) => {
                      setColor(newCol)
                      if (!recentColors.includes(newCol)) {
                        setRecentColors([newCol, ...recentColors.slice(0, 7)])
                      }
                    }}
                    onClose={() => setShowColorWheel(false)}
                    className="w-full"
                  />
                </div>
              )}

              <div className="grid grid-cols-6 gap-1.5 bg-[#2b2d31] p-2.5 rounded-2xl border border-[#383a40]">
                {PRESET_PALETTE.map((swatch) => (
                  <button
                    key={swatch}
                    onClick={() => {
                      setColor(swatch)
                      if (!recentColors.includes(swatch)) {
                        setRecentColors([swatch, ...recentColors.slice(0, 7)])
                      }
                    }}
                    style={{ backgroundColor: swatch }}
                    className={`w-7 h-7 rounded-lg transition-transform hover:scale-110 aspect-square cursor-pointer ${
                      color.toLowerCase() === swatch.toLowerCase()
                        ? 'ring-2 ring-white scale-105 shadow-md'
                        : 'border border-black/20'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Recent Colors */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cores Recentes</span>
              <div className="flex gap-1.5 flex-wrap">
                {recentColors.map((rc, idx) => (
                  <button
                    key={`${rc}_${idx}`}
                    onClick={() => setColor(rc)}
                    style={{ backgroundColor: rc }}
                    className={`w-6 h-6 rounded-md transition-transform hover:scale-110 cursor-pointer ${
                      color.toLowerCase() === rc.toLowerCase() ? 'ring-2 ring-white' : 'border border-black/30'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
