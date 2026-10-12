import { create } from 'zustand'
import {
  ZoneJamSession,
  SharedSpotifyTrack,
  SpotifyDjState,
  parseSpotifyUrl,
  toSpotifyDeepLink,
  toSpotifyWebUrl,
} from '../types/spotifyJam'
import { useGameStore } from './useGameStore'
import { PeerManager } from '../p2p/PeerManager'

interface SpotifyJamStore {
  jamsByZone: Record<string, ZoneJamSession>
  djStateByZone: Record<string, SpotifyDjState>
  sharedTracksByZone: Record<string, SharedSpotifyTrack[]>
  isModalOpen: boolean
  activeZoneIdForModal: string | null
  isSideDisplayMinimized: boolean
  volume: number
  isMuted: boolean
  isDjModeActive: boolean

  setModalOpen: (open: boolean, zoneId?: string | null) => void
  toggleModal: (zoneId?: string | null) => void
  toggleSideDisplayMinimized: () => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  startJamInZone: (zoneId: string, zoneName: string, rawUrl: string) => void
  stopJamInZone: (zoneId: string, broadcast?: boolean) => void
  syncZoneJamFromPeer: (zoneId: string, session: ZoneJamSession | null) => void
  shareTrackInZone: (zoneId: string, trackUrlOrQuery: string, title?: string, artist?: string) => void
  removeSharedTrack: (zoneId: string, trackId: string) => void
  syncTrackShareFromPeer: (zoneId: string, track: SharedSpotifyTrack) => void
  setDjStateInZone: (zoneId: string, djState: SpotifyDjState | null, broadcast?: boolean) => void
  syncDjStateFromPeer: (zoneId: string, djState: SpotifyDjState | null) => void
  setIsDjModeActive: (active: boolean) => void
  clearAllJams: () => void
}

export const useSpotifyJamStore = create<SpotifyJamStore>((set, get) => ({
  jamsByZone: {},
  djStateByZone: {},
  sharedTracksByZone: {},
  isModalOpen: false,
  activeZoneIdForModal: null,
  isSideDisplayMinimized: false,
  volume: 80,
  isMuted: false,
  isDjModeActive: false,

  setModalOpen: (open, zoneId = null) => {
    set({
      isModalOpen: open,
      activeZoneIdForModal: zoneId ?? get().activeZoneIdForModal,
    })
  },

  toggleModal: (zoneId = null) => {
    const nextOpen = !get().isModalOpen
    set({
      isModalOpen: nextOpen,
      activeZoneIdForModal: zoneId ?? get().activeZoneIdForModal,
    })
  },

  toggleSideDisplayMinimized: () => {
    set((state) => ({ isSideDisplayMinimized: !state.isSideDisplayMinimized }))
  },

  setVolume: (volume: number) => {
    set({ volume: Math.max(0, Math.min(200, volume)), isMuted: false })
  },

  toggleMute: () => {
    set((state) => ({ isMuted: !state.isMuted }))
  },

  startJamInZone: (zoneId, zoneName, rawUrl) => {
    if (!zoneId) return

    const parsed = parseSpotifyUrl(rawUrl)
    const local = useGameStore.getState().localPlayer

    const session: ZoneJamSession = {
      zoneId,
      zoneName,
      jamUrl: rawUrl.trim(),
      embedUrl: parsed.embedUrl,
      isJamLink: parsed.isJam,
      startedBy: local.name || 'Participante',
      startedAt: Date.now(),
      isActive: true,
    }

    set((state) => ({
      jamsByZone: {
        ...state.jamsByZone,
        [zoneId]: session,
      },
      isModalOpen: false,
    }))

    // Broadcast sync to peers in the room
    try {
      const pm = PeerManager.getInstance()
      const senderId = pm.getPeerId() || local.id
      pm.broadcast({
        type: 'SPOTIFY_JAM_SYNC',
        senderId,
        payload: { zoneId, session },
        timestamp: Date.now(),
      })
    } catch (e) {
      console.warn('[SpotifyJamStore] Broadcast error:', e)
    }
  },

  stopJamInZone: (zoneId, broadcast = true) => {
    if (!zoneId) return

    set((state) => {
      const updated = { ...state.jamsByZone }
      delete updated[zoneId]
      return { jamsByZone: updated }
    })

    if (broadcast) {
      try {
        const pm = PeerManager.getInstance()
        const local = useGameStore.getState().localPlayer
        const senderId = pm.getPeerId() || local.id
        pm.broadcast({
          type: 'SPOTIFY_JAM_SYNC',
          senderId,
          payload: { zoneId, session: null },
          timestamp: Date.now(),
        })
      } catch (e) {
        console.warn('[SpotifyJamStore] Broadcast stop error:', e)
      }
    }
  },

  syncZoneJamFromPeer: (zoneId, session) => {
    if (!zoneId) return

    set((state) => {
      const updated = { ...state.jamsByZone }
      if (session && session.isActive) {
        updated[zoneId] = session
      } else {
        delete updated[zoneId]
      }
      return { jamsByZone: updated }
    })
  },

  shareTrackInZone: (zoneId, trackUrlOrQuery, title, artist) => {
    if (!zoneId || !trackUrlOrQuery) return

    const local = useGameStore.getState().localPlayer
    const deepLink = toSpotifyDeepLink(trackUrlOrQuery)
    const webUrl = toSpotifyWebUrl(trackUrlOrQuery)

    let trackTitle = title || trackUrlOrQuery
    let trackArtist = artist || ''
    if (!title && trackUrlOrQuery.includes(' - ')) {
      const parts = trackUrlOrQuery.split(' - ')
      trackArtist = parts[0].trim()
      trackTitle = parts.slice(1).join(' - ').trim()
    }

    const sharedTrack: SharedSpotifyTrack = {
      id: 'track-' + Math.random().toString(36).substring(2, 9),
      title: trackTitle,
      artist: trackArtist,
      url: webUrl,
      uri: deepLink,
      sharedBy: local.name || 'Participante',
      sharedAt: Date.now(),
      zoneId,
    }

    set((state) => {
      const current = state.sharedTracksByZone[zoneId] || []
      return {
        sharedTracksByZone: {
          ...state.sharedTracksByZone,
          [zoneId]: [sharedTrack, ...current].slice(0, 50),
        },
      }
    })

    try {
      const pm = PeerManager.getInstance()
      const senderId = pm.getPeerId() || local.id
      pm.broadcast({
        type: 'SPOTIFY_TRACK_SHARE',
        senderId,
        payload: { zoneId, track: sharedTrack },
        timestamp: Date.now(),
      })
    } catch (e) {
      console.warn('[SpotifyJamStore] Broadcast track error:', e)
    }
  },

  removeSharedTrack: (zoneId, trackId) => {
    if (!zoneId) return
    set((state) => {
      const current = state.sharedTracksByZone[zoneId] || []
      return {
        sharedTracksByZone: {
          ...state.sharedTracksByZone,
          [zoneId]: current.filter((t) => t.id !== trackId),
        },
      }
    })
  },

  syncTrackShareFromPeer: (zoneId, track) => {
    if (!zoneId || !track) return
    set((state) => {
      const current = state.sharedTracksByZone[zoneId] || []
      if (current.some((t) => t.id === track.id)) return state
      return {
        sharedTracksByZone: {
          ...state.sharedTracksByZone,
          [zoneId]: [track, ...current].slice(0, 50),
        },
      }
    })
  },

  setDjStateInZone: (zoneId, djState, broadcast = true) => {
    if (!zoneId) return

    set((state) => {
      const updated = { ...state.djStateByZone }
      if (djState && djState.isDjActive) {
        updated[zoneId] = djState
      } else {
        delete updated[zoneId]
      }
      return { djStateByZone: updated }
    })

    if (broadcast) {
      try {
        const pm = PeerManager.getInstance()
        const local = useGameStore.getState().localPlayer
        const senderId = pm.getPeerId() || local.id
        pm.broadcast({
          type: 'SPOTIFY_DJ_STATUS',
          senderId,
          payload: { zoneId, djState },
          timestamp: Date.now(),
        })
      } catch (e) {
        console.warn('[SpotifyJamStore] Broadcast DJ status error:', e)
      }
    }
  },

  syncDjStateFromPeer: (zoneId, djState) => {
    if (!zoneId) return
    set((state) => {
      const updated = { ...state.djStateByZone }
      if (djState && djState.isDjActive) {
        updated[zoneId] = djState
      } else {
        delete updated[zoneId]
      }
      return { djStateByZone: updated }
    })
  },

  setIsDjModeActive: (active) => {
    set({ isDjModeActive: active })
  },

  clearAllJams: () => {
    set({
      jamsByZone: {},
      djStateByZone: {},
      sharedTracksByZone: {},
      isModalOpen: false,
      activeZoneIdForModal: null,
      isDjModeActive: false,
    })
  },
}))
