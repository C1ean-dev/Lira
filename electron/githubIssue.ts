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

  try {
    const entries = await fs.promises.readdir(logsDir)
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
      const parsed = parseReportLines(combinedReports).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
      const groups = groupReports(parsed)
      summaryText = formatDigest(groups)
    }

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
      } catch {}
    }
  } catch {}

  return {
    systemInfo,
    summaryText,
    recentErrorsText,
  }
}

export function buildIssueMarkdown(payload: {
  title: string
  description: string
  diagnostics: IssueDiagnostics
}): string {
  const { description, diagnostics } = payload
  const { systemInfo } = diagnostics

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
    '<details>',
    '<summary>📋 Resumo dos Erros Registrados</summary>',
    '',
    '```text',
    diagnostics.summaryText || 'Nenhum erro registrado.',
    '```',
    '</details>',
    '',
    '<details>',
    '<summary>📄 Últimas Linhas de Log de Erro</summary>',
    '',
    '```text',
    diagnostics.recentErrorsText || 'Nenhum log recente.',
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

export async function createGithubIssue(options: CreateIssueOptions): Promise<CreateIssueResult> {
  const repo = options.repo ?? 'C1ean-dev/Lira'
  const execCmd = options.execGh ?? defaultExecGh
  const openUrl = options.openExternal ?? (async (u: string) => {
    if (typeof shell !== 'undefined' && shell.openExternal) {
      await shell.openExternal(u)
    }
  })

  const diagnostics = await collectIssueDiagnostics(options.logsDir)
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
      return { ok: true, issueUrl, method: 'cli' }
    } catch {
      const webUrl = buildGithubWebUrl({
        title: options.title,
        body: markdown,
        repo,
      })
      await openUrl(webUrl)
      return { ok: true, issueUrl: webUrl, method: 'web' }
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
