import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  useNetworkQualityStore,
  calculateRating,
  DEFAULT_NETWORK_QUALITY,
  getUserNetworkQuality,
  useUserNetworkQuality,
} from '../store/useNetworkQualityStore'
import { idleManager, IDLE_TIMEOUT_SECONDS } from '../services/idleManager'
import {
  sendNotification,
  playNotificationSound,
} from '../services/notificationService'
import { useGameStore } from '../store/useGameStore'

describe('Indicador de Qualidade de Rede (Network Quality Store)', () => {
  beforeEach(() => {
    useNetworkQualityStore.getState().clearAll()
  })

  it('calculates ratings accurately based on ping, loss, and jitter', () => {
    // Low latency, zero loss -> excellent
    expect(calculateRating(25, 0, 5)).toBe('excellent')

    // Moderate ping or loss -> good
    expect(calculateRating(100, 1, 10)).toBe('good')
    expect(calculateRating(40, 3, 10)).toBe('good')

    // High ping or loss -> poor
    expect(calculateRating(200, 2, 20)).toBe('poor')
    expect(calculateRating(50, 8, 20)).toBe('poor')

    // Critical conditions -> bad
    expect(calculateRating(400, 0, 20)).toBe('bad')
    expect(calculateRating(50, 20, 20)).toBe('bad')
    expect(calculateRating(50, 0, 120)).toBe('bad')
  })

  it('stores local and per-peer network qualities and cleans up disconnected peers', () => {
    const store = useNetworkQualityStore.getState()

    store.setLocalQuality({ pingMs: 35, lossPct: 0, jitterMs: 4 })
    expect(useNetworkQualityStore.getState().localQuality.rating).toBe('excellent')
    expect(useNetworkQualityStore.getState().localQuality.pingMs).toBe(35)

    store.setPeerQuality('peer-1', { pingMs: 180, lossPct: 6, jitterMs: 15 })
    expect(useNetworkQualityStore.getState().peerQualities['peer-1']?.rating).toBe('poor')

    store.setPeerQuality('peer-2', { pingMs: 25, lossPct: 0, jitterMs: 2 })
    expect(useNetworkQualityStore.getState().peerQualities['peer-2']?.rating).toBe('excellent')

    // Remove disconnected peer
    store.removePeerQuality('peer-1')
    expect(useNetworkQualityStore.getState().peerQualities['peer-1']).toBeUndefined()
    expect(useNetworkQualityStore.getState().peerQualities['peer-2']).toBeDefined()
  })
})

describe('Status de Presença Automático (Idle / AFK Presence Manager)', () => {
  beforeEach(() => {
    idleManager.stop()
    idleManager.resetForTesting()
    useGameStore.setState({
      localPlayer: {
        ...useGameStore.getState().localPlayer,
        status: 'available',
        statusText: 'Disponível',
        statusEmoji: '💻',
      },
    })
  })

  it('automatically sets status to Ausente (AFK) with 💤 after 5 minutes of inactivity', async () => {
    // Mock getIdleSeconds to simulate 301 seconds of inactivity
    vi.spyOn(idleManager, 'getIdleSeconds').mockResolvedValue(IDLE_TIMEOUT_SECONDS + 1)

    // Trigger internal idle check
    await (idleManager as any).checkIdleStatus()

    const localPlayer = useGameStore.getState().localPlayer
    expect(localPlayer.status).toBe('away')
    expect(localPlayer.statusText).toBe('Ausente (AFK)')
    expect(localPlayer.statusEmoji).toBe('💤')
  })

  it('automatically restores the previous status when the user returns', async () => {
    // 1. Go idle
    vi.spyOn(idleManager, 'getIdleSeconds').mockResolvedValue(IDLE_TIMEOUT_SECONDS + 5)
    await (idleManager as any).checkIdleStatus()

    expect(useGameStore.getState().localPlayer.status).toBe('away')

    // 2. User returns (idle time drops to 0 seconds)
    vi.spyOn(idleManager, 'getIdleSeconds').mockResolvedValue(0)
    await (idleManager as any).checkIdleStatus()

    const restoredPlayer = useGameStore.getState().localPlayer
    expect(restoredPlayer.status).toBe('available')
    expect(restoredPlayer.statusText).toBe('Disponível')
    expect(restoredPlayer.statusEmoji).toBe('💻')
  })

  it('markUserActive immediately wakes up the player upon any mouse or keyboard activity', async () => {
    // 1. Put user in AFK state
    vi.spyOn(idleManager, 'getIdleSeconds').mockResolvedValue(IDLE_TIMEOUT_SECONDS + 10)
    await (idleManager as any).checkIdleStatus()
    expect(useGameStore.getState().localPlayer.statusText).toBe('Ausente (AFK)')

    // 2. User moves mouse / types -> calls markUserActive()
    idleManager.markUserActive()

    const awakePlayer = useGameStore.getState().localPlayer
    expect(awakePlayer.status).toBe('available')
    expect(awakePlayer.statusText).toBe('Disponível')
    expect(awakePlayer.statusEmoji).toBe('💻')
  })

  it('guarantees that restoring status never leaves the user stuck in Ausente (AFK)', () => {
    // Force player in store to be away with no previous status recorded
    useGameStore.setState({
      localPlayer: {
        ...useGameStore.getState().localPlayer,
        status: 'away',
        statusText: 'Ausente (AFK)',
        statusEmoji: '💤',
      },
    })
    idleManager.resetForTesting()

    // Calling markUserActive should safely transition back to available / Disponível
    idleManager.markUserActive()

    const activePlayer = useGameStore.getState().localPlayer
    expect(activePlayer.status).toBe('available')
    expect(activePlayer.statusText).toBe('Disponível')
    expect(activePlayer.statusEmoji).toBe('')
  })

  it('does not overwrite manual Ausente status upon user activity (preserves explicit choice)', () => {
    // User explicitly selects "Ausente" in AvatarCustomizerModal or dropdown
    useGameStore.getState().setLocalStatus({
      status: 'away',
      statusText: 'Ausente',
      statusEmoji: '',
    })

    // User moves mouse or types
    idleManager.markUserActive()

    const player = useGameStore.getState().localPlayer
    expect(player.status).toBe('away')
    expect(player.statusText).toBe('Ausente')
    expect(player.statusEmoji).toBe('')
  })

  it('cancels auto-away when user explicitly updates status manually', async () => {
    // 1. Go auto-AFK
    vi.spyOn(idleManager, 'getIdleSeconds').mockResolvedValue(IDLE_TIMEOUT_SECONDS + 10)
    await (idleManager as any).checkIdleStatus()
    expect(useGameStore.getState().localPlayer.statusText).toBe('Ausente (AFK)')

    // 2. User explicitly selects "Ausente" manually
    useGameStore.getState().setLocalStatus({
      status: 'away',
      statusText: 'Ausente',
      statusEmoji: '',
    })

    // 3. User becomes active - manual Ausente must be preserved!
    idleManager.markUserActive()

    const player = useGameStore.getState().localPlayer
    expect(player.status).toBe('away')
    expect(player.statusText).toBe('Ausente')
    expect(player.statusEmoji).toBe('')
  })
})

describe('Notificações Nativas do Windows & Som de Chamada (Notification Service)', () => {
  beforeEach(() => {
    // Mock global window and document
    ;(globalThis as any).window = {
      AudioContext: vi.fn().mockImplementation(() => ({
        currentTime: 0,
        state: 'running',
        createOscillator: () => ({
          type: 'triangle',
          frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        }),
        createGain: () => ({
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        }),
        destination: {},
      })),
      electronAPI: {},
    }
    ;(globalThis as any).document = {
      hasFocus: () => false,
      hidden: true,
    }
  })

  it('plays synthesized notification sounds without throwing errors', () => {
    expect(() => playNotificationSound('knock')).not.toThrow()
    expect(() => playNotificationSound('message')).not.toThrow()
    expect(() => playNotificationSound('call')).not.toThrow()
  })

  it('triggers native Windows notification when window is blurred or in background', async () => {
    const showMock = vi.fn().mockResolvedValue({ ok: true })
    ;(globalThis as any).window.electronAPI = {
      showNativeNotification: showMock,
    }

    let approved = false
    await sendNotification({
      title: 'Batida na Porta - Lira',
      body: 'Carlos está pedindo para entrar na sala.',
      soundType: 'knock',
      tag: 'test-knock',
      actions: [{ type: 'button', text: 'Permitir' }],
      onAction: (index) => {
        if (index === 0) approved = true
      },
    })

    expect(showMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Batida na Porta - Lira',
        body: 'Carlos está pedindo para entrar na sala.',
        tag: 'test-knock',
      })
    )
  })
})

describe('Garantia Anti-Loop de Renderização (Zustand Referential Stability & Anti-Loop)', () => {
  beforeEach(() => {
    useNetworkQualityStore.getState().clearAll()
  })

  it('guarantees that DEFAULT_NETWORK_QUALITY is a frozen singleton reference', () => {
    expect(Object.isFrozen(DEFAULT_NETWORK_QUALITY)).toBe(true)
    expect(DEFAULT_NETWORK_QUALITY.pingMs).toBe(0)
    expect(DEFAULT_NETWORK_QUALITY.rating).toBe('excellent')
  })

  it('getUserNetworkQuality returns strictly identical object references for unmapped peers across multiple calls', () => {
    // If a selector produces a new object on each invocation, React's useSyncExternalStore
    // triggers an infinite re-render loop (Maximum update depth exceeded).
    const state = useNetworkQualityStore.getState()
    const refA = getUserNetworkQuality(state, 'unmapped-peer-id')
    const refB = getUserNetworkQuality(state, 'unmapped-peer-id')
    const refC = getUserNetworkQuality(state, undefined, false)

    expect(refA).toBe(DEFAULT_NETWORK_QUALITY)
    expect(refB).toBe(DEFAULT_NETWORK_QUALITY)
    expect(refC).toBe(DEFAULT_NETWORK_QUALITY)

    // Strict referential equality
    expect(Object.is(refA, refB)).toBe(true)
    expect(Object.is(refB, refC)).toBe(true)
  })

  it('unrelated store updates do not break referential equality for unmapped peers', () => {
    const store = useNetworkQualityStore.getState()
    const initialRef = getUserNetworkQuality(store, 'peer-ghost')

    // Update local player quality
    useNetworkQualityStore.getState().setLocalQuality({ pingMs: 85, lossPct: 2 })
    const afterLocalUpdate = getUserNetworkQuality(useNetworkQualityStore.getState(), 'peer-ghost')
    expect(afterLocalUpdate).toBe(initialRef)

    // Update another peer
    useNetworkQualityStore.getState().setPeerQuality('peer-active', { pingMs: 42, lossPct: 0 })
    const afterOtherPeerUpdate = getUserNetworkQuality(useNetworkQualityStore.getState(), 'peer-ghost')
    expect(afterOtherPeerUpdate).toBe(initialRef)

    // The active peer should get its new quality, but peer-ghost stays strictly on DEFAULT_NETWORK_QUALITY
    const activeQuality = getUserNetworkQuality(useNetworkQualityStore.getState(), 'peer-active')
    expect(activeQuality.pingMs).toBe(42)
    expect(getUserNetworkQuality(useNetworkQualityStore.getState(), 'peer-ghost')).toBe(DEFAULT_NETWORK_QUALITY)
  })

  it('demonstrates that returning inline object literals inside Zustand selectors is an anti-pattern', () => {
    // The previous buggy pattern was:
    // const selector = (s) => s.peerQualities[id] || { pingMs: 0, lossPct: 0, rating: 'excellent' }
    // Calling this selector twice produces two distinct objects in memory:
    const buggySelector = (s: any) => s.peerQualities['nonexistent'] || { pingMs: 0, lossPct: 0 }
    const call1 = buggySelector(useNetworkQualityStore.getState())
    const call2 = buggySelector(useNetworkQualityStore.getState())

    // BUG VERIFICATION: The buggy selector fails Object.is equality, which causes React re-render loops
    expect(Object.is(call1, call2)).toBe(false)

    // SAFE SELECTOR VERIFICATION: Our getUserNetworkQuality passes Object.is equality every single time
    const safeCall1 = getUserNetworkQuality(useNetworkQualityStore.getState(), 'nonexistent')
    const safeCall2 = getUserNetworkQuality(useNetworkQualityStore.getState(), 'nonexistent')
    expect(Object.is(safeCall1, safeCall2)).toBe(true)
  })

  it('scans codebase to assert that no component contains inline object fallbacks inside useNetworkQualityStore selectors', () => {
    // Eagerly load all component and store source files as raw text strings via Vite
    const sourceModules = import.meta.glob<string>(
      ['../components/**/*.{ts,tsx}'],
      { query: '?raw', import: 'default', eager: true }
    )

    // Anti-pattern regex: useNetworkQualityStore((s) => ... || { ... })
    // Regex matches inline object fallback `|| {` inside useNetworkQualityStore call
    const inlineObjectPattern = /useNetworkQualityStore\s*\(\s*\([^)]*\)\s*=>[^{};]*?\|\|\s*\{/g

    const violations: { file: string; match: string }[] = []

    for (const [filePath, content] of Object.entries(sourceModules)) {
      if (typeof content === 'string') {
        const matches = content.match(inlineObjectPattern)
        if (matches) {
          violations.push({
            file: filePath,
            match: matches[0],
          })
        }
      }
    }

    // Must be ZERO violations across all components
    expect(
      violations,
      `Detected inline object literal fallback inside useNetworkQualityStore selector in: ${JSON.stringify(violations, null, 2)}. Use useUserNetworkQuality or DEFAULT_NETWORK_QUALITY instead!`
    ).toHaveLength(0)
  })
})
