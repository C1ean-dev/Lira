import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

describe('AudioSettingsModal Issue Reporting Button', () => {
  const code = fs.readFileSync('src/components/AudioSettingsModal.tsx', 'utf8')

  it('removes the auto-saved settings text and checkmark icon from the footer', () => {
    expect(code).not.toContain('Configurações salvas automaticamente no seu dispositivo')
    expect(code).not.toContain('CheckCircle2')
  })

  it('renders a report problem button next to ExportLogsButton', () => {
    expect(code).toContain('<ExportLogsButton')
    expect(code).toMatch(/Reportar problema/i)
    expect(code).toContain('<ReportIssueModal')
  })
})
