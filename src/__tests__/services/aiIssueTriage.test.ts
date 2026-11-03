import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  extractGistId,
  extractRecommendedLabel,
  buildTriagePrompt,
  callOpenRouter,
  runIssueTriage,
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

  describe('callOpenRouter', () => {
    it('sends correct headers, body, and returns completion text', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: '## Diagnóstico\nErro no PeerManager.',
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
        'https://openrouter.ai/api/v1/chat/completions',
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
      expect(content).toBe('## Diagnóstico\nErro no PeerManager.')
    })

    it('throws descriptive error when OpenRouter responds with error status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Invalid API Key',
      })

      await expect(
        callOpenRouter({
          apiKey: 'invalid-key',
          messages: [{ role: 'user', content: 'hi' }],
          fetchFn: mockFetch,
        })
      ).rejects.toThrow('OpenRouter API error 401: Invalid API Key')
    })
  })

  describe('runIssueTriage', () => {
    it('skips triage gracefully if OPENROUTER_API_KEY is not set', async () => {
      const mockFetch = vi.fn()
      const result = await runIssueTriage(
        {
          ISSUE_NUMBER: '42',
          GITHUB_REPOSITORY: 'C1ean-dev/Lira',
        },
        mockFetch
      )

      expect(result.skipped).toBe(true)
      expect(result.reason).toContain('OPENROUTER_API_KEY')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('skips if issue is already triaged by the AI bot', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 1,
            body: '<!-- AI-ISSUE-TRIAGE -->\nJá analisado anteriormente.',
          },
        ],
      })

      const result = await runIssueTriage(
        {
          OPENROUTER_API_KEY: 'test-key',
          GITHUB_TOKEN: 'gh-token',
          ISSUE_NUMBER: '42',
          GITHUB_REPOSITORY: 'C1ean-dev/Lira',
          ISSUE_TITLE: 'Erro ao conectar',
          ISSUE_BODY: 'Detalhes do erro',
        },
        mockFetch
      )

      expect(result.skipped).toBe(true)
      expect(result.reason).toContain('already triaged')
    })

    it('executes full flow: calls OpenRouter, posts comment, and adds label', async () => {
      const mockFetch = vi.fn()

      // 1. Check existing comments -> none
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      })

      // 2. OpenRouter API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: `<!-- AI-ISSUE-TRIAGE -->
## Análise Técnica
### 1. Diagnóstico
Desconexão indevida.
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
        json: async () => ({ id: 100, html_url: 'https://github.com/comment/100' }),
      })

      // 4. Add label
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ name: 'ready-for-agent' }],
      })

      const result = await runIssueTriage(
        {
          OPENROUTER_API_KEY: 'test-key',
          GITHUB_TOKEN: 'gh-token',
          ISSUE_NUMBER: '42',
          GITHUB_REPOSITORY: 'C1ean-dev/Lira',
          ISSUE_TITLE: 'DJ parando de tocar',
          ISSUE_BODY: 'O DJ parou de tocar após 2 minutos.',
          ISSUE_AUTHOR: 'usuario1',
        },
        mockFetch
      )

      expect(result.success).toBe(true)
      expect(result.label).toBe('ready-for-agent')

      // Verify comment was posted
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/C1ean-dev/Lira/issues/42/comments',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer gh-token',
          }),
        })
      )

      // Verify label was applied
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/C1ean-dev/Lira/issues/42/labels',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ labels: ['ready-for-agent'] }),
        })
      )
    })
  })
})
