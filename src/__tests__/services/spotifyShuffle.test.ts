import { afterEach, describe, expect, it, vi } from 'vitest'
import { toggleSpotifyShuffle } from '../../../electron/spotifyShuffle'

afterEach(() => vi.unstubAllGlobals())
describe('Spotify shuffle toggle', () => {
  it.each([{ disabled: true, ariaDisabled: null }, { disabled: false, ariaDisabled: 'true' }])('does not click an unavailable control: %j', options => {
    const button = { disabled: options.disabled, getAttribute: () => options.ariaDisabled, click: vi.fn() }
    vi.stubGlobal('location', { origin: 'https://open.spotify.com' })
    vi.stubGlobal('document', { querySelector: () => button })
    expect(toggleSpotifyShuffle()).toBe(false)
    expect(button.click).not.toHaveBeenCalled()
  })
  it('does not interact after navigation away from Spotify', () => {
    vi.stubGlobal('location', { origin: 'https://accounts.spotify.com' })
    const querySelector = vi.fn()
    vi.stubGlobal('document', { querySelector })
    expect(toggleSpotifyShuffle()).toBe(false)
    expect(querySelector).not.toHaveBeenCalled()
  })
})
