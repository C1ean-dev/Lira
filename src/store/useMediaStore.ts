import { create } from 'zustand'
import { SensitivityMode, AudioProcessorMode } from '../types/audio'
import { useGameStore } from './useGameStore'
import {
  isHardwareAccelerationEnabled as getHwCodecEnabled,
  setHardwareAccelerationEnabled as setHwCodecEnabled,
} from '../media/hardwareCodec'

export interface MicCalibration {
  noiseFloorDb: number
  peakRmsDb: number
  snrDb: number
  recommendedMode: AudioProcessorMode
  recommendedSensitivity: number
  calibratedAt: number // timestamp ms
}

interface MediaStore {
  // Local Streams
  localStream: MediaStream | null
  localScreenStream: MediaStream | null
  setLocalStream: (stream: MediaStream | null) => void
  setLocalScreenStream: (stream: MediaStream | null) => void

  // Toggles
  isMuted: boolean
  isCameraOff: boolean
  isScreenSharing: boolean
  isNoiseSuppressionEnabled: boolean
  isGridCallOpen: boolean
  isSettingsModalOpen: boolean
  isDeafened: boolean // Mutes all incoming call sound for self
  silencedUsers: Record<string, boolean> // Users mutually silenced by self
  mutuallySilencedBy: Record<string, boolean> // Users who have silenced self
  adminNotice: { message: string; type: 'mute' | 'deafen'; timestamp: number } | null

  toggleMute: () => void
  toggleCamera: () => void
  toggleDeafen: () => void
  setMuted: (muted: boolean) => void
  setCameraOff: (cameraOff: boolean) => void
  setDeafened: (deafened: boolean) => void
  setScreenSharing: (sharing: boolean) => void
  toggleNoiseSuppression: () => void
  toggleGridCall: () => void
  setGridCallOpen: (open: boolean) => void
  setSettingsModalOpen: (open: boolean) => void
  toggleSilenceUser: (userId: string, userName?: string) => boolean
  isUserSilenced: (userId: string, userName?: string) => boolean
  setMutuallySilencedBy: (peerId: string, silenced: boolean) => void
  isUserLocallyMuted: (userId: string, userName?: string) => boolean
  toggleLocalMuteUser: (userId: string, userName?: string) => boolean
  setAdminNotice: (notice: { message: string; type: 'mute' | 'deafen' } | null) => void

  // Audio & Video Device & Control Settings
  selectedAudioInput: string
  selectedAudioOutput: string
  selectedVideoInput: string
  inputVolume: number // 0 to 200 (percentage, 100 is unity)
  outputVolume: number // 0 to 100 (percentage)
  sensitivityMode: SensitivityMode
  manualSensitivityThreshold: number // 0 to 100
  echoCancellation: boolean
  autoGainControl: boolean
  audioProcessorMode: AudioProcessorMode
  /**
   * When true, audioProcessorMode reflects the user's *manual* choice and
   * must not be auto-overridden by a stored calibration. When false, the
   * MediaManager is allowed to apply the calibrated recommendation as
   * the default engine on startup.
   */
  hasUserChosenProcessorMode: boolean
  screenShareAudioVolume: number // 0 to 100 (percentage, default 100)
  duckingEnabled: boolean // Auto-reduce screen sound when user talks
  screenShareIsolateCallAudio: boolean // Isolate call audio: prevent remote peers' voices from leaking into screen share
  screenShareTargetTitle: string | null // Name of target window/app being shared
  screenShareAudioMode: 'app_only' | 'app_and_mic' // 'app_only' = pure app sound, 'app_and_mic' = app + user voice

  setSelectedAudioInput: (deviceId: string) => void
  setSelectedAudioOutput: (deviceId: string) => void
  setSelectedVideoInput: (deviceId: string) => void
  setInputVolume: (vol: number) => void
  setOutputVolume: (vol: number) => void
  setSensitivityMode: (mode: SensitivityMode) => void
  setManualSensitivityThreshold: (val: number) => void
  setEchoCancellation: (enabled: boolean) => void
  setAutoGainControl: (enabled: boolean) => void
  setAudioProcessorMode: (mode: AudioProcessorMode) => void
  setScreenShareAudioVolume: (vol: number) => void
  setDuckingEnabled: (enabled: boolean) => void
  setScreenShareIsolateCallAudio: (enabled: boolean) => void
  setScreenShareTargetTitle: (title: string | null) => void
  setScreenShareAudioMode: (mode: 'app_only' | 'app_and_mic') => void

  // WebRTC GPU Hardware Acceleration
  isHardwareAccelerationEnabled: boolean
  setHardwareAccelerationEnabled: (enabled: boolean) => void
  toggleHardwareAcceleration: () => void

  // RNNoise engine lifecycle (surfaced so the UI can show ground truth —
  // previously a failed init was silent and the user got raw mic audio).
  rnnoiseStatus: 'idle' | 'loading' | 'ready' | 'fallback' | 'error'
  rnnoiseError: string | null
  setRnnoiseStatus: (status: 'idle' | 'loading' | 'ready' | 'fallback' | 'error', error?: string | null) => void
  // Last init stage reached (blob → addModule → node → waiting ready).
  // Narrows the next failure to an exact step.
  rnnoiseStage: string
  setRnnoiseStage: (stage: string) => void

  // Mic calibration per deviceId
  micCalibrations: Record<string, MicCalibration>
  isCalibrating: boolean
  setMicCalibration: (deviceId: string, cal: MicCalibration) => void
  clearMicCalibration: (deviceId: string) => void
  setIsCalibrating: (calibrating: boolean) => void

  // Audio Level meter & Gate state (for visual speaker aura & settings VU meter)
  localAudioLevel: number
  isGateOpen: boolean
  isTestingMic: boolean
  autoThresholdPercent: number
  setLocalAudioLevel: (level: number, gateOpen?: boolean, autoThresholdPercent?: number) => void
  setIsTestingMic: (testing: boolean) => void

  // Remote Streams map: peerId -> MediaStream
  peerStreams: Record<string, MediaStream>
  peerScreenStreams: Record<string, MediaStream>
  participantVolumes: Record<string, number> // peerId or streamId -> 0 to 100
  setParticipantVolume: (id: string, volume: number) => void
  getEffectiveParticipantVolume: (id: string) => number
  liveStreamVolume: number // shared persisted volume for live / screen share
  setLiveStreamVolume: (volume: number) => void
  liveBufferMode: 'dynamic' | 'manual'
  liveBufferDelay: number // in ms, legacy single-number mirror of the adaptive VIDEO buffer
  dynamicBufferMetrics: {
    calculatedMs: number
    jitterMs: number
    frameDropRate: number
    statusText: string
    /** Adaptive AUDIO buffer in ms (independent from video). */
    audioMs?: number
  }
  setLiveBufferMode: (mode: 'dynamic' | 'manual') => void
  setLiveBufferDelay: (ms: number) => void
  /**
   * Written by DynamicBufferManager every evaluation tick. Unlike
   * setLiveBufferDelay it does NOT dispatch 'gather:live-buffer-changed'
   * (the manager already applied both values straight to the peer
   * connections) — dispatching would make PeerManager re-apply a
   * video-only value and clobber the adaptive audio number.
   */
  setAdaptiveBuffers: (audioMs: number, videoMs: number, jitterMs: number, lossPct: number) => void
  setDynamicBufferMetrics: (
    metrics: Partial<{ calculatedMs: number; jitterMs: number; frameDropRate: number; statusText: string }>
  ) => void
  setPeerStream: (peerId: string, stream: MediaStream) => void
  removePeerStream: (peerId: string) => void
  setPeerScreenStream: (peerId: string, stream: MediaStream) => void
  removePeerScreenStream: (peerId: string) => void
  clearAllPeerStreams: () => void
  stopAllMedia: () => void
}

const STORAGE_KEY = 'gather_v2_audio_settings'

const loadSavedAudioSettings = () => {
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        return JSON.parse(raw)
      }
    }
  } catch (e) {
    // Ignore in non-browser env
  }
  return null
}

const saved = loadSavedAudioSettings() || {}

if (saved && saved.isHardwareAccelerationEnabled !== undefined) {
  try {
    setHwCodecEnabled(Boolean(saved.isHardwareAccelerationEnabled))
  } catch {}
}

const saveAudioSettings = (settings: Record<string, any>) => {
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      const current = loadSavedAudioSettings() || {}
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...settings }))
    }
  } catch (e) {
    // Ignore in non-browser env
  }
}

// Trailing-debounce for localStorage persistence. Volume sliders fire
// setState per pixel while dragging — a synchronous read+parse+stringify+write
// per tick janks the drag. State updates stay immediate; only the disk write
// is debounced.
let persistTimer: ReturnType<typeof setTimeout> | null = null
let pendingPersist: Record<string, any> = {}
const saveAudioSettingsDebounced = (settings: Record<string, any>, delayMs: number = 300) => {
  pendingPersist = { ...pendingPersist, ...settings }
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    const batch = pendingPersist
    pendingPersist = {}
    saveAudioSettings(batch)
  }, delayMs)
}

const isValidMode = (m: any): m is AudioProcessorMode =>
  m === 'classic' || m === 'soft' || m === 'rnnoise'

export const useMediaStore = create<MediaStore>((set, get) => ({
  localStream: null,
  localScreenStream: null,
  setLocalStream: (localStream) => set({ localStream }),
  setLocalScreenStream: (localScreenStream) => set({ localScreenStream }),

  isMuted: true,
  isCameraOff: true,
  isScreenSharing: false,
  isNoiseSuppressionEnabled: saved.isNoiseSuppressionEnabled !== undefined ? saved.isNoiseSuppressionEnabled : true,
  isGridCallOpen: false,
  isSettingsModalOpen: false,

  // Device & Volume Config
  selectedAudioInput: saved.selectedAudioInput || 'default',
  selectedAudioOutput: saved.selectedAudioOutput || 'default',
  selectedVideoInput: saved.selectedVideoInput || 'default',
  inputVolume: saved.inputVolume !== undefined ? saved.inputVolume : 100,
  outputVolume: saved.outputVolume !== undefined ? saved.outputVolume : 100,
  sensitivityMode: saved.sensitivityMode || 'auto',
  manualSensitivityThreshold: saved.manualSensitivityThreshold !== undefined ? saved.manualSensitivityThreshold : 20,
  echoCancellation: saved.echoCancellation !== undefined ? saved.echoCancellation : true,
  autoGainControl: saved.autoGainControl !== undefined ? saved.autoGainControl : true,
  audioProcessorMode: isValidMode(saved.audioProcessorMode) ? saved.audioProcessorMode : 'rnnoise',
  // Default false: on first launch MediaManager is allowed to apply the
  // calibrated recommendation (if any) to pick the initial engine.
  hasUserChosenProcessorMode: saved.hasUserChosenProcessorMode === true,
  screenShareAudioVolume: saved.screenShareAudioVolume !== undefined ? saved.screenShareAudioVolume : 100,
  duckingEnabled: saved.duckingEnabled !== undefined ? saved.duckingEnabled : true,
  screenShareIsolateCallAudio: saved.screenShareIsolateCallAudio !== undefined ? saved.screenShareIsolateCallAudio : true,
  screenShareTargetTitle: null,
  screenShareAudioMode: saved.screenShareAudioMode === 'app_and_mic' ? 'app_and_mic' : 'app_only',
  isHardwareAccelerationEnabled:
    saved.isHardwareAccelerationEnabled !== undefined
      ? Boolean(saved.isHardwareAccelerationEnabled)
      : getHwCodecEnabled(),

  // Per-device calibrations, persisted as a flat map.
  micCalibrations: (saved.micCalibrations as Record<string, MicCalibration>) || {},
  isCalibrating: false,

  rnnoiseStatus: 'idle',
  rnnoiseError: null,
  setRnnoiseStatus: (rnnoiseStatus, rnnoiseError = null) => {
    const prev = get()
    if (prev.rnnoiseStatus === rnnoiseStatus && prev.rnnoiseError === rnnoiseError) return
    set({ rnnoiseStatus, rnnoiseError })
  },
  rnnoiseStage: '',
  setRnnoiseStage: (rnnoiseStage) => {
    if (get().rnnoiseStage === rnnoiseStage) return
    set({ rnnoiseStage })
  },

  setSelectedAudioInput: (selectedAudioInput) => {
    saveAudioSettings({ selectedAudioInput })
    set({ selectedAudioInput })
  },
  setSelectedAudioOutput: (selectedAudioOutput) => {
    saveAudioSettings({ selectedAudioOutput })
    set({ selectedAudioOutput })
  },
  setSelectedVideoInput: (selectedVideoInput) => {
    if (get().selectedVideoInput === selectedVideoInput) return
    saveAudioSettings({ selectedVideoInput })
    set({ selectedVideoInput })
    try {
      import('../media/MediaManager').then(({ MediaManager }) => {
        MediaManager.getInstance().changeVideoInput(selectedVideoInput)
      }).catch(() => {})
    } catch {}
  },
  setInputVolume: (inputVolume) => {
    saveAudioSettingsDebounced({ inputVolume })
    set({ inputVolume })
  },
  setOutputVolume: (outputVolume) => {
    saveAudioSettingsDebounced({ outputVolume })
    set({ outputVolume })
  },
  setSensitivityMode: (sensitivityMode) => {
    saveAudioSettings({ sensitivityMode })
    set({ sensitivityMode })
  },
  setManualSensitivityThreshold: (manualSensitivityThreshold) => {
    saveAudioSettings({ manualSensitivityThreshold })
    set({ manualSensitivityThreshold })
  },
  setEchoCancellation: (echoCancellation) => {
    saveAudioSettings({ echoCancellation })
    set({ echoCancellation })
  },
  setAutoGainControl: (autoGainControl) => {
    saveAudioSettings({ autoGainControl })
    set({ autoGainControl })
  },
  setAudioProcessorMode: (audioProcessorMode) => {
    saveAudioSettings({
      audioProcessorMode,
      hasUserChosenProcessorMode: true, // any user click is a manual override
    })
    set({ audioProcessorMode, hasUserChosenProcessorMode: true })
  },
  setScreenShareAudioVolume: (screenShareAudioVolume) => {
    saveAudioSettingsDebounced({ screenShareAudioVolume })
    set({ screenShareAudioVolume })
  },
  setDuckingEnabled: (duckingEnabled) => {
    saveAudioSettings({ duckingEnabled })
    set({ duckingEnabled })
  },
  setScreenShareIsolateCallAudio: (screenShareIsolateCallAudio) => {
    saveAudioSettings({ screenShareIsolateCallAudio })
    set({ screenShareIsolateCallAudio })
  },
  setScreenShareTargetTitle: (screenShareTargetTitle) => set({ screenShareTargetTitle }),
  setScreenShareAudioMode: (screenShareAudioMode) => {
    saveAudioSettings({ screenShareAudioMode })
    set({ screenShareAudioMode })
  },
  setHardwareAccelerationEnabled: (enabled: boolean) => {
    saveAudioSettings({ isHardwareAccelerationEnabled: enabled })
    setHwCodecEnabled(enabled)
    set({ isHardwareAccelerationEnabled: enabled })
  },
  toggleHardwareAcceleration: () => {
    const next = !get().isHardwareAccelerationEnabled
    saveAudioSettings({ isHardwareAccelerationEnabled: next })
    setHwCodecEnabled(next)
    set({ isHardwareAccelerationEnabled: next })
  },

  setMicCalibration: (deviceId, cal) => {
    const next = { ...get().micCalibrations, [deviceId]: cal }
    saveAudioSettings({ micCalibrations: next })
    set({ micCalibrations: next })
  },
  clearMicCalibration: (deviceId) => {
    const next = { ...get().micCalibrations }
    delete next[deviceId]
    saveAudioSettings({ micCalibrations: next })
    set({ micCalibrations: next })
  },
  setIsCalibrating: (isCalibrating) => set({ isCalibrating }),

  toggleMute: () => {
    const nextMute = !get().isMuted
    const { localStream } = get()
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !nextMute
      })
    }
    set({ isMuted: nextMute })
    useGameStore.getState().setLocalPlayer({
      isMuted: nextMute,
      isMutedByAdmin: false,
    })
    try {
      import('../media/MediaManager').then(({ MediaManager }) => {
        MediaManager.getInstance().syncMuteState(nextMute, false)
      }).catch(() => {})
    } catch {}
  },

  setMuted: (isMuted) => {
    const { localStream } = get()
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted
      })
    }
    set({ isMuted })
    useGameStore.getState().setLocalPlayer({
      isMuted,
      isMutedByAdmin: false,
    })
    try {
      import('../media/MediaManager').then(({ MediaManager }) => {
        MediaManager.getInstance().syncMuteState(isMuted, false)
      }).catch(() => {})
    } catch {}
  },

  toggleCamera: () => {
    const nextCam = !get().isCameraOff
    set({ isCameraOff: nextCam })
    try {
      import('../media/MediaManager').then(({ MediaManager }) => {
        MediaManager.getInstance().syncCameraState(nextCam)
      }).catch(() => {})
    } catch {}
  },

  setCameraOff: (isCameraOff) => {
    if (get().isCameraOff === isCameraOff) return
    set({ isCameraOff })
    try {
      import('../media/MediaManager').then(({ MediaManager }) => {
        MediaManager.getInstance().syncCameraState(isCameraOff)
      }).catch(() => {})
    } catch {}
  },

  setScreenSharing: (sharing) => set({ isScreenSharing: sharing }),

  toggleNoiseSuppression: () => {
    const nextState = !get().isNoiseSuppressionEnabled
    saveAudioSettings({ isNoiseSuppressionEnabled: nextState })
    set({ isNoiseSuppressionEnabled: nextState })
    try {
      import('../media/MediaManager').then(({ MediaManager }) => {
        MediaManager.getInstance().updateNoiseSuppression(nextState)
      }).catch(() => {})
    } catch {}
  },

  toggleGridCall: () => set((state) => ({ isGridCallOpen: !state.isGridCallOpen })),
  setGridCallOpen: (open) => set({ isGridCallOpen: open }),
  setSettingsModalOpen: (isSettingsModalOpen) => set({ isSettingsModalOpen }),

  isDeafened: false,
  toggleDeafen: () => {
    const next = !get().isDeafened
    set({ isDeafened: next })
    useGameStore.getState().setLocalPlayer({ isDeafened: next })
    try {
      import('../p2p/PeerManager').then(({ PeerManager }) => {
        PeerManager.getInstance().sendPlayerUpdate({ isDeafened: next })
      }).catch(() => {})
    } catch {}
  },
  setDeafened: (isDeafened) => {
    set({ isDeafened })
    useGameStore.getState().setLocalPlayer({ isDeafened })
    try {
      import('../p2p/PeerManager').then(({ PeerManager }) => {
        PeerManager.getInstance().sendPlayerUpdate({ isDeafened })
      }).catch(() => {})
    } catch {}
  },

  silencedUsers: {},
  mutuallySilencedBy: {},
  toggleSilenceUser: (userId, userName) => {
    const current = { ...get().silencedUsers }
    const isCurrentlySilenced = !!current[userId] || (!!userName && !!current[userName])
    const nextState = !isCurrentlySilenced
    if (nextState) {
      current[userId] = true
      if (userName) current[userName] = true
    } else {
      delete current[userId]
      if (userName) delete current[userName]
    }
    set({ silencedUsers: current })
    return nextState
  },
  isUserSilenced: (userId, userName) => {
    const { silencedUsers, mutuallySilencedBy } = get()
    return !!(
      silencedUsers[userId] ||
      (userName && silencedUsers[userName]) ||
      mutuallySilencedBy[userId] ||
      (userName && mutuallySilencedBy[userName])
    )
  },
  setMutuallySilencedBy: (peerId, silenced) => {
    const next = { ...get().mutuallySilencedBy }
    if (silenced) {
      next[peerId] = true
    } else {
      delete next[peerId]
    }
    set({ mutuallySilencedBy: next })
  },
  isUserLocallyMuted: (userId, userName) => {
    const vols = get().participantVolumes || {}
    if (vols[userId] !== undefined) return vols[userId] === 0
    if (userName && userName !== 'Player' && vols[userName] !== undefined) return vols[userName] === 0
    return false
  },
  toggleLocalMuteUser: (userId, userName) => {
    const isMuted = get().isUserLocallyMuted(userId, userName)
    const nextVol = isMuted ? 100 : 0
    get().setParticipantVolume(userId, nextVol)
    if (userName && userName !== 'Player') get().setParticipantVolume(userName, nextVol)
    return !isMuted
  },

  adminNotice: null,
  setAdminNotice: (notice) => set({
    adminNotice: notice ? { ...notice, timestamp: Date.now() } : null
  }),

  peerStreams: {},
  peerScreenStreams: {},
  participantVolumes: saved.participantVolumes || {},
  liveStreamVolume: typeof saved.liveStreamVolume === 'number' ? saved.liveStreamVolume : 100,

  setParticipantVolume: (id, volume) => {
    const clamped = Math.max(0, Math.min(200, Math.round(volume)))
    const current = get().participantVolumes || {}
    if (current[id] === clamped) return
    const next = { ...current, [id]: clamped }
    saveAudioSettingsDebounced({ participantVolumes: next })
    set({ participantVolumes: next })
  },

  setLiveStreamVolume: (volume) => {
    const clamped = Math.max(0, Math.min(200, Math.round(volume)))
    const current = get().participantVolumes || {}
    const nextVolumes = { ...current, live: clamped }
    saveAudioSettingsDebounced({ liveStreamVolume: clamped, participantVolumes: nextVolumes })
    set({ liveStreamVolume: clamped, participantVolumes: nextVolumes })
  },

  getEffectiveParticipantVolume: (id, name?: string) => {
    if (get().isDeafened) return 0
    const silenced = get().silencedUsers || {}
    const mutual = get().mutuallySilencedBy || {}
    if (silenced[id] || (name && silenced[name]) || mutual[id] || (name && mutual[name])) return 0

    const vols = get().participantVolumes || {}
    const pVol = vols[id] !== undefined ? vols[id] : (name && vols[name] !== undefined ? vols[name] : 100)
    const master = (get().outputVolume !== undefined ? get().outputVolume : 100) / 100
    return Math.max(0, Math.min(1, master * (pVol / 100)))
  },

  liveBufferMode: (saved.liveBufferMode as any) || 'dynamic',
  // Default jitter buffer is 1ms. The DynamicBufferManager grows this
  // every 1.5s based on real RTCStats — a clean LAN stays at 1ms,
  // a jittery link grows to whatever's needed. Hard-coding anything
  // higher here was the source of the user-reported voice lag.
  liveBufferDelay: typeof saved.liveBufferDelay === 'number' ? saved.liveBufferDelay : 1,
  dynamicBufferMetrics: {
    calculatedMs: typeof saved.liveBufferDelay === 'number' ? saved.liveBufferDelay : 1,
    jitterMs: 0,
    frameDropRate: 0,
    statusText: 'Calibrando…',
  },

  setLiveBufferMode: (mode) => {
    saveAudioSettings({ liveBufferMode: mode })
    set({ liveBufferMode: mode })
  },

  setLiveBufferDelay: (ms) => {
    // Range now matches DynamicBufferManager: 1ms floor (true minimum),
    // 1500ms ceiling (was 5s — tightened because real WebRTC never needs
    // more than ~1s to absorb 99th-percentile home-network jitter).
    // NOTE: this is the USER-SLIDER path — it dispatches an event so
    // PeerManager re-applies the value to live calls. The adaptive engine
    // uses setAdaptiveBuffers instead (no event, no clobber).
    const clamped = Math.max(1, Math.min(1500, Math.round(ms)))
    saveAudioSettings({ liveBufferDelay: clamped })
    set({ liveBufferDelay: clamped })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gather:live-buffer-changed', { detail: clamped }))
    }
  },

  setAdaptiveBuffers: (audioMs, videoMs, jitterMs, lossPct) =>
    set((state) => {
      const v = Math.max(1, Math.min(1500, Math.round(videoMs)))
      const a = Math.max(1, Math.min(500, Math.round(audioMs)))
      const prev = state.dynamicBufferMetrics
      const nextMetrics = {
        calculatedMs: v,
        jitterMs: Math.round(jitterMs),
        frameDropRate: Math.round(lossPct),
        statusText: `Dinâmico · áudio ${a}ms · vídeo ${v}ms`,
        audioMs: a,
      }
      // Persist the video mirror (slider reads it on reload) without
      // dispatching the live-buffer event — the manager applied both
      // values directly to the peer connections already.
      if (state.liveBufferDelay !== v) {
        saveAudioSettings({ liveBufferDelay: v })
      }
      if (
        state.liveBufferDelay === v &&
        prev.calculatedMs === nextMetrics.calculatedMs &&
        prev.jitterMs === nextMetrics.jitterMs &&
        prev.frameDropRate === nextMetrics.frameDropRate &&
        prev.statusText === nextMetrics.statusText &&
        (prev as any).audioMs === nextMetrics.audioMs
      ) {
        return state
      }
      return { liveBufferDelay: v, dynamicBufferMetrics: nextMetrics }
    }),

  setDynamicBufferMetrics: (metrics) =>
    set((state) => {
      // Guard: DynamicBufferManager evaluates every 2s during calls. Skip the
      // notify when nothing changed so subscribers don't re-render on a timer.
      const prev = state.dynamicBufferMetrics
      if (
        (metrics.calculatedMs === undefined || metrics.calculatedMs === prev.calculatedMs) &&
        (metrics.jitterMs === undefined || metrics.jitterMs === prev.jitterMs) &&
        (metrics.frameDropRate === undefined || metrics.frameDropRate === prev.frameDropRate) &&
        (metrics.statusText === undefined || metrics.statusText === prev.statusText)
      ) {
        return state
      }
      return {
        dynamicBufferMetrics: { ...prev, ...metrics },
      }
    }),

  setPeerStream: (peerId, stream) =>
    set((state) => ({
      peerStreams: { ...state.peerStreams, [peerId]: stream },
    })),

  removePeerStream: (peerId) =>
    set((state) => {
      const copy = { ...state.peerStreams }
      delete copy[peerId]
      return { peerStreams: copy }
    }),

  setPeerScreenStream: (peerId, stream) =>
    set((state) => ({
      peerScreenStreams: { ...state.peerScreenStreams, [peerId]: stream },
    })),

  removePeerScreenStream: (peerId) =>
    set((state) => {
      const copy = { ...state.peerScreenStreams }
      delete copy[peerId]
      return { peerScreenStreams: copy }
    }),

  clearAllPeerStreams: () => set({ peerStreams: {}, peerScreenStreams: {} }),

  stopAllMedia: () => {
    const { localStream, localScreenStream } = get()
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop())
    }
    if (localScreenStream) {
      localScreenStream.getTracks().forEach((t) => t.stop())
    }
    set({
      localStream: null,
      localScreenStream: null,
      isScreenSharing: false,
      peerStreams: {},
      peerScreenStreams: {},
    })
  },

  localAudioLevel: 0,
  isGateOpen: false,
  isTestingMic: false,
  autoThresholdPercent: 0,
  setLocalAudioLevel: (localAudioLevel, isGateOpen = false, autoThresholdPercent?: number) => {
    const prev = get()
    // Guard: DSP engines report the level at ~60Hz (rAF). Skip the zustand
    // notify when nothing perceptible changed — every set() re-renders all
    // media-store subscribers (grid, tiles, overlays).
    const gate = isGateOpen ?? prev.isGateOpen
    const threshold = typeof autoThresholdPercent === 'number'
      ? Math.round(autoThresholdPercent)
      : prev.autoThresholdPercent

    if (
      gate === prev.isGateOpen &&
      Math.abs(localAudioLevel - prev.localAudioLevel) < 0.005 &&
      threshold === prev.autoThresholdPercent
    ) {
      return
    }
    set({ localAudioLevel, isGateOpen: gate, autoThresholdPercent: threshold })
  },
  setIsTestingMic: (isTestingMic) => set({ isTestingMic }),
}))