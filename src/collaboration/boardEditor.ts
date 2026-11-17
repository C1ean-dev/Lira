import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { BinaryFileData, BinaryFiles } from '@excalidraw/excalidraw/types'

// Scene data uses SDK types directly. Only coordinate types belong to the Lira adapter.
export type BoardElement = ExcalidrawElement
export type BoardFile = BinaryFileData
export type BoardFiles = BinaryFiles
export type BoardPoint = { x: number; y: number }
