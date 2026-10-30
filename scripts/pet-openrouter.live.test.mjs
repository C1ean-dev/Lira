import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { transform } from 'esbuild'

test('OpenRouter exposes free conversational models', { skip: process.env.LIRA_RUN_OPENROUTER_MODELS !== '1', timeout: 30000 }, async () => {
  const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20000) })
  assert.equal(response.status, 200)
  const { data } = await response.json()
  const models = data.filter(model => model.id.endsWith(':free') && Number(model.pricing?.prompt) === 0 && Number(model.pricing?.completion) === 0)
  assert.ok(models.length > 0)
  console.log('Available free model IDs', models.map(model => model.id).join(', '))
})

// Opt-in only. The credential is supplied in memory and is never written to disk.
test('pet OpenRouter integration with a supplied key', { skip: process.env.LIRA_RUN_OPENROUTER_LIVE !== '1', timeout: 120000 }, async () => {
  let apiKey = process.env.LIRA_OPENROUTER_TEST_KEY
  delete process.env.LIRA_OPENROUTER_TEST_KEY
  if (!apiKey) {
    const input = createInterface({ input: process.stdin, terminal: false })
    apiKey = await new Promise(resolve => input.once('line', line => { input.close(); resolve(line.trim()) }))
  }
  assert.ok(apiKey, 'Provide the test key on stdin')
  const auth = await fetch('https://openrouter.ai/api/v1/auth/key', { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20000) })
  console.log('OpenRouter authentication HTTP', auth.status)
  assert.equal(auth.status, 200, 'OpenRouter did not authenticate the supplied key')
  const { code } = await transform(await readFile(new URL('../src/services/petOpenRouter.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' })
  const { askPet } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  const fetcher = async (url, options) => {
    if (options?.body) {
      const request = JSON.parse(options.body)
      assert.ok([request.model, ...(request.models || [])].every(model => model === 'openrouter/free' || model.endsWith(':free')), 'Use free models only')
    }
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) })
    const data = await response.clone().json().catch(() => ({}))
    const error = String(data.error?.message || '').toLowerCase()
    const category = error.includes('no endpoints') ? 'no-endpoints' : error.includes('data policy') ? 'data-policy' : error.includes('rate') || error.includes('limit') ? 'rate-limit' : error.includes('credit') ? 'credits' : error ? 'other-api-error' : 'none'
    const detail = String(data.error?.message || '').replaceAll(apiKey, '[redacted]').replace(/sk-or-[a-z0-9-]+/gi, '[redacted]').slice(0, 300)
    console.log('OpenRouter', url.endsWith('/models') ? 'catalog' : 'completion', JSON.stringify({ status: response.status, errorCode: data.error?.code, category, model: data.model, ...(detail ? { detail } : {}) }))
    return response
  }
  let answer
  try { answer = await askPet({ apiKey, petName: 'Mingau', personality: 'Um gato amigável. Responda em português em uma frase curta.', question: 'Oi, tudo bem?' }, fetcher) }
  catch (error) { throw new Error(String(error.message).replaceAll(apiKey, '[redacted]')) }
  assert.ok(answer.trim(), 'The pet must provide a conversational answer')
  assert.doesNotMatch(answer, /^User Safety:/i)
  console.log('Pet conversational reply received successfully')
})
