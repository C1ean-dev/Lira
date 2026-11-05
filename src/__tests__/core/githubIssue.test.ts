import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  collectIssueDiagnostics,
  buildIssueMarkdown,
  buildGithubWebUrl,
  createGithubIssue,
  submitIssueToBackend,
  DEFAULT_REPORT_BACKEND_URL,
} from '../../../electron/githubIssue'

describe('collectIssueDiagnostics', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-03T12:00:00.000Z'))
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lira-issue-test-'))
  })

  afterEach(async () => {
    vi.useRealTimers()
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

  it('never substitutes historic errors when the report day has no errors', async () => {
    await fs.promises.writeFile(path.join(tempDir, 'lira-reports-2026-10-15.jsonl'), JSON.stringify({
      t: '2026-10-15T10:00:00Z', fingerprint: 'old', message: 'historic failover', count: 99,
    }))
    await fs.promises.writeFile(path.join(tempDir, 'lira-errors-2026-10-15.log'), '2026-10-15T10:00:00Z ERROR historic failover\n    at oldStack\n')
    await fs.promises.writeFile(path.join(tempDir, 'call-debug-2026-11-03.log'), '{"t":"2026-11-03T10:00:00Z","event":"current-call"}\n')
    const diag = await collectIssueDiagnostics(tempDir)
    expect(diag.summaryText).toBe('')
    expect(diag.recentErrorsText).toBe('')
    expect(diag.attachedFiles).not.toContain('lira-reports.jsonl')
    expect(diag.attachedFiles).not.toContain('lira-errors.log')
    expect(JSON.stringify(diag)).not.toContain('historic failover')
    expect(diag.callDebugText).toContain('current-call')
  })

  it('keeps audio processor evidence visible even when connection chatter fills the recent log tail', async () => {
    const lines = [
      { t: '2026-11-03T10:00:00Z', cat: 'audio', event: 'rnnoise.ready', data: { sampleRate: 48000 } },
      ...Array.from({ length: 60 }, () => ({ t: '2026-11-03T10:01:00Z', cat: 'p2p', event: 'sender-state' })),
    ]
    await fs.promises.writeFile(path.join(tempDir, 'call-debug-2026-11-03.log'), lines.map(line => JSON.stringify(line)).join('\n'))
    const diag = await collectIssueDiagnostics(tempDir)
    const markdown = buildIssueMarkdown({ title: 'Microfone', description: 'Estalos', diagnostics: diag })
    expect(markdown).toContain('rnnoise.ready')
    expect(markdown).toContain('48000')
    expect(markdown).toContain(diag.systemInfo.reportDay)
    expect(markdown).toContain(diag.systemInfo.logWindowStart)
    expect(markdown).toContain(diag.systemInfo.logWindowEnd)
    expect(markdown).not.toContain('- 📄 `lira-errors.log`')
  })

  it('excludes prior-day records and breadcrumbs even when they were flushed into a current-day file', async () => {
    const old = '2026-10-15T10:00:00Z'
    const current = '2026-11-03T10:00:00Z'
    await fs.promises.writeFile(path.join(tempDir, 'lira-reports-2026-11-03.jsonl'), [
      { t: old, fingerprint: 'old', message: 'old-failover', count: 99 },
      { t: current, fingerprint: 'current', message: 'current-error', count: 1,
        breadcrumbs: [{ t: old, event: 'historic-crumb' }, { t: current, event: 'current-crumb' }],
        stats: { old: { t: old, event: 'historic-stat' }, current: { t: current, event: 'current-stat' } } },
    ].map(entry => JSON.stringify(entry)).join('\n'))
    const diag = await collectIssueDiagnostics(tempDir)
    expect(diag.summaryText).toContain('1 occurrence')
    expect(JSON.stringify(diag)).not.toMatch(/old-failover|historic-crumb|historic-stat/)
    expect(diag.rawFiles![0].content).toContain('current-crumb')
    expect(diag.rawFiles![0].content).toContain('current-stat')
  })

  it('filters records by the local calendar day across UTC midnight, preserving current stacks and numeric rotation order', async () => {
    vi.setSystemTime(new Date(2026, 10, 3, 23, 30))
    const start = new Date(2026, 10, 3).getTime()
    const end = new Date(2026, 10, 4).getTime()
    const iso = (ms: number) => new Date(ms).toISOString()
    const day = (ms: number) => iso(ms).slice(0, 10)
    const write = (name: string, content: string) => fs.promises.writeFile(path.join(tempDir, name), content)
    await write(`lira-${day(start)}.log.10`, `${iso(start - 1)} ERROR previous-day\n    at previousStack\n${iso(start)} ERROR first-current\n    at currentStack\n`)
    await write(`lira-${day(start)}.log.2`, `${iso(start + 1000)} INFO second-current\n`)
    await write(`lira-${day(end - 1)}.log`, `${iso(end - 1)} INFO last-current\n${iso(end)} ERROR next-day\n    at nextStack\n`)
    await write(`call-debug-${day(end - 1)}.log`, [
      { t: iso(start - 1), event: 'previous-call' },
      { t: iso(end - 1), event: 'current-call' },
      { t: iso(end), event: 'future-call' },
    ].map(entry => JSON.stringify(entry)).join('\n'))
    await write(`lira-reports-${day(end - 1)}.jsonl`, [
      { t: iso(start - 1), fingerprint: 'previous', message: 'previous-report' },
      { t: iso(end - 1), fingerprint: 'current', message: 'current-report', count: 1 },
      { t: iso(end), fingerprint: 'future', message: 'future-report' },
    ].map(entry => JSON.stringify(entry)).join('\n'))
    const diag = await collectIssueDiagnostics(tempDir)
    const logs = diag.rawFiles!.map(file => file.content).join('\n')
    expect(logs).toContain('currentStack')
    expect(logs).toContain('current-call')
    expect(logs).toContain('current-report')
    expect(logs).not.toMatch(/previous|next-day|nextStack|future/)
    expect(diag.appLogText.indexOf('first-current')).toBeLessThan(diag.appLogText.indexOf('second-current'))
    expect(diag.appLogText.indexOf('second-current')).toBeLessThan(diag.appLogText.indexOf('last-current'))
    expect(diag.systemInfo.reportDay).toBe('2026-11-03')
    expect(diag.systemInfo.logWindowStart).toBe(iso(start))
    expect(diag.systemInfo.logWindowEnd).toBe(iso(end))
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

  it('formats issue markdown with user attachments (images and logs)', () => {
    const md = buildIssueMarkdown({
      title: 'DJ com erro visual',
      description: 'Veja o print anexo',
      diagnostics: {
        systemInfo: {
          appVersion: '1.0.0',
          platform: 'win32 x64',
          electron: '30.0.0',
          chrome: '124.0.0',
          node: '20.0.0',
          date: '2026-11-03T12:00:00.000Z',
        },
        summaryText: '',
        recentErrorsText: '',
        callDebugText: '',
        appLogText: '',
        attachedFiles: [],
      },
      userAttachments: [
        {
          name: 'print.png',
          size: 2048,
          type: 'image/png',
          isImage: true,
          url: 'https://github.com/user-attachments/assets/abc-123',
        },
        {
          name: 'extra-client.log',
          size: 512,
          type: 'text/plain',
          isImage: false,
          url: 'https://github.com/user-attachments/assets/def-456',
        },
      ],
    })

    expect(md).toContain('### 🖼️ Imagens / Evidências Anexadas')
    expect(md).toContain('![print.png](https://github.com/user-attachments/assets/abc-123)')
    expect(md).toContain('### 📂 Arquivos Adicionais Anexados')
    expect(md).toContain('[extra-client.log](https://github.com/user-attachments/assets/def-456)')
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
    vi.useRealTimers()
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('sends the same day-filtered logs through the Gist, issue body and backend fallback', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-03T12:00:00Z'))
    await fs.promises.writeFile(path.join(tempDir, 'lira-errors-2026-10-15.log'), '2026-10-15T10:00:00Z ERROR historic-failover\n')
    await fs.promises.writeFile(path.join(tempDir, 'call-debug-2026-11-03.log'), '{"t":"2026-11-03T10:00:00Z","cat":"audio","event":"rnnoise.ready"}\n')
    let uploaded: string[] = []
    let issueBody = ''
    const execGh = vi.fn(async (args: string[]) => {
      if (args[0] === 'gist') {
        uploaded = await Promise.all(args.slice(2, args.indexOf('-d')).map(file => fs.promises.readFile(file, 'utf8')))
      }
      if (args[0] === 'issue') issueBody = await fs.promises.readFile(args[args.indexOf('--body-file') + 1], 'utf8')
      throw new Error('CLI unavailable')
    })
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, issueUrl: 'https://github.com/C1ean-dev/Lira/issues/999' }) }))
    const result = await createGithubIssue({ title: 'Microfone', description: 'Estalos', logsDir: tempDir, execGh, fetchFn: fetchFn as any })
    expect(result.method).toBe('backend')
    const payload = JSON.parse((fetchFn.mock.calls[0] as any)[1].body)
    expect(uploaded.join('\n')).toContain('rnnoise.ready')
    expect(issueBody).toContain('rnnoise.ready')
    expect(JSON.stringify(payload)).toContain('rnnoise.ready')
    expect([uploaded.join('\n'), issueBody, JSON.stringify(payload)].join('\n')).not.toContain('historic-failover')
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

  it('falls back to GitHub web issue URL when gh CLI and backend fail without opening browser automatically', async () => {
    const mockExecGh = vi.fn().mockRejectedValue(new Error('gh: command not found'))
    const mockOpenExternal = vi.fn().mockResolvedValue(undefined)
    const mockFetch = vi.fn().mockRejectedValue(new Error('Backend offline'))

    const result = await createGithubIssue({
      title: 'Bug no chat',
      description: 'Mensagens não aparecem',
      logsDir: tempDir,
      execGh: mockExecGh,
      openExternal: mockOpenExternal,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.ok).toBe(true)
    expect(result.method).toBe('web')
    expect(result.issueUrl).toContain('https://github.com/C1ean-dev/Lira/issues/new?')
    // Must NOT automatically open browser on submit:
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('submits issue to Render backend successfully when gh CLI fails', async () => {
    const mockExecGh = vi.fn().mockRejectedValue(new Error('gh: command not found'))
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        issueUrl: 'https://github.com/C1ean-dev/Lira/issues/777',
        issueNumber: 777,
      }),
    })

    const result = await createGithubIssue({
      title: 'Bug anonimo',
      description: 'Usuario sem GitHub enviando relato',
      logsDir: tempDir,
      execGh: mockExecGh,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.ok).toBe(true)
    expect(result.method).toBe('backend')
    expect(result.issueUrl).toBe('https://github.com/C1ean-dev/Lira/issues/777')
    expect(mockFetch).toHaveBeenCalledWith(
      DEFAULT_REPORT_BACKEND_URL,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )
  })

  it('submits directly via submitIssueToBackend helper', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        issueUrl: 'https://github.com/C1ean-dev/Lira/issues/888',
      }),
    })

    const res = await submitIssueToBackend(
      { title: 'Teste direto', description: 'Descricao direta' },
      'https://lira-signaling.onrender.com/report-issue',
      mockFetch as unknown as typeof fetch
    )

    expect(res.ok).toBe(true)
    expect(res.issueUrl).toBe('https://github.com/C1ean-dev/Lira/issues/888')
  })
})
