import { create } from 'zustand'
import { SensitivityMode, AudioProcessorMode } from '../types/audio'
import { useGameStore } from './useGameStore'
import { diagLog, shortId, summarizeStream } from '../utils/diagnosticLogger'
import { registerReportContext } from '../utils/reportContext'
import {
  isHardwareAccelerationEnabled as getHwCodecEnabled,
  setHardwareAccelerationEnabled as setHwCodecEnabled,
} from '../media/hardwareCodec'
import { MediaManager } from '../media/MediaManager'
import { PeerManager } from '../p2p/PeerManager'
import { reportStorageFailure } from '../utils/storageReport'
import { playSoundEffect, setSoundEffectsOptionsProvider } from '../utils/soundEffects'

export interface MicCalibration {
  noiseFloorDb: number
  peakRmsDb: number
  snrDb: number
  recommendedMode: AudioProcessorMode
  recommendedSensitivity: number
  calibratedAt: number
}

interface MediaStore {
  localStream: MediaStream | null
  localScreenStream: MediaStream | null
  setLocalStream: (stream: MediaStream | null) => void
  setLocalScreenStream: (stream: MediaStream | null) => void

  isMuted: boolean
  isCameraOff: boolean
  isScreenSharing: boolean
  isNoiseSuppressionEnabled: boolean
  isGridCallOpen: boolean
  isSettingsModalOpen: boolean
  isDeafened: boolean
  silencedUsers: Record<string, boolean>
  mutuallySilencedBy: Record<string, boolean>
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

  selectedAudioInput: string
  selectedAudioOutput: string
  selectedVideoInput: string
  inputVolume: number
  outputVolume: number
  sensitivityMode: SensitivityMode
  manualSensitivityThreshold: number
  echoCancellation: boolean
  autoGainControl: boolean
  audioProcessorMode: AudioProcessorMode
  hasUserChosenProcessorMode: boolean
  screenShareAudioVolume: number
  duckingEnabled: boolean
  screenShareIsolateCallAudio: boolean
  screenShareTargetTitle: string | null
  screenShareAudioMode: 'app_only' | 'app_and_mic'
  screenShareOptimizationMode: 'quality' | 'smoothness'
  soundEffectsEnabled: boolean
  soundEffectsVolume: number

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
  setScreenShareOptimizationMode: (mode: 'quality' | 'smoothness') => void
  setSoundEffectsEnabled: (enabled: boolean) => void
  setSoundEffectsVolume: (volume: number) => void

  isHardwareAccelerationEnabled: boolean
  setHardwareAccelerationEnabled: (enabled: boolean) => void
  toggleHardwareAcceleration: () => void

  rnnoiseStatus: 'idle' | 'loading' | 'ready' | 'fallback' | 'error'
  rnnoiseError: string | null
  setRnnoiseStatus: (status: 'idle' | 'loading' | 'ready' | 'fallback' | 'error', error?: string | null) => void
  rnnoiseStage: string
  setRnnoiseStage: (stage: string) => void

  micCalibrations: Record<string, MicCalibration>
  isCalibrating: boolean
  setMicCalibration: (deviceId: string, cal: MicCalibration) => void
  clearMicCalibration: (deviceId: string) => void
  setIsCalibrating: (calibrating: boolean) => void

  localAudioLevel: number
  isGateOpen: boolean
  isTestingMic: boolean
  autoThresholdPercent: number
  setLocalAudioLevel: (level: number, gateOpen?: boolean, autoThresholdPercent?: number) => void
  setIsTestingMic: (testing: boolean) => void

  peerStreams: Record<string, MediaStream>
  peerScreenStreams: Record<string, MediaStream>
  participantVolumes: Record<string, number>
  setParticipantVolume: (id: string, volume: number) => void
  getEffectiveParticipantVolume: (id: string) => number
  liveStreamVolume: number
  setLiveStreamVolume: (volume: number) => void
  liveBufferMode: 'dynamic' | 'manual'
  liveBufferDelay: number
  dynamicBufferMetrics: {
    calculatedMs: number
    jitterMs: number
    frameDropRate: number
    statusText: string
    audioMs?: number
  }
  setLiveBufferMode: (mode: 'dynamic' | 'manual') => void
  setLiveBufferDelay: (ms: number) => void
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

const STORAGE_KEY = 'lira_audio_settings'

const loadSavedAudioSettings = () => {
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        return JSON.parse(raw)
      }
    }
  } catch (e) {
    reportStorageFailure('read', STORAGE_KEY, e)
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
    reportStorageFailure('write', STORAGE_KEY, e)
  }
}

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

const hasMediaHardware = () =>
  typeof window !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices

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
  hasUserChosenProcessorMode: saved.hasUserChosenProcessorMode === true,
  screenShareAudioVolume: saved.screenShareAudioVolume !== undefined ? saved.screenShareAudioVolume : 100,
  duckingEnabled: saved.duckingEnabled !== undefined ? saved.duckingEnabled : true,
  screenShareIsolateCallAudio: saved.screenShareIsolateCallAudio !== undefined ? saved.screenShareIsolateCallAudio : true,
  screenShareTargetTitle: null,
  screenShareAudioMode: saved.screenShareAudioMode === 'app_and_mic' ? 'app_and_mic' : 'app_only',
  screenShareOptimizationMode:
    saved.screenShareOptimizationMode === 'smoothness' ? 'smoothness' : 'quality',
  soundEffectsEnabled: saved.soundEffectsEnabled !== undefined ? Boolean(saved.soundEffectsEnabled) : true,
  soundEffectsVolume: typeof saved.soundEffectsVolume === 'number' ? saved.soundEffectsVolume : 80,
  isHardwareAccelerationEnabled:
    saved.isHardwareAccelerationEnabled !== undefined
      ? Boolean(saved.isHardwareAccelerationEnabled)
      : getHwCodecEnabled(),

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
    if (hasMediaHardware()) {
      try {
        MediaManager.getInstance().changeVideoInput(selectedVideoInput)
      } catch {}
    }
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
      hasUserChosenProcessorMode: true,
    })
    set({ audioProcessorMode, hasUserChosenProcessorMode: true })
  },
  setScreenShareAudioVolume: (screenShareAudioVolume) => {
    const clamped = Math.max(0, Math.min(200, Math.round(screenShareAudioVolume)))
    saveAudioSettingsDebounced({ screenShareAudioVolume: clamped })
    set({ screenShareAudioVolume: clamped })
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
  setScreenShareOptimizationMode: (mode) => {
    saveAudioSettings({ screenShareOptimizationMode: mode })
    set({ screenShareOptimizationMode: mode })
    MediaManager.getInstance().updateScreenShareOptimizationMode(mode)
  },
  setSoundEffectsEnabled: (soundEffectsEnabled: boolean) => {
    saveAudioSettings({ soundEffectsEnabled })
    set({ soundEffectsEnabled })
  },
  setSoundEffectsVolume: (soundEffectsVolume: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(soundEffectsVolume)))
    saveAudioSettingsDebounced({ soundEffectsVolume: clamped })
    set({ soundEffectsVolume: clamped })
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
    playSoundEffect(nextMute ? 'mute' : 'unmute')
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
    if (hasMediaHardware()) {
      try {
        MediaManager.getInstance().syncMuteState(nextMute, false)
      } catch {}
    }
  },

  setMuted: (isMuted) => {
    const prev = get().isMuted
    if (prev !== isMuted) {
      playSoundEffect(isMuted ? 'mute' : 'unmute')
    }
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
    if (hasMediaHardware()) {
      try {
        MediaManager.getInstance().syncMuteState(isMuted, false)
      } catch {}
    }
  },

  toggleCamera: () => {
    const nextCam = !get().isCameraOff
    set({ isCameraOff: nextCam })
    if (hasMediaHardware()) {
      try {
        MediaManager.getInstance().syncCameraState(nextCam)
      } catch {}
    }
  },

  setCameraOff: (isCameraOff) => {
    set({ isCameraOff })
    useGameStore.getState().setLocalPlayer({ isCameraOff })
    try {
      PeerManager.getInstance().sendPlayerUpdate({ isCameraOff })
    } catch {}
    if (hasMediaHardware()) {
      try {
        MediaManager.getInstance().syncCameraState(isCameraOff)
      } catch {}
    }
  },

  setScreenSharing: (sharing) => {
    const prev = get().isScreenSharing
    if (prev !== sharing) {
      playSoundEffect(sharing ? 'live_start' : 'live_stop')
    }
    set({ isScreenSharing: sharing })
  },

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
    playSoundEffect(next ? 'deafen' : 'undeafen')
    set({ isDeafened: next })
    useGameStore.getState().setLocalPlayer({ isDeafened: next })
    try {
      PeerManager.getInstance().sendPlayerUpdate({ isDeafened: next })
    } catch {}
  },
  setDeafened: (isDeafened) => {
    const prev = get().isDeafened
    if (prev !== isDeafened) {
      playSoundEffect(isDeafened ? 'deafen' : 'undeafen')
    }
    set({ isDeafened })
    useGameStore.getState().setLocalPlayer({ isDeafened })
    try {
      PeerManager.getInstance().sendPlayerUpdate({ isDeafened })
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
    const clamped = Math.max(1, Math.min(1500, Math.round(ms)))
    saveAudioSettings({ liveBufferDelay: clamped })
    set({ liveBufferDelay: clamped })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('lira:live-buffer-changed', { detail: clamped }))
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

  clearAllPeerStreams: () =>
    set({
      peerStreams: {},
      peerScreenStreams: {},
    }),

  stopAllMedia: () => {
    const { localStream, localScreenStream } = get()
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop())
    }
    if (localScreenStream) {
      localScreenStream.getTracks().forEach((track) => track.stop())
    }
    set({
      localStream: null,
      localScreenStream: null,
      peerStreams: {},
      peerScreenStreams: {},
      isMuted: true,
      isCameraOff: true,
      isScreenSharing: false,
    })
  },

  localAudioLevel: 0,
  isGateOpen: false,
  isTestingMic: false,
  autoThresholdPercent: 0,
  setLocalAudioLevel: (localAudioLevel, isGateOpen = false, autoThresholdPercent?: number) => {
    const prev = get()
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

registerReportContext('media', () => {
  const state = useMediaStore.getState()
  return {
    muted: state.isMuted,
    cameraOff: state.isCameraOff,
    screenSharing: state.isScreenSharing,
    deafened: state.isDeafened,
    processor: state.audioProcessorMode,
    processorMode: state.audioProcessorMode,
    userChosenMode: state.hasUserChosenProcessorMode,
    rnnoise: { status: state.rnnoiseStatus, stage: state.rnnoiseStage, error: state.rnnoiseError },
    noiseSuppression: state.isNoiseSuppressionEnabled,
    sensitivityMode: state.sensitivityMode,
    threshold: state.manualSensitivityThreshold,
    echoCancellation: state.echoCancellation,
    autoGainControl: state.autoGainControl,
    hwAcceleration: state.isHardwareAccelerationEnabled,
    screenShareOptimizationMode: state.screenShareOptimizationMode,
    devices: {
      input: shortId(state.selectedAudioInput ?? ''),
      output: shortId(state.selectedAudioOutput ?? ''),
      camera: shortId(state.selectedVideoInput ?? ''),
    },
    volumes: { input: state.inputVolume, output: state.outputVolume },
    liveBufferDelay: state.liveBufferDelay,
    screenShare: state.isScreenSharing
      ? { target: state.screenShareTargetTitle, audioMode: state.screenShareAudioMode, volume: state.screenShareAudioVolume }
      : undefined,
    localStream: summarizeStream(state.localStream),
    screenStream: summarizeStream(state.localScreenStream),
    gridOpen: state.isGridCallOpen,
    settingsOpen: state.isSettingsModalOpen,
  }
})

const TRACKED_MEDIA_SETTINGS = [
  'audioProcessorMode',
  'isNoiseSuppressionEnabled',
  'echoCancellation',
  'autoGainControl',
  'sensitivityMode',
  'selectedAudioInput',
  'selectedAudioOutput',
  'selectedVideoInput',
  'isHardwareAccelerationEnabled',
  'screenShareAudioMode',
] as const

useMediaStore.subscribe((state, previous) => {
  for (const name of TRACKED_MEDIA_SETTINGS) {
    if (state[name] === previous[name]) continue
    const value = state[name]
    diagLog('settings', name, { value: name.startsWith('selected') && typeof value === 'string' ? shortId(value) : value })
  }
  if (state.isGridCallOpen !== previous.isGridCallOpen) {
    diagLog('ui', 'grid-call', { open: state.isGridCallOpen }, String(state.isGridCallOpen))
  }
  if (state.isSettingsModalOpen !== previous.isSettingsModalOpen) {
    diagLog('ui', 'settings', { open: state.isSettingsModalOpen }, String(state.isSettingsModalOpen))
  }
})

setSoundEffectsOptionsProvider(() => {
  const s = useMediaStore.getState()
  return {
    enabled: s.soundEffectsEnabled,
    volume: s.soundEffectsVolume,
    isDeafened: s.isDeafened,
    selectedAudioOutput: s.selectedAudioOutput,
  }
})
