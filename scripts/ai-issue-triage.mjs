#!/usr/bin/env node

/**
 * Lira - AI Issue Triage & Solution Planner
 * Analyzes reported issues, diagnostics, and logs using Gemini (Google AI Studio)
 * or OpenRouter API, posts an architectural solution plan and sets canonical triage labels.
 */

import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash'
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash'
export const BOT_SIGNATURE = '<!-- AI-ISSUE-TRIAGE -->'

/**
 * Extracts a GitHub Gist ID from issue body markdown if present.
 */
export function extractGistId(body) {
  if (!body || typeof body !== 'string') return null
  const regex = /https:\/\/gist\.github\.com\/(?:[a-zA-Z0-9_\-]+\/)?([a-f0-9]{8,40})/i
  const match = body.match(regex)
  return match ? match[1] : null
}

/**
 * Parses the recommended label from the AI response markdown.
 * Canonical roles from AGENTS.md: ready-for-agent, needs-info, ready-for-human, wontfix
 */
export function extractRecommendedLabel(response) {
  if (!response || typeof response !== 'string') return 'needs-triage'

  // Look specifically in section 5 or across the text
  const section5Match = response.match(/###\s*5\.[^#]+/i)
  const searchText = section5Match ? section5Match[0] : response

  if (/ready-for-agent/i.test(searchText)) return 'ready-for-agent'
  if (/needs-info/i.test(searchText)) return 'needs-info'
  if (/ready-for-human/i.test(searchText)) return 'ready-for-human'
  if (/wontfix/i.test(searchText)) return 'wontfix'

  return 'needs-triage'
}

/**
 * Formats prompt messages for the AI model.
 */
export function buildTriagePrompt({ title, body, author, gistLogs }) {
  const systemPrompt = `Você é um engenheiro de software sênior e arquiteto especialista no projeto Lira.
O Lira é um escritório virtual desktop colaborativo em tempo real construído com Electron, React, TypeScript, WebRTC (P2P mesh), DSP de áudio (RNNoise/DeepFilterNet/Web Audio), bot DJ para streaming de música via Spotify e hub de salas públicas e privadas.

Sua missão:
1. Analisar o problema reportado pelo usuário, dados do sistema e arquivos de log anexados (lira-errors, call-debug, lira.log, resumo).
2. Identificar a causa raiz técnica (ex: desconexão de peer WebRTC, corte ou buffer de áudio no DJ, WebSocket fechado, exceção não tratada, etc.).
3. Se faltarem dados essenciais para diagnóstico, indicar o que está faltando e recomendar a label 'needs-info'.
4. Se o problema for claro e puder ser resolvido por um agente autônomo, propor o plano e recomendar a label 'ready-for-agent'.
5. Se envolver decisão de produto, design ou intervenção manual humana, recomendar 'ready-for-human'.
6. Formular um plano técnico detalhado com arquivos recomendados para alteração e plano de testes (TDD).

Responda em Markdown em português (claro, profissional, objetivo e sem emojis desnecessários), iniciando estritamente com:
${BOT_SIGNATURE}
## Análise Técnica e Planejamento da Solução (IA)

### 1. Diagnóstico e Causa Raiz
[Explicação técnica do que aconteceu com base nos logs e dados do sistema]

### 2. Evidências dos Logs
[Trechos críticos dos logs que comprovam o erro ou falha]

### 3. Plano de Solução Recomendado
- **Arquivos a modificar:** [lista de caminhos dos arquivos no repositório]
- **Lógica da correção:** [passo a passo do que deve ser alterado]

### 4. Estratégia de Testes (TDD)
- [Cenários de teste unitários a serem criados antes de aplicar o código]

### 5. Triagem e Próximos Passos
- **Label Recomendada:** \`ready-for-agent\` | \`needs-info\` | \`ready-for-human\`
- **Justificativa:** [breve justificativa da triagem]`

  let userContent = `### Título da Issue:
${title}

${author ? `### Autor: @${author}\n` : ''}
### Conteúdo da Issue:
${body}
`

  if (gistLogs && Object.keys(gistLogs).length > 0) {
    userContent += '\n### Logs Completos Obtidos do Gist:\n'
    for (const [filename, content] of Object.entries(gistLogs)) {
      const truncated = content.length > 25000 ? `${content.slice(-25000)}\n... [truncado]` : content
      userContent += `\n#### Arquivo: \`${filename}\`\n\`\`\`text\n${truncated}\n\`\`\`\n`
    }
  }

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ]
}

/**
 * Calls OpenAI-compatible completions API (Gemini via Google AI Studio or OpenRouter).
 */
export async function callAIProvider({ apiKey, provider = 'gemini', model, messages, fetchFn = fetch }) {
  if (!apiKey) {
    throw new Error('API key is required')
  }

  const isGemini = provider === 'gemini'
  const endpoint = isGemini ? GEMINI_API_URL : OPENROUTER_API_URL
  const selectedModel = model || (isGemini ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENROUTER_MODEL)

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  if (!isGemini) {
    headers['HTTP-Referer'] = 'https://github.com/C1ean-dev/Lira'
    headers['X-Title'] = 'Lira AI Issue Triage'
  }

  const response = await fetchFn(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: selectedModel,
      messages,
      temperature: 0.2,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    const providerName = isGemini ? 'Google Gemini' : 'OpenRouter'
    throw new Error(`${providerName} API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('API returned empty response')
  }

  return content
}

/**
 * OpenRouter-specific alias for backwards compatibility.
 */
export async function callOpenRouter(opts) {
  return callAIProvider({ ...opts, provider: 'openrouter' })
}

/**
 * Fetches log contents from a GitHub Gist if available.
 */
export async function fetchGistLogs(gistId, fetchFn = fetch, token) {
  if (!gistId) return {}
  try {
    const headers = { 'User-Agent': 'Lira-AI-Triage' }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    const res = await fetchFn(`https://api.github.com/gists/${gistId}`, { headers })
    if (!res.ok) return {}
    const data = await res.json()
    const files = data.files || {}
    const result = {}
    for (const [name, fileObj] of Object.entries(files)) {
      if (fileObj.content) {
        result[name] = fileObj.content
      }
    }
    return result
  } catch {
    return {}
  }
}

/**
 * Main issue triage runner.
 */
export async function runIssueTriage(env = process.env, fetchFn = fetch) {
  const geminiKey = env.GEMINI_API_KEY
  const openRouterKey = env.OPENROUTER_API_KEY
  const apiKey = geminiKey || openRouterKey
  const provider = geminiKey ? 'gemini' : 'openrouter'

  if (!apiKey) {
    console.log('[AI Triage] Neither GEMINI_API_KEY nor OPENROUTER_API_KEY is configured in repository secrets. Skipping triage.')
    return { skipped: true, reason: 'Neither GEMINI_API_KEY nor OPENROUTER_API_KEY is configured.' }
  }

  const token = env.GITHUB_TOKEN
  const issueNumber = env.ISSUE_NUMBER
  const repo = env.GITHUB_REPOSITORY || 'C1ean-dev/Lira'
  const title = env.ISSUE_TITLE || ''
  const body = env.ISSUE_BODY || ''
  const author = env.ISSUE_AUTHOR || ''
  const model = env.AI_MODEL || env.OPENROUTER_MODEL || (provider === 'gemini' ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENROUTER_MODEL)

  if (!issueNumber) {
    throw new Error('ISSUE_NUMBER is missing')
  }

  console.log(`[AI Triage] Processing Issue #${issueNumber} on ${repo} using ${provider} (${model})...`)

  // 1. Check if issue is already triaged
  if (token) {
    const commentsRes = await fetchFn(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Lira-AI-Triage',
        },
      }
    )
    if (commentsRes.ok) {
      const comments = await commentsRes.json()
      const alreadyTriaged = comments.some(
        (c) => typeof c.body === 'string' && c.body.includes(BOT_SIGNATURE)
      )
      if (alreadyTriaged) {
        console.log(`[AI Triage] Issue #${issueNumber} has already been triaged. Skipping.`)
        return { skipped: true, reason: 'Issue already triaged.' }
      }
    }
  }

  // 2. Fetch Gist logs if attached
  const gistId = extractGistId(body)
  let gistLogs = {}
  if (gistId) {
    console.log(`[AI Triage] Found Gist ${gistId}, fetching attached logs...`)
    gistLogs = await fetchGistLogs(gistId, fetchFn, token)
  }

  // 3. Build prompt and call AI provider
  console.log(`[AI Triage] Generating analysis with ${provider} (${model})...`)
  const messages = buildTriagePrompt({ title, body, author, gistLogs })
  const analysis = await callAIProvider({ apiKey, provider, model, messages, fetchFn })
  const recommendedLabel = extractRecommendedLabel(analysis)

  console.log(`[AI Triage] Recommended label: ${recommendedLabel}`)

  // 4. Post comment on GitHub issue
  if (token) {
    console.log('[AI Triage] Posting analysis comment on GitHub Issue...')
    const commentRes = await fetchFn(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Lira-AI-Triage',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: analysis }),
      }
    )
    if (!commentRes.ok) {
      console.warn(`[AI Triage] Warning: Failed to post comment (${commentRes.status})`)
    }

    // 5. Apply recommended label
    if (recommendedLabel) {
      console.log(`[AI Triage] Applying label '${recommendedLabel}' to Issue #${issueNumber}...`)
      try {
        await fetchFn(`https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': 'Lira-AI-Triage',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ labels: [recommendedLabel] }),
        })
      } catch (err) {
        console.warn('[AI Triage] Failed to apply label:', err?.message || err)
      }
    }
  }

  console.log('[AI Triage] Triage completed successfully!')
  return { success: true, label: recommendedLabel }
}

// CLI Execution
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runIssueTriage()
    .then((res) => {
      if (!res.success && !res.skipped) {
        process.exitCode = 1
      }
    })
    .catch((err) => {
      console.error('[AI Triage] Fatal error:', err)
      process.exitCode = 1
    })
}
