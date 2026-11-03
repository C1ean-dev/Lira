import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { app, shell } from 'electron'
import { formatDigest, groupReports, parseReportLines } from '../src/utils/reportDigest'
import { buildGithubWebUrl, MAX_WEB_URL_LENGTH } from '../src/utils/githubIssueUrl'

export { buildGithubWebUrl, MAX_WEB_URL_LENGTH }

export interface IssueDiagnostics {
  systemInfo: Record<string, string>
  summaryText: string
  recentErrorsText: string
  callDebugText: string
  appLogText: string
  gistUrl?: string
  attachedFiles: string[]
  rawFiles?: Array<{ name: string; content: string }>
}

export interface CollectDiagnosticsOptions {
  version?: string
  platform?: string
}

export async function collectIssueDiagnostics(
  logsDir: string,
  options?: CollectDiagnosticsOptions
): Promise<IssueDiagnostics> {
  const systemInfo: Record<string, string> = {
    appVersion:
      options?.version ??
      (typeof app !== 'undefined' && app?.getVersion ? app.getVersion() : process.env.npm_package_version ?? 'dev'),
    platform: options?.platform ?? `${os.platform()} (${os.release()}) ${os.arch()}`,
    electron: process.versions?.electron ?? 'N/A',
    chrome: process.versions?.chrome ?? 'N/A',
    node: process.versions?.node ?? process.version ?? 'N/A',
    date: new Date().toISOString(),
  }

  let summaryText = ''
  let recentErrorsText = ''
  let callDebugText = ''
  let appLogText = ''
  const attachedFiles: string[] = []
  const rawFiles: Array<{ name: string; content: string }> = []

  try {
    const entries = await fs.promises.readdir(logsDir)

    // 1. lira-reports
    const reportFiles = entries
      .filter((file) => /^lira-reports-\d{4}-\d{2}-\d{2}\.jsonl(?:\.\d+)?$/.test(file))
      .sort()
      .reverse()

    if (reportFiles.length > 0) {
      let combinedReports = ''
      for (const file of reportFiles.slice(0, 2)) {
        try {
          const content = await fs.promises.readFile(path.join(logsDir, file), 'utf8')
          combinedReports += content + '\n'
        } catch {}
      }
      if (combinedReports.trim()) {
        const parsed = parseReportLines(combinedReports).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
        const groups = groupReports(parsed)
        summaryText = formatDigest(groups)
        attachedFiles.push('lira-reports.jsonl')
        rawFiles.push({ name: 'lira-reports.jsonl', content: combinedReports })
      }
    }

    // 2. lira-errors
    const errorFiles = entries
      .filter((file) => /^lira-errors-\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/.test(file))
      .sort()
      .reverse()

    if (errorFiles.length > 0) {
      const latestErrorFile = errorFiles[0]
      try {
        const errorContent = await fs.promises.readFile(path.join(logsDir, latestErrorFile), 'utf8')
        const lines = errorContent.split(/\r?\n/).filter((l) => l.trim().length > 0)
        recentErrorsText = lines.slice(-40).join('\n')
        attachedFiles.push('lira-errors.log')
        rawFiles.push({ name: 'lira-errors.log', content: errorContent })
      } catch {}
    }

    // 3. call-debug (DJ, audio, WebRTC events)
    const callDebugFiles = entries
      .filter((file) => /^call-debug-\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/.test(file))
      .sort()
      .reverse()

    if (callDebugFiles.length > 0) {
      const latestCallFile = callDebugFiles[0]
      try {
        const callContent = await fs.promises.readFile(path.join(logsDir, latestCallFile), 'utf8')
        const lines = callContent.split(/\r?\n/).filter((l) => l.trim().length > 0)
        callDebugText = lines.slice(-50).join('\n')
        attachedFiles.push('call-debug.log')
        rawFiles.push({ name: 'call-debug.log', content: callContent })
      } catch {}
    }

    // 4. lira (app general timeline)
    const liraFiles = entries
      .filter((file) => /^lira-\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/.test(file))
      .sort()
      .reverse()

    if (liraFiles.length > 0) {
      const latestLiraFile = liraFiles[0]
      try {
        const liraContent = await fs.promises.readFile(path.join(logsDir, latestLiraFile), 'utf8')
        const lines = liraContent.split(/\r?\n/).filter((l) => l.trim().length > 0)
        appLogText = lines.slice(-40).join('\n')
        attachedFiles.push('lira.log')
        rawFiles.push({ name: 'lira.log', content: liraContent })
      } catch {}
    }
  } catch {}

  return {
    systemInfo,
    summaryText,
    recentErrorsText,
    callDebugText,
    appLogText,
    attachedFiles,
    rawFiles,
  }
}

export function buildIssueMarkdown(payload: {
  title: string
  description: string
  diagnostics: IssueDiagnostics
}): string {
  const { description, diagnostics } = payload
  const { systemInfo } = diagnostics

  const gistCallout = diagnostics.gistUrl
    ? [
        '> [!IMPORTANT]',
        '> **Arquivos de logs completos anexados via GitHub Gist:**',
        `> 🔗 **[Clique aqui para abrir os arquivos de log anexados no GitHub Gist](${diagnostics.gistUrl})**`,
        '',
      ]
    : [
        '> [!NOTE]',
        '> Os logs de diagnóstico foram anexados diretamente nesta issue.',
        '',
      ]

  return [
    '### Descrição do problema',
    description.trim(),
    '',
    '### Informações do Sistema',
    `- **Versão do App**: ${systemInfo.appVersion}`,
    `- **SO**: ${systemInfo.platform}`,
    `- **Electron**: ${systemInfo.electron}`,
    `- **Chrome**: ${systemInfo.chrome}`,
    `- **Node**: ${systemInfo.node}`,
    `- **Data/Hora**: ${systemInfo.date}`,
    '',
    '### 📎 Anexo dos Logs de Diagnóstico',
    '',
    ...gistCallout,
    '#### Arquivos anexados:',
    '- 🎧 `call-debug.log` — Eventos de chamadas WebRTC, áudio e streaming do DJ',
    '- 📋 `resumo.txt` — Resumo e frequência de erros agrupados',
    '- 📄 `lira-errors.log` — Erros capturados com rastreamento de pilha',
    '- 📜 `lira.log` — Linha do tempo de execução do aplicativo',
    '',
    '<details open>',
    '<summary>📋 Resumo dos Erros (resumo.txt)</summary>',
    '',
    '```text',
    diagnostics.summaryText || 'Nenhum erro registrado.',
    '```',
    '</details>',
    '',
    '<details open>',
    '<summary>🎧 Diagnóstico de Chamadas e DJ (call-debug.log - últimas linhas)</summary>',
    '',
    '```text',
    diagnostics.callDebugText || 'Nenhum evento recente.',
    '```',
    '</details>',
    '',
    '<details>',
    '<summary>📄 Erros Detalhados (lira-errors.log - últimas linhas)</summary>',
    '',
    '```text',
    diagnostics.recentErrorsText || 'Nenhum log recente.',
    '```',
    '</details>',
    '',
    '<details>',
    '<summary>📜 Log Geral do Aplicativo (lira.log - últimas linhas)</summary>',
    '',
    '```text',
    diagnostics.appLogText || 'Nenhum log recente.',
    '```',
    '</details>',
  ].join('\n')
}

export interface CreateIssueOptions {
  title: string
  description: string
  logsDir: string
  repo?: string
  execGh?: (args: string[]) => Promise<{ stdout: string; stderr: string }>
  openExternal?: (url: string) => Promise<void>
}

export interface CreateIssueResult {
  ok: boolean
  issueUrl?: string
  gistUrl?: string
  error?: string
  method: 'cli' | 'web'
}

function defaultExecGh(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        reject(err)
      } else {
        resolve({ stdout: String(stdout), stderr: String(stderr) })
      }
    })
  })
}

export async function uploadLogsGist(
  title: string,
  diagnostics: IssueDiagnostics,
  execGh: (args: string[]) => Promise<{ stdout: string; stderr: string }>
): Promise<string | null> {
  const tmpGistDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lira-gist-files-'))
  try {
    const filePaths: string[] = []

    // 1. resumo.txt
    const resumoPath = path.join(tmpGistDir, 'resumo.txt')
    await fs.promises.writeFile(resumoPath, diagnostics.summaryText || 'Nenhum erro registrado.', 'utf8')
    filePaths.push(resumoPath)

    // 2. other raw files (truncated to max 1MB each to avoid gist size issues)
    if (diagnostics.rawFiles && diagnostics.rawFiles.length > 0) {
      for (const raw of diagnostics.rawFiles) {
        const filePath = path.join(tmpGistDir, raw.name)
        const content = raw.content.length > 1024 * 1024 ? raw.content.slice(-1024 * 1024) : raw.content
        await fs.promises.writeFile(filePath, content, 'utf8')
        filePaths.push(filePath)
      }
    } else {
      // Fallback: write recent lines if raw files not present
      if (diagnostics.callDebugText) {
        const p = path.join(tmpGistDir, 'call-debug.log')
        await fs.promises.writeFile(p, diagnostics.callDebugText, 'utf8')
        filePaths.push(p)
      }
      if (diagnostics.recentErrorsText) {
        const p = path.join(tmpGistDir, 'lira-errors.log')
        await fs.promises.writeFile(p, diagnostics.recentErrorsText, 'utf8')
        filePaths.push(p)
      }
      if (diagnostics.appLogText) {
        const p = path.join(tmpGistDir, 'lira.log')
        await fs.promises.writeFile(p, diagnostics.appLogText, 'utf8')
        filePaths.push(p)
      }
    }

    if (filePaths.length === 0) return null

    const result = await execGh(['gist', 'create', ...filePaths, '-d', `Logs de diagnóstico - Issue: ${title}`])
    const match = result.stdout.match(/https:\/\/gist\.github\.com\/[^\s]+/)
    return match ? match[0] : null
  } catch (err) {
    console.warn('[uploadLogsGist] failed to create gist:', err)
    return null
  } finally {
    try {
      await fs.promises.rm(tmpGistDir, { recursive: true, force: true })
    } catch {}
  }
}

export async function createGithubIssue(options: CreateIssueOptions): Promise<CreateIssueResult> {
  const repo = options.repo ?? 'C1ean-dev/Lira'
  const execCmd = options.execGh ?? defaultExecGh
  const openUrl = options.openExternal ?? (async (u: string) => {
    if (typeof shell !== 'undefined' && shell.openExternal) {
      await shell.openExternal(u)
    }
  })

  const diagnostics = await collectIssueDiagnostics(options.logsDir)

  // Try creating a Gist with the full log attachments first
  let gistUrl: string | null = null
  try {
    gistUrl = await uploadLogsGist(options.title, diagnostics, execCmd)
    if (gistUrl) {
      diagnostics.gistUrl = gistUrl
    }
  } catch {}

  const markdown = buildIssueMarkdown({
    title: options.title,
    description: options.description,
    diagnostics,
  })

  const tempFile = path.join(os.tmpdir(), `lira-issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`)

  try {
    await fs.promises.writeFile(tempFile, markdown, 'utf8')

    try {
      const res = await execCmd([
        'issue',
        'create',
        '-R',
        repo,
        '--title',
        options.title,
        '--body-file',
        tempFile,
        '--label',
        'bug',
        '--label',
        'needs-triage',
      ])

      const match = res.stdout.match(/https:\/\/github\.com\/[^\s]+/)
      const issueUrl = match ? match[0] : `https://github.com/${repo}/issues`

      await openUrl(issueUrl)
      return { ok: true, issueUrl, gistUrl: gistUrl ?? undefined, method: 'cli' }
    } catch {
      const webUrl = buildGithubWebUrl({
        title: options.title,
        body: markdown,
        repo,
      })
      await openUrl(webUrl)
      return { ok: true, issueUrl: webUrl, gistUrl: gistUrl ?? undefined, method: 'web' }
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      method: 'web',
    }
  } finally {
    try {
      if (fs.existsSync(tempFile)) {
        await fs.promises.unlink(tempFile)
      }
    } catch {}
  }
}
