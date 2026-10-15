import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
const read = (name: string) => fs.readFileSync(name, 'utf8')
describe('PNG/XML asset persistence wiring', () => {
  it('has retired both JSON write transports', () => {
    expect(read('electron/main.ts')).not.toContain("ipcMain.handle('save-native-assets'")
    expect(read('vite.config.ts')).not.toContain("req.url === '/api/save-native-assets'")
    expect(read('src/store/useCustomAssetsStore.ts')).not.toContain('JSON.stringify(assets)')
  })
  it('uses the same atomic pair writer in Electron and development', () => {
    for (const name of ['electron/main.ts', 'vite.config.ts']) expect(read(name)).toContain('await writeAssetAtlasLatest(')
  })
  it('exposes the actual PNG/XML IPC transport from the preload', () => {
    const preload = read('electron/preload.ts')
    for (const channel of ['load-asset-atlas', 'save-asset-atlas', 'complete-asset-atlas-migration']) expect(preload).toContain(`ipcRenderer.invoke('${channel}'`)
    expect(preload).not.toContain("ipcRenderer.invoke('save-native-assets'")
  })
  it('retains the old reader solely for migration and leaves spaces intact', () => {
    expect(read('electron/main.ts')).toContain('return readNativeDataFile(filePath)')
    expect(read('src/store/useCustomAssetsStore.ts')).toContain('unpackImages(native)')
    expect(read('electron/main.ts')).toContain("ipcMain.handle('save-native-spaces'")
  })
})
