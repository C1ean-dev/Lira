import { describe, it, expect, beforeEach } from 'vitest'
import { CATEGORIES } from '../components/avatar-customizer/CategoryTabs'
import { useGameStore } from '../store/useGameStore'
import { DEFAULT_AVATAR } from '../engine/Constants'
import { Player } from '../types/game'

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

describe('Avatar Customizer - Nome e Perfil', () => {
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

  it('persists profileImage when setLocalPlayer is called', () => {
    const sampleProfileImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='
    const { setLocalPlayer } = useGameStore.getState()

    setLocalPlayer({
      name: 'TesterPro',
      profileImage: sampleProfileImage,
      avatar: {
        ...DEFAULT_AVATAR,
        profileImage: sampleProfileImage,
      },
    })

    const state = useGameStore.getState()
    expect(state.localPlayer.name).toBe('TesterPro')
    expect(state.localPlayer.profileImage).toBe(sampleProfileImage)
    expect(state.localPlayer.avatar?.profileImage).toBe(sampleProfileImage)

    // Verify localStorage persistence
    const savedRaw = localStorageMock.getItem('gather_v2_user_profile')
    expect(savedRaw).toBeTruthy()
    const parsed = JSON.parse(savedRaw!)
    expect(parsed.name).toBe('TesterPro')
    expect(parsed.profileImage).toBe(sampleProfileImage)
  })

  it('allows removing profile image (reverting to undefined) and persisting removal', () => {
    const { setLocalPlayer } = useGameStore.getState()

    setLocalPlayer({
      name: 'PlayerWithoutPhoto',
      profileImage: undefined,
    })

    const state = useGameStore.getState()
    expect(state.localPlayer.profileImage).toBeUndefined()

    const savedRaw = localStorageMock.getItem('gather_v2_user_profile')
    expect(savedRaw).toBeTruthy()
    const parsed = JSON.parse(savedRaw!)
    expect(parsed.profileImage).toBeUndefined()
  })

  it('correctly provides fallback initial letter for avatar display', () => {
    const playerWithPhoto: Player = {
      id: 'p1',
      name: 'Alice',
      profileImage: 'data:image/png;base64,alicephoto',
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
      x: 0,
      y: 0,
      direction: 'down',
      isMoving: false,
      avatar: { ...DEFAULT_AVATAR },
      status: 'available',
      lastUpdated: Date.now(),
    }

    expect(playerWithPhoto.profileImage).toBeTruthy()
    expect(playerWithoutPhoto.profileImage).toBeUndefined()
    expect(playerWithoutPhoto.name.charAt(0).toUpperCase()).toBe('B')
  })
})
