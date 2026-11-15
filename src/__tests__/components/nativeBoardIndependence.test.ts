import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('independent local board', () => {
  it('ships without the external editor dependency or network fallback', () => {
    for (const file of ['package.json', 'package-lock.json', 'vite.config.ts', 'electron/main.ts',
      'src/components/collaboration/NativeBoard.tsx', 'src/components/collaboration/WhiteboardPanel.tsx',
      'src/collaboration/boardEditor.ts', 'src/collaboration/boardFile.ts', 'src/collaboration/boardScene.ts', 'src/collaboration/whiteboard.ts']) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/excalidraw/i)
    }
    for (const file of ['src/components/collaboration/NativeBoard.tsx', 'src/collaboration/boardFile.ts']) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/\bfetch\s*\(|\bWebSocket\b|sendBeacon|@font-face/)
    }
  })
})
