import { describe, expect, it, vi } from 'vitest'
import { createSpotifyLoginSession } from '../../services/spotifyLogin'

const required = { pending: false, confirmed: false, browserOpen: false }
const pending = { pending: true, confirmed: false, browserOpen: true }
const ready = { pending: false, confirmed: true, browserOpen: false }
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function setup() {
  const api = {
    getSpotifyLoginState: vi.fn(async () => required),
    openSpotifyLogin: vi.fn(async () => ({ ok: true })),
    completeSpotifyLogin: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  }
  const changed = vi.fn()
  const session = createSpotifyLoginSession(api, changed)
  return { api, changed, session }
}

describe('live Spotify login feedback before broadcasting', () => {
  it('restores a completed login and tracks closing the browser without broadcasting', async () => {
    const { api, session } = setup()
    expect(session.view.state).toBeNull()
    api.getSpotifyLoginState.mockResolvedValueOnce(ready)
    await session.refresh()
    expect(session.view.state).toEqual(ready)
    api.getSpotifyLoginState.mockResolvedValueOnce(pending)
    await session.refresh()
    expect(session.view.state).toEqual(pending)
    api.getSpotifyLoginState.mockResolvedValueOnce({ ...pending, browserOpen: false })
    await session.refresh()
    expect(session.view.state).toEqual({ ...pending, browserOpen: false })
    expect(api.completeSpotifyLogin).not.toHaveBeenCalled()
  })

  it('shows opening and completion progress and updates the result immediately', async () => {
    const { api, session } = setup()
    const opening = deferred<{ ok: boolean }>()
    api.openSpotifyLogin.mockReturnValueOnce(opening.promise)
    const action = session.act(false)
    expect(session.view.busy).toBe('opening')
    await session.act(false)
    expect(api.openSpotifyLogin).toHaveBeenCalledOnce()
    opening.resolve({ ok: true })
    await action
    expect(session.view).toMatchObject({ state: pending, busy: null, error: null })
    await session.act(true)
    expect(session.view).toMatchObject({ state: ready, busy: null, error: null })
  })

  it('shows completion failures immediately and preserves them during polling', async () => {
    const { api, session } = setup()
    await session.act(false)
    api.completeSpotifyLogin.mockResolvedValueOnce({ ok: false, error: 'Entre novamente no Spotify.' })
    await session.act(true)
    expect(session.view.error).toBe('Entre novamente no Spotify.')
    expect(session.view.state?.confirmed).toBe(false)
    api.getSpotifyLoginState.mockResolvedValueOnce(pending)
    await session.refresh()
    expect(session.view.error).toBe('Entre novamente no Spotify.')
    await session.act(true)
    expect(session.view.error).toBeNull()
    expect(session.view.state).toEqual(ready)
  })

  it('ignores an old state response after the user starts or completes login', async () => {
    const { api, session } = setup()
    const stale = deferred<typeof required>()
    api.getSpotifyLoginState.mockReturnValueOnce(stale.promise)
    const refresh = session.refresh()
    await session.act(false)
    await session.act(true)
    stale.resolve(required)
    await refresh
    expect(session.view.state).toEqual(ready)
  })

  it('does not overlap slow state queries and ignores responses after closing the panel', async () => {
    const { api, changed, session } = setup()
    const delayed = deferred<typeof required>()
    api.getSpotifyLoginState.mockReturnValueOnce(delayed.promise)
    const refresh = session.refresh()
    await session.refresh()
    expect(api.getSpotifyLoginState).toHaveBeenCalledOnce()
    session.dispose()
    changed.mockClear()
    delayed.resolve(ready)
    await refresh
    expect(changed).not.toHaveBeenCalled()
  })

  it('reports a state query failure and clears it when the query recovers', async () => {
    const { api, session } = setup()
    api.getSpotifyLoginState.mockRejectedValueOnce(new Error('IPC unavailable'))
    await session.refresh()
    expect(session.view.error).toContain('verificar')
    expect(session.view.state).toBeNull()
    await session.refresh()
    expect(session.view.error).toBeNull()
    expect(session.view.state).toEqual(required)
  })

  it('clears a local action failure when login is completed in another panel', async () => {
    const { api, session } = setup()
    api.completeSpotifyLogin.mockResolvedValueOnce({ ok: false, error: 'Aguarde a abertura do Spotify terminar.' })
    await session.act(true)
    api.getSpotifyLoginState.mockResolvedValueOnce(ready)
    await session.refresh()
    expect(session.view).toMatchObject({ state: ready, error: null })
  })
})
