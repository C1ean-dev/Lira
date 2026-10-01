import React, { useState, useRef, useEffect } from 'react'
import {
  X,
  Sparkles,
  Scissors,
  Check,
  RotateCcw,
} from 'lucide-react'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { useMapStore } from '../store/useMapStore'
import { useGameStore } from '../store/useGameStore'
import { PeerManager } from '../p2p/PeerManager'
import { CustomAsset, CustomAssetType, DirectionalDimension } from '../types/customAsset'
import { Direction } from '../types/game'
import {
  cropImage,
  applyBackgroundRemoval,
  getTrimmedBounds,
  RGBColor,
  PRESET_BG_COLORS,
} from '../utils/imageTransparency'
import {
  resizeImageToTarget,
  calculateFitDimensions,
  fitLayerToBounds,
  rescaleLayersForNewBoard,
  calculateHighFidelityBakeScale,
  bakeLayersToDataUrl,
  bakeLayersToDataUrlSync,
} from '../utils/imageResize'
import { CropStudio, CroppedClip } from './custom-element/CropStudio'
import { CompositionStudio, CompositeLayer } from './custom-element/CompositionStudio'
import { CroppedClipsList } from './custom-element/CroppedClipsList'
import { LayerManager } from './custom-element/LayerManager'
import { AnimationTimeline } from './custom-element/AnimationTimeline'
import { TransparencyControls } from './custom-element/TransparencyControls'
import { AssetPropertiesForm } from './custom-element/AssetPropertiesForm'

export const CustomElementModal: React.FC = () => {
  const {
    isCustomModalOpen,
    setCustomModalOpen,
    editingAssetId,
    initialStudioMode,
    initialCategory,
    updateCustomAsset,
    getAssetById,
    addCustomAsset,
    addCategory,
    getAllCategories,
  } = useCustomAssetsStore()
  const { setSelectedFurnitureDefId, setSelectedFloor, setSelectedWall, setActiveTool } = useMapStore()

  // Studio Mode: 'crop' (Recorte de Sprites) vs 'compose' (Mesa de Montagem)
  const [studioMode, setStudioMode] = useState<'crop' | 'compose'>('crop')

  // Source Image State
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null)
  const [sourceImageSrc, setSourceImageSrc] = useState<string>('')
  const [zoom, setZoom] = useState<number>(1)
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true)
  const [gridSnapSize, setGridSnapSize] = useState<number>(32)
  const [isEyedropperActive, setIsEyedropperActive] = useState<boolean>(false)

  // Selection Box
  const [selection, setSelection] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0,
    y: 0,
    w: 64,
    h: 128,
  })
  const [isDraggingSelection, setIsDraggingSelection] = useState<boolean>(false)
  const [dragSelectionStart, setDragSelectionStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  // Transparency / Background Removal
  const [enableBgRemoval, setEnableBgRemoval] = useState<boolean>(true)
  const [targetColor, setTargetColor] = useState<RGBColor>(PRESET_BG_COLORS.LPC_DARK)
  const [tolerance, setTolerance] = useState<number>(25)
  const [removeWhiteFringe, setRemoveWhiteFringe] = useState<boolean>(true)

  // Saved Cropped Pieces Library
  const [croppedClips, setCroppedClips] = useState<CroppedClip[]>([])

  // Composition Board & Target Element Size State
  const [tileWidth, setTileWidth] = useState<number>(2)
  const [tileHeight, setTileHeight] = useState<number>(2)
  const [pixelWidth, setPixelWidth] = useState<number>(64)
  const [pixelHeight, setPixelHeight] = useState<number>(64)
  const [compositeBoardWidth, setCompositeBoardWidth] = useState<number>(64)
  const [compositeBoardHeight, setCompositeBoardHeight] = useState<number>(64)
  const [scaleFitMode, setScaleFitMode] = useState<'fit' | 'stretch'>('fit')
  const [compositeLayers, setCompositeLayers] = useState<CompositeLayer[]>([])
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null)
  const [isDraggingLayer, setIsDraggingLayer] = useState<boolean>(false)
  const [dragLayerStart, setDragLayerStart] = useState<{ mouseX: number; mouseY: number; layerX: number; layerY: number }>({
    mouseX: 0,
    mouseY: 0,
    layerX: 0,
    layerY: 0,
  })

  // Composition Tools
  const [composeTool, setComposeTool] = useState<'move' | 'collision'>('move')
  const [composeZoom, setComposeZoom] = useState<number>(2)
  const [showCollisionOverlay, setShowCollisionOverlay] = useState<boolean>(true)
  const [isPaintingCollision, setIsPaintingCollision] = useState<boolean>(false)
  const [collisionPaintValue, setCollisionPaintValue] = useState<boolean>(true)

  // Collision Grid Matrix - starts empty (all false), user adds if they want
  const [collisionGrid, setCollisionGrid] = useState<boolean[][]>(() => {
    const grid: boolean[][] = []
    for (let r = 0; r < 2; r++) {
      const row: boolean[] = []
      for (let c = 0; c < 2; c++) {
        row.push(false)
      }
      grid.push(row)
    }
    return grid
  })

  // Animation Frames State
  const [frames, setFrames] = useState<string[]>([])
  const [frameLayerStates, setFrameLayerStates] = useState<CompositeLayer[][]>([])
  const [selectedFrameIdx, setSelectedFrameIdx] = useState<number | null>(0)
  const [frameRateMs, setFrameRateMs] = useState<number>(160)
  const [isPlayingAnim, setIsPlayingAnim] = useState<boolean>(true)
  const [currentPreviewFrameIdx, setCurrentPreviewFrameIdx] = useState<number>(0)

  // 4-Direction Furniture State
  const [activeDirection, setActiveDirection] = useState<Direction>('down')
  const [directionalFrames, setDirectionalFrames] = useState<Record<Direction, string[]>>({
    down: [],
    left: [],
    up: [],
    right: [],
  })
  const [directionalFrameLayers, setDirectionalFrameLayers] = useState<Record<Direction, CompositeLayer[][]>>({
    down: [],
    left: [],
    up: [],
    right: [],
  })
  const [directionalDimensions, setDirectionalDimensions] = useState<Record<Direction, {
    tileWidth: number
    tileHeight: number
    pixelWidth: number
    pixelHeight: number
  }>>({
    down: { tileWidth: 2, tileHeight: 2, pixelWidth: 64, pixelHeight: 64 },
    left: { tileWidth: 2, tileHeight: 2, pixelWidth: 64, pixelHeight: 64 },
    up: { tileWidth: 2, tileHeight: 2, pixelWidth: 64, pixelHeight: 64 },
    right: { tileWidth: 2, tileHeight: 2, pixelWidth: 64, pixelHeight: 64 },
  })
  const [directionalCollisionGrids, setDirectionalCollisionGrids] = useState<Partial<Record<Direction, boolean[][]>>>({})

  const handleSelectDirection = (newDir: Direction) => {
    if (newDir === activeDirection) return

    // 1. Save current active direction layers, frames, dimensions, and collision grid
    const currentBoardLayers = JSON.parse(JSON.stringify(compositeLayers))
    let currentFrameList = [...frames]
    const currentFrameLayers = [...frameLayerStates]

    // If currentFrameList is empty but we have board layers, bake a frame synchronously so directionalFrames has sprite data
    if (currentFrameList.length === 0 && currentBoardLayers.length > 0) {
      const syncBaked = bakeLayersToDataUrlSync(
        compositeBoardWidth,
        compositeBoardHeight,
        currentBoardLayers,
        cachedLayerImages
      )
      if (syncBaked) {
        currentFrameList = [syncBaked]
      }
    }

    const updatedLayers: Record<Direction, CompositeLayer[][]> = {
      ...directionalFrameLayers,
      [activeDirection]:
        currentFrameLayers.length > 0
          ? currentFrameLayers
          : currentBoardLayers.length > 0
          ? [currentBoardLayers]
          : [],
    }
    const updatedFrames: Record<Direction, string[]> = {
      ...directionalFrames,
      [activeDirection]: currentFrameList,
    }
    const updatedDims = {
      ...directionalDimensions,
      [activeDirection]: {
        tileWidth,
        tileHeight,
        pixelWidth: pixelWidth || tileWidth * 32,
        pixelHeight: pixelHeight || tileHeight * 32,
      },
    }
    const updatedCollisions = {
      ...directionalCollisionGrids,
      [activeDirection]: collisionGrid,
    }

    setDirectionalFrameLayers(updatedLayers)
    setDirectionalFrames(updatedFrames)
    setDirectionalDimensions(updatedDims)
    setDirectionalCollisionGrids(updatedCollisions)

    // 2. Switch to new direction and restore its dimensions and collision grid
    setActiveDirection(newDir)

    const targetDim = updatedDims[newDir] || updatedDims.down || {
      tileWidth: 2,
      tileHeight: 2,
      pixelWidth: 64,
      pixelHeight: 64,
    }

    setTileWidth(targetDim.tileWidth)
    setTileHeight(targetDim.tileHeight)
    setPixelWidth(targetDim.pixelWidth)
    setPixelHeight(targetDim.pixelHeight)
    setCompositeBoardWidth(targetDim.pixelWidth)
    setCompositeBoardHeight(targetDim.pixelHeight)

    // Restore collision grid for new direction, or generate default for its tile dimensions
    if (updatedCollisions[newDir] && updatedCollisions[newDir]!.length === targetDim.tileHeight) {
      setCollisionGrid(updatedCollisions[newDir]!)
    } else {
      const newGrid: boolean[][] = []
      for (let r = 0; r < targetDim.tileHeight; r++) {
        const row: boolean[] = []
        for (let c = 0; c < targetDim.tileWidth; c++) {
          row.push(false)
        }
        newGrid.push(row)
      }
      setCollisionGrid(newGrid)
    }

    const nextFrames = updatedFrames[newDir] || []
    const nextLayers = updatedLayers[newDir] || []

    setFrames(nextFrames)
    setFrameLayerStates(nextLayers)
    setSelectedFrameIdx(nextFrames.length > 0 ? 0 : null)

    if (nextLayers.length > 0 && nextLayers[0]?.length > 0) {
      setCompositeLayers(JSON.parse(JSON.stringify(nextLayers[0])))
      setSelectedLayerId(nextLayers[0][0]?.id || null)
    } else {
      setCompositeLayers([])
      setSelectedLayerId(null)
    }
  }

  const handleCopyFromDownDirection = () => {
    let sourceLayers: CompositeLayer[] = []
    if (
      directionalFrameLayers.down &&
      directionalFrameLayers.down.length > 0 &&
      directionalFrameLayers.down[0].length > 0
    ) {
      sourceLayers = directionalFrameLayers.down[0]
    } else if (activeDirection === 'down' && compositeLayers.length > 0) {
      sourceLayers = compositeLayers
    }

    if (!sourceLayers || sourceLayers.length === 0) {
      alert('Não há camadas configuradas na visão de Frente (⬇️) para copiar.')
      return
    }

    const copied = sourceLayers.map((layer, idx) => ({
      ...layer,
      id: `layer_${activeDirection}_copy_${Date.now()}_${idx}`,
    }))

    setCompositeLayers(copied)
    setSelectedLayerId(copied[0]?.id || null)
  }

  const handleAutoMirrorLeftRight = () => {
    const oppositeDir: Direction = activeDirection === 'right' ? 'left' : 'right'
    const oppositeDim = directionalDimensions[oppositeDir]

    if (compositeLayers.length === 0) {
      const oppositeLayers = directionalFrameLayers[oppositeDir]?.[0]
      if (oppositeLayers && oppositeLayers.length > 0) {
        if (oppositeDim) {
          setTileWidth(oppositeDim.tileWidth)
          setTileHeight(oppositeDim.tileHeight)
          setPixelWidth(oppositeDim.pixelWidth)
          setPixelHeight(oppositeDim.pixelHeight)
          setCompositeBoardWidth(oppositeDim.pixelWidth)
          setCompositeBoardHeight(oppositeDim.pixelHeight)
          setDirectionalDimensions((prev) => ({
            ...prev,
            [activeDirection]: { ...oppositeDim },
          }))
        }

        const boardW = oppositeDim ? oppositeDim.pixelWidth : compositeBoardWidth
        const mirrored = oppositeLayers.map((l, idx) => ({
          ...l,
          id: `layer_${activeDirection}_mirrored_${Date.now()}_${idx}`,
          x: Math.max(0, boardW - (l.x + l.width)),
          flipH: !l.flipH,
        }))
        setCompositeLayers(mirrored)
        setSelectedLayerId(mirrored[0]?.id || null)
        return
      }
      alert('Adicione camadas primeiro ou configure o lado oposto para espelhar.')
      return
    }

    setCompositeLayers((prev) =>
      prev.map((l) => ({
        ...l,
        x: Math.max(0, compositeBoardWidth - (l.x + l.width)),
        flipH: !l.flipH,
      }))
    )
  }

  // Element Properties Form
  const [elementName, setElementName] = useState<string>('Meu Elemento Composto')
  const [elementType, setElementType] = useState<CustomAssetType>('furniture')
  const [category, setCategory] = useState<string>('Geral')
  const [isCreatingNewCategory, setIsCreatingNewCategory] = useState<boolean>(false)
  const [newCategoryName, setNewCategoryName] = useState<string>('')

  // Canvas Refs
  const mainCanvasRef = useRef<HTMLCanvasElement>(null!)
  const composeCanvasRef = useRef<HTMLCanvasElement>(null!)
  const singlePreviewCanvasRef = useRef<HTMLCanvasElement>(null!)
  const animCanvasRef = useRef<HTMLCanvasElement>(null!)
  const fileInputRef = useRef<HTMLInputElement>(null!)

  const setBoardSizeInTiles = (wTiles: number, hTiles: number) => {
    const w = Math.max(1, Math.min(32, wTiles))
    const h = Math.max(1, Math.min(32, hTiles))
    const targetW = w * 32
    const targetH = h * 32
    const prevW = compositeBoardWidth
    const prevH = compositeBoardHeight
    setTileWidth(w)
    setTileHeight(h)
    setPixelWidth(targetW)
    setPixelHeight(targetH)
    setCompositeBoardWidth(targetW)
    setCompositeBoardHeight(targetH)
    setCompositeLayers((prev) => rescaleLayersForNewBoard(prev, targetW, targetH, prevW, prevH))
    setFrameLayerStates((prev) =>
      prev.map((layers) => rescaleLayersForNewBoard(layers, targetW, targetH, prevW, prevH))
    )
    if (elementType === 'furniture') {
      setDirectionalDimensions((prev) => ({
        ...prev,
        [activeDirection]: {
          tileWidth: w,
          tileHeight: h,
          pixelWidth: targetW,
          pixelHeight: targetH,
        },
      }))
    }
  }

  const setPixelSize = (pxW: number, pxH: number) => {
    const w = Math.max(1, Math.min(4096, pxW))
    const h = Math.max(1, Math.min(4096, pxH))
    const prevW = compositeBoardWidth
    const prevH = compositeBoardHeight
    const tW = Math.max(1, Math.ceil(w / 32))
    const tH = Math.max(1, Math.ceil(h / 32))
    setPixelWidth(w)
    setPixelHeight(h)
    setTileWidth(tW)
    setTileHeight(tH)
    setCompositeBoardWidth(w)
    setCompositeBoardHeight(h)
    setCompositeLayers((prev) => rescaleLayersForNewBoard(prev, w, h, prevW, prevH))
    setFrameLayerStates((prev) =>
      prev.map((layers) => rescaleLayersForNewBoard(layers, w, h, prevW, prevH))
    )
    if (w <= 16 || h <= 16) {
      setComposeZoom((z) => Math.max(z, 8))
    }
    if (elementType === 'furniture') {
      setDirectionalDimensions((prev) => ({
        ...prev,
        [activeDirection]: {
          tileWidth: tW,
          tileHeight: tH,
          pixelWidth: w,
          pixelHeight: h,
        },
      }))
    }
  }

  const handleFitLayersToBoard = () => {
    setCompositeLayers((prev) => {
      if (prev.length === 0) return prev
      return prev.map((layer) => {
        if (!selectedLayerId || layer.id === selectedLayerId) {
          return fitLayerToBounds(layer, compositeBoardWidth, compositeBoardHeight, scaleFitMode)
        }
        return layer
      })
    })
  }


  // Synchronize collisionGrid matrix when tile dimensions change
  useEffect(() => {
    setCollisionGrid((prev) => {
      const newGrid: boolean[][] = []
      for (let r = 0; r < tileHeight; r++) {
        const row: boolean[] = []
        for (let c = 0; c < tileWidth; c++) {
          if (prev[r] && prev[r][c] !== undefined) {
            row.push(prev[r][c])
          } else {
            row.push(false)
          }
        }
        newGrid.push(row)
      }
      return newGrid
    })
  }, [tileWidth, tileHeight])

  const handleSetAllCollision = (solid: boolean) => {
    setCollisionGrid((prev) => prev.map((row) => row.map(() => solid)))
  }

  const handleSetBottomHalfCollision = () => {
    setCollisionGrid((prev) =>
      prev.map((row, r) => row.map(() => r >= Math.floor(tileHeight / 2)))
    )
  }

  const handleSelectElementType = (newType: CustomAssetType) => {
    setElementType(newType)
    if (newType !== 'furniture') {
      setActiveDirection('down')
    }
    if (newType === 'avatar') {
      setTileWidth(1)
      setTileHeight(1)
      setCompositeBoardWidth(32)
      setCompositeBoardHeight(32)
    }
    if (!category) {
      setCategory('Geral')
    }
  }

  // Load asset data when editing an existing asset or opening in crop/compose mode
  useEffect(() => {
    if (!isCustomModalOpen) return

    if (editingAssetId) {
      const asset = getAssetById(editingAssetId)
      if (asset) {
        setElementName(asset.name)
        setElementType(asset.type)
        setCategory(asset.category || 'Geral')
        setTileWidth(asset.width)
        setTileHeight(asset.height)
        const initPxW = asset.pixelWidth || asset.width * 32
        const initPxH = asset.pixelHeight || asset.height * 32
        setPixelWidth(initPxW)
        setPixelHeight(initPxH)
        setCompositeBoardWidth(initPxW)
        setCompositeBoardHeight(initPxH)
        setFrames(asset.frames || [])
        setFrameRateMs(asset.frameRateMs || 160)
        if (asset.collisionGrid && asset.collisionGrid.length > 0) {
          setCollisionGrid(asset.collisionGrid)
        }

        if (asset.frameLayers && asset.frameLayers.length > 0) {
          setFrameLayerStates(asset.frameLayers)
          const firstFrameLayers = asset.frameLayers[0] || []
          setCompositeLayers(JSON.parse(JSON.stringify(firstFrameLayers)))
          if (firstFrameLayers.length > 0) {
            setSelectedLayerId(firstFrameLayers[0].id)
          }

          const existingClipsMap = new Map<string, CroppedClip>()
          asset.frameLayers.flat().forEach((layer) => {
            const clipKey = layer.clipId || layer.id
            if (!existingClipsMap.has(clipKey)) {
              existingClipsMap.set(clipKey, {
                id: clipKey,
                name: layer.name,
                dataUrl: layer.dataUrl,
                width: layer.width,
                height: layer.height,
              })
            }
          })
          setCroppedClips(Array.from(existingClipsMap.values()))
        } else if (asset.frames && asset.frames.length > 0) {
          const legacyLayers: CompositeLayer[][] = asset.frames.map((f, idx) => [
            {
              id: `layer_edit_${idx}_0`,
              clipId: `clip_edit_${idx}`,
              name: `Camada Base (${idx + 1})`,
              dataUrl: f,
              x: 0,
              y: 0,
              width: asset.width * 32,
              height: asset.height * 32,
              flipH: false,
              opacity: 1,
            },
          ])
          setFrameLayerStates(legacyLayers)
          setCompositeLayers(JSON.parse(JSON.stringify(legacyLayers[0])))
          setSelectedLayerId(legacyLayers[0][0].id)

          const clips: CroppedClip[] = asset.frames.map((f, idx) => ({
            id: `clip_edit_${idx}`,
            name: `Quadro ${idx + 1}`,
            dataUrl: f,
            width: asset.width * 32,
            height: asset.height * 32,
          }))
          setCroppedClips(clips)
        }

        setActiveDirection('down')
        if (asset.directionalFrames) {
          const dirFrames: Record<Direction, string[]> = {
            down: [],
            left: [],
            up: [],
            right: [],
          }
          ;(['down', 'left', 'up', 'right'] as Direction[]).forEach((d) => {
            const val = asset.directionalFrames?.[d]
            if (val) {
              dirFrames[d] = Array.isArray(val) ? val : [val]
            }
          })
          if (dirFrames.down.length === 0 && asset.frames && asset.frames.length > 0) {
            dirFrames.down = asset.frames
          }
          setDirectionalFrames(dirFrames)
        } else if (asset.frames && asset.frames.length > 0) {
          setDirectionalFrames({
            down: asset.frames,
            left: [],
            up: [],
            right: [],
          })
        }

        if (asset.directionalFrameLayers) {
          const dirLayers: Record<Direction, CompositeLayer[][]> = {
            down: [],
            left: [],
            up: [],
            right: [],
          }
          ;(['down', 'left', 'up', 'right'] as Direction[]).forEach((d) => {
            const val = asset.directionalFrameLayers?.[d]
            if (val) {
              dirLayers[d] = val as any
            }
          })
          if (dirLayers.down.length === 0 && asset.frameLayers && asset.frameLayers.length > 0) {
            dirLayers.down = asset.frameLayers as any
          }
          setDirectionalFrameLayers(dirLayers)
        } else if (asset.frameLayers && asset.frameLayers.length > 0) {
          setDirectionalFrameLayers({
            down: asset.frameLayers as any,
            left: [],
            up: [],
            right: [],
          })
        }

        if (asset.directionalDimensions) {
          const dims: Record<Direction, { tileWidth: number; tileHeight: number; pixelWidth: number; pixelHeight: number }> = {
            down: { tileWidth: asset.width, tileHeight: asset.height, pixelWidth: asset.pixelWidth || asset.width * 32, pixelHeight: asset.pixelHeight || asset.height * 32 },
            left: { tileWidth: asset.width, tileHeight: asset.height, pixelWidth: asset.pixelWidth || asset.width * 32, pixelHeight: asset.pixelHeight || asset.height * 32 },
            up: { tileWidth: asset.width, tileHeight: asset.height, pixelWidth: asset.pixelWidth || asset.width * 32, pixelHeight: asset.pixelHeight || asset.height * 32 },
            right: { tileWidth: asset.width, tileHeight: asset.height, pixelWidth: asset.pixelWidth || asset.width * 32, pixelHeight: asset.pixelHeight || asset.height * 32 },
          }
          ;(['down', 'left', 'up', 'right'] as Direction[]).forEach((d) => {
            const val = asset.directionalDimensions?.[d]
            if (val) {
              dims[d] = {
                tileWidth: val.width,
                tileHeight: val.height,
                pixelWidth: val.pixelWidth || val.width * 32,
                pixelHeight: val.pixelHeight || val.height * 32,
              }
            }
          })
          setDirectionalDimensions(dims)
        } else {
          const baseDim = {
            tileWidth: asset.width,
            tileHeight: asset.height,
            pixelWidth: asset.pixelWidth || asset.width * 32,
            pixelHeight: asset.pixelHeight || asset.height * 32,
          }
          setDirectionalDimensions({
            down: { ...baseDim },
            left: { ...baseDim },
            up: { ...baseDim },
            right: { ...baseDim },
          })
        }

        if (asset.directionalCollisionGrids) {
          setDirectionalCollisionGrids(asset.directionalCollisionGrids)
        }

        setSelectedFrameIdx(0)
        setStudioMode(initialStudioMode || 'compose')
      }
    } else {
      setActiveDirection('down')
      setDirectionalFrames({ down: [], left: [], up: [], right: [] })
      setDirectionalFrameLayers({ down: [], left: [], up: [], right: [] })
      setDirectionalDimensions({
        down: { tileWidth: 2, tileHeight: 2, pixelWidth: 64, pixelHeight: 64 },
        left: { tileWidth: 2, tileHeight: 2, pixelWidth: 64, pixelHeight: 64 },
        up: { tileWidth: 2, tileHeight: 2, pixelWidth: 64, pixelHeight: 64 },
        right: { tileWidth: 2, tileHeight: 2, pixelWidth: 64, pixelHeight: 64 },
      })
      setDirectionalCollisionGrids({})
      const emptyGrid: boolean[][] = []
      for (let r = 0; r < 2; r++) {
        emptyGrid.push([false, false])
      }
      setCollisionGrid(emptyGrid)
      setCategory(initialCategory || 'Geral')
      setStudioMode(initialStudioMode || 'crop')
    }
  }, [isCustomModalOpen, editingAssetId, initialStudioMode, initialCategory])

  // Animation player ticker
  useEffect(() => {
    if (!isPlayingAnim || frames.length <= 1) return
    const interval = setInterval(() => {
      setCurrentPreviewFrameIdx((prev) => (prev + 1) % frames.length)
    }, frameRateMs)
    return () => clearInterval(interval)
  }, [isPlayingAnim, frames.length, frameRateMs])

  // Draw main source canvas with selection box, handles, and dimensions
  useEffect(() => {
    const canvas = mainCanvasRef.current
    if (!canvas || !sourceImage) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = sourceImage.naturalWidth * zoom
    canvas.height = sourceImage.naturalHeight * zoom

    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height)

    const effectiveSnap = snapToGrid ? Math.max(1, gridSnapSize) : 1
    if (snapToGrid && effectiveSnap > 1) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
      ctx.lineWidth = 1
      const gridPx = effectiveSnap * zoom
      for (let x = 0; x <= canvas.width; x += gridPx) {
        ctx.beginPath()
        ctx.moveTo(x + 0.5, 0)
        ctx.lineTo(x + 0.5, canvas.height)
        ctx.stroke()
      }
      for (let y = 0; y <= canvas.height; y += gridPx) {
        ctx.beginPath()
        ctx.moveTo(0, y + 0.5)
        ctx.lineTo(canvas.width, y + 0.5)
        ctx.stroke()
      }
    }

    const sx = Math.round(selection.x * zoom)
    const sy = Math.round(selection.y * zoom)
    const sw = Math.round(selection.w * zoom)
    const sh = Math.round(selection.h * zoom)

    // Spotlight effect: dim area outside selection
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)'
    if (sy > 0) ctx.fillRect(0, 0, canvas.width, sy)
    if (sy + sh < canvas.height) ctx.fillRect(0, sy + sh, canvas.width, canvas.height - (sy + sh))
    if (sx > 0) ctx.fillRect(0, sy, sx, sh)
    if (sx + sw < canvas.width) ctx.fillRect(sx + sw, sy, canvas.width - (sx + sw), sh)

    // Live preview: inside the selection, show transparency filter if enabled
    if (enableBgRemoval) {
      const processed = getProcessedSelectionCanvas()
      if (processed) {
        ctx.clearRect(sx, sy, sw, sh)
        ctx.drawImage(processed, sx, sy, sw, sh)
      }
    }

    // Inside tint
    ctx.fillStyle = 'rgba(59, 130, 246, 0.12)'
    ctx.fillRect(sx, sy, sw, sh)

    // Selection border
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 2
    ctx.strokeRect(sx + 0.5, sy + 0.5, Math.max(1, sw - 1), Math.max(1, sh - 1))

    // Inner dashed guide
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.strokeRect(sx + 0.5, sy + 0.5, Math.max(1, sw - 1), Math.max(1, sh - 1))
    ctx.setLineDash([])

    // 8 Modern circular handles (nw, n, ne, e, se, s, sw, w)
    const handleRadius = 4.5
    const handlePoints = [
      [sx, sy],
      [sx + sw / 2, sy],
      [sx + sw, sy],
      [sx + sw, sy + sh / 2],
      [sx + sw, sy + sh],
      [sx + sw / 2, sy + sh],
      [sx, sy + sh],
      [sx, sy + sh / 2],
    ]

    handlePoints.forEach(([hx, hy]) => {
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#2563eb'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(hx, hy, handleRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    })

    // Floating dimension badge
    const label = `${selection.w} × ${selection.h} px`
    ctx.font = 'bold 11px monospace'
    const textMetrics = ctx.measureText(label)
    const textW = textMetrics.width
    const pillW = textW + 14
    const pillH = 18
    const pillX = Math.max(4, Math.min(canvas.width - pillW - 4, sx + (sw - pillW) / 2))
    const pillY = sy >= 24 ? sy - 22 : sy + sh + 6

    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)'
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(pillX, pillY, pillW, pillH, 5)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#38bdf8'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, pillX + pillW / 2, pillY + pillH / 2 + 0.5)
  }, [
    sourceImage,
    zoom,
    selection,
    snapToGrid,
    gridSnapSize,
    studioMode,
    isCustomModalOpen,
    enableBgRemoval,
    targetColor,
    tolerance,
    removeWhiteFringe,
  ])

  const getProcessedSelectionCanvas = (): HTMLCanvasElement | null => {
    if (!sourceImage || selection.w <= 0 || selection.h <= 0) return null
    const rawCrop = cropImage(sourceImage, selection.x, selection.y, selection.w, selection.h)
    if (enableBgRemoval) {
      return applyBackgroundRemoval(rawCrop, targetColor, tolerance, removeWhiteFringe)
    }
    return rawCrop
  }

  // Preload layer images cache
  const [cachedLayerImages, setCachedLayerImages] = useState<{ [id: string]: HTMLImageElement }>({})

  useEffect(() => {
    const newCache: { [id: string]: HTMLImageElement } = {}
    let loadedCount = 0
    const total = compositeLayers.length

    if (total === 0) {
      setCachedLayerImages({})
      return
    }

    compositeLayers.forEach((layer) => {
      const img = new Image()
      img.src = layer.dataUrl
      img.onload = () => {
        loadedCount++
        if (loadedCount === total) {
          setCachedLayerImages(newCache)
        }
      }
      newCache[layer.id] = img
    })
  }, [compositeLayers])

  // Draw Composition Canvas
  useEffect(() => {
    const canvas = composeCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const renderZoom = composeZoom
    canvas.width = compositeBoardWidth * renderZoom
    canvas.height = compositeBoardHeight * renderZoom

    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const tileSize = 16
    for (let y = 0; y < canvas.height; y += tileSize) {
      for (let x = 0; x < canvas.width; x += tileSize) {
        ctx.fillStyle = (x / tileSize + y / tileSize) % 2 === 0 ? '#181a20' : '#22252e'
        ctx.fillRect(x, y, tileSize, tileSize)
      }
    }

    if (snapToGrid) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
      ctx.lineWidth = 1
      const gridPx = 32 * renderZoom
      for (let x = 0; x <= canvas.width; x += gridPx) {
        ctx.beginPath()
        ctx.moveTo(x + 0.5, 0)
        ctx.lineTo(x + 0.5, canvas.height)
        ctx.stroke()
      }
      for (let y = 0; y <= canvas.height; y += gridPx) {
        ctx.beginPath()
        ctx.moveTo(0, y + 0.5)
        ctx.lineTo(canvas.width, y + 0.5)
        ctx.stroke()
      }
    }

    compositeLayers.forEach((layer) => {
      const img = cachedLayerImages[layer.id]
      if (!img || !img.complete) return

      ctx.save()
      ctx.globalAlpha = layer.opacity ?? 1

      const drawX = layer.x * renderZoom
      const drawY = layer.y * renderZoom
      const drawW = layer.width * renderZoom
      const drawH = layer.height * renderZoom

      if (layer.flipH) {
        ctx.translate(drawX + drawW, drawY)
        ctx.scale(-1, 1)
        ctx.drawImage(img, 0, 0, drawW, drawH)
      } else {
        ctx.drawImage(img, drawX, drawY, drawW, drawH)
      }

      if (composeTool === 'move' && layer.id === selectedLayerId) {
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 2
        ctx.setLineDash([4, 4])
        ctx.strokeRect(drawX + 0.5, drawY + 0.5, drawW - 1, drawH - 1)
        ctx.setLineDash([])
      }

      ctx.restore()
    })

    if (showCollisionOverlay && collisionGrid && collisionGrid.length > 0) {
      const targetW = pixelWidth || tileWidth * 32
      const targetH = pixelHeight || tileHeight * 32
      for (let r = 0; r < tileHeight; r++) {
        for (let c = 0; c < tileWidth; c++) {
          if (collisionGrid[r]?.[c]) {
            const cellLeft = c * 32
            const cellTop = r * 32
            const cellRight = Math.min((c + 1) * 32, targetW)
            const cellBottom = Math.min((r + 1) * 32, targetH)
            const cellW = (cellRight - cellLeft) * renderZoom
            const cellH = (cellBottom - cellTop) * renderZoom

            if (cellW > 0 && cellH > 0) {
              const bx = cellLeft * renderZoom
              const by = cellTop * renderZoom
              ctx.fillStyle = 'rgba(239, 68, 68, 0.25)'
              ctx.fillRect(bx, by, cellW, cellH)
              ctx.strokeStyle = '#ef4444'
              ctx.lineWidth = 2
              ctx.strokeRect(bx + 1, by + 1, cellW - 2, cellH - 2)
            }
          }
        }
      }
    }
  }, [
    compositeLayers,
    selectedLayerId,
    compositeBoardWidth,
    compositeBoardHeight,
    snapToGrid,
    cachedLayerImages,
    studioMode,
    isCustomModalOpen,
    showCollisionOverlay,
    collisionGrid,
    composeTool,
    composeZoom,
    tileWidth,
    tileHeight,
    pixelWidth,
    pixelHeight,
  ])

  // Update Animation Preview Canvas
  useEffect(() => {
    const animCanvas = animCanvasRef.current
    if (!animCanvas) return
    const ctx = animCanvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, animCanvas.width, animCanvas.height)

    const tileSize = 8
    for (let y = 0; y < animCanvas.height; y += tileSize) {
      for (let x = 0; x < animCanvas.width; x += tileSize) {
        ctx.fillStyle = (x / tileSize + y / tileSize) % 2 === 0 ? '#1e2029' : '#2b2d38'
        ctx.fillRect(x, y, tileSize, tileSize)
      }
    }

    const currentFrameData = frames[currentPreviewFrameIdx] || frames[0]
    if (!currentFrameData) return

    const img = new Image()
    img.src = currentFrameData
    img.onload = () => {
      ctx.imageSmoothingEnabled = false
      const maxDim = Math.max(img.width, img.height)
      const scale = (animCanvas.width - 16) / maxDim
      const drawW = img.width * scale
      const drawH = img.height * scale
      const offX = (animCanvas.width - drawW) / 2
      const offY = (animCanvas.height - drawH) / 2
      ctx.drawImage(img, offX, offY, drawW, drawH)
    }
  }, [frames, currentPreviewFrameIdx])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    processFile(file)
    // Allow the same file to be re-selected later
    e.target.value = ''
  }

  // Shared file-loading pipeline used by both the <input type="file"> change
  // handler and native HTML5 drag-and-drop events from the CropStudio.
  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      console.warn('[CustomElementModal] dropped file is not an image:', file.type)
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string
      const img = new Image()
      img.src = dataUrl
      img.onload = () => {
        setSourceImage(img)
        setSourceImageSrc(dataUrl)
        setSelection({ x: 0, y: 0, w: Math.min(64, img.naturalWidth), h: Math.min(64, img.naturalHeight) })
        if (img.naturalWidth > 640 || img.naturalHeight > 480) {
          const autoFitZoom = Math.max(0.15, Math.min(1, Math.min(640 / img.naturalWidth, 480 / img.naturalHeight)))
          setZoom(Math.round(autoFitZoom * 100) / 100)
        } else {
          setZoom(1)
        }
      }
    }
    reader.readAsDataURL(file)
  }

  // Handle Dynamic Crop Selection (8-direction handles, move, and freeform creation)
  type CropDragMode =
    | 'none'
    | 'create'
    | 'move'
    | 'nw'
    | 'n'
    | 'ne'
    | 'e'
    | 'se'
    | 's'
    | 'sw'
    | 'w'

  const cropDragRef = useRef<{
    isDragging: boolean
    mode: CropDragMode
    startClientX: number
    startClientY: number
    startMouseImgX: number
    startMouseImgY: number
    origSelection: { x: number; y: number; w: number; h: number }
  }>({
    isDragging: false,
    mode: 'none',
    startClientX: 0,
    startClientY: 0,
    startMouseImgX: 0,
    startMouseImgY: 0,
    origSelection: { x: 0, y: 0, w: 0, h: 0 },
  })

  const getCropInteractionAtPoint = (
    clientX: number,
    clientY: number,
    rect: DOMRect
  ): { mode: CropDragMode; cursor: string } => {
    if (isEyedropperActive) {
      return { mode: 'none', cursor: 'crosshair' }
    }

    const mx = clientX - rect.left
    const my = clientY - rect.top

    const sx = selection.x * zoom
    const sy = selection.y * zoom
    const sw = selection.w * zoom
    const sh = selection.h * zoom

    const HANDLE_HIT_R = 9

    const handlePoints: { mode: CropDragMode; x: number; y: number; cursor: string }[] = [
      { mode: 'nw', x: sx, y: sy, cursor: 'nwse-resize' },
      { mode: 'n', x: sx + sw / 2, y: sy, cursor: 'ns-resize' },
      { mode: 'ne', x: sx + sw, y: sy, cursor: 'nesw-resize' },
      { mode: 'e', x: sx + sw, y: sy + sh / 2, cursor: 'ew-resize' },
      { mode: 'se', x: sx + sw, y: sy + sh, cursor: 'nwse-resize' },
      { mode: 's', x: sx + sw / 2, y: sy + sh, cursor: 'ns-resize' },
      { mode: 'sw', x: sx, y: sy + sh, cursor: 'nesw-resize' },
      { mode: 'w', x: sx, y: sy + sh / 2, cursor: 'ew-resize' },
    ]

    for (const h of handlePoints) {
      const dx = mx - h.x
      const dy = my - h.y
      if (dx * dx + dy * dy <= HANDLE_HIT_R * HANDLE_HIT_R) {
        return { mode: h.mode, cursor: h.cursor }
      }
    }

    // Check if inside the existing selection box to drag/move it
    if (mx >= sx && mx <= sx + sw && my >= sy && my <= sy + sh) {
      return { mode: 'move', cursor: 'move' }
    }

    return { mode: 'create', cursor: 'crosshair' }
  }

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!mainCanvasRef.current || !sourceImage) return
    const rect = mainCanvasRef.current.getBoundingClientRect()
    const scaleX = mainCanvasRef.current.width / rect.width
    const scaleY = mainCanvasRef.current.height / rect.height
    const canvasPxX = Math.floor((e.clientX - rect.left) * scaleX)
    const canvasPxY = Math.floor((e.clientY - rect.top) * scaleY)

    if (isEyedropperActive) {
      const sampleCanvas = document.createElement('canvas')
      sampleCanvas.width = sourceImage.naturalWidth
      sampleCanvas.height = sourceImage.naturalHeight
      const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })
      if (sampleCtx) {
        sampleCtx.drawImage(sourceImage, 0, 0)
        const imgX = Math.max(0, Math.min(sourceImage.naturalWidth - 1, Math.floor(canvasPxX / zoom)))
        const imgY = Math.max(0, Math.min(sourceImage.naturalHeight - 1, Math.floor(canvasPxY / zoom)))
        const pixel = sampleCtx.getImageData(imgX, imgY, 1, 1).data
        setTargetColor({
          r: pixel[0],
          g: pixel[1],
          b: pixel[2],
        })
        setEnableBgRemoval(true)
      }
      setIsEyedropperActive(false)
      return
    }

    const { mode, cursor } = getCropInteractionAtPoint(e.clientX, e.clientY, rect)
    mainCanvasRef.current.style.cursor = cursor

    const imgW = sourceImage.naturalWidth
    const imgH = sourceImage.naturalHeight
    const rawMouseImgX = (e.clientX - rect.left) / zoom
    const rawMouseImgY = (e.clientY - rect.top) / zoom

    const effectiveSnap = snapToGrid ? Math.max(1, gridSnapSize) : 1

    if (mode === 'create') {
      let startX = rawMouseImgX
      let startY = rawMouseImgY
      if (effectiveSnap > 1) {
        startX = Math.floor(startX / effectiveSnap) * effectiveSnap
        startY = Math.floor(startY / effectiveSnap) * effectiveSnap
      } else {
        startX = Math.round(startX)
        startY = Math.round(startY)
      }
      startX = Math.max(0, Math.min(imgW - 1, startX))
      startY = Math.max(0, Math.min(imgH - 1, startY))

      cropDragRef.current = {
        isDragging: true,
        mode: 'create',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startMouseImgX: startX,
        startMouseImgY: startY,
        origSelection: { x: startX, y: startY, w: 1, h: 1 },
      }
      setSelection({ x: startX, y: startY, w: 1, h: 1 })
      setIsDraggingSelection(true)
    } else {
      cropDragRef.current = {
        isDragging: true,
        mode,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startMouseImgX: rawMouseImgX,
        startMouseImgY: rawMouseImgY,
        origSelection: { ...selection },
      }
      setIsDraggingSelection(true)
    }
  }

  // Global mouse move & up — tracks resizing, moving and creating smoothly across the whole window
  useEffect(() => {
    if (!isDraggingSelection) return

    const handleWindowMouseMove = (e: MouseEvent) => {
      const canvas = mainCanvasRef.current
      if (!canvas || !sourceImage || !cropDragRef.current.isDragging) return
      const rect = canvas.getBoundingClientRect()

      const imgW = sourceImage.naturalWidth
      const imgH = sourceImage.naturalHeight
      const { mode, startClientX, startClientY, startMouseImgX, startMouseImgY, origSelection } =
        cropDragRef.current

      // Invert snap with Alt key
      const baseSnap = snapToGrid ? Math.max(1, gridSnapSize) : 1
      const effectiveSnap = e.altKey ? 1 : baseSnap

      const currentMouseImgX = (e.clientX - rect.left) / zoom
      const currentMouseImgY = (e.clientY - rect.top) / zoom

      if (mode === 'create') {
        let curX = currentMouseImgX
        let curY = currentMouseImgY
        if (effectiveSnap > 1) {
          curX = Math.round(curX / effectiveSnap) * effectiveSnap
          curY = Math.round(curY / effectiveSnap) * effectiveSnap
        } else {
          curX = Math.round(curX)
          curY = Math.round(curY)
        }
        curX = Math.max(0, Math.min(imgW, curX))
        curY = Math.max(0, Math.min(imgH, curY))

        const minX = Math.max(0, Math.min(startMouseImgX, curX))
        const minY = Math.max(0, Math.min(startMouseImgY, curY))
        const maxX = Math.min(imgW, Math.max(startMouseImgX, curX))
        const maxY = Math.min(imgH, Math.max(startMouseImgY, curY))
        const w = Math.max(1, maxX - minX)
        const h = Math.max(1, maxY - minY)

        setSelection({ x: minX, y: minY, w, h })
        return
      }

      if (mode === 'move') {
        const deltaX = (e.clientX - startClientX) / zoom
        const deltaY = (e.clientY - startClientY) / zoom

        let newX = origSelection.x + deltaX
        let newY = origSelection.y + deltaY

        if (effectiveSnap > 1) {
          newX = Math.round(newX / effectiveSnap) * effectiveSnap
          newY = Math.round(newY / effectiveSnap) * effectiveSnap
        } else {
          newX = Math.round(newX)
          newY = Math.round(newY)
        }

        newX = Math.max(0, Math.min(imgW - origSelection.w, newX))
        newY = Math.max(0, Math.min(imgH - origSelection.h, newY))

        setSelection({ x: newX, y: newY, w: origSelection.w, h: origSelection.h })
        return
      }

      // Handle Resizing (nw, n, ne, e, se, s, sw, w)
      const deltaX = (e.clientX - startClientX) / zoom
      const deltaY = (e.clientY - startClientY) / zoom

      let left = origSelection.x
      let right = origSelection.x + origSelection.w
      let top = origSelection.y
      let bottom = origSelection.y + origSelection.h

      if (['e', 'ne', 'se'].includes(mode)) {
        let newRight = right + deltaX
        if (effectiveSnap > 1) {
          newRight = Math.round(newRight / effectiveSnap) * effectiveSnap
        } else {
          newRight = Math.round(newRight)
        }
        right = Math.max(left + 1, Math.min(imgW, newRight))
      }

      if (['w', 'nw', 'sw'].includes(mode)) {
        let newLeft = left + deltaX
        if (effectiveSnap > 1) {
          newLeft = Math.round(newLeft / effectiveSnap) * effectiveSnap
        } else {
          newLeft = Math.round(newLeft)
        }
        left = Math.max(0, Math.min(right - 1, newLeft))
      }

      if (['s', 'se', 'sw'].includes(mode)) {
        let newBottom = bottom + deltaY
        if (effectiveSnap > 1) {
          newBottom = Math.round(newBottom / effectiveSnap) * effectiveSnap
        } else {
          newBottom = Math.round(newBottom)
        }
        bottom = Math.max(top + 1, Math.min(imgH, newBottom))
      }

      if (['n', 'nw', 'ne'].includes(mode)) {
        let newTop = top + deltaY
        if (effectiveSnap > 1) {
          newTop = Math.round(newTop / effectiveSnap) * effectiveSnap
        } else {
          newTop = Math.round(newTop)
        }
        top = Math.max(0, Math.min(bottom - 1, newTop))
      }

      setSelection({
        x: left,
        y: top,
        w: Math.max(1, right - left),
        h: Math.max(1, bottom - top),
      })
    }

    const handleWindowMouseUp = () => {
      cropDragRef.current.isDragging = false
      cropDragRef.current.mode = 'none'
      setIsDraggingSelection(false)
    }

    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [isDraggingSelection, snapToGrid, gridSnapSize, zoom, sourceImage])

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!mainCanvasRef.current || !sourceImage) return
    if (cropDragRef.current.isDragging) return
    const rect = mainCanvasRef.current.getBoundingClientRect()
    const { cursor } = getCropInteractionAtPoint(e.clientX, e.clientY, rect)
    mainCanvasRef.current.style.cursor = cursor
  }

  const handleCanvasMouseUp = () => {
    cropDragRef.current.isDragging = false
    cropDragRef.current.mode = 'none'
    setIsDraggingSelection(false)
  }

  // Auto-Crop / Trim to bounding box of content
  const handleAutoCropToContent = () => {
    if (!sourceImage || selection.w <= 0 || selection.h <= 0) return
    const rawCrop = cropImage(sourceImage, selection.x, selection.y, selection.w, selection.h)
    const processed = enableBgRemoval
      ? applyBackgroundRemoval(rawCrop, targetColor, tolerance, removeWhiteFringe)
      : rawCrop

    const bounds = getTrimmedBounds(processed)
    if (bounds) {
      const newX = Math.max(0, selection.x + bounds.x)
      const newY = Math.max(0, selection.y + bounds.y)
      const newW = Math.min(sourceImage.naturalWidth - newX, bounds.w)
      const newH = Math.min(sourceImage.naturalHeight - newY, bounds.h)
      setSelection({ x: newX, y: newY, w: newW, h: newH })
    }
  }

  // Keyboard navigation for pixel-level nudge adjustments
  useEffect(() => {
    if (studioMode !== 'crop' || !sourceImage || !isCustomModalOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return
      }

      const imgW = sourceImage.naturalWidth
      const imgH = sourceImage.naturalHeight
      const step = e.shiftKey ? 10 : 1

      if (e.altKey) {
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          setSelection((s) => ({ ...s, w: Math.min(imgW - s.x, s.w + step) }))
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setSelection((s) => ({ ...s, w: Math.max(1, s.w - step) }))
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelection((s) => ({ ...s, h: Math.min(imgH - s.y, s.h + step) }))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelection((s) => ({ ...s, h: Math.max(1, s.h - step) }))
        }
      } else {
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          setSelection((s) => ({ ...s, x: Math.min(imgW - s.w, s.x + step) }))
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setSelection((s) => ({ ...s, x: Math.max(0, s.x - step) }))
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelection((s) => ({ ...s, y: Math.min(imgH - s.h, s.y + step) }))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelection((s) => ({ ...s, y: Math.max(0, s.y - step) }))
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [studioMode, sourceImage, isCustomModalOpen])

  // Composition Mouse Handlers
  const handleComposeCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!composeCanvasRef.current) return
    const rect = composeCanvasRef.current.getBoundingClientRect()
    const clickX = Math.floor((e.clientX - rect.left) / composeZoom)
    const clickY = Math.floor((e.clientY - rect.top) / composeZoom)

    if (composeTool === 'collision') {
      const targetW = pixelWidth || tileWidth * 32
      const targetH = pixelHeight || tileHeight * 32
      if (clickX < 0 || clickX >= targetW || clickY < 0 || clickY >= targetH) {
        return
      }

      const tileCol = Math.floor(clickX / 32)
      const tileRow = Math.floor(clickY / 32)

      if (tileRow >= 0 && tileRow < tileHeight && tileCol >= 0 && tileCol < tileWidth) {
        const currentValue = collisionGrid[tileRow]?.[tileCol] ?? false
        const nextValue = !currentValue
        setCollisionPaintValue(nextValue)
        setIsPaintingCollision(true)
        setCollisionGrid((prev) =>
          prev.map((row, r) =>
            row.map((val, c) => (r === tileRow && c === tileCol ? nextValue : val))
          )
        )
      }
      return
    }

    for (let i = compositeLayers.length - 1; i >= 0; i--) {
      const layer = compositeLayers[i]
      if (
        clickX >= layer.x &&
        clickX <= layer.x + layer.width &&
        clickY >= layer.y &&
        clickY <= layer.y + layer.height
      ) {
        setSelectedLayerId(layer.id)
        setIsDraggingLayer(true)
        setDragLayerStart({
          mouseX: clickX,
          mouseY: clickY,
          layerX: layer.x,
          layerY: layer.y,
        })
        return
      }
    }

    setSelectedLayerId(null)
  }

  const handleComposeCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!composeCanvasRef.current) return
    const rect = composeCanvasRef.current.getBoundingClientRect()
    const currentX = Math.floor((e.clientX - rect.left) / composeZoom)
    const currentY = Math.floor((e.clientY - rect.top) / composeZoom)

    if (composeTool === 'collision') {
      if (!isPaintingCollision) return
      const targetW = pixelWidth || tileWidth * 32
      const targetH = pixelHeight || tileHeight * 32
      if (currentX < 0 || currentX >= targetW || currentY < 0 || currentY >= targetH) {
        return
      }

      const tileCol = Math.floor(currentX / 32)
      const tileRow = Math.floor(currentY / 32)

      if (tileRow >= 0 && tileRow < tileHeight && tileCol >= 0 && tileCol < tileWidth) {
        setCollisionGrid((prev) =>
          prev.map((row, r) =>
            row.map((val, c) => (r === tileRow && c === tileCol ? collisionPaintValue : val))
          )
        )
      }
      return
    }

    if (!isDraggingLayer || !selectedLayerId) return

    const deltaX = currentX - dragLayerStart.mouseX
    const deltaY = currentY - dragLayerStart.mouseY

    let newX = dragLayerStart.layerX + deltaX
    let newY = dragLayerStart.layerY + deltaY

    if (snapToGrid) {
      const step = compositeBoardWidth <= 16 || compositeBoardHeight <= 16 ? 1 : 8
      newX = Math.round(newX / step) * step
      newY = Math.round(newY / step) * step
    }

    setCompositeLayers((prev) =>
      prev.map((l) => (l.id === selectedLayerId ? { ...l, x: newX, y: newY } : l))
    )
  }

  const handleComposeCanvasMouseUp = () => {
    setIsDraggingLayer(false)
    setIsPaintingCollision(false)
  }

  // Crop & Add Actions
  const handleSaveCurrentCropToLibrary = () => {
    const processed = getProcessedSelectionCanvas()
    if (!processed) return null

    const targetW = pixelWidth || tileWidth * 32
    const targetH = pixelHeight || tileHeight * 32

    // Retain full crisp crop resolution for lossless scaling at any size
    const dataUrl = processed.toDataURL('image/png')
    const clipId = `clip_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
    const clipName = `Peça ${croppedClips.length + 1} (${processed.width}x${processed.height}px)`

    const newClip: CroppedClip = {
      id: clipId,
      name: clipName,
      dataUrl,
      width: targetW,
      height: targetH,
      origWidth: processed.width,
      origHeight: processed.height,
    }

    setCroppedClips((prev) => [...prev, newClip])
    return newClip
  }

  const handleAddClipToCompositionBoard = (clip: CroppedClip) => {
    const newLayerId = `layer_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`

    const origW = clip.origWidth || clip.width
    const origH = clip.origHeight || clip.height

    const { drawW, drawH, offX, offY } = calculateFitDimensions(
      origW,
      origH,
      compositeBoardWidth,
      compositeBoardHeight,
      scaleFitMode,
      'bottom'
    )

    const newLayer: CompositeLayer = {
      id: newLayerId,
      clipId: clip.id,
      name: clip.name,
      dataUrl: clip.dataUrl,
      x: offX,
      y: offY,
      width: drawW,
      height: drawH,
      origWidth: origW,
      origHeight: origH,
      flipH: false,
      opacity: 1,
    }

    setCompositeLayers((prev) => [...prev, newLayer])
    setSelectedLayerId(newLayerId)
  }

  const handleBakeCompositionToFrame = () => {
    if (compositeLayers.length === 0) {
      alert('Adicione pelo menos uma camada na mesa de composição antes de mesclar.')
      return
    }

    const { scale, bakeWidth, bakeHeight, useSmoothing } = calculateHighFidelityBakeScale(
      compositeBoardWidth,
      compositeBoardHeight,
      compositeLayers
    )

    const offscreen = document.createElement('canvas')
    offscreen.width = bakeWidth
    offscreen.height = bakeHeight
    const ctx = offscreen.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = useSmoothing
    if (useSmoothing) {
      ctx.imageSmoothingQuality = 'high'
    }
    ctx.clearRect(0, 0, offscreen.width, offscreen.height)

    compositeLayers.forEach((layer) => {
      const img = cachedLayerImages[layer.id]
      if (!img) return

      ctx.save()
      ctx.globalAlpha = layer.opacity ?? 1

      const drawX = layer.x * scale
      const drawY = layer.y * scale
      const drawW = layer.width * scale
      const drawH = layer.height * scale

      if (layer.flipH) {
        ctx.translate(drawX + drawW, drawY)
        ctx.scale(-1, 1)
        ctx.drawImage(img, 0, 0, drawW, drawH)
      } else {
        ctx.drawImage(img, drawX, drawY, drawW, drawH)
      }

      ctx.restore()
    })

    const dataUrl = offscreen.toDataURL('image/png')
    const layersClone = JSON.parse(JSON.stringify(compositeLayers))

    setFrames((prev) => [...prev, dataUrl])
    setFrameLayerStates((prev) => [...prev, layersClone])
    setSelectedFrameIdx(frames.length)

    if (elementType === 'furniture') {
      setDirectionalFrames((prev) => ({
        ...prev,
        [activeDirection]: [...(prev[activeDirection] || []), dataUrl],
      }))
      setDirectionalFrameLayers((prev) => ({
        ...prev,
        [activeDirection]: [...(prev[activeDirection] || []), layersClone],
      }))
    }
  }

  const handleFlipLayer = (id: string) => {
    setCompositeLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, flipH: !l.flipH } : l))
    )
  }

  const handleDuplicateLayer = (id: string) => {
    const target = compositeLayers.find((l) => l.id === id)
    if (!target) return
    const clone: CompositeLayer = {
      ...target,
      id: `layer_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: `${target.name} (Cópia)`,
      x: target.x + 8,
      y: target.y + 8,
    }
    setCompositeLayers((prev) => [...prev, clone])
    setSelectedLayerId(clone.id)
  }

  const handleDeleteLayer = (id: string) => {
    setCompositeLayers((prev) => prev.filter((l) => l.id !== id))
    if (selectedLayerId === id) setSelectedLayerId(null)
  }

  const handleDeleteClip = (id: string) => {
    setCroppedClips((prev) => prev.filter((c) => c.id !== id))
  }

  const handleMoveLayerOrder = (idx: number, direction: 'up' | 'down') => {
    setCompositeLayers((prev) => {
      const clone = [...prev]
      const targetIdx = direction === 'up' ? idx + 1 : idx - 1
      if (targetIdx < 0 || targetIdx >= clone.length) return prev
      const temp = clone[idx]
      clone[idx] = clone[targetIdx]
      clone[targetIdx] = temp
      return clone
    })
  }

  const handleChangeLayerOpacity = (id: string, opacity: number) => {
    setCompositeLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, opacity } : l))
    )
  }

  const handleDeleteFrame = (idx: number) => {
    setFrames((prev) => prev.filter((_, i) => i !== idx))
    setFrameLayerStates((prev) => prev.filter((_, i) => i !== idx))
    if (elementType === 'furniture') {
      setDirectionalFrames((prev) => ({
        ...prev,
        [activeDirection]: (prev[activeDirection] || []).filter((_, i) => i !== idx),
      }))
      setDirectionalFrameLayers((prev) => ({
        ...prev,
        [activeDirection]: (prev[activeDirection] || []).filter((_, i) => i !== idx),
      }))
    }
    if (selectedFrameIdx === idx) {
      setSelectedFrameIdx(null)
    } else if (selectedFrameIdx !== null && selectedFrameIdx > idx) {
      setSelectedFrameIdx(selectedFrameIdx - 1)
    }
  }

  // Full studio reset: clears the loaded source image, clips, the composition
  // board and the baked frames/timeline, returning every tab to blank state.
  // Previously it only cleared compositeLayers/frames, so an image loaded in
  // the "Recortar Imagem" tab stayed on screen and nothing seemed to happen.
  const handleClearBoard = () => {
    setSourceImage(null)
    setSourceImageSrc('')
    setSelection({ x: 0, y: 0, w: 64, h: 128 })
    setZoom(1)
    setCroppedClips([])
    setCompositeLayers([])
    setSelectedLayerId(null)
    setFrames([])
    setFrameLayerStates([])
    setActiveDirection('down')
    setDirectionalFrames({ down: [], left: [], up: [], right: [] })
    setDirectionalFrameLayers({ down: [], left: [], up: [], right: [] })
    setDirectionalDimensions({
      down: { tileWidth: 2, tileHeight: 2, pixelWidth: 64, pixelHeight: 64 },
      left: { tileWidth: 2, tileHeight: 2, pixelWidth: 64, pixelHeight: 64 },
      up: { tileWidth: 2, tileHeight: 2, pixelWidth: 64, pixelHeight: 64 },
      right: { tileWidth: 2, tileHeight: 2, pixelWidth: 64, pixelHeight: 64 },
    })
    setDirectionalCollisionGrids({})
    const emptyGrid: boolean[][] = []
    for (let r = 0; r < 2; r++) {
      emptyGrid.push([false, false])
    }
    setCollisionGrid(emptyGrid)
    setSelectedFrameIdx(null)
    setCurrentPreviewFrameIdx(0)
    setTileWidth(2)
    setTileHeight(2)
    setPixelWidth(64)
    setPixelHeight(64)
    setCompositeBoardWidth(64)
    setCompositeBoardHeight(64)
    setStudioMode('crop')
  }

  // Save the custom asset into the store
  const handleSaveAsset = async () => {
    let finalFrames: string[] = []
    let finalFrameLayers: CompositeLayer[][] = []
    const finalDirFrames: Partial<Record<Direction, string[]>> = {}
    const finalDirLayers: Partial<Record<Direction, CompositeLayer[][]>> = {}
    const finalDirDims: Partial<Record<Direction, DirectionalDimension>> = {}
    const finalDirCollisionsRecord: Partial<Record<Direction, boolean[][]>> = {}

    const isFloor = elementType === 'floor'
    const isWall = elementType === 'wall'
    const finalIsObstacle = isFloor
      ? false
      : isWall
      ? true
      : collisionGrid.some((row) => row.some((col) => col === true))
    const finalCollisionGrid = isFloor ? [] : collisionGrid

    let finalCategory = category.trim() || 'Geral'
    if (isCreatingNewCategory && newCategoryName.trim()) {
      finalCategory = newCategoryName.trim()
      addCategory(finalCategory)
    }

    if (elementType === 'furniture') {
      const directions: Direction[] = ['down', 'left', 'up', 'right']

      // Collect active direction board layers & frames
      const currentActiveBoardLayers = JSON.parse(JSON.stringify(compositeLayers))
      const currentActiveFrameLayers = [...frameLayerStates]
      const currentActiveFrames = [...frames]

      const allDirLayers: Record<Direction, CompositeLayer[][]> = {
        ...directionalFrameLayers,
        [activeDirection]:
          currentActiveFrameLayers.length > 0
            ? currentActiveFrameLayers
            : currentActiveBoardLayers.length > 0
            ? [currentActiveBoardLayers]
            : (directionalFrameLayers[activeDirection] || []),
      }

      const allDirFramesState: Record<Direction, string[]> = {
        ...directionalFrames,
        [activeDirection]: currentActiveFrames,
      }

      const allDirDims: Record<Direction, { tileWidth: number; tileHeight: number; pixelWidth: number; pixelHeight: number }> = {
        ...directionalDimensions,
        [activeDirection]: {
          tileWidth,
          tileHeight,
          pixelWidth: pixelWidth || tileWidth * 32,
          pixelHeight: pixelHeight || tileHeight * 32,
        },
      }

      const allDirCollisions: Partial<Record<Direction, boolean[][]>> = {
        ...directionalCollisionGrids,
        [activeDirection]: collisionGrid,
      }

      // Process each direction
      for (const d of directions) {
        const layersList = allDirLayers[d] || []
        const dim = allDirDims[d] || {
          tileWidth: 2,
          tileHeight: 2,
          pixelWidth: 64,
          pixelHeight: 64,
        }

        finalDirDims[d] = {
          width: dim.pixelWidth ? dim.pixelWidth / 32 : dim.tileWidth,
          height: dim.pixelHeight ? dim.pixelHeight / 32 : dim.tileHeight,
          pixelWidth: dim.pixelWidth,
          pixelHeight: dim.pixelHeight,
        }

        if (allDirCollisions[d]) {
          finalDirCollisionsRecord[d] = allDirCollisions[d]
        }

        if (layersList.length > 0) {
          finalDirLayers[d] = layersList
          const bakedForD: string[] = []
          for (const frameLayer of layersList) {
            if (frameLayer.length > 0) {
              const bUrl = await bakeLayersToDataUrl(
                dim.pixelWidth,
                dim.pixelHeight,
                frameLayer,
                d === activeDirection ? cachedLayerImages : undefined
              )
              if (bUrl) bakedForD.push(bUrl)
            }
          }
          if (bakedForD.length > 0) {
            finalDirFrames[d] = bakedForD
          } else if (allDirFramesState[d] && allDirFramesState[d].length > 0) {
            finalDirFrames[d] = allDirFramesState[d]
          }
        } else if (allDirFramesState[d] && allDirFramesState[d].length > 0) {
          finalDirFrames[d] = allDirFramesState[d]
        }
      }

      // Default finalFrames should be the front (down) view, or activeDirection, or any available direction
      if (finalDirFrames.down && finalDirFrames.down.length > 0) {
        finalFrames = finalDirFrames.down
        finalFrameLayers = finalDirLayers.down || []
      } else if (finalDirFrames[activeDirection] && finalDirFrames[activeDirection]!.length > 0) {
        finalFrames = finalDirFrames[activeDirection]!
        finalFrameLayers = finalDirLayers[activeDirection] || []
      } else {
        for (const d of directions) {
          if (finalDirFrames[d] && finalDirFrames[d]!.length > 0) {
            finalFrames = finalDirFrames[d]!
            finalFrameLayers = finalDirLayers[d] || []
            break
          }
        }
      }
    } else {
      // Non-furniture (floor, wall, avatar)
      if (frames.length > 0) {
        finalFrames = [...frames]
        finalFrameLayers = [...frameLayerStates]
      } else if (compositeLayers.length > 0) {
        const baked = await bakeLayersToDataUrl(
          compositeBoardWidth,
          compositeBoardHeight,
          compositeLayers,
          cachedLayerImages
        )
        if (baked) {
          finalFrames = [baked]
          finalFrameLayers = [JSON.parse(JSON.stringify(compositeLayers))]
        }
      } else {
        const processed = getProcessedSelectionCanvas()
        if (!processed) {
          alert('Selecione uma área válida da imagem ou adicione camadas na mesa antes de salvar.')
          return
        }
        const targetW = pixelWidth || tileWidth * 32
        const targetH = pixelHeight || tileHeight * 32
        const { bakeWidth, bakeHeight, useSmoothing } = calculateHighFidelityBakeScale(
          targetW,
          targetH,
          [{ width: targetW, height: targetH, origWidth: processed.width, origHeight: processed.height }]
        )
        const scaled = resizeImageToTarget(processed, bakeWidth, bakeHeight, {
          fitMode: scaleFitMode,
          align: 'bottom',
          smooth: useSmoothing,
        })
        finalFrames = [scaled.toDataURL('image/png')]
        finalFrameLayers = [
          [
            {
              id: `layer_${Date.now()}`,
              clipId: `clip_${Date.now()}`,
              name: elementName.trim() || 'Camada Base',
              dataUrl: finalFrames[0],
              x: 0,
              y: 0,
              width: targetW,
              height: targetH,
              origWidth: processed.width,
              origHeight: processed.height,
              flipH: false,
              opacity: 1,
            },
          ],
        ]
      }
    }

    if (finalFrames.length === 0) {
      alert('Não foi possível gerar a imagem do elemento. Certifique-se de adicionar peças ou desenhar na mesa.')
      return
    }

    const baseWidth = elementType === 'furniture' && finalDirDims.down ? (finalDirDims.down.pixelWidth ? finalDirDims.down.pixelWidth / 32 : finalDirDims.down.width) : (pixelWidth ? pixelWidth / 32 : tileWidth)
    const baseHeight = elementType === 'furniture' && finalDirDims.down ? (finalDirDims.down.pixelHeight ? finalDirDims.down.pixelHeight / 32 : finalDirDims.down.height) : (pixelHeight ? pixelHeight / 32 : tileHeight)
    const basePixelWidth = elementType === 'furniture' && finalDirDims.down ? (finalDirDims.down.pixelWidth || finalDirDims.down.width * 32) : (pixelWidth || tileWidth * 32)
    const basePixelHeight = elementType === 'furniture' && finalDirDims.down ? (finalDirDims.down.pixelHeight || finalDirDims.down.height * 32) : (pixelHeight || tileHeight * 32)

    if (editingAssetId) {
      updateCustomAsset(editingAssetId, {
        name: elementName.trim() || 'Elemento Customizado',
        type: elementType,
        category: finalCategory,
        width: baseWidth,
        height: baseHeight,
        pixelWidth: basePixelWidth,
        pixelHeight: basePixelHeight,
        isObstacle: finalIsObstacle,
        collisionGrid: finalCollisionGrid,
        frames: finalFrames,
        frameLayers: finalFrameLayers,
        directionalFrames:
          elementType === 'furniture' && Object.keys(finalDirFrames).length > 0
            ? finalDirFrames
            : undefined,
        directionalFrameLayers:
          elementType === 'furniture' && Object.keys(finalDirLayers).length > 0
            ? finalDirLayers
            : undefined,
        directionalDimensions:
          elementType === 'furniture' && Object.keys(finalDirDims).length > 0
            ? finalDirDims
            : undefined,
        directionalCollisionGrids:
          elementType === 'furniture' && Object.keys(finalDirCollisionsRecord).length > 0
            ? finalDirCollisionsRecord
            : undefined,
        frameRateMs,
      })

      if (elementType === 'furniture') {
        setSelectedFurnitureDefId(editingAssetId)
        setActiveTool('place_furniture')
      } else if (elementType === 'floor') {
        setSelectedFloor(editingAssetId as any)
        setActiveTool('paint_floor')
      } else if (elementType === 'wall') {
        setSelectedWall(editingAssetId as any)
        setActiveTool('paint_wall')
      } else if (elementType === 'avatar') {
        const curAvatar = useGameStore.getState().localPlayer.avatar
        const updatedAvatar = { ...curAvatar, customSkinUrl: finalFrames[0], customAvatarId: editingAssetId }
        useGameStore.getState().setLocalPlayer({ avatar: updatedAvatar })
        PeerManager.getInstance().sendPlayerUpdate({ avatar: updatedAvatar })
      }

      setCustomModalOpen(false)
      return
    }

    const id = `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

    const newAsset: CustomAsset = {
      id,
      name: elementName.trim() || (elementType === 'avatar' ? 'Skin de Avatar' : 'Elemento Customizado'),
      type: elementType,
      category: finalCategory,
      width: baseWidth,
      height: baseHeight,
      pixelWidth: basePixelWidth,
      pixelHeight: basePixelHeight,
      isObstacle: finalIsObstacle,
      collisionGrid: finalCollisionGrid,
      frames: finalFrames,
      frameLayers: finalFrameLayers,
      directionalFrames:
        elementType === 'furniture' && Object.keys(finalDirFrames).length > 0
          ? finalDirFrames
          : undefined,
      directionalFrameLayers:
        elementType === 'furniture' && Object.keys(finalDirLayers).length > 0
          ? finalDirLayers
          : undefined,
      directionalDimensions:
        elementType === 'furniture' && Object.keys(finalDirDims).length > 0
          ? finalDirDims
          : undefined,
      directionalCollisionGrids:
        elementType === 'furniture' && Object.keys(finalDirCollisionsRecord).length > 0
          ? finalDirCollisionsRecord
          : undefined,
      frameRateMs,
      iconColor: elementType === 'avatar' ? '#8b5cf6' : isFloor ? '#20c997' : isWall ? '#f59f00' : '#e03131',
      createdAt: Date.now(),
    }

    addCustomAsset(newAsset)

    if (elementType === 'furniture') {
      setSelectedFurnitureDefId(id)
      setActiveTool('place_furniture')
    } else if (elementType === 'floor') {
      setSelectedFloor(id as any)
      setActiveTool('paint_floor')
    } else if (elementType === 'wall') {
      setSelectedWall(id as any)
      setActiveTool('paint_wall')
    } else if (elementType === 'avatar') {
      const curAvatar = useGameStore.getState().localPlayer.avatar
      const updatedAvatar = { ...curAvatar, customSkinUrl: finalFrames[0], customAvatarId: id }
      useGameStore.getState().setLocalPlayer({ avatar: updatedAvatar })
      PeerManager.getInstance().sendPlayerUpdate({ avatar: updatedAvatar })
    }

    setCustomModalOpen(false)
  }

  if (!isCustomModalOpen) return null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none">
      <div className="bg-[#1e1f22] border border-[#2b2d31] rounded-3xl w-full max-w-6xl overflow-hidden shadow-2xl flex flex-col h-[90vh] max-h-[850px]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[#2b2d31] bg-[#18191c]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center text-white font-black text-sm shadow">
              ✦
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-100">
                {editingAssetId ? 'Editar Elemento Personalizado' : 'Estúdio de Criação de Elementos'}
              </h2>
              <p className="text-[11px] text-slate-400">
                Recorte sprites, componha camadas e pinte colisões físicas para seu espaço virtual
              </p>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex bg-[#12151d] p-1 rounded-2xl border border-[#2b2d31]">
            <button
              type="button"
              onClick={() => setStudioMode('crop')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                studioMode === 'crop'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>1. Recortar Imagem</span>
            </button>

            <button
              type="button"
              onClick={() => setStudioMode('compose')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                studioMode === 'compose'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-300" />
              <span>3. Montagem & Colisão</span>
            </button>
          </div>

          <button
            onClick={() => setCustomModalOpen(false)}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-[#2b2d31] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2-Column Main Workspace */}
        <div className="flex flex-1 overflow-hidden">
          {/* LEFT COLUMN: Main Active Canvas */}
          <div className="flex-1 p-4 flex flex-col gap-3 overflow-hidden">
            {studioMode === 'crop' ? (
              <CropStudio
                sourceImage={sourceImage}
                sourceImageSrc={sourceImageSrc}
                zoom={zoom}
                setZoom={setZoom}
                snapToGrid={snapToGrid}
                setSnapToGrid={setSnapToGrid}
                gridSnapSize={gridSnapSize}
                setGridSnapSize={setGridSnapSize}
                selection={selection}
                setSelection={setSelection}
                isEyedropperActive={isEyedropperActive}
                mainCanvasRef={mainCanvasRef}
                fileInputRef={fileInputRef}
                onUploadImage={handleFileUpload}
                onDropFile={processFile}
                onCanvasMouseDown={handleCanvasMouseDown}
                onCanvasMouseMove={handleCanvasMouseMove}
                onCanvasMouseUp={handleCanvasMouseUp}
                onCropAndSaveClip={handleSaveCurrentCropToLibrary}
                tileWidth={tileWidth}
                tileHeight={tileHeight}
                pixelWidth={pixelWidth}
                pixelHeight={pixelHeight}
                onSetBoardSizeInTiles={setBoardSizeInTiles}
                onSetPixelSize={setPixelSize}
                onAutoCropToContent={handleAutoCropToContent}
                scaleFitMode={scaleFitMode}
              />
            ) : (
              <CompositionStudio
                elementType={elementType}
                tileWidth={tileWidth}
                tileHeight={tileHeight}
                pixelWidth={pixelWidth}
                pixelHeight={pixelHeight}
                setBoardSizeInTiles={setBoardSizeInTiles}
                composeCanvasRef={composeCanvasRef}
                composeTool={composeTool}
                setComposeTool={setComposeTool}
                composeZoom={composeZoom}
                setComposeZoom={setComposeZoom}
                showCollisionOverlay={showCollisionOverlay}
                setShowCollisionOverlay={setShowCollisionOverlay}
                collisionGrid={collisionGrid}
                onSetAllCollision={handleSetAllCollision}
                onSetBottomHalfCollision={handleSetBottomHalfCollision}
                onFitLayersToBoard={handleFitLayersToBoard}
                onComposeMouseDown={handleComposeCanvasMouseDown}
                onComposeMouseMove={handleComposeCanvasMouseMove}
                onComposeMouseUp={handleComposeCanvasMouseUp}
                activeDirection={activeDirection}
                onSelectDirection={handleSelectDirection}
                directionalFramesCount={{
                  down: (directionalFrames.down?.length || 0) + (activeDirection === 'down' && frames.length === 0 && compositeLayers.length > 0 ? 1 : 0),
                  left: (directionalFrames.left?.length || 0) + (activeDirection === 'left' && frames.length === 0 && compositeLayers.length > 0 ? 1 : 0),
                  up: (directionalFrames.up?.length || 0) + (activeDirection === 'up' && frames.length === 0 && compositeLayers.length > 0 ? 1 : 0),
                  right: (directionalFrames.right?.length || 0) + (activeDirection === 'right' && frames.length === 0 && compositeLayers.length > 0 ? 1 : 0),
                }}
                directionalDimensions={directionalDimensions}
                onCopyFromDownDirection={handleCopyFromDownDirection}
                onAutoMirrorLeftRight={handleAutoMirrorLeftRight}
              />
            )}
          </div>

          {/* RIGHT COLUMN: Toolbars, Clips Library, Layers, Properties */}
          <div className="w-96 bg-[#18191c] border-l border-[#2b2d31] p-4 flex flex-col gap-4 overflow-y-auto shrink-0">
            {/* Asset Properties Form */}
            <AssetPropertiesForm
              elementName={elementName}
              setElementName={setElementName}
              elementType={elementType}
              onSelectElementType={handleSelectElementType}
              category={category}
              setCategory={setCategory}
              allCategories={getAllCategories()}
              isCreatingNewCategory={isCreatingNewCategory}
              setIsCreatingNewCategory={setIsCreatingNewCategory}
              newCategoryName={newCategoryName}
              setNewCategoryName={setNewCategoryName}
              onAddNewCategory={() => {
                if (newCategoryName.trim()) {
                  addCategory(newCategoryName.trim())
                  setCategory(newCategoryName.trim())
                  setIsCreatingNewCategory(false)
                  setNewCategoryName('')
                }
              }}
              tileWidth={tileWidth}
              tileHeight={tileHeight}
              onSetBoardSizeInTiles={setBoardSizeInTiles}
              pixelWidth={pixelWidth}
              pixelHeight={pixelHeight}
              onSetPixelSize={setPixelSize}
              scaleFitMode={scaleFitMode}
              setScaleFitMode={setScaleFitMode}
              selection={selection}
            />

            {/* Transparency Controls */}
            <TransparencyControls
              enableBgRemoval={enableBgRemoval}
              setEnableBgRemoval={setEnableBgRemoval}
              targetColor={targetColor}
              setTargetColor={setTargetColor}
              tolerance={tolerance}
              setTolerance={setTolerance}
              removeWhiteFringe={removeWhiteFringe}
              setRemoveWhiteFringe={setRemoveWhiteFringe}
              isEyedropperActive={isEyedropperActive}
              setIsEyedropperActive={setIsEyedropperActive}
            />

            {/* Cropped Clips Gallery */}
            <CroppedClipsList
              croppedClips={croppedClips}
              onAddClipToComposition={handleAddClipToCompositionBoard}
              onDeleteClip={handleDeleteClip}
            />

            {/* Composite Layers Manager (in Compose Mode) */}
            {studioMode === 'compose' && (
              <LayerManager
                compositeLayers={compositeLayers}
                selectedLayerId={selectedLayerId}
                setSelectedLayerId={setSelectedLayerId}
                onFlipLayer={handleFlipLayer}
                onDuplicateLayer={handleDuplicateLayer}
                onDeleteLayer={handleDeleteLayer}
                onMoveLayerOrder={handleMoveLayerOrder}
                onChangeLayerOpacity={handleChangeLayerOpacity}
                onFitLayersToBoard={handleFitLayersToBoard}
              />
            )}

            {/* Animation Timeline */}
            <AnimationTimeline
              frames={frames}
              selectedFrameIdx={selectedFrameIdx}
              setSelectedFrameIdx={setSelectedFrameIdx}
              onCaptureFrame={handleBakeCompositionToFrame}
              onDeleteFrame={handleDeleteFrame}
              isPlayingAnim={isPlayingAnim}
              setIsPlayingAnim={setIsPlayingAnim}
              frameRateMs={frameRateMs}
              setFrameRateMs={setFrameRateMs}
              animCanvasRef={animCanvasRef}
            />
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 border-t border-[#2b2d31] bg-[#18191c] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearBoard}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Limpar Mesa</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setCustomModalOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSaveAsset}
              className="px-6 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white shadow-lg shadow-indigo-600/30 transition-all active:scale-95 flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>Salvar Elemento no Catálogo</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
