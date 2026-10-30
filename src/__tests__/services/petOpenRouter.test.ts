import { describe, it, expect, vi } from 'vitest'
import { askPet } from '../../services/petOpenRouter'
const input = { apiKey: 'secret', personality: 'gentil', petName: 'Mingau', question: 'Oi' }
const ok = (text: string) => ({ ok: true, json: async () => ({ choices: [{ message: { content: text } }] }) })
describe('openrouter/free pet requests', () => {
  it('uses the free router and retries a failed request up to three total attempts', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) }).mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) }).mockResolvedValueOnce(ok('Olá!'))
    expect(await askPet(input, fetcher)).toBe('Olá!')
    expect(fetcher).toHaveBeenCalledTimes(3)
    for (const [, options] of fetcher.mock.calls) expect(JSON.parse(options.body).model).toBe('openrouter/free')
  })
  it('stops after three failures and reports the last error', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    await expect(askPet(input, fetcher)).rejects.toMatchObject({ code: 'invalid-key' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('retries safety labels and network errors', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(ok('User Safety: safe')).mockResolvedValueOnce(ok('Miau!'))
    expect(await askPet(input, fetcher)).toBe('Miau!')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('rejects absent keys before sending a request', async () => {
    const fetcher = vi.fn()
    await expect(askPet({ ...input, apiKey: '' }, fetcher)).rejects.toMatchObject({ code: 'missing-key' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
