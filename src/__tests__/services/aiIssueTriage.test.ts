import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  extractGistId,
  extractRecommendedLabel,
  buildTriagePrompt,
  callAIProvider,
  executeCascadeTriage,
  runIssueTriage,
  GEMINI_API_URL,
  OPENROUTER_API_URL,
  CASCADE_TIERS,
} from '../../../scripts/ai-issue-triage.mjs'

describe('ai-issue-triage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('extractGistId', () => {
    it('extracts gist ID from standard github gist markdown links', () => {
      const body = `
### Relatório de erro
> 🔗 [Clique aqui para abrir os arquivos de log anexados no GitHub Gist](https://gist.github.com/C1ean-dev/8a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d)
`
      expect(extractGistId(body)).toBe('8a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d')
    })

    it('extracts gist ID from raw gist URL or plain link', () => {
      const body = 'Logs: https://gist.github.com/abc123def456'
      expect(extractGistId(body)).toBe('abc123def456')
    })

    it('returns null when no gist link is present', () => {
      const body = 'Problema simples sem gist anexado.'
      expect(extractGistId(body)).toBeNull()
    })
  })

  describe('extractRecommendedLabel', () => {
    it('uses the explicit recommendation, ignoring alternative labels in the justification', () => {
      expect(extractRecommendedLabel('### 5. Triagem\n- **Label Recomendada:** `needs-info`\n- Falta evidência para ready-for-agent.')).toBe('needs-info')
      expect(extractRecommendedLabel('Não aplicar ready-for-agent sem evidência.')).toBe('needs-triage')
    })
    it('extracts ready-for-agent from section 5', () => {
      const response = `
## Análise Técnica
### 5. Triagem e Próximos Passos
- **Label Recomendada:** \`ready-for-agent\`
- **Justificativa:** O erro de socket é claro no log.
`
      expect(extractRecommendedLabel(response)).toBe('ready-for-agent')
    })

    it('extracts needs-info when information is missing', () => {
      const response = `
### 5. Triagem
- **Label:** needs-info
`
      expect(extractRecommendedLabel(response)).toBe('needs-info')
    })

    it('extracts ready-for-human when human review is required', () => {
      const response = `
### 5. Triagem
Label Recomendada: ready-for-human
`
      expect(extractRecommendedLabel(response)).toBe('ready-for-human')
    })

    it('falls back to needs-triage when no canonical label is recognized', () => {
      const response = 'Resposta sem label identificada.'
      expect(extractRecommendedLabel(response)).toBe('needs-triage')
    })
  })

  describe('buildTriagePrompt', () => {
    it('requires temporal evidence and separates hypotheses from confirmed causes without inventing source code', () => {
      const system = buildTriagePrompt({ title: 'Microfone pipocando', body: 'Logs incompletos' })[0].content
      expect(system).toContain('hipóteses')
      expect(system).toContain('dia local')
      expect(system).toContain('sessão')
      expect(system).toContain('readyState')
      expect(system).toContain('screenShareAudio')
      expect(system).toContain('replaceTrack')
      expect(system).toContain('código-fonte')
      expect(system).toContain('dados não confiáveis')
    })
    it('constructs system and user messages containing issue info and logs', () => {
      const messages = buildTriagePrompt({
        title: 'DJ travando na conexão WebRTC',
        body: 'O bot DJ desconectou após 5 minutos.',
        author: 'usuario123',
        gistLogs: {
          'call-debug.log': '[12:00:01] peer closed connection code 1006',
        },
      })

      expect(messages).toHaveLength(2)
      expect(messages[0].role).toBe('system')
      expect(messages[0].content).toContain('Lira')
      expect(messages[1].role).toBe('user')
      expect(messages[1].content).toContain('DJ travando na conexão WebRTC')
      expect(messages[1].content).toContain('[12:00:01] peer closed connection code 1006')
    })
  })

  describe('callAIProvider', () => {
    it('calls Google Gemini endpoint with gemini-3.8-flash', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Resposta Gemini' } }],
        }),
      })

      const content = await callAIProvider({
        apiKey: 'test-gemini-key',
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        messages: [{ role: 'user', content: 'test' }],
        fetchFn: mockFetch,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        GEMINI_API_URL,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-gemini-key',
            'Content-Type': 'application/json',
          }),
        })
      )
      expect(content).toBe('Resposta Gemini')
    })

    it('sends provider sort price config to OpenRouter for deepseek-v4.1-flash', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Resposta DeepSeek' } }],
        }),
      })

      const content = await callAIProvider({
        apiKey: 'test-openrouter-key',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4.1-flash-1017',
        providerConfig: { sort: 'price' },
        messages: [{ role: 'user', content: 'test' }],
        fetchFn: mockFetch,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        OPENROUTER_API_URL,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"provider":{"sort":"price"}'),
        })
      )
      expect(content).toBe('Resposta DeepSeek')
    })
  })

  describe('executeCascadeTriage', () => {
    it('verifies CASCADE_TIERS structure with 3 tiers in exact requested order', () => {
      expect(CASCADE_TIERS).toHaveLength(3)
      expect(CASCADE_TIERS[0].model).toBe('gemini-3.8-flash')
      expect(CASCADE_TIERS[0].provider).toBe('gemini')
      expect(CASCADE_TIERS[0].maxAttempts).toBe(3)

      expect(CASCADE_TIERS[1].model).toBe('deepseek/deepseek-v4.1-flash-1017')
      expect(CASCADE_TIERS[1].provider).toBe('openrouter')
      expect(CASCADE_TIERS[1].providerConfig).toEqual({ sort: 'price', require_parameters: true })
      expect(CASCADE_TIERS[1].maxAttempts).toBe(3)

      expect(CASCADE_TIERS[2].model).toBe('nvidia/nemotron-3-ultra-550b-a55b:free')
      expect(CASCADE_TIERS[2].provider).toBe('openrouter')
      expect(CASCADE_TIERS[2].maxAttempts).toBe(3)
    })

    it('falls back to DeepSeek on OpenRouter if Gemini fails 3 times', async () => {
      const mockFetch = vi.fn()

      // Gemini attempts 1, 2, 3 fail
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Unavailable' })
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Unavailable' })
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Unavailable' })

      // DeepSeek attempt 1 succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Plano via DeepSeek' } }],
        }),
      })

      const result = await executeCascadeTriage({
        geminiKey: 'gemini-key',
        openRouterKey: 'openrouter-key',
        messages: [{ role: 'user', content: 'hi' }],
        fetchFn: mockFetch,
        sleepFn: () => Promise.resolve(),
      })

      expect(result.content).toBe('Plano via DeepSeek')
      expect(result.tierUsed).toContain('DeepSeek')
      expect(mockFetch).toHaveBeenCalledTimes(4)
    })

    it('falls back to Nemotron Free if DeepSeek on OpenRouter also fails 3 times', async () => {
      const mockFetch = vi.fn()

      // Gemini: 3 failures
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })

      // DeepSeek: 3 failures
      mockFetch.mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'bad gateway' })
      mockFetch.mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'bad gateway' })
      mockFetch.mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'bad gateway' })

      // Nemotron: attempt 1 succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Plano via Nemotron' } }],
        }),
      })

      const result = await executeCascadeTriage({
        geminiKey: 'gemini-key',
        openRouterKey: 'openrouter-key',
        messages: [{ role: 'user', content: 'hi' }],
        fetchFn: mockFetch,
        sleepFn: () => Promise.resolve(),
      })

      expect(result.content).toBe('Plano via Nemotron')
      expect(result.tierUsed).toContain('Nemotron')
      expect(mockFetch).toHaveBeenCalledTimes(7)

      const bodies = mockFetch.mock.calls.map(([, options]) => JSON.parse(options.body))
      expect(bodies.map((body) => body.reasoning_effort)).toEqual([
        undefined, undefined, undefined, 'max', 'max', 'max', undefined,
      ])
      for (const body of bodies.slice(3, 6)) {
        expect(body.provider).toEqual({ sort: 'price', require_parameters: true })
      }
    })
  })

  describe('runIssueTriage', () => {
    it('skips triage gracefully if neither GEMINI_API_KEY nor OPENROUTER_API_KEY is set', async () => {
      const mockFetch = vi.fn()
      const result = await runIssueTriage(
        {
          ISSUE_NUMBER: '42',
          GITHUB_REPOSITORY: 'C1ean-dev/Lira',
        },
        mockFetch
      )

      expect(result.skipped).toBe(true)
      expect(result.reason).toContain('Neither GEMINI_API_KEY nor OPENROUTER_API_KEY')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('executes full flow using Gemini first, posting comment and label', async () => {
      const mockFetch = vi.fn()

      // 1. Comments check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      })

      // 2. Gemini completion (Tier 1 succeeds on attempt 1)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: `<!-- AI-ISSUE-TRIAGE -->
## Análise Técnica
### 5. Triagem e Próximos Passos
- **Label Recomendada:** \`ready-for-agent\`
`,
              },
            },
          ],
        }),
      })

      // 3. Post comment
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 101 }),
      })

      // 4. Add label
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ name: 'ready-for-agent' }],
      })

      const result = await runIssueTriage(
        {
          GEMINI_API_KEY: 'free-gemini-key',
          GITHUB_TOKEN: 'gh-token',
          ISSUE_NUMBER: '42',
          GITHUB_REPOSITORY: 'C1ean-dev/Lira',
          ISSUE_TITLE: 'Erro no áudio',
          ISSUE_BODY: 'DJ falhando',
        },
        mockFetch,
        () => Promise.resolve()
      )

      expect(result.success).toBe(true)
      expect(result.label).toBe('ready-for-agent')
      expect(result.tierUsed).toContain('Gemini 3.8 Flash')
    })
  })
})
