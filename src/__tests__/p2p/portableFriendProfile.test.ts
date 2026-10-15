import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '../../store/useGameStore'
import { FriendsNetwork } from '../../p2p/FriendsNetwork'

const fixture = vi.hoisted(() => {
  const hash = 'd'.repeat(64)
  const path = `assets/images/${hash}.png`
  return { hash, path }
})
vi.mock('../../media/bundledImageManifest', () => ({ default: { version: 1, aliases: {}, images: { [fixture.hash]: { path: fixture.path, mime: 'image/png' } } } }))
vi.mock('../../data/nativeAssets.json', () => ({ default: { assets: [], categories: [] } }))
vi.mock('../../data/nativeAvatarPresets.json', () => ({ default: { assets: [], categories: [] } }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('portable saved and shared character profiles', () => {
  it('saves the selected character portably and preserves later profile changes', async () => {
    let finish!: (value: string) => void
    const stored = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) }, electronAPI: { readBundledImage: () => new Promise(resolve => { finish = resolve }) } })
    useGameStore.getState().setLocalPlayer({ avatar: { ...useGameStore.getState().localPlayer.avatar, customAvatarId: 'cat', directionalFrames: { down: [fixture.path] } } as any })
    useGameStore.getState().setLocalPlayer({ name: 'Novo nome' })
    await vi.waitFor(() => expect(finish).toBeDefined())
    finish('data:image/png;base64,portable')
    await vi.waitFor(() => {
      const profile = JSON.parse(stored.get('lira_user_profile') ?? '{}')
      expect(profile.avatar?.directionalFrames.down).toEqual(['data:image/png;base64,portable'])
      expect(profile.name).toBe('Novo nome')
    })
  })

  it('shares a portable profile through the friends link', async () => {
    let finish!: (value: string) => void
    vi.stubGlobal('window', { electronAPI: { readBundledImage: () => new Promise(resolve => { finish = resolve }) } })
    const conn = { open: true, send: vi.fn() }
    const network = Object.create(FriendsNetwork.prototype) as any
    Object.assign(network, { links: new Map([['friend', new Set([conn])]]), peer: {}, userId: 'self' })
    expect(network.send('friend', { t: 'profile', avatar: { directionalFrames: { down: [fixture.path] } } })).toBe(true)
    await vi.waitFor(() => expect(finish).toBeDefined())
    finish('data:image/png;base64,portable')
    await vi.waitFor(() => expect(conn.send).toHaveBeenCalledOnce())
    expect(conn.send.mock.calls[0][0].avatar.directionalFrames.down).toEqual(['data:image/png;base64,portable'])
  })
})
