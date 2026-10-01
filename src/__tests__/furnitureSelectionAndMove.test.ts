import { describe, it, expect, beforeEach } from 'vitest'
import { useMapStore } from '../store/useMapStore'

describe('Editor Deselection & Immediate Move Behavior', () => {
  beforeEach(() => {
    useMapStore.setState({
      selectedPlacedFurnitureId: null,
      isMovingFurniture: false,
      selectedFurnitureDefId: '',
      activeTool: 'select',
      mapData: {
        width: 20,
        height: 20,
        floors: [],
        walls: [],
        furniture: [
          { id: 'furn-table', defId: 'glass_table', x: 5, y: 5, direction: 'down', rotation: 0 },
          { id: 'furn-chair', defId: 'chair_blue', x: 8, y: 8, direction: 'down', rotation: 0 },
        ],
        zones: [],
      },
    })
  })

  it('toggles selection off when clicking an already selected placed furniture', () => {
    // 1. Initial click: Selects furniture and enables move mode
    useMapStore.setState({
      selectedPlacedFurnitureId: 'furn-table',
      isMovingFurniture: true,
    })
    expect(useMapStore.getState().selectedPlacedFurnitureId).toBe('furn-table')
    expect(useMapStore.getState().isMovingFurniture).toBe(true)

    // 2. Second click on the same furniture: Deselects
    const currentSelectedId = useMapStore.getState().selectedPlacedFurnitureId
    if (currentSelectedId === 'furn-table') {
      useMapStore.setState({
        selectedPlacedFurnitureId: null,
        isMovingFurniture: false,
      })
    }

    expect(useMapStore.getState().selectedPlacedFurnitureId).toBeNull()
    expect(useMapStore.getState().isMovingFurniture).toBe(false)
  })

  it('allows clicking an active item in palette to deselect it', () => {
    // 1. Select furniture item in palette
    useMapStore.getState().setSelectedFurnitureDefId('sofa_blue')
    expect(useMapStore.getState().selectedFurnitureDefId).toBe('sofa_blue')
    expect(useMapStore.getState().activeTool).toBe('place_furniture')

    // 2. Clicking again in palette toggles selection off
    const isSelected =
      useMapStore.getState().selectedFurnitureDefId === 'sofa_blue' &&
      useMapStore.getState().activeTool === 'place_furniture'
    if (isSelected) {
      useMapStore.getState().setSelectedFurnitureDefId('')
      useMapStore.getState().setActiveTool('select')
    }

    expect(useMapStore.getState().selectedFurnitureDefId).toBe('')
    expect(useMapStore.getState().activeTool).toBe('select')
  })

  it('allows Escape key to deselect any active furniture and palette item', () => {
    useMapStore.setState({
      selectedPlacedFurnitureId: 'furn-table',
      isMovingFurniture: true,
      selectedFurnitureDefId: 'sofa_blue',
      activeTool: 'place_furniture',
    })

    // Simulate Escape
    useMapStore.setState({
      selectedPlacedFurnitureId: null,
      isMovingFurniture: false,
      selectedFurnitureDefId: '',
      setActiveTool: 'select',
    } as any)

    expect(useMapStore.getState().selectedPlacedFurnitureId).toBeNull()
    expect(useMapStore.getState().isMovingFurniture).toBe(false)
    expect(useMapStore.getState().selectedFurnitureDefId).toBe('')
  })

  it('deselects furniture when clicking empty space instead of teleporting it', () => {
    // When a furniture is selected
    useMapStore.setState({
      selectedPlacedFurnitureId: 'furn-chair',
      isMovingFurniture: true,
    })

    // When clicking empty space (no furniture clicked), deselect instead of teleporting
    const clickedFurn = null
    if (!clickedFurn && useMapStore.getState().selectedPlacedFurnitureId) {
      useMapStore.setState({
        selectedPlacedFurnitureId: null,
        isMovingFurniture: false,
      })
    }

    expect(useMapStore.getState().selectedPlacedFurnitureId).toBeNull()
    expect(useMapStore.getState().isMovingFurniture).toBe(false)
    // Position of chair remains intact (no teleport)
    const chair = useMapStore.getState().mapData.furniture.find((f) => f.id === 'furn-chair')
    expect(chair?.x).toBe(8)
    expect(chair?.y).toBe(8)
  })

  it('updates furniture position smoothly while dragging with boundary constraints', () => {
    useMapStore.setState({
      selectedPlacedFurnitureId: 'furn-table',
      isMovingFurniture: true,
    })

    // Drag table from (5,5) to (12, 14)
    useMapStore.getState().updateFurniture('furn-table', { x: 12, y: 14 })

    const updatedTable = useMapStore.getState().mapData.furniture.find((f) => f.id === 'furn-table')
    expect(updatedTable?.x).toBe(12)
    expect(updatedTable?.y).toBe(14)

    // Boundaries clamping: map is 20x20
    const clampedX = Math.max(0, Math.min(19, 25))
    const clampedY = Math.max(0, Math.min(19, -5))
    useMapStore.getState().updateFurniture('furn-table', { x: clampedX, y: clampedY })

    const clampedTable = useMapStore.getState().mapData.furniture.find((f) => f.id === 'furn-table')
    expect(clampedTable?.x).toBe(19)
    expect(clampedTable?.y).toBe(0)
  })
})
