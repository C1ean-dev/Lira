import { useEffect, useRef, useState } from 'react'
import { createSpotifyLoginSession, type SpotifyLoginAPI, type SpotifyLoginView } from '../services/spotifyLogin'

export function useSpotifyLogin(enabled: boolean) {
  const [view, setView] = useState<SpotifyLoginView>({ state: null, busy: null, error: null })
  const session = useRef<ReturnType<typeof createSpotifyLoginSession> | null>(null)

  useEffect(() => {
    if (!enabled) return
    const api = (window as unknown as { electronAPI?: SpotifyLoginAPI }).electronAPI
    const current = createSpotifyLoginSession(api, setView)
    session.current = current
    setView(current.view)
    const refresh = () => { if (!document.hidden) void current.refresh() }
    refresh()
    const timer = setInterval(refresh, 3000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      current.dispose()
      session.current = null
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [enabled])

  return {
    ...view,
    ready: enabled && !!view.state?.confirmed && !view.state.pending && !view.busy && !view.error,
    act: (complete: boolean) => session.current?.act(complete),
  }
}
