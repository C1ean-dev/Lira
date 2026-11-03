import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  extractGistId,
  extractRecommendedLabel,
  buildTriagePrompt,
  callAIProvider,
  callOpenRouter,
  runIssueTriage,
  GEMINI_API_URL,
  OPENROUTER_API_URL,
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

  describe('callAIProvider with Gemini and OpenRouter', () => {
    it('calls Google Gemini endpoint when provider is gemini', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: '## Diagnóstico Gemini\nErro no WebRTC.',
              },
            },
          ],
        }),
      })

      const content = await callAIProvider({
        apiKey: 'test-gemini-key',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
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
      expect(content).toBe('## Diagnóstico Gemini\nErro no WebRTC.')
    })

    it('calls OpenRouter endpoint when provider is openrouter', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: '## Diagnóstico OpenRouter\nErro no PeerManager.',
              },
            },
          ],
        }),
      })

      const content = await callOpenRouter({
        apiKey: 'test-openrouter-key',
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: 'test' }],
        fetchFn: mockFetch,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        OPENROUTER_API_URL,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-openrouter-key',
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/C1ean-dev/Lira',
            'X-Title': 'Lira AI Issue Triage',
          }),
        })
      )
      expect(content).toBe('## Diagnóstico OpenRouter\nErro no PeerManager.')
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

    it('works seamlessly using GEMINI_API_KEY with Google Gemini', async () => {
      const mockFetch = vi.fn()

      // 1. Comments check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      })

      // 2. Gemini completion
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
        mockFetch
      )

      expect(result.success).toBe(true)
      expect(result.label).toBe('ready-for-agent')
      expect(mockFetch).toHaveBeenCalledWith(
        GEMINI_API_URL,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer free-gemini-key',
          }),
        })
      )
    })
  })
})
