import { create } from 'zustand'
import { z } from 'zod'
import { createStoredState } from './persistedState'
import { AvatarConfig, FriendProfile, Player, PresenceStatus } from '../types/game'
import { UserProfile } from '../types/profile'

const PROFILE_NOTES_STORAGE_KEY = 'lira_profile_private_notes'
const notesPreferences = createStoredState<Record<string, string>>(
  PROFILE_NOTES_STORAGE_KEY,
  z.record(z.string(), z.string()),
  {}
)

export interface ProfileModalTarget {
  userId: string
  peerId?: string
  name: string
  isLocal?: boolean
  profilePicture?: string
  avatar?: AvatarConfig
  profile?: UserProfile
  status?: PresenceStatus | 'offline' | string
  statusText?: string
  statusEmoji?: string
  currentZoneId?: string | null
  roomCode?: string | null
  roomName?: string | null
  isOnline?: boolean
  friendKey?: string
  friendSince?: number
  spotifyActivity?: Player['spotifyActivity']
  isOwner?: boolean
  isHost?: boolean
  role?: Player['role']
}

export type ProfileModalMode = 'view' | 'edit'
export type ProfileEditorSection =
  | 'identity'
  | 'avatar'
  | 'banner'
  | 'nameplate'
  | 'appearance'
  | 'medals'

interface ProfileModalStore {
  isOpen: boolean
  mode: ProfileModalMode
  editorSection: ProfileEditorSection | null
  target: ProfileModalTarget | null
  notes: Record<string, string>
  openProfile: (target: ProfileModalTarget, mode?: ProfileModalMode, section?: ProfileEditorSection | null) => void
  openLocalProfile: (mode?: ProfileModalMode, section?: ProfileEditorSection | null) => void
  closeProfile: () => void
  setMode: (mode: ProfileModalMode, section?: ProfileEditorSection | null) => void
  setEditorSection: (section: ProfileEditorSection | null) => void
  setNote: (userId: string, note: string) => void
}

export const useProfileModalStore = create<ProfileModalStore>((set) => ({
  isOpen: false,
  mode: 'view',
  editorSection: null,
  target: null,
  notes: notesPreferences.getState(),

  openProfile: (target, mode = 'view', section = null) =>
    set({
      isOpen: true,
      target,
      mode: target.isLocal ? mode : 'view',
      editorSection: target.isLocal ? section : null,
    }),

  openLocalProfile: (mode = 'view', section = null) =>
    set({
      isOpen: true,
      target: { userId: '__local__', name: 'Você', isLocal: true },
      mode,
      editorSection: section,
    }),

  closeProfile: () => set({ isOpen: false, editorSection: null }),

  setMode: (mode, section) =>
    set((state) => ({
      mode: state.target?.isLocal ? mode : 'view',
      editorSection: section !== undefined ? section : state.editorSection,
    })),

  setEditorSection: (editorSection) => set({ editorSection }),

  setNote: (userId, note) =>
    set((state) => {
      const trimmed = note.slice(0, 300)
      const next = { ...state.notes }
      if (trimmed.trim()) {
        next[userId] = trimmed
      } else {
        delete next[userId]
      }
      notesPreferences.setState(next, true)
      return { notes: next }
    }),
}))

export type ProfileSourcePlayer = Pick<
  Player,
  | 'id'
  | 'gameId'
  | 'name'
  | 'profilePicture'
  | 'avatar'
  | 'profile'
  | 'status'
  | 'statusText'
  | 'statusEmoji'
  | 'currentZoneId'
  | 'spotifyActivity'
  | 'isOwner'
  | 'isHost'
  | 'role'
>

export function buildProfileTargetFromPlayer(player: ProfileSourcePlayer, isLocal = false): ProfileModalTarget {
  return {
    userId: player.gameId || player.id,
    peerId: player.id,
    name: player.name,
    isLocal,
    profilePicture: player.profilePicture,
    avatar: player.avatar,
    profile: player.profile,
    status: player.status,
    statusText: player.statusText,
    statusEmoji: player.statusEmoji,
    currentZoneId: player.currentZoneId,
    isOnline: true,
    spotifyActivity: player.spotifyActivity,
    isOwner: player.isOwner,
    isHost: player.isHost,
    role: player.role,
  }
}

export function buildProfileTargetFromFriend(
  friend: FriendProfile & { isOnline?: boolean; roomCode?: string | null; roomName?: string | null }
): ProfileModalTarget {
  return {
    userId: friend.actualUserId || friend.gameId || friend.id,
    name: friend.name,
    isLocal: false,
    profilePicture: friend.profilePicture,
    avatar: friend.avatar,
    profile: friend.profile,
    status: friend.isOnline ? friend.status || 'available' : 'offline',
    statusText: friend.statusText,
    roomCode: friend.roomCode ?? friend.lastRoomCode,
    roomName: friend.roomName ?? friend.lastRoomName,
    isOnline: friend.isOnline,
    friendKey: friend.id,
    friendSince: friend.friendSince,
  }
}
