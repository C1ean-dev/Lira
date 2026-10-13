type Result = { ok: boolean; error?: string }
export type SpotifyLoginAPI = { openSpotifyLogin?: () => Promise<Result>; completeSpotifyLogin?: () => Promise<Result>; getSpotifyLoginState?: () => Promise<{ pending: boolean }> }

export async function spotifyLoginAction(api: SpotifyLoginAPI | undefined, complete: boolean): Promise<Result> {
  const action = complete ? api?.completeSpotifyLogin : api?.openSpotifyLogin
  if (!action) return { ok: false, error: 'O login do Spotify requer a versão atual do Lira para Windows.' }
  try { return await action() }
  catch { return { ok: false, error: 'Não foi possível abrir o login do Spotify. Tente novamente.' } }
}
