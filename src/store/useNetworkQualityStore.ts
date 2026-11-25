import { create } from 'zustand'

export type NetworkRating = 'excellent' | 'good' | 'poor' | 'bad'
export type ConnectionRoute = 'direct' | 'super-peer' | 'turn' | 'unknown'
export type TurnProvider = 'cloudflare' | 'metered' | 'unknown'
export type TransportPreference = 'auto' | 'direct' | 'turn'

export interface NetworkQuality {
  pingMs: number
  lossPct: number
  jitterMs: number
  rating: NetworkRating
  lastUpdated: number
  route?: ConnectionRoute
  turnProvider?: TurnProvider
  protocol?: string
  transportPreference?: TransportPreference
  isSwitchingTransport?: boolean
}

interface NetworkQualityStore {
  localQuality: NetworkQuality
  peerQualities: Record<string, NetworkQuality>
  setLocalQuality: (quality: Partial<NetworkQuality>) => void
  setPeerQuality: (peerId: string, quality: Partial<NetworkQuality>) => void
  removePeerQuality: (peerId: string) => void
  clearAll: () => void
}

export function calculateRating(pingMs: number, lossPct: number, jitterMs: number = 0): NetworkRating {
  if (lossPct >= 15 || pingMs >= 320 || jitterMs >= 100) return 'bad'
  if (lossPct >= 5 || pingMs >= 160 || jitterMs >= 50) return 'poor'
  if (lossPct >= 2 || pingMs >= 90 || jitterMs >= 30) return 'good'
  return 'excellent'
}

export const DEFAULT_NETWORK_QUALITY: NetworkQuality = Object.freeze({
  pingMs: 0,
  lossPct: 0,
  jitterMs: 0,
  rating: 'excellent',
  lastUpdated: 0,
})

export function getUserNetworkQuality(
  state: { localQuality: NetworkQuality; peerQualities: Record<string, NetworkQuality> },
  peerId?: string,
  isLocal?: boolean
): NetworkQuality {
  if (isLocal) return state.localQuality
  if (!peerId) return DEFAULT_NETWORK_QUALITY
  return state.peerQualities[peerId] || DEFAULT_NETWORK_QUALITY
}

export function useUserNetworkQuality(peerId?: string, isLocal?: boolean): NetworkQuality {
  const quality = useNetworkQualityStore((s) => {
    if (isLocal) return s.localQuality
    if (!peerId) return undefined
    return s.peerQualities[peerId]
  })
  return quality || DEFAULT_NETWORK_QUALITY
}

const DEFAULT_QUALITY: NetworkQuality = { ...DEFAULT_NETWORK_QUALITY }

export const useNetworkQualityStore = create<NetworkQualityStore>((set) => ({
  localQuality: { ...DEFAULT_QUALITY },
  peerQualities: {},

  setLocalQuality: (data) =>
    set((state) => {
      const merged = { ...state.localQuality, ...data, lastUpdated: Date.now() }
      merged.rating = calculateRating(merged.pingMs, merged.lossPct, merged.jitterMs)
      return { localQuality: merged }
    }),

  setPeerQuality: (peerId, data) =>
    set((state) => {
      const prev = state.peerQualities[peerId] || { ...DEFAULT_QUALITY }
      const merged = { ...prev, ...data, lastUpdated: Date.now() }
      merged.rating = calculateRating(merged.pingMs, merged.lossPct, merged.jitterMs)
      return {
        peerQualities: {
          ...state.peerQualities,
          [peerId]: merged,
        },
      }
    }),

  removePeerQuality: (peerId) =>
    set((state) => {
      const next = { ...state.peerQualities }
      delete next[peerId]
      return { peerQualities: next }
    }),

  clearAll: () => set({ peerQualities: {}, localQuality: { ...DEFAULT_QUALITY } }),
}))
