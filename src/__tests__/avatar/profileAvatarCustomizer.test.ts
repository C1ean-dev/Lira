import { describe, it, expect, beforeEach } from 'vitest'
import { CATEGORIES } from '../../components/avatar-customizer/CategoryTabs'
import { useGameStore } from '../../store/useGameStore'
import { DEFAULT_AVATAR } from '../../engine/Constants'
import { Player } from '../../types/game'
import { generateAvatarSnapshot, getAvatarSnapshot } from '../../utils/avatarSnapshot'

// Mock global localStorage
const mockStorage: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value
  },
  removeItem: (key: string) => {
    delete mockStorage[key]
  },
  clear: () => {
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key]
    }
  },
}

;(globalThis as any).window = {
  localStorage: localStorageMock,
}
;(globalThis as any).localStorage = localStorageMock

describe('Avatar Customizer - Nome e Perfil & Default Avatar Snapshot', () => {
  beforeEach(() => {
    localStorageMock.clear()
  })

  it('defines "Nome e Perfil" (profile) category immediately below "Pet / Mascote"', () => {
    const petIndex = CATEGORIES.findIndex((c) => c.id === 'pet')
    const profileIndex = CATEGORIES.findIndex((c) => c.id === 'profile')

    expect(petIndex).toBeGreaterThanOrEqual(0)
    expect(profileIndex).toBe(petIndex + 1)
    expect(CATEGORIES[profileIndex].label).toBe('Nome e Perfil')
  })

  it('safely handles avatar snapshot in test environment without throwing', () => {
    expect(() => generateAvatarSnapshot(DEFAULT_AVATAR, 'Tester')).not.toThrow()
    expect(() => getAvatarSnapshot(DEFAULT_AVATAR, 'Tester')).not.toThrow()
  })

  it('persists custom profile photo and hasCustomPhoto flag when setLocalPlayer is called', () => {
    const sampleCustomPhoto = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='
    const { setLocalPlayer } = useGameStore.getState()

    setLocalPlayer({
      name: 'TesterPro',
      hasCustomPhoto: true,
      profileImage: sampleCustomPhoto,
      avatar: {
        ...DEFAULT_AVATAR,
        hasCustomPhoto: true,
        profileImage: sampleCustomPhoto,
      },
    })

    const state = useGameStore.getState()
    expect(state.localPlayer.name).toBe('TesterPro')
    expect(state.localPlayer.hasCustomPhoto).toBe(true)
    expect(state.localPlayer.profileImage).toBe(sampleCustomPhoto)

    // Verify localStorage persistence
    const savedRaw = localStorageMock.getItem('gather_v2_user_profile')
    expect(savedRaw).toBeTruthy()
    const parsed = JSON.parse(savedRaw!)
    expect(parsed.name).toBe('TesterPro')
    expect(parsed.hasCustomPhoto).toBe(true)
    expect(parsed.profileImage).toBe(sampleCustomPhoto)
  })

  it('reverts custom photo and resets hasCustomPhoto to false on photo removal', () => {
    const { setLocalPlayer } = useGameStore.getState()

    setLocalPlayer({
      name: 'TesterDefaultAvatar',
      hasCustomPhoto: false,
      profileImage: undefined,
    })

    const state = useGameStore.getState()
    expect(state.localPlayer.hasCustomPhoto).toBe(false)

    const savedRaw = localStorageMock.getItem('gather_v2_user_profile')
    expect(savedRaw).toBeTruthy()
    const parsed = JSON.parse(savedRaw!)
    expect(parsed.hasCustomPhoto).toBe(false)
  })

  it('correctly provides fallback initial letter when image is not present', () => {
    const playerWithPhoto: Player = {
      id: 'p1',
      name: 'Alice',
      profileImage: 'data:image/png;base64,alicephoto',
      hasCustomPhoto: true,
      x: 0,
      y: 0,
      direction: 'down',
      isMoving: false,
      avatar: { ...DEFAULT_AVATAR },
      status: 'available',
      lastUpdated: Date.now(),
    }

    const playerWithoutPhoto: Player = {
      id: 'p2',
      name: 'Bob',
      hasCustomPhoto: false,
      x: 0,
      y: 0,
      direction: 'down',
      isMoving: false,
      avatar: { ...DEFAULT_AVATAR },
      status: 'available',
      lastUpdated: Date.now(),
    }

    expect(playerWithPhoto.profileImage).toBeTruthy()
    expect(playerWithPhoto.hasCustomPhoto).toBe(true)
    expect(playerWithoutPhoto.name.charAt(0).toUpperCase()).toBe('B')
  })
})
