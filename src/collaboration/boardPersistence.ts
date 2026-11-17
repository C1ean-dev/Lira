import { prepareBoardAssets } from './boardAssets'
import { openDB, type DBSchema } from 'idb'
import { getLocalStorage } from '../store/persistedState'
import { applyWhiteboardOperation, createWhiteboard, type WhiteboardDocument } from './whiteboard'

interface BoardDatabase extends DBSchema { documents: { key: string; value: WhiteboardDocument } }
const database = () => openDB<BoardDatabase>('lira-whiteboards', 1, { upgrade(db) { db.createObjectStore('documents') } })

function readDocument(raw: unknown): WhiteboardDocument {
  if (!raw || typeof raw !== 'object' || !('operations' in raw) || !raw.operations || typeof raw.operations !== 'object' || Array.isArray(raw.operations) || Object.keys(raw.operations).length > 1000) return createWhiteboard()
  return Object.values(raw.operations).reduce<WhiteboardDocument>(applyWhiteboardOperation, createWhiteboard())
}
async function normalize(document: WhiteboardDocument): Promise<WhiteboardDocument> {
  prepareBoardAssets()
  const { restoreBoardDocument } = await import('./boardRestore')
  return restoreBoardDocument(document)
}

export async function loadBoardRoom(roomId: string): Promise<WhiteboardDocument> {
  const db = await database()
  try {
    const stored = await db.get('documents', roomId)
    if (stored) return readDocument(stored)
    const legacy = getLocalStorage()?.getItem(`lira_whiteboard_${encodeURIComponent(roomId)}`)
    if (!legacy) return createWhiteboard()
    let document: WhiteboardDocument
    try { document = readDocument(JSON.parse(legacy)) } catch { return createWhiteboard() }
    document = await normalize(document)
    await db.put('documents', document, roomId)
    // Keep the legacy bytes as a recovery copy; only the version 2 database is written from now on.
    return document
  } finally { db.close() }
}

export async function saveBoardRoom(roomId: string, document: WhiteboardDocument): Promise<void> {
  const db = await database()
  let normalized: WhiteboardDocument
  try { normalized = await normalize(document) } catch (error) { db.close(); throw error }
  const tx = db.transaction('documents', 'readwrite')
  try {
    const previous = readDocument(await tx.store.get(roomId))
    const merged = Object.values(normalized.operations).reduce(applyWhiteboardOperation, previous)
    await tx.store.put(merged, roomId)
    await tx.done
  } catch (error) {
    try { tx.abort() } catch {}
    await tx.done.catch(() => {})
    throw error
  } finally { db.close() }
}
