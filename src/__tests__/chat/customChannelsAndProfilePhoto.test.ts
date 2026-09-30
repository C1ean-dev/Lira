import { describe, it, expect, beforeEach } from 'vitest'

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

;(globalThis as any).localStorage = localStorageMock
if (!(globalThis as any).window) {
  ;(globalThis as any).window = { localStorage: localStorageMock }
} else {
  ;(globalThis as any).window.localStorage = localStorageMock
}

import { useChatStore } from '../../store/useChatStore'
import { useGameStore } from '../../store/useGameStore'

describe('Custom Channels & Profile Photo System', () => {
  beforeEach(() => {
    localStorageMock.clear()

    useGameStore.setState({
      localPlayer: {
        id: 'player-test-1',
        name: 'Tester',
        x: 5,
        y: 5,
        direction: 'down',
        isMoving: false,
        profilePhoto: undefined,
        avatar: { skin: '#ffd1a4', hair: '#000', hairStyle: 'short', shirtColor: '#4c6ef5', pantsColor: '#1a1f2c' },
      },
      remotePlayers: {},
    })

    useChatStore.setState({
      channels: [
        { id: 'general', name: 'general', type: 'general', unreadCount: 0 },
        { id: 'social', name: 'social', type: 'social', unreadCount: 0 },
        { id: 'current-zone', name: 'zona-atual', type: 'zone', unreadCount: 0 },
      ],
      messages: [],
      activeChannelId: 'general',
      isChatOpen: false,
    })
  })

  describe('Custom Channels Creation & Management', () => {
    it('creates a custom channel with formatted name and selects it', () => {
      const channel = useChatStore.getState().createChannel('Projetos Dev', 'Canal para discutir projetos')

      expect(channel).toBeDefined()
      expect(channel.name).toBe('projetos-dev')
      expect(channel.type).toBe('custom')
      expect(channel.isCustom).toBe(true)
      expect(channel.description).toBe('Canal para discutir projetos')

      const state = useChatStore.getState()
      expect(state.activeChannelId).toBe(channel.id)
      expect(state.channels.some((c) => c.id === channel.id)).toBe(true)
    })

    it('persists custom channels to localStorage', () => {
      useChatStore.getState().createChannel('Design Team')

      const saved = localStorageMock.getItem('gather_v2_saved_custom_channels')
      expect(saved).toBeTruthy()

      const parsed = JSON.parse(saved!)
      expect(parsed.length).toBe(1)
      expect(parsed[0].name).toBe('design-team')
      expect(parsed[0].isCustom).toBe(true)
    })

    it('does not create duplicate channels with identical name', () => {
      const ch1 = useChatStore.getState().createChannel('random')
      const countBefore = useChatStore.getState().channels.length

      const ch2 = useChatStore.getState().createChannel('random')
      const countAfter = useChatStore.getState().channels.length

      expect(ch1.name).toBe('random')
      expect(countAfter).toBe(countBefore)
    })

    it('removes custom channel and resets activeChannelId to general if deleted', () => {
      const ch = useChatStore.getState().createChannel('to-delete')
      expect(useChatStore.getState().activeChannelId).toBe(ch.id)

      useChatStore.getState().removeChannel(ch.id)

      const state = useChatStore.getState()
      expect(state.channels.some((c) => c.id === ch.id)).toBe(false)
      expect(state.activeChannelId).toBe('general')
    })

    it('adds remote channel received from peer via addChannel', () => {
      useChatStore.getState().addChannel({
        id: 'custom-peer-123',
        name: 'novidades-p2p',
        type: 'custom',
        description: 'Canal criado por um colega',
        unreadCount: 0,
        isCustom: true,
      })

      const state = useChatStore.getState()
      const found = state.channels.find((c) => c.id === 'custom-peer-123')
      expect(found).toBeDefined()
      expect(found?.name).toBe('novidades-p2p')
    })
  })

  describe('Profile Photo Management', () => {
    it('sets and updates profilePhoto on localPlayer and persists to localStorage', () => {
      const mockPhoto = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...'
      useGameStore.getState().setLocalPlayer({
        name: 'Maria Dev',
        profilePhoto: mockPhoto,
      })

      const local = useGameStore.getState().localPlayer
      expect(local.profilePhoto).toBe(mockPhoto)
      expect(local.name).toBe('Maria Dev')

      const saved = localStorageMock.getItem('gather_v2_user_profile')
      expect(saved).toBeTruthy()

      const parsed = JSON.parse(saved!)
      expect(parsed.name).toBe('Maria Dev')
      expect(parsed.profilePhoto).toBe(mockPhoto)
    })

    it('allows clearing profilePhoto and updating display name', () => {
      useGameStore.getState().setLocalPlayer({
        name: 'Novo Nick',
        profilePhoto: undefined,
      })

      const local = useGameStore.getState().localPlayer
      expect(local.name).toBe('Novo Nick')
      expect(local.profilePhoto).toBeUndefined()

      const saved = localStorageMock.getItem('gather_v2_user_profile')
      const parsed = JSON.parse(saved!)
      expect(parsed.name).toBe('Novo Nick')
    })

    it('supports profilePhoto on participant call data for camera off screen', () => {
      const mockPhoto = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...'
      useGameStore.getState().setLocalPlayer({
        profilePhoto: mockPhoto,
      })

      const local = useGameStore.getState().localPlayer
      const participant = {
        id: local.id,
        name: local.name,
        stream: null,
        isCameraOff: true,
        profilePhoto: local.profilePhoto || local.avatar?.profilePhoto,
      }

      expect(participant.profilePhoto).toBe(mockPhoto)
    })
  })
})
