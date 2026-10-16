import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpotifyLoginView } from '../../services/spotifyLogin'
import { useSpotifyLogin } from '../../hooks/useSpotifyLogin'

// Exercise lifecycle events without opening a browser or mounting a native window.
const hooks = vi.hoisted(() => ({
  view: null as SpotifyLoginView | null,
  ref: { current: null as unknown },
  effect: null as (() => void | (() => void)) | null,
}))
vi.mock('react', () => ({
  useState: (initial: SpotifyLoginView) => [hooks.view ?? initial, (view: SpotifyLoginView) => { hooks.view = view }],
  useRef: () => hooks.ref,
  useEffect: (effect: () => void | (() => void)) => { hooks.effect = effect },
}))

describe('Spotify login panel lifecycle', () => {
  let browser: EventTarget
  let page: EventTarget & { hidden: boolean }
  let api: { getSpotifyLoginState: ReturnType<typeof vi.fn>; openSpotifyLogin: ReturnType<typeof vi.fn> }
  let cleanup: void | (() => void)
  beforeEach(() => {
    vi.useFakeTimers()
    hooks.view = null
    hooks.ref.current = null
    hooks.effect = null
    cleanup = undefined
    api = {
      getSpotifyLoginState: vi.fn(async () => ({ pending: false, confirmed: false, browserOpen: false })),
      openSpotifyLogin: vi.fn(async () => ({ ok: true })),
    }
    browser = Object.assign(new EventTarget(), { electronAPI: api })
    page = Object.assign(new EventTarget(), { hidden: false })
    vi.stubGlobal('window', browser)
    vi.stubGlobal('document', page)
  })
  afterEach(() => {
    cleanup?.()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('checks on opening, polls while visible and refreshes when returning to Lira', async () => {
    expect(useSpotifyLogin(true).ready).toBe(false)
    cleanup = hooks.effect?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(api.getSpotifyLoginState).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.getSpotifyLoginState).toHaveBeenCalledTimes(2)
    page.hidden = true
    await vi.advanceTimersByTimeAsync(6000)
    expect(api.getSpotifyLoginState).toHaveBeenCalledTimes(2)
    page.hidden = false
    api.getSpotifyLoginState.mockResolvedValue({ pending: false, confirmed: true, browserOpen: false })
    browser.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(useSpotifyLogin(true).ready).toBe(true)
    page.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.getSpotifyLoginState).toHaveBeenCalledTimes(4)
  })

  it('blocks transmission during an action and stops listening after the panel closes', async () => {
    useSpotifyLogin(true)
    cleanup = hooks.effect?.()
    await vi.advanceTimersByTimeAsync(0)
    let resolve!: (value: { ok: boolean }) => void
    api.openSpotifyLogin.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const action = useSpotifyLogin(true).act(false)
    expect(useSpotifyLogin(true).busy).toBe('opening')
    expect(useSpotifyLogin(true).ready).toBe(false)
    resolve({ ok: true })
    await action
    expect(useSpotifyLogin(true).state?.pending).toBe(true)
    cleanup?.()
    cleanup = undefined
    api.getSpotifyLoginState.mockClear()
    browser.dispatchEvent(new Event('focus'))
    page.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(6000)
    expect(api.getSpotifyLoginState).not.toHaveBeenCalled()
  })

  it('does not query or allow login actions when the panel is inactive', async () => {
    expect(useSpotifyLogin(false).ready).toBe(false)
    cleanup = hooks.effect?.()
    await useSpotifyLogin(false).act(false)
    await vi.advanceTimersByTimeAsync(6000)
    expect(api.getSpotifyLoginState).not.toHaveBeenCalled()
    expect(api.openSpotifyLogin).not.toHaveBeenCalled()
  })
})
