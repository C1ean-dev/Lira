import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { app, shell } from 'electron'
import { formatDigest, groupReports, parseReportLines } from '../src/utils/reportDigest'
import { buildGithubWebUrl, MAX_WEB_URL_LENGTH } from '../src/utils/githubIssueUrl'

export { buildGithubWebUrl, MAX_WEB_URL_LENGTH }

export interface UserAttachment {
  name: string
  size: number
  type: string
  isImage: boolean
  base64Data?: string
  url?: string
}

export interface IssueDiagnostics {
  systemInfo: Record<string, string>
  summaryText: string
  recentErrorsText: string
  callDebugText: string
  audioDiagnosticsText?: string
  appLogText: string
  gistUrl?: string
  attachedFiles: string[]
  rawFiles?: Array<{ name: string; content: string }>
}

export interface CollectDiagnosticsOptions {
  version?: string
  platform?: string
}

// File names use UTC, while a report covers the user's local calendar day.
// Filter records as well: buffered/late reports can be written into a newer file.
export async function collectIssueDiagnostics(
  logsDir: string,
  options?: CollectDiagnosticsOptions
): Promise<IssueDiagnostics> {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const inDay = (time: unknown) => {
    const value = typeof time === 'string' ? Date.parse(time) : NaN
    return value >= start.getTime() && value < end.getTime()
  }
  const systemInfo: Record<string, string> = {
    appVersion: options?.version ??
      (typeof app !== 'undefined' && app?.getVersion ? app.getVersion() : process.env.npm_package_version ?? 'dev'),
    platform: options?.platform ?? `${os.platform()} (${os.release()}) ${os.arch()}`,
    electron: process.versions?.electron ?? 'N/A',
    chrome: process.versions?.chrome ?? 'N/A',
    node: process.versions?.node ?? process.version ?? 'N/A',
    date: now.toISOString(),
    reportDay: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    logWindowStart: start.toISOString(),
    logWindowEnd: end.toISOString(),
  }
  const rawFiles: Array<{ name: string; content: string }> = []
  const collected: Record<string, string> = {}
  try {
    const entries = await fs.promises.readdir(logsDir)
    const kinds = [
      ['lira-reports', 'jsonl'], ['lira-errors', 'log'], ['call-debug', 'log'], ['lira', 'log'],
    ]
    for (const [kind, extension] of kinds) {
      const files = entries.flatMap(name => {
        const match = /^(lira-reports|lira-errors|call-debug|lira)-(\d{4}-\d{2}-\d{2})\.(jsonl|log)(?:\.(\d+))?$/.exec(name)
        if (!match || match[1] !== kind || match[3] !== extension ||
            match[2] < start.toISOString().slice(0, 10) || match[2] > end.toISOString().slice(0, 10)) return []
        return [{ name, day: match[2], rotation: Number(match[4] ?? 0) }]
      }).sort((a, b) => a.day.localeCompare(b.day) || b.rotation - a.rotation)
      const parts: string[] = []
      for (const file of files) {
        try {
          const content = await fs.promises.readFile(path.join(logsDir, file.name), 'utf8')
          let keep = false
          for (const line of content.split(/\r?\n/)) {
            if (line.trimStart().startsWith('{')) {
              keep = false
              try {
                const record = JSON.parse(line)
                if (inDay(record.t)) {
                  // Breadcrumbs from before midnight are historical too.
                  if (Array.isArray(record.breadcrumbs)) record.breadcrumbs = record.breadcrumbs.filter((item: any) => inDay(item?.t))
                  if (record.stats && typeof record.stats === 'object') {
                    record.stats = Object.fromEntries(Object.entries(record.stats).filter(([, value]) => inDay((value as any)?.t)))
                  }
                  parts.push(JSON.stringify(record))
                }
              } catch {}
              continue
            }
            const timestamp = /^(\d{4}-\d{2}-\d{2}T\S+)/.exec(line)
            if (timestamp) keep = inDay(timestamp[1])
            // Preserve stack continuations only with their selected parent.
            if (keep) parts.push(line)
          }
        } catch {}
      }
      const content = parts.join('\n').trimEnd()
      if (content) {
        const name = `${kind}.${extension}`
        collected[kind] = content
        rawFiles.push({ name, content })
      }
    }
  } catch {}
  const reports = parseReportLines(collected['lira-reports'] ?? '').sort((a, b) => a.t.localeCompare(b.t))
  const tail = (kind: string, count: number) => (collected[kind] ?? '').split(/\r?\n/).filter(line => line.trim()).slice(-count).join('\n')
  return {
    systemInfo,
    summaryText: reports.length ? formatDigest(groupReports(reports)) : '',
    recentErrorsText: tail('lira-errors', 40),
    callDebugText: tail('call-debug', 50),
    audioDiagnosticsText: (collected['call-debug'] ?? '').split('\n').filter(line => {
      try { return ['audio', 'media'].includes(JSON.parse(line).cat) } catch { return false }
    }).slice(-30).join('\n'),
    appLogText: tail('lira', 40),
    attachedFiles: rawFiles.map(file => file.name),
    rawFiles,
  }
}

export function buildIssueMarkdown(payload: {
  title: string
  description: string
  diagnostics: IssueDiagnostics
  userAttachments?: UserAttachment[]
}): string {
  const { description, diagnostics, userAttachments } = payload
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

  const images = (userAttachments ?? []).filter((a) => a.isImage && a.url)
  const imageSection =
    images.length > 0
      ? [
          '### 🖼️ Imagens / Evidências Anexadas',
          '',
          ...images.map((img) => `![${img.name}](${img.url})`),
          '',
        ]
      : []

  const nonImages = (userAttachments ?? []).filter((a) => !a.isImage && a.url)
  const nonImageSection =
    nonImages.length > 0
      ? [
          '### 📂 Arquivos Adicionais Anexados',
          '',
          ...nonImages.map((file) => `- 📎 [${file.name}](${file.url}) (${Math.round(file.size / 1024)} KB)`),
          '',
        ]
      : []

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
    ...(systemInfo.reportDay ? [
      `- **Dia local dos logs**: ${systemInfo.reportDay} (${systemInfo.timeZone})`,
      `- **Janela dos logs (UTC)**: [${systemInfo.logWindowStart}, ${systemInfo.logWindowEnd})`,
    ] : []),
    '',
    ...imageSection,
    ...nonImageSection,
    '### 📎 Anexo dos Logs de Diagnóstico',
    '',
    ...gistCallout,
    ...(systemInfo.reportDay ? ['Somente registros do dia local do relato. A ausência de logs não comprova a ausência de falha.', ''] : []),
    '#### Arquivos anexados:',
    ...(diagnostics.attachedFiles.includes('call-debug.log') ? ['- 🎧 `call-debug.log` — Eventos de chamadas WebRTC, áudio e streaming do DJ'] : []),
    '- 📋 `resumo.txt` — Resumo e frequência de erros agrupados',
    ...(diagnostics.attachedFiles.includes('lira-errors.log') ? ['- 📄 `lira-errors.log` — Erros capturados com rastreamento de pilha'] : []),
    ...(diagnostics.attachedFiles.includes('lira.log') ? ['- 📜 `lira.log` — Linha do tempo de execução do aplicativo'] : []),
    '',
    '<details open>',
    '<summary>📋 Resumo dos Erros (resumo.txt)</summary>',
    '',
    '```text',
    diagnostics.summaryText || 'Nenhum erro registrado.',
    '```',
    '</details>',
    '',
    ...(diagnostics.audioDiagnosticsText ? [
      '<details open>',
      '<summary>Processamento de áudio — eventos recentes do dia</summary>',
      '', '```text', diagnostics.audioDiagnosticsText, '```', '</details>', '',
    ] : []),
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

export const DEFAULT_REPORT_BACKEND_URL =
  process.env.VITE_REPORT_BACKEND_URL || 'https://lira-signaling.onrender.com/report-issue'

export async function submitIssueToBackend(
  payload: {
    title: string
    description: string
    body?: string
    gistUrl?: string
    rawFiles?: Array<{ name: string; content: string }>
    systemInfo?: Record<string, string>
  },
  backendUrl: string = DEFAULT_REPORT_BACKEND_URL,
  fetchFn: typeof fetch = fetch
): Promise<{ ok: boolean; issueUrl?: string; gistUrl?: string; error?: string }> {
  try {
    const res = await fetchFn(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { ok: false, error: 'Backend HTTP ' + res.status + ': ' + errText }
    }
    const data = (await res.json()) as { ok?: boolean; issueUrl?: string; gistUrl?: string; error?: string }
    return { ok: !!data.ok, issueUrl: data.issueUrl, gistUrl: data.gistUrl, error: data.error }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface CreateIssueOptions {
  title: string
  description: string
  logsDir: string
  attachments?: UserAttachment[]
  repo?: string
  execGh?: (args: string[]) => Promise<{ stdout: string; stderr: string }>
  openExternal?: (url: string) => Promise<void>
  backendUrl?: string
  fetchFn?: typeof fetch
}

export interface CreateIssueResult {
  ok: boolean
  issueUrl?: string
  gistUrl?: string
  error?: string
  method: 'cli' | 'backend' | 'web'
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

export async function uploadUserAttachments(
  attachments: UserAttachment[],
  repo: string,
  execGh: (args: string[]) => Promise<{ stdout: string; stderr: string }>
): Promise<void> {
  if (!attachments || attachments.length === 0) return

  let token = ''
  let repoId = ''
  try {
    const tokenRes = await execGh(['auth', 'token'])
    token = tokenRes.stdout.trim()
    const repoIdRes = await execGh(['api', `repos/${repo}`, '--jq', '.id'])
    repoId = repoIdRes.stdout.trim()
  } catch {}

  if (!token || !repoId) return

  for (const att of attachments) {
    if (!att.base64Data || att.url) continue
    try {
      const buf = Buffer.from(att.base64Data, 'base64')
      const uploadUrl = `https://uploads.github.com/user-attachments/assets?name=${encodeURIComponent(
        att.name
      )}&content_type=${encodeURIComponent(att.type || 'application/octet-stream')}&repository_id=${repoId}`

      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': att.type || 'application/octet-stream',
        },
        body: buf,
      })

      if (res.ok) {
        const data = (await res.json()) as { url?: string }
        if (data?.url) {
          att.url = data.url
        }
      }
    } catch (err) {
      console.warn(`[uploadUserAttachments] failed to upload ${att.name}:`, err)
    }
  }
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

  const diagnostics = await collectIssueDiagnostics(options.logsDir)

  // Upload user attachments if provided
  if (options.attachments && options.attachments.length > 0) {
    // Add text attachments to rawFiles for Gist
    for (const att of options.attachments) {
      if (!att.isImage && att.base64Data) {
        try {
          const text = Buffer.from(att.base64Data, 'base64').toString('utf8')
          diagnostics.rawFiles?.push({ name: att.name, content: text })
          diagnostics.attachedFiles.push(att.name)
        } catch {}
      }
    }

    try {
      await uploadUserAttachments(options.attachments, repo, execCmd)
    } catch (err) {
      console.warn('[createGithubIssue] user attachments upload failed:', err)
    }
  }

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
    userAttachments: options.attachments,
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

      return { ok: true, issueUrl, gistUrl: gistUrl ?? undefined, method: 'cli' }
    } catch {
      // 1. Tenta envio anonimo direto pelo backend no Render
      const backendUrl = options.backendUrl ?? DEFAULT_REPORT_BACKEND_URL
      const fetchFn = options.fetchFn ?? fetch
      try {
        const backendRes = await submitIssueToBackend(
          {
            title: options.title,
            description: options.description,
            body: markdown,
            gistUrl: gistUrl ?? undefined,
            rawFiles: diagnostics.rawFiles,
            systemInfo: diagnostics.systemInfo,
          },
          backendUrl,
          fetchFn
        )

        if (backendRes.ok && backendRes.issueUrl) {
          return {
            ok: true,
            issueUrl: backendRes.issueUrl,
            gistUrl: backendRes.gistUrl ?? gistUrl ?? undefined,
            method: 'backend',
          }
        }
      } catch (backendErr) {
        console.warn('[createGithubIssue] backend submit failed, falling back to web:', backendErr)
      }

      // 2. Ultimo fallback: retorna URL para abertura no navegador
      const webUrl = buildGithubWebUrl({
        title: options.title,
        body: markdown,
        repo,
      })
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
