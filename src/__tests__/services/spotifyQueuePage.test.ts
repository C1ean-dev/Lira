import { afterEach, describe, expect, it, vi } from 'vitest'
import { enqueueSpotifyTrackInPage } from '../../../electron/spotifyQueue'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const id = '4uLU6hMCjMI75M1A2tKUQC'
function page({ confirmed = true, existingToast = false, disabled = false, visible = false, focused = undefined as boolean | undefined, foregroundAfterMenu = false } = {}) {
  let open = false
  let added = false
  const oldToast = { textContent: 'Added to queue' }
  const newToast = { textContent: 'Adicionada à fila' }
  const menuItem = { textContent: 'Adicionar à fila', disabled, getAttribute: () => null, click: vi.fn(() => { added = true }) }
  const menu = { querySelectorAll: () => [menuItem], getAttribute: () => null }
  const more = { disabled: false, getAttribute: () => null, click: vi.fn(() => { open = true; if (foregroundAfterMenu) visible = true }) }
  const row = { querySelector: () => more }
  const anchor = { getAttribute: () => `/track/${id}`, closest: () => row }
  vi.stubGlobal('location', { origin: 'https://open.spotify.com' })
  vi.stubGlobal('document', { body: {}, get visibilityState() { return visible ? 'visible' : 'hidden' }, hasFocus: () => focused ?? visible, querySelectorAll: (selector: string) => {
    if (selector.includes('/track/')) return [anchor]
    if (selector === '[role="menu"]') return open ? [menu] : []
    return [...(existingToast ? [oldToast] : []), ...(added && confirmed ? [newToast] : [])]
  } })
  return { menuItem, more }
}
describe('Spotify queue robot in the page', () => {
  it('allows a native hidden target that reports visible document state while retaining no user focus', async () => {
    page({ visible: true, focused: false })
    expect(await enqueueSpotifyTrackInPage(id)).toEqual({ ok: true })
  })
  it('uses the selected track menu and waits for a new Spotify confirmation', async () => {
    const { menuItem, more } = page()
    expect(await enqueueSpotifyTrackInPage(id)).toEqual({ ok: true })
    expect(more.click).toHaveBeenCalledOnce()
    expect(menuItem.click).toHaveBeenCalledOnce()
  })
  it('does not count a previous toast as success or repeat a click when confirmation is missing', async () => {
    vi.useFakeTimers()
    const { menuItem } = page({ confirmed: false, existingToast: true })
    const operation = enqueueSpotifyTrackInPage(id)
    await vi.advanceTimersByTimeAsync(6000)
    expect(await operation).toMatchObject({ ok: false, uncertain: true })
    expect(menuItem.click).toHaveBeenCalledOnce()
  })
  it('reports an unavailable queue action without clicking playback or a disabled action', async () => {
    const { menuItem } = page({ disabled: true })
    expect(await enqueueSpotifyTrackInPage(id)).toMatchObject({ ok: false })
    expect(menuItem.click).not.toHaveBeenCalled()
    vi.stubGlobal('location', { origin: 'https://example.com' })
    expect(await enqueueSpotifyTrackInPage(id)).toMatchObject({ ok: false })
  })
  it.each([false, true])('pauses automation when the user activates its tab, including after the menu opens=%s', async afterMenu => {
    const { menuItem, more } = page({ visible: !afterMenu, foregroundAfterMenu: afterMenu })
    expect(await enqueueSpotifyTrackInPage(id)).toMatchObject({ ok: false })
    expect(menuItem.click).not.toHaveBeenCalled()
    if (!afterMenu) expect(more.click).not.toHaveBeenCalled()
  })
})
