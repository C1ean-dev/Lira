import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AVATAR } from '../../engine/Constants'

const chosenAvatar = {
  ...DEFAULT_AVATAR,
  customAvatarId: 'avatar_other_sliced_charmander_walk',
  otherType: 'avatar_other_sliced_charmander_walk',
  customComponents: { other: 'avatar_other_sliced_charmander_walk' },
  pet: { type: 'none' as const },
}
const profile = { name: 'Ana', profilePicture: 'data:image/png;base64,photo', avatar: chosenAvatar }

async function reloadGame() {
  vi.resetModules()
  return (await import('../../store/useGameStore')).useGameStore
}

beforeEach(() => {
  const entries = new Map<string, string>()
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value) },
  }
  vi.stubGlobal('window', { localStorage: storage })
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => { vi.unstubAllGlobals() })

describe('player profile across reloads and updates', () => {
  it.each([
    { name: 'Ana #2' },
    { profilePicture: 'data:image/png;base64,new-photo' },
    { avatar: { ...chosenAvatar, hairColor: '#e03131' } },
  ])('preserves omitted profile fields after saving %j and restarting', async update => {
    const game = await reloadGame()
    game.getState().setLocalPlayer(profile)
    const id = game.getState().localPlayer.id
    game.getState().setLocalPlayer(update)

    const restarted = (await reloadGame()).getState().localPlayer
    expect(restarted).toMatchObject({ id, ...profile, ...update })
  })

  it('allows clearing the profile picture while keeping the chosen character and name', async () => {
    const game = await reloadGame()
    game.getState().setLocalPlayer(profile)
    game.getState().setLocalPlayer({ profilePicture: '' })

    expect((await reloadGame()).getState().localPlayer).toMatchObject({ ...profile, profilePicture: '' })
  })
})
