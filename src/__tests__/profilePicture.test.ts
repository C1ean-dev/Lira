import { describe, it, expect, beforeEach } from 'vitest'
import { renderAvatarSnapshot, getPlayerAvatarSrc, resizeImageFile, cropImageToSquare } from '../utils/avatarUtils'
import { useGameStore } from '../store/useGameStore'
import { DEFAULT_AVATAR } from '../engine/Constants'
import { CATEGORIES } from '../components/avatar-customizer/CategoryTabs'

describe('Profile Picture & Avatar Fallback System', () => {
  beforeEach(() => {
    // Reset localPlayer
    useGameStore.setState({
      localPlayer: {
        id: 'local-test',
        name: 'Tester',
        profilePicture: '',
        avatar: { ...DEFAULT_AVATAR },
        x: 0,
        y: 0,
        direction: 'down',
        isMoving: false,
        status: 'available',
        lastUpdated: Date.now(),
      },
      friends: [],
      friendProfiles: {},
      remotePlayers: {},
    })
  })

  it('includes "profile" tab in CategoryTabs with label "Config. de Perfil"', () => {
    const profileCat = CATEGORIES.find((c) => c.id === 'profile')
    expect(profileCat).toBeDefined()
    expect(profileCat?.label).toBe('Config. de Perfil')
  })

  it('getPlayerAvatarSrc falls back to rendered character snapshot when profilePicture is absent', () => {
    const playerWithoutPic = {
      name: 'Player 1',
      avatar: { ...DEFAULT_AVATAR },
      profilePicture: '',
    }

    const src = getPlayerAvatarSrc(playerWithoutPic)
    expect(src).toBeDefined()
    expect(typeof src).toBe('string')
    expect(src.startsWith('data:image/')).toBe(true)
  })

  it('getPlayerAvatarSrc returns custom profilePicture when set', () => {
    const customPic = 'data:image/png;base64,CUSTOM_BASE64_IMAGE_DATA'
    const playerWithPic = {
      name: 'Player 2',
      avatar: { ...DEFAULT_AVATAR },
      profilePicture: customPic,
    }

    const src = getPlayerAvatarSrc(playerWithPic)
    expect(src).toBe(customPic)
  })

  it('useGameStore updates and persists localPlayer profilePicture', () => {
    const customPic = 'data:image/jpeg;base64,TEST_PHOTO_123'
    useGameStore.getState().setLocalPlayer({
      profilePicture: customPic,
      name: 'Custom User',
    })

    const updated = useGameStore.getState().localPlayer
    expect(updated.profilePicture).toBe(customPic)
    expect(updated.name).toBe('Custom User')
  })

  it('setRemotePlayer synchronizes remote player profilePicture into friendProfiles', () => {
    // Setup existing friend profile
    const friendId = 'peer-friend-1'
    useGameStore.setState({
      friends: [friendId],
      friendProfiles: {
        [friendId]: {
          id: friendId,
          name: 'Amigo 1',
          avatar: { ...DEFAULT_AVATAR },
          profilePicture: '',
        },
      },
    })

    // Remote player joins or updates with custom profile picture
    const customPic = 'data:image/webp;base64,FRIEND_CUSTOM_AVATAR'
    useGameStore.getState().setRemotePlayer({
      id: friendId,
      name: 'Amigo 1 Updated',
      profilePicture: customPic,
      avatar: { ...DEFAULT_AVATAR },
      x: 5,
      y: 5,
      direction: 'down',
      isMoving: false,
      status: 'available',
      lastUpdated: Date.now(),
    })

    // Check remotePlayers
    const remote = useGameStore.getState().remotePlayers[friendId]
    expect(remote.profilePicture).toBe(customPic)

    // Check friendProfiles sync
    const friendProfile = useGameStore.getState().friendProfiles[friendId]
    expect(friendProfile).toBeDefined()
    expect(friendProfile.profilePicture).toBe(customPic)
    expect(friendProfile.name).toBe('Amigo 1 Updated')
  })

  it('cropImageToSquare returns cropped image string', () => {
    const mockSource = {} as any
    const cropped = cropImageToSquare(mockSource, 0, 0, 100, 256)
    expect(cropped).toBeDefined()
    expect(typeof cropped).toBe('string')
  })
})

