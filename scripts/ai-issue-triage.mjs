#!/usr/bin/env node

/**
 * Lira - AI Issue Triage & Solution Planner
 * Analyzes reported issues, diagnostics, and logs using a robust fallback cascade:
 * 1. Google Gemini (gemini-3.8-flash via Google AI Studio) -> 3 attempts
 * 2. DeepSeek V4.1 Flash (deepseek/deepseek-v4.1-flash-1017 via OpenRouter cheapest provider) -> 3 attempts
 * 3. NVIDIA Nemotron (nvidia/nemotron-3-ultra-550b-a55b:free via OpenRouter free tier) -> 3 attempts
 */

import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

export const BOT_SIGNATURE = '<!-- AI-ISSUE-TRIAGE -->'

export const CASCADE_TIERS = [
  {
    name: 'Gemini 3.8 Flash (Google AI Studio)',
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    maxAttempts: 3,
  },
  {
    name: 'DeepSeek V4.1 Flash (OpenRouter - Provedor Mais Barato)',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4.1-flash-1017',
    providerConfig: { sort: 'price' },
    maxAttempts: 3,
  },
  {
    name: 'NVIDIA Nemotron 3 Ultra Free (OpenRouter)',
    provider: 'openrouter',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    maxAttempts: 3,
  },
]

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
export async function callAIProvider({ apiKey, provider = 'gemini', model, providerConfig, messages, fetchFn = fetch }) {
  if (!apiKey) {
    throw new Error('API key is required')
  }

  const isGemini = provider === 'gemini'
  const endpoint = isGemini ? GEMINI_API_URL : OPENROUTER_API_URL

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  if (!isGemini) {
    headers['HTTP-Referer'] = 'https://github.com/C1ean-dev/Lira'
    headers['X-Title'] = 'Lira AI Issue Triage'
  }

  const payload = {
    model,
    messages,
    temperature: 0.2,
  }

  if (providerConfig && !isGemini) {
    payload.provider = providerConfig
  }

  const response = await fetchFn(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
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
 * Executes the cascading triage strategy:
 * 1. Gemini (3 attempts)
 * 2. OpenRouter DeepSeek (3 attempts, cheapest provider)
 * 3. OpenRouter Nemotron Free (3 attempts)
 */
export async function executeCascadeTriage({
  geminiKey,
  openRouterKey,
  messages,
  fetchFn = fetch,
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const errors = []

  for (const tier of CASCADE_TIERS) {
    const isGemini = tier.provider === 'gemini'
    const apiKey = isGemini ? geminiKey : openRouterKey

    if (!apiKey) {
      console.log(`[AI Triage] Skipping ${tier.name}: ${isGemini ? 'GEMINI_API_KEY' : 'OPENROUTER_API_KEY'} is not configured.`)
      continue
    }

    console.log(`[AI Triage] Starting ${tier.name} (up to ${tier.maxAttempts} attempts)...`)

    for (let attempt = 1; attempt <= tier.maxAttempts; attempt++) {
      try {
        console.log(`[AI Triage] [${tier.name}] Attempt ${attempt}/${tier.maxAttempts}...`)
        const content = await callAIProvider({
          apiKey,
          provider: tier.provider,
          model: tier.model,
          providerConfig: tier.providerConfig,
          messages,
          fetchFn,
        })
        console.log(`[AI Triage] Successfully received analysis from ${tier.name}!`)
        return { content, tierUsed: tier.name }
      } catch (err) {
        console.warn(`[AI Triage] [${tier.name}] Attempt ${attempt} failed:`, err?.message || err)
        errors.push(`[${tier.name}] Attempt ${attempt}: ${err?.message || err}`)
        if (attempt < tier.maxAttempts) {
          const backoffMs = Math.min(attempt * 1500, 3000)
          await sleepFn(backoffMs)
        }
      }
    }

    console.warn(`[AI Triage] ${tier.name} exhausted all ${tier.maxAttempts} attempts. Moving to next fallback tier...`)
  }

  throw new Error(`All AI triage cascade tiers failed:\n${errors.join('\n')}`)
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
export async function runIssueTriage(env = process.env, fetchFn = fetch, sleepFn) {
  const geminiKey = env.GEMINI_API_KEY
  const openRouterKey = env.OPENROUTER_API_KEY

  if (!geminiKey && !openRouterKey) {
    console.log('[AI Triage] Neither GEMINI_API_KEY nor OPENROUTER_API_KEY is configured in repository secrets. Skipping triage.')
    return { skipped: true, reason: 'Neither GEMINI_API_KEY nor OPENROUTER_API_KEY is configured.' }
  }

  const token = env.GITHUB_TOKEN
  const issueNumber = env.ISSUE_NUMBER
  const repo = env.GITHUB_REPOSITORY || 'C1ean-dev/Lira'
  const title = env.ISSUE_TITLE || ''
  const body = env.ISSUE_BODY || ''
  const author = env.ISSUE_AUTHOR || ''

  if (!issueNumber) {
    throw new Error('ISSUE_NUMBER is missing')
  }

  console.log(`[AI Triage] Processing Issue #${issueNumber} on ${repo}...`)

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

  // 3. Build prompt and run cascade
  console.log('[AI Triage] Running AI triage cascade...')
  const messages = buildTriagePrompt({ title, body, author, gistLogs })
  const { content: analysis, tierUsed } = await executeCascadeTriage({
    geminiKey,
    openRouterKey,
    messages,
    fetchFn,
    sleepFn,
  })

  const recommendedLabel = extractRecommendedLabel(analysis)
  console.log(`[AI Triage] Recommended label: ${recommendedLabel} (via ${tierUsed})`)

  // 4. Post comment on GitHub issue
  if (token) {
    console.log('[AI Triage] Posting analysis comment on GitHub Issue...')
    const commentWithFooter = `${analysis}\n\n---\n*Triagem realizada automaticamente via **${tierUsed}***`
    const commentRes = await fetchFn(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Lira-AI-Triage',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: commentWithFooter }),
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
  return { success: true, label: recommendedLabel, tierUsed }
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
