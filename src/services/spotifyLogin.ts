import type { SpotifyLoginState } from '../types/spotifyLogin'

type Result = { ok: boolean; error?: string }
export type SpotifyLoginAPI = { openSpotifyLogin?: () => Promise<Result>; completeSpotifyLogin?: () => Promise<Result>; getSpotifyLoginState?: () => Promise<SpotifyLoginState> }
export type SpotifyLoginView = {
  state: SpotifyLoginState | null
  busy: 'opening' | 'completing' | null
  error: string | null
}

export async function spotifyLoginAction(api: SpotifyLoginAPI | undefined, complete: boolean): Promise<Result> {
  const action = complete ? api?.completeSpotifyLogin : api?.openSpotifyLogin
  if (!action) return { ok: false, error: 'O login do Spotify requer a versão atual do Lira para Windows.' }
  try { return await action() }
  catch { return { ok: false, error: 'Não foi possível abrir o login do Spotify. Tente novamente.' } }
}

// Each visible panel owns a session. Old queries cannot replace a newer action result.
export function createSpotifyLoginSession(api: SpotifyLoginAPI | undefined, changed: (view: SpotifyLoginView) => void) {
  let view: SpotifyLoginView = { state: null, busy: null, error: null }
  let disposed = false
  let refreshing = false
  let revision = 0
  let queryFailed = false
  const update = (next: Partial<SpotifyLoginView>) => {
    if (disposed) return
    view = { ...view, ...next }
    changed(view)
  }
  return {
    get view() { return view },
    async refresh() {
      if (disposed || refreshing || view.busy) return
      refreshing = true
      const current = revision
      try {
        if (!api?.getSpotifyLoginState) throw new Error('Unsupported login state')
        const state = await api.getSpotifyLoginState()
        if (disposed || current !== revision) return
        update({ state, error: queryFailed || (state.confirmed && !state.pending) ? null : view.error })
        queryFailed = false
      } catch {
        if (disposed || current !== revision) return
        queryFailed = true
        update({ error: 'Não foi possível verificar o login do Spotify. Tente novamente.' })
      } finally { refreshing = false }
    },
    async act(complete: boolean) {
      if (disposed || view.busy) return
      revision++
      queryFailed = false
      update({ busy: complete ? 'completing' : 'opening', error: null })
      const result = await spotifyLoginAction(api, complete)
      if (disposed) return
      if (result.ok) {
        update({ state: { pending: !complete, confirmed: complete, browserOpen: !complete }, busy: null, error: null })
      } else {
        update({ state: complete ? { pending: true, confirmed: false, browserOpen: view.state?.browserOpen ?? false } : null,
          busy: null, error: result.error || 'Não foi possível abrir o Spotify.' })
      }
    },
    dispose() { disposed = true; revision++ },
  }
}
