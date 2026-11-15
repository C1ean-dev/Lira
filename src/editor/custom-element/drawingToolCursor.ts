import pencil from '../../assets/cursors/draw-pencil.svg?url'
import eraser from '../../assets/cursors/draw-eraser.svg?url'
import fill from '../../assets/cursors/draw-fill.svg?url'
import picker from '../../assets/cursors/draw-picker.svg?url'
import move from '../../assets/cursors/draw-move.svg?url'

// Hotspots sit on the working tip, so the icon agrees with the pixel preview.
export const drawingToolCursors = {
  pencil: { url: pencil, file: 'draw-pencil.svg', hotspot: [3, 28], fallback: 'default' },
  eraser: { url: eraser, file: 'draw-eraser.svg', hotspot: [3, 22], fallback: 'default' },
  fill: { url: fill, file: 'draw-fill.svg', hotspot: [5, 27], fallback: 'default' },
  picker: { url: picker, file: 'draw-picker.svg', hotspot: [3, 29], fallback: 'default' },
  move: { url: move, file: 'draw-move.svg', hotspot: [16, 16], fallback: 'move' },
} as const

export function drawingToolCursor(tool: keyof typeof drawingToolCursors): string {
  const icon = drawingToolCursors[tool]
  return `url("${icon.url}") ${icon.hotspot[0]} ${icon.hotspot[1]}, ${icon.fallback}`
}
