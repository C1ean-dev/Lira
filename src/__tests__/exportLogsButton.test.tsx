import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExportLogsButton, exportLogsLabel, exportLogsStatus } from '../components/ExportLogsButton'

describe('ExportLogsButton', () => {
  it('offers to make the file of logs and says what that does', () => {
    const html = renderToStaticMarkup(<ExportLogsButton className="x" />)

    expect(html).toContain('Gerar arquivo de logs')
    expect(html).toContain('class="x"')
    expect(html).toMatch(/title="[^"]*\.zip[^"]*Downloads[^"]*"/)
    expect(html).toMatch(/title="[^"]*não inclui o texto das mensagens[^"]*"/i)
    expect(html).toContain('type="button"')
  })

  it('says what happened after the click', () => {
    expect(exportLogsLabel('idle')).toBe('Gerar arquivo de logs')
    expect(exportLogsLabel('working')).toBe('Gerando arquivo...')
    expect(exportLogsLabel('bundle')).toBe('Arquivo criado em Downloads')
    expect(exportLogsLabel('folder')).toBe('Pasta de logs aberta')
    expect(exportLogsLabel('download')).toBe('Logs baixados')
    expect(exportLogsLabel('failed')).toBe('Não foi possível gerar')
  })

  it('reads the outcome of the export', () => {
    expect(exportLogsStatus({ kind: 'bundle', path: 'C:\\Downloads\\Lira-logs.zip' })).toBe('bundle')
    expect(exportLogsStatus({ kind: 'folder', path: 'C:\\logs' })).toBe('folder')
    expect(exportLogsStatus({ kind: 'download', path: null })).toBe('download')
    expect(exportLogsStatus({ kind: 'failed', path: null })).toBe('failed')
    expect(exportLogsStatus(null)).toBe('failed')
  })
})

describe('where the button is', () => {
  const read = (file: string) => fs.readFileSync(file, 'utf8')

  it('is in the footer of the audio settings', () => {
    const modal = read('src/components/AudioSettingsModal.tsx')
    expect(modal).toContain('<ExportLogsButton')
    expect(modal).not.toContain('Exportar logs da chamada')
  })

  it('is on the error screen', () => {
    expect(read('src/components/ErrorBoundary.tsx')).toContain('<ExportLogsButton')
  })
})

describe('the bridge to the main process', () => {
  const preload = fs.readFileSync('electron/preload.ts', 'utf8')
  const main = fs.readFileSync('electron/main.ts', 'utf8').replace(/\r\n/g, '\n')

  it('exposes the export to the window', () => {
    expect(preload).toContain("exportLogBundle: () => ipcRenderer.invoke('export-log-bundle')")
    expect(preload).toMatch(/exportLogBundle: \(\) => Promise<\{ ok: boolean; path: string \| null \}>/)
  })

  it('makes the bundle from the logs folder, in Downloads, and shows it', () => {
    const from = main.indexOf("ipcMain.handle('export-log-bundle'")
    expect(from).toBeGreaterThan(-1)
    const handler = main.slice(from, main.indexOf('\n})', from))
    expect(handler).toContain('createLogBundle({')
    expect(handler).toContain('logsDir: getLogsDirectory()')
    expect(handler).toContain("outDir: app.getPath('downloads')")
    expect(handler).toContain('shell.showItemInFolder(bundle.path)')
    expect(handler).toContain('appLog.flushReports()')
    expect(handler).toContain('return { ok: false, path: null')
  })
})
