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

  it('collects system info, error reports, error logs, call debug, and app timeline', async () => {
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
    await fs.promises.writeFile(
      path.join(tempDir, 'call-debug-2026-11-03.log'),
      '2026-11-03T10:00:01.000Z [diag:dj] stream-drop { duration: 5 }\n',
      'utf8'
    )
    await fs.promises.writeFile(
      path.join(tempDir, 'lira-2026-11-03.log'),
      '2026-11-03T10:00:00.500Z INFO app started\n',
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
    expect(diag.callDebugText).toContain('[diag:dj] stream-drop')
    expect(diag.appLogText).toContain('INFO app started')
    expect(diag.attachedFiles).toContain('call-debug.log')
  })

  it('handles empty logs directory gracefully', async () => {
    const diag = await collectIssueDiagnostics(tempDir, {
      version: '1.2.3',
    })

    expect(diag.systemInfo.appVersion).toBe('1.2.3')
    expect(diag.summaryText).toBe('')
    expect(diag.recentErrorsText).toBe('')
    expect(diag.callDebugText).toBe('')
    expect(diag.appLogText).toBe('')
  })
})

describe('buildIssueMarkdown', () => {
  it('formats issue markdown with user description, system details, and visible log attachment sections', () => {
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
        callDebugText: '2026-11-03T12:00:01Z [diag:dj] freeze',
        appLogText: '2026-11-03T12:00:00Z INFO loaded',
        gistUrl: 'https://gist.github.com/C1ean-dev/123456',
        attachedFiles: ['call-debug.log', 'lira-errors.log', 'lira.log', 'resumo.txt'],
      },
    })

    expect(md).toContain('### Descrição do problema')
    expect(md).toContain('O som para do nada após 5 minutos tocando.')
    expect(md).toContain('**Versão do App**: 1.0.0')
    expect(md).toContain('**SO**: win32 x64')
    expect(md).toContain('### 📎 Anexo dos Logs de Diagnóstico')
    expect(md).toContain('https://gist.github.com/C1ean-dev/123456')
    expect(md).toContain('<details open>')
    expect(md).toContain('Resumo dos Erros')
    expect(md).toContain('3x fp123 Cannot read properties')
    expect(md).toContain('Diagnóstico de Chamadas e DJ')
    expect(md).toContain('[diag:dj] freeze')
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

  it('creates an issue via gh CLI, creates gist for full logs, does not automatically open browser, and returns cli method', async () => {
    const mockExecGh = vi.fn().mockImplementation(async (args: string[]) => {
      if (args[0] === 'gist') {
        return { stdout: 'https://gist.github.com/C1ean-dev/gist999\n', stderr: '' }
      }
      if (args[0] === 'issue') {
        return { stdout: 'https://github.com/C1ean-dev/Lira/issues/42\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
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
      expect.arrayContaining(['gist', 'create'])
    )
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
    // Must NOT automatically open browser on submit:
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('falls back to GitHub web issue URL when gh CLI fails without opening browser automatically', async () => {
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
    // Must NOT automatically open browser on submit:
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })
})
