import { restoreSceneElements } from './boardRestore'
import { validWhiteboardOperation, MAX_WHITEBOARD_OPERATIONS } from './whiteboard'
import type { BoardElement, BoardFiles } from './boardEditor'

/** Import only local scene formats; actual geometry restoration belongs to the SDK. */
export function parseBoardFile(text: string): { elements: BoardElement[]; files: BoardFiles } {
  const data = JSON.parse(text), base = { id: 'import', actor: 'local', clock: 1 }
  if (!data || !['lira-whiteboard', 'excalidraw'].includes(data.type) || !Array.isArray(data.elements) ||
      !data.files || typeof data.files !== 'object' || Array.isArray(data.files) ||
      data.elements.length + Object.keys(data.files).length >= MAX_WHITEBOARD_OPERATIONS) throw new Error('Arquivo de quadro inválido.')
  if (!data.elements.every((element: unknown) => validWhiteboardOperation({ ...base, kind: 'element', element })) ||
      !Object.entries(data.files).every(([id, file]) => file && typeof file === 'object' && 'id' in file && file.id === id &&
        validWhiteboardOperation({ ...base, kind: 'file', file }))) throw new Error('Arquivo com objetos inválidos ou imagens não locais.')
  if (new Set(data.elements.map((element: BoardElement) => element.id)).size !== data.elements.length) throw new Error('Objetos duplicados no quadro.')
  if (data.elements.some((element: BoardElement) => element.type === 'image' && element.fileId && !data.files[element.fileId])) throw new Error('Imagem do quadro ausente.')
  return { elements: restoreSceneElements(data.elements), files: data.files }
}
