import { describe, it, expect } from 'vitest'
import { createLatestWriter } from '../../electron/latestWriter'

/** A write that stays open until the test finishes it. */
function controlledWrite() {
  const started: string[] = []
  const finish: Record<string, { ok: () => void; fail: (e: unknown) => void }> = {}
  const write = (key: string, value: string) =>
    new Promise<void>((resolve, reject) => {
      started.push(`${key}:${value}`)
      finish[`${key}:${value}`] = { ok: resolve, fail: reject }
    })
  return { write, started, finish }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('createLatestWriter', () => {
  it('starts writing at once when nothing is being written', async () => {
    const { write, started, finish } = controlledWrite()
    const submit = createLatestWriter(write)
    const done = submit('file', 'a')
    expect(started).toEqual(['file:a'])
    finish['file:a'].ok()
    await done
  })

  it('writes one at a time and, of what piles up meanwhile, only the latest', async () => {
    const { write, started, finish } = controlledWrite()
    const submit = createLatestWriter(write)
    const a = submit('file', 'a')
    const b = submit('file', 'b')
    const c = submit('file', 'c')
    expect(started).toEqual(['file:a'])

    finish['file:a'].ok()
    await a
    await tick()
    expect(started).toEqual(['file:a', 'file:c'])

    finish['file:c'].ok()
    await Promise.all([b, c])
    expect(started).toEqual(['file:a', 'file:c'])
  })

  it('answers each caller only once what it asked for, or something newer, is written', async () => {
    const { write, finish } = controlledWrite()
    const submit = createLatestWriter(write)
    let settled = ''
    const a = submit('file', 'a').then(() => (settled += 'a'))
    const b = submit('file', 'b').then(() => (settled += 'b'))

    await tick()
    expect(settled).toBe('')
    finish['file:a'].ok()
    await a
    expect(settled).toBe('a')
    await tick()
    finish['file:b'].ok()
    await b
    expect(settled).toBe('ab')
  })

  it('does not make different files wait for each other', async () => {
    const { write, started, finish } = controlledWrite()
    const submit = createLatestWriter(write)
    const one = submit('one', 'x')
    const two = submit('two', 'y')
    expect(started).toEqual(['one:x', 'two:y'])
    finish['one:x'].ok()
    finish['two:y'].ok()
    await Promise.all([one, two])
  })

  it('rejects the callers of a write that fails, and still does the one waiting behind it', async () => {
    const { write, started, finish } = controlledWrite()
    const submit = createLatestWriter(write)
    const a = submit('file', 'a')
    const b = submit('file', 'b')
    const aResult = a.then(
      () => 'ok',
      (e: Error) => e.message
    )

    finish['file:a'].fail(new Error('disk full'))
    expect(await aResult).toBe('disk full')
    await tick()
    expect(started).toEqual(['file:a', 'file:b'])
    finish['file:b'].ok()
    await b
  })

  it('rejects every caller that was folded into a write that fails', async () => {
    const { write, finish } = controlledWrite()
    const submit = createLatestWriter(write)
    const a = submit('file', 'a')
    const b = submit('file', 'b')
    const c = submit('file', 'c')
    finish['file:a'].ok()
    await a
    await tick()
    const results = Promise.all([b, c].map((p) => p.then(() => 'ok', (e: Error) => e.message)))
    finish['file:c'].fail(new Error('locked'))
    expect(await results).toEqual(['locked', 'locked'])
  })

  it('can be used again once everything is written', async () => {
    const { write, started, finish } = controlledWrite()
    const submit = createLatestWriter(write)
    const a = submit('file', 'a')
    finish['file:a'].ok()
    await a
    const b = submit('file', 'b')
    expect(started).toEqual(['file:a', 'file:b'])
    finish['file:b'].ok()
    await b
  })
})
