import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ReportIssueModal, submitReportIssue } from '../../components/ReportIssueModal'

describe('ReportIssueModal UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing when isOpen is false', () => {
    const html = renderToStaticMarkup(<ReportIssueModal isOpen={false} onClose={() => {}} />)
    expect(html).toBe('')
  })

  it('renders form with title, description, and notice when isOpen is true', () => {
    const html = renderToStaticMarkup(<ReportIssueModal isOpen={true} onClose={() => {}} />)

    expect(html).toContain('Reportar problema')
    expect(html).toContain('Título do problema')
    expect(html).toContain('Descrição do problema')
    expect(html).toContain('Criar Issue no GitHub')
    expect(html).toContain('Cancelar')
  })

  it('displays the list of attached log files without (DJ/Audio) and without Automático tag', () => {
    const html = renderToStaticMarkup(<ReportIssueModal isOpen={true} onClose={() => {}} />)
    expect(html).toContain('call-debug.log')
    expect(html).not.toContain('(DJ/Áudio)')
    expect(html).not.toContain('(DJ/Audio)')
    expect(html).not.toContain('Automático')
    expect(html).toContain('lira-errors.log')
    expect(html).toContain('lira.log')
    expect(html).toContain('lira-reports.jsonl')
  })

  it('renders a drag-and-drop file upload zone for user attachments', () => {
    const html = renderToStaticMarkup(<ReportIssueModal isOpen={true} onClose={() => {}} />)
    expect(html).toMatch(/arraste arquivos/i)
    expect(html).toMatch(/clique para selecionar/i)
  })

  it('has disabled submit button initially when inputs are empty', () => {
    const html = renderToStaticMarkup(<ReportIssueModal isOpen={true} onClose={() => {}} />)
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Criar Issue no GitHub/)
  })

  it('renders success view with "Ver issue no GitHub" when feedback has issueUrl', () => {
    const feedback = {
      type: 'success' as const,
      message: 'Issue criada com os logs anexados!',
      issueUrl: 'https://github.com/C1ean-dev/Lira/issues/127',
    }

    const html = renderToStaticMarkup(<ReportIssueModal isOpen={true} onClose={() => {}} initialFeedback={feedback} />)
    expect(html).toContain('Ver issue no GitHub')
    expect(html).toContain('Fechar')
  })

  it('renders action-required warning view with "Abrir e publicar no GitHub" when feedback is warning (web fallback)', () => {
    const feedback = {
      type: 'warning' as const,
      message: 'O envio automático pelo servidor não estava disponível no momento. Preparamos o relatório com todos os detalhes e logs para você concluir a publicação no GitHub:',
      issueUrl: 'https://github.com/C1ean-dev/Lira/issues/new?title=Teste&body=Logs',
      method: 'web' as const,
    }

    const html = renderToStaticMarkup(<ReportIssueModal isOpen={true} onClose={() => {}} initialFeedback={feedback} />)
    expect(html).toContain('Quase lá! Conclua o envio no GitHub')
    expect(html).toContain('Abrir e publicar no GitHub')
    expect(html).toContain('Fechar')
  })
})

describe('submitReportIssue', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('validates empty inputs and returns error', async () => {
    const result = await submitReportIssue('   ', '   ')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/obrigatórios/i)
  })

  it('calls electronAPI.reportIssue with attachments when available in electron environment', async () => {
    const mockReport = vi.fn().mockResolvedValue({
      ok: true,
      issueUrl: 'https://github.com/C1ean-dev/Lira/issues/123',
      method: 'cli',
    })
    vi.stubGlobal('window', {
      electronAPI: {
        reportIssue: mockReport,
      },
    })

    const attachments = [{
      name: 'screenshot.png',
      size: 1024,
      type: 'image/png',
      isImage: true,
      base64Data: 'iVBORw0KGgo...',
    }]

    const result = await submitReportIssue('DJ travando', 'Ao trocar de faixa o áudio para', attachments)

    expect(mockReport).toHaveBeenCalledWith({
      title: 'DJ travando',
      description: 'Ao trocar de faixa o áudio para',
      attachments,
    })
    expect(result.ok).toBe(true)
    expect(result.issueUrl).toBe('https://github.com/C1ean-dev/Lira/issues/123')
    expect(result.method).toBe('cli')
  })

  it('prepares webUrl when electronAPI is not present without opening browser automatically', async () => {
    const mockOpen = vi.fn()
    vi.stubGlobal('window', {
      open: mockOpen,
    })

    const result = await submitReportIssue('Problema no web', 'Descrição do teste web')

    // Must NOT open browser automatically on submit:
    expect(mockOpen).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.method).toBe('web')
    expect(result.issueUrl).toContain('https://github.com/C1ean-dev/Lira/issues/new?')
  })
})
