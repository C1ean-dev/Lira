import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateMeetingSummary, meetingMarkdown } from '../../services/meetingSummary'
import { useMeetingStore } from '../../store/useMeetingStore'

const entry = { id: 1, speakerId: 'ana', speakerName: 'Ana', text: 'Entrego o relatório na sexta.', timestamp: 1000 }
const original = useMeetingStore.getState()
afterEach(() => { vi.unstubAllGlobals(); useMeetingStore.setState(original); vi.restoreAllMocks() })

describe('post-call meeting summaries', () => {
  it('archives final utterances after leaving the call without mixing sessions', () => {
    const store = useMeetingStore.getState()
    const id = store.begin('room', 'zone', 'Reunião de produto')
    store.append(id, entry); store.finish(id); store.append(id, { ...entry, id: 2, text: 'Até amanhã.' })
    const next = store.begin('room', 'other', 'Outra reunião')
    expect(useMeetingStore.getState().meetings.find(m => m.id === id)?.entries).toHaveLength(2)
    expect(useMeetingStore.getState().meetings.find(m => m.id === next)?.entries).toEqual([])
    expect(useMeetingStore.getState().meetings.find(m => m.id === id)?.endedAt).toBeDefined()
    store.append(id, entry)
    expect(useMeetingStore.getState().meetings.find(m => m.id === id)?.entries).toHaveLength(2)
  })
  it('requires a key and actual speech before sending anything', async () => {
    const fetcher = vi.fn()
    await expect(generateMeetingSummary('', [entry], fetcher)).rejects.toThrow(/chave/i)
    await expect(generateMeetingSummary('secret', [], fetcher)).rejects.toThrow(/falas/i)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('asks AI for decisions, tasks, owners and deadlines with speaker attribution', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'Resumo\nAna: entregar relatório na sexta.' } }] }) }))
    const summary = await generateMeetingSummary('secret', [entry], fetcher as any)
    const options = (fetcher.mock.calls[0] as any)[1]
    const payload = JSON.parse(options.body)
    expect(options.headers.Authorization).toBe('Bearer secret')
    expect(payload.messages[0].content).toMatch(/decisões/i)
    expect(payload.messages[0].content).toMatch(/não invent/i)
    expect(payload.messages[1].content).toContain('Ana')
    expect(payload.messages[1].content).toContain(entry.text)
    expect(payload.messages[1].content).not.toContain('secret')
    expect(summary).toContain('sexta')
  })
  it('reports provider errors and rejects empty responses', async () => {
    await expect(generateMeetingSummary('secret', [entry], vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as any)).rejects.toThrow(/chave/i)
    await expect(generateMeetingSummary('secret', [entry], vi.fn(async () => ({ ok: true, json: async () => ({ choices: [] }) })) as any)).rejects.toThrow(/resumo/i)
  })
  it('summarizes long meetings in chunks without omitting the final decisions', async () => {
    const sent: string[] = []
    const fetcher = vi.fn(async (_url: any, options: any) => {
      sent.push(JSON.parse(options.body).messages[1].content)
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Resumo parcial de decisões e tarefas.' } }] }) }
    })
    await generateMeetingSummary('secret', [{ ...entry, text: 'Primeira decisão. ' + 'discussão '.repeat(6000) + 'Decisão final.' }], fetcher as any)
    expect(sent.length).toBeGreaterThan(2)
    expect(sent[0]).toContain('Primeira decisão.')
    expect(sent.slice(0, -1).join('')).toContain('Decisão final.')
    expect(sent.every(text => text.length < 25000)).toBe(true)
  })
  it('exports the summary and timestamped transcript as Markdown', () => {
    const id = useMeetingStore.getState().begin('room', 'zone', 'Planejamento')
    useMeetingStore.getState().append(id, entry)
    useMeetingStore.getState().setSummary(id, 'Tarefa: relatório — Ana — sexta.')
    const markdown = meetingMarkdown(useMeetingStore.getState().meetings[0])
    expect(markdown).toContain('Planejamento')
    expect(markdown).toContain('Tarefa: relatório')
    expect(markdown).toContain('Ana: Entrego o relatório')
  })
  it('keeps meetings exportable and reports a local storage failure', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('QuotaExceededError') } })
    const id = useMeetingStore.getState().begin('room', 'zone', 'Review')
    useMeetingStore.getState().append(id, entry)
    expect(useMeetingStore.getState().storageError).toBe(true)
    expect(meetingMarkdown(useMeetingStore.getState().meetings[0])).toContain(entry.text)
  })
})
