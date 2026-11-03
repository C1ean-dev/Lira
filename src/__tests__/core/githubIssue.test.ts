import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  collectIssueDiagnostics,
  buildIssueMarkdown,
  buildGithubWebUrl,
  createGithubIssue,
} from '../../../electron/githubIssue'

describe('collectIssueDiagnostics', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lira-issue-test-'))
  })

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('collects system info and reads recent error reports and error logs', async () => {
    const reportLine1 = JSON.stringify({
      fingerprint: 'fp123',
      message: 'Cannot read properties of undefined (reading audio)',
      count: 3,
      severity: 'error',
      kind: 'TypeError',
      source: 'renderer',
      session: 'sess-1',
      t: '2026-11-03T10:00:00.000Z',
    })
    await fs.promises.writeFile(path.join(tempDir, 'lira-reports-2026-11-03.jsonl'), reportLine1 + '\n', 'utf8')
    await fs.promises.writeFile(
      path.join(tempDir, 'lira-errors-2026-11-03.log'),
      '2026-11-03T10:00:00.000Z ERROR renderer sess-1 [Audio] Failure playing stream\n',
      'utf8'
    )

    const diag = await collectIssueDiagnostics(tempDir, {
      version: '1.2.3',
      platform: 'win32 (10.0.19045) x64',
    })

    expect(diag.systemInfo.appVersion).toBe('1.2.3')
    expect(diag.systemInfo.platform).toContain('win32')
    expect(diag.summaryText).toContain('fp123')
    expect(diag.summaryText).toContain('Cannot read properties of undefined')
    expect(diag.recentErrorsText).toContain('[Audio] Failure playing stream')
  })

  it('handles empty logs directory gracefully', async () => {
    const diag = await collectIssueDiagnostics(tempDir, {
      version: '1.2.3',
    })

    expect(diag.systemInfo.appVersion).toBe('1.2.3')
    expect(diag.summaryText).toBe('')
    expect(diag.recentErrorsText).toBe('')
  })
})

describe('buildIssueMarkdown', () => {
  it('formats issue markdown with user description, system details, and collapsible log sections', () => {
    const md = buildIssueMarkdown({
      title: 'DJ cortando som',
      description: 'O som para do nada após 5 minutos tocando.',
      diagnostics: {
        systemInfo: {
          appVersion: '1.0.0',
          platform: 'win32 x64',
          electron: '30.0.0',
          chrome: '124.0.0',
          node: '20.0.0',
          date: '2026-11-03T12:00:00.000Z',
        },
        summaryText: '3x fp123 Cannot read properties',
        recentErrorsText: '2026-11-03T12:00:00Z ERROR [Audio] Fail',
      },
    })

    expect(md).toContain('### Descrição do problema')
    expect(md).toContain('O som para do nada após 5 minutos tocando.')
    expect(md).toContain('**Versão do App**: 1.0.0')
    expect(md).toContain('**SO**: win32 x64')
    expect(md).toContain('<details>')
    expect(md).toContain('<summary>📋 Resumo dos Erros Registrados</summary>')
    expect(md).toContain('3x fp123 Cannot read properties')
    expect(md).toContain('<summary>📄 Últimas Linhas de Log de Erro</summary>')
    expect(md).toContain('2026-11-03T12:00:00Z ERROR [Audio] Fail')
  })
})

describe('buildGithubWebUrl', () => {
  it('builds an issue creation URL targeting C1ean-dev/Lira with labels bug and needs-triage', () => {
    const url = buildGithubWebUrl({
      title: 'Problema no áudio',
      body: 'Descrição teste',
    })

    expect(url).toContain('https://github.com/C1ean-dev/Lira/issues/new?')
    expect(url).toContain('title=Problema+no+%C3%A1udio')
    expect(url).toContain('labels=bug%2Cneeds-triage')
    expect(url).toContain('body=Descri%C3%A7%C3%A3o+teste')
  })

  it('safely truncates excessively large body text to avoid browser URL length limits', () => {
    const longBody = 'A'.repeat(8000)
    const url = buildGithubWebUrl({
      title: 'Big issue',
      body: longBody,
    })

    expect(url.length).toBeLessThan(5000)
    expect(decodeURIComponent(url)).toContain('truncado')
  })
})

describe('createGithubIssue', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lira-issue-cli-test-'))
  })

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('creates an issue via gh CLI when available, opens issue in browser, and returns cli method', async () => {
    const mockExecGh = vi.fn().mockResolvedValue({
      stdout: 'https://github.com/C1ean-dev/Lira/issues/42\n',
      stderr: '',
    })
    const mockOpenExternal = vi.fn().mockResolvedValue(undefined)

    const result = await createGithubIssue({
      title: 'Bug no chat',
      description: 'Mensagens não aparecem',
      logsDir: tempDir,
      execGh: mockExecGh,
      openExternal: mockOpenExternal,
    })

    expect(result.ok).toBe(true)
    expect(result.method).toBe('cli')
    expect(result.issueUrl).toBe('https://github.com/C1ean-dev/Lira/issues/42')
    expect(mockExecGh).toHaveBeenCalledWith(
      expect.arrayContaining([
        'issue',
        'create',
        '-R',
        'C1ean-dev/Lira',
        '--title',
        'Bug no chat',
        '--label',
        'bug',
        '--label',
        'needs-triage',
      ])
    )
    expect(mockOpenExternal).toHaveBeenCalledWith('https://github.com/C1ean-dev/Lira/issues/42')
  })

  it('falls back to opening GitHub web issue page when gh CLI fails', async () => {
    const mockExecGh = vi.fn().mockRejectedValue(new Error('gh: command not found'))
    const mockOpenExternal = vi.fn().mockResolvedValue(undefined)

    const result = await createGithubIssue({
      title: 'Bug no chat',
      description: 'Mensagens não aparecem',
      logsDir: tempDir,
      execGh: mockExecGh,
      openExternal: mockOpenExternal,
    })

    expect(result.ok).toBe(true)
    expect(result.method).toBe('web')
    expect(result.issueUrl).toContain('https://github.com/C1ean-dev/Lira/issues/new?')
    expect(mockOpenExternal).toHaveBeenCalledWith(expect.stringContaining('https://github.com/C1ean-dev/Lira/issues/new?'))
  })
})
