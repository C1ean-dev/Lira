import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { measureStorage, reportStorageFailure } from '../utils/storageReport'
import { getBufferedLogs, __resetLoggerForTests } from '../utils/logger'

const makeStorage = (entries: Record<string, string>) => {
  const keys = Object.keys(entries)
  return {
    get length() {
      return keys.length
    },
    key: (index: number) => keys[index] ?? null,
    getItem: (key: string) => entries[key] ?? null,
  }
}

describe('measureStorage', () => {
  it('says how much is stored and what takes the most room', () => {
    const storage = makeStorage({
      lira_custom_user_assets: 'x'.repeat(4000),
      lira_saved_spaces: 'y'.repeat(1500),
      lira_user_profile: 'z'.repeat(80),
      a: '1',
      b: '2',
      c: '3',
    })

    expect(measureStorage(storage)).toEqual({
      keys: 6,
      totalChars: 4000 + 23 + 1500 + 17 + 80 + 17 + 6,
      largest: [
        { key: 'lira_custom_user_assets', chars: 4023 },
        { key: 'lira_saved_spaces', chars: 1517 },
        { key: 'lira_user_profile', chars: 97 },
        { key: 'a', chars: 2 },
        { key: 'b', chars: 2 },
      ],
    })
  })

  it('returns nothing when the storage cannot be read', () => {
    expect(measureStorage(null)).toBeUndefined()
    expect(measureStorage(undefined)).toBeUndefined()
    expect(
      measureStorage({
        get length(): number {
          throw new Error('denied')
        },
        key: () => null,
        getItem: () => null,
      })
    ).toBeUndefined()
  })
})

describe('reportStorageFailure', () => {
  beforeEach(() => {
    __resetLoggerForTests()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    __resetLoggerForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports saved data that could not be read, with its key', () => {
    reportStorageFailure('read', 'lira_friends_list', new SyntaxError('Unexpected token } in JSON'))

    const [record] = getBufferedLogs()
    expect(record).toMatchObject({ level: 'error', scope: 'Storage' })
    expect(record.message).toBe('could not read lira_friends_list SyntaxError: Unexpected token } in JSON')
    expect(record.report).toMatchObject({
      kind: 'handled',
      scope: 'Storage',
      data: { action: 'read', key: 'lira_friends_list' },
      error: { name: 'SyntaxError' },
    })
  })

  it('says how full the storage is when a write fails', () => {
    vi.stubGlobal('localStorage', makeStorage({ lira_custom_user_assets: 'x'.repeat(4000), lira_user_profile: 'z'.repeat(80) }))
    const quota = Object.assign(new Error('Setting the value exceeded the quota'), { name: 'QuotaExceededError' })
    reportStorageFailure('write', 'lira_custom_user_assets', quota, { chars: 5300000 })

    const [record] = getBufferedLogs()
    expect(record.report).toMatchObject({
      data: {
        action: 'write',
        key: 'lira_custom_user_assets',
        chars: 5300000,
        storage: { keys: 2, totalChars: 4120, largest: [{ key: 'lira_custom_user_assets', chars: 4023 }, { key: 'lira_user_profile', chars: 97 }] },
      },
      error: { name: 'QuotaExceededError' },
    })
  })

  it('does not measure the storage for a failed read', () => {
    vi.stubGlobal('localStorage', makeStorage({ a: '1' }))
    reportStorageFailure('read', 'a', new Error('bad'))
    expect(getBufferedLogs()[0].report?.data).toEqual({ action: 'read', key: 'a' })
  })

  it('groups the failures of one key, whatever the details of the message', () => {
    reportStorageFailure('read', 'lira_saved_dms', new SyntaxError('Unexpected token a in JSON at position 12'))
    reportStorageFailure('read', 'lira_saved_dms', new SyntaxError('Unexpected token a in JSON at position 99'))
    reportStorageFailure('read', 'lira_friends_list', new SyntaxError('Unexpected token a in JSON at position 12'))

    const prints = getBufferedLogs().map((record) => record.fp)
    expect(prints[0]).toBe(prints[1])
    expect(prints[2]).not.toBe(prints[0])
  })

  it('never throws', () => {
    vi.stubGlobal('localStorage', {
      get length(): number {
        throw new Error('denied')
      },
    })
    expect(() => reportStorageFailure('write', 'k', undefined)).not.toThrow()
    expect(() => reportStorageFailure('read', undefined as never, null)).not.toThrow()
  })
})
