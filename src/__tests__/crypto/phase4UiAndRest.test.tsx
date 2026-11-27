// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  decryptDmPayload,
  encryptDmPayload,
  isEncryptedDmEnvelope,
  resetDmStorageCryptoForTests,
} from '../../crypto/dmStorageCrypto'
import { useSecurityStore, resolvePeerSecurity, aggregatePeersSecurity } from '../../store/useSecurityStore'
import { useGameStore } from '../../store/useGameStore'
import { SecurityBadge } from '../../components/security/SecurityBadge'
import { SafetyNumberModal } from '../../components/security/SafetyNumberModal'
import { SecurityAlertBanner } from '../../components/security/SecurityAlertBanner'

describe('Phase 4 — Security UI & Encrypted DM Storage at Rest', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    resetDmStorageCryptoForTests()
    useSecurityStore.getState().reset()
    delete (window as any).electronAPI
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    delete (window as any).electronAPI
  })

  it('encrypts and decrypts DM history at rest using WebCrypto AES-GCM fallback', async () => {
    const secret = 'segredo-ultra-confidencial-123'
    const payload = JSON.stringify([
      { id: 'm1', senderId: 'u-bob', senderName: 'Bob', channelId: 'dm-a-b', content: secret, timestamp: 1700000000000 },
    ])

    const envelope = await encryptDmPayload(payload)
    expect(isEncryptedDmEnvelope(envelope)).toBe(true)
    expect(envelope.mode).toBe('webcrypto')
    expect(JSON.stringify(envelope)).not.toContain(secret)

    const decrypted = await decryptDmPayload(envelope)
    expect(decrypted).toBe(payload)

    const first = envelope.ciphertext[0] === 'A' ? 'B' : 'A'
    const tampered = { ...envelope, ciphertext: first + envelope.ciphertext.slice(1) }
    await expect(decryptDmPayload(tampered)).rejects.toThrow()
  })

  it('prefers Electron safeStorage IPC when available for DM persistence at rest', async () => {
    const mockEncrypt = vi.fn(async (plain: string) => Buffer.from(`ENC:${plain}`, 'utf8').toString('base64'))
    const mockDecrypt = vi.fn(async (b64: string) => {
      const decoded = Buffer.from(b64, 'base64').toString('utf8')
      return decoded.startsWith('ENC:') ? decoded.slice(4) : null
    })

    ;(window as any).electronAPI = {
      secureStorageAvailable: vi.fn(async () => true),
      secureStorageEncrypt: mockEncrypt,
      secureStorageDecrypt: mockDecrypt,
    }

    const secretPayload = JSON.stringify([{ id: 'm-safe', content: 'top-secret-electron' }])
    const envelope = await encryptDmPayload(secretPayload)
    expect(envelope.mode).toBe('safeStorage')
    expect(envelope.ciphertext).not.toContain('top-secret-electron')
    expect(mockEncrypt).toHaveBeenCalledWith(secretPayload)

    const restored = await decryptDmPayload(envelope)
    expect(restored).toBe(secretPayload)
    expect(mockDecrypt).toHaveBeenCalledTimes(1)
  })

  it('persists DMs encrypted in localStorage and hydrates them on startup + migrates legacy plaintext', async () => {
    const { useChatStore, flushDmPersistence, hydrateEncryptedDmsFromStorage } = await import('../../store/useChatStore')

    useChatStore.setState({
      channels: [
        { id: 'general', name: 'general', type: 'general', unreadCount: 0 },
        { id: 'dm-u-alice-u-bob', name: 'Bob', type: 'dm', recipientId: 'u-bob', unreadCount: 0 },
      ],
      messages: [],
      activeChannelId: 'dm-u-alice-u-bob',
      isChatOpen: true,
      lastReadByPeer: {},
    })

    const secretText = 'mensagem-e2ee-em-repouso-xyz'
    useChatStore.getState().addMessage({
      id: 'dm-msg-1',
      senderId: 'u-alice',
      senderName: 'Alice',
      recipientId: 'u-bob',
      channelId: 'dm-u-alice-u-bob',
      content: secretText,
      timestamp: Date.now(),
      encrypted: true,
      status: 'sent',
    })

    await flushDmPersistence()

    const rawStored = localStorage.getItem('lira_saved_dms')
    expect(rawStored).toBeTruthy()
    expect(rawStored).not.toContain(secretText)
    const parsedEnvelope = JSON.parse(rawStored!)
    expect(isEncryptedDmEnvelope(parsedEnvelope)).toBe(true)

    useChatStore.setState({ messages: [] })
    const hydrated = await hydrateEncryptedDmsFromStorage()
    expect(hydrated.map((m) => m.id)).toContain('dm-msg-1')
    expect(useChatStore.getState().messages.find((m) => m.id === 'dm-msg-1')?.content).toBe(secretText)

    // Legacy plaintext array in lira_saved_dms is read on startup and automatically migrated
    vi.resetModules()
    resetDmStorageCryptoForTests()
    const legacyText = 'legacy-plaintext-dm-001'
    localStorage.setItem(
      'lira_saved_dms',
      JSON.stringify([
        {
          id: 'legacy-1',
          senderId: 'u-bob',
          senderName: 'Bob',
          recipientId: 'u-alice',
          channelId: 'dm-u-alice-u-bob',
          content: legacyText,
          timestamp: Date.now(),
        },
      ])
    )
    const reloadedChat = await import('../../store/useChatStore')
    expect(reloadedChat.useChatStore.getState().messages.find((m) => m.id === 'legacy-1')?.content).toBe(legacyText)
    await reloadedChat.flushDmPersistence()
    const migratedRaw = localStorage.getItem('lira_saved_dms')
    expect(migratedRaw).not.toContain(legacyText)
    expect(isEncryptedDmEnvelope(JSON.parse(migratedRaw!))).toBe(true)
  })

  it('preserves history when a DM arrives before startup has decrypted it', async () => {
    vi.resetModules()
    const message = {
      id: 'earlier-dm', senderId: 'u-alice', senderName: 'Alice', recipientId: 'u-bob',
      channelId: 'dm-u-alice-u-bob', content: 'Histórico', timestamp: 1000,
    }
    const saved = JSON.stringify({ __liraEncV: 1, mode: 'safeStorage', ciphertext: 'previous' })
    localStorage.setItem('lira_saved_dms', saved)
    let release: (value: string) => void = () => {}
    const delayedRead = new Promise<string>(resolve => { release = resolve })
    const encrypt = vi.fn(async (_plaintext: string) => 'updated')
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
      secureStorageAvailable: async () => true,
      secureStorageDecrypt: () => delayedRead,
      secureStorageEncrypt: encrypt,
    } })
    const { useChatStore, flushDmPersistence } = await import('../../store/useChatStore')
    useChatStore.getState().addMessage({ ...message, id: 'incoming-dm', timestamp: 1001 })
    await Promise.resolve()
    expect(localStorage.getItem('lira_saved_dms')).toBe(saved)
    expect(encrypt).not.toHaveBeenCalled()

    release(JSON.stringify([message]))
    await flushDmPersistence()
    expect(encrypt).toHaveBeenCalledOnce()
    expect(JSON.parse(String(encrypt.mock.calls[0]?.[0])).map((entry: { id: string }) => entry.id))
      .toEqual(['earlier-dm', 'incoming-dm'])
  })

  it('preserves an unreadable history and saves new DMs in a new encrypted history', async () => {
    vi.resetModules()
    const unreadable = '{invalid-json'
    localStorage.setItem('lira_saved_dms', unreadable)
    const { useChatStore, flushDmPersistence } = await import('../../store/useChatStore')
    useChatStore.getState().addMessage({
      id: 'after-recovery', senderId: 'u-alice', senderName: 'Alice', recipientId: 'u-bob',
      channelId: 'dm-u-alice-u-bob', content: 'Nova mensagem', timestamp: Date.now(),
    })
    await flushDmPersistence()
    const backup = Object.keys(localStorage).find(key => key.startsWith('lira_saved_dms_recovery_'))
    expect(backup).toBeDefined()
    expect(localStorage.getItem(backup!)).toBe(unreadable)
    const saved = JSON.parse(localStorage.getItem('lira_saved_dms')!)
    expect(isEncryptedDmEnvelope(saved)).toBe(true)
    expect(useChatStore.getState().dmHistoryNotice).toContain('As novas DMs estão sendo salvas')
  })

  it('displays SAS numbers, fingerprints, and verifies friend trust via SafetyNumberModal', () => {
    const peerId = 'u-bob12345678901234567'
    const remotePub = 'bob-pub-b64url'
    const remoteFp = 'abcdef0123456789'.repeat(4)
    const localFp = '0011223344556677'.repeat(4)

    useGameStore.setState({
      friends: [peerId],
      friendProfiles: {
        [peerId]: {
          id: peerId,
          actualUserId: peerId,
          name: 'Bob',
          identityKey: remotePub,
          identityKeyFingerprint: remoteFp,
          identityKeyVerified: false,
        },
      },
    })

    useSecurityStore.getState().setLocalIdentity('local-pub-b64', localFp)
    useSecurityStore.getState().setPeerSecurity(peerId, {
      status: 'encrypted',
      publicKey: remotePub,
      fingerprint: remoteFp,
      sas: { code: '12345 67890 11111 22222 33333 44444', emojis: ['🔑', '🛡️', '🌙', '⭐'] },
      dtlsBound: true,
      mediaEncrypted: true,
      callDtlsVerified: true,
    })
    useSecurityStore.getState().openInspection({ peerId, displayName: 'Bob' })

    render(<SafetyNumberModal />)

    expect(screen.getByTestId('sas-code').textContent).toBe('12345 67890 11111 22222 33333 44444')
    expect(screen.getByText('🔑')).toBeTruthy()
    expect(screen.getByTestId('local-fingerprint').textContent).toContain('0011 2233')
    expect(screen.getByTestId('remote-fingerprint').textContent).toContain('ABCD EF01')
    expect(screen.getByText('DTLS autenticado')).toBeTruthy()
    expect(screen.getByText('Mídia SFrame E2EE')).toBeTruthy()

    fireEvent.click(screen.getByText('Marcar como Verificado'))

    expect(useSecurityStore.getState().peers[peerId].status).toBe('verified')
    expect(useGameStore.getState().friendProfiles[peerId].identityKeyVerified).toBe(true)
    expect(screen.getByText('Identidade Verificada')).toBeTruthy()

    fireEvent.click(screen.getByText('Remover verificação'))
    expect(useSecurityStore.getState().peers[peerId].status).toBe('encrypted')
    expect(useGameStore.getState().friendProfiles[peerId].identityKeyVerified).toBe(false)
  })

  it('handles TOFU key_changed warnings and explicit key acceptance', () => {
    const peerId = 'u-carol123456789012345'
    const newPub = 'carol-new-pub'
    const newFp = 'fedcba9876543210'.repeat(4)

    useGameStore.setState({
      friends: [peerId],
      friendProfiles: {
        [peerId]: {
          id: peerId,
          actualUserId: peerId,
          name: 'Carol',
          identityKey: 'carol-old-pub',
          identityKeyFingerprint: '1111'.repeat(16),
          identityKeyVerified: true,
        },
      },
    })

    useSecurityStore.getState().setPeerSecurity(peerId, {
      status: 'key_changed',
      publicKey: newPub,
      fingerprint: newFp,
      reason: 'Pinned identity key changed since last verified session',
    })
    useSecurityStore.getState().recordAlert({
      peerId,
      reason: 'pinned_key_changed',
      message: 'A chave de Carol mudou.',
    })
    useSecurityStore.getState().openInspection({ peerId, displayName: 'Carol' })

    render(<SafetyNumberModal />)

    expect(screen.getByText('Chave de Identidade Alterada!')).toBeTruthy()
    fireEvent.click(screen.getByText('Aceitar nova chave'))

    expect(useGameStore.getState().friendProfiles[peerId].identityKey).toBe(newPub)
    expect(useGameStore.getState().friendProfiles[peerId].identityKeyFingerprint).toBe(newFp)
    expect(useGameStore.getState().friendProfiles[peerId].identityKeyVerified).toBe(false)
    expect(useSecurityStore.getState().alerts).toHaveLength(0)
    expect(useSecurityStore.getState().peers[peerId].status).toBe('pending')
  })

  it('renders SecurityAlertBanner and SecurityBadge states with inspect and dismiss controls', () => {
    const peerId = 'peer-mitm-1'
    useSecurityStore.getState().recordAlert({
      peerId,
      reason: 'dtls_mismatch',
      message: 'Fingerprint DTLS divergente detectado.',
    })

    render(<SecurityAlertBanner />)
    expect(screen.getByText('Possível ataque MITM detectado (DTLS)')).toBeTruthy()
    expect(screen.getByText('Fingerprint DTLS divergente detectado.')).toBeTruthy()

    fireEvent.click(screen.getByText('Inspecionar'))
    expect(useSecurityStore.getState().inspectionTarget?.peerId).toBe(peerId)

    fireEvent.click(screen.getByLabelText('Dispensar alerta'))
    expect(useSecurityStore.getState().alerts).toHaveLength(0)

    const onClick = vi.fn()
    render(
      <div>
        <SecurityBadge status="verified" onClick={onClick} />
        <SecurityBadge status="encrypted" mediaEncrypted />
        <SecurityBadge status="key_changed" />
        <SecurityBadge status="mitm_blocked" />
      </div>
    )

    fireEvent.click(screen.getByText('Verificado'))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByText('E2EE Mídia')).toBeTruthy()
    expect(screen.getByText('Chave Alterada')).toBeTruthy()
    expect(screen.getByText('MITM Bloqueado')).toBeTruthy()

    const resolved = resolvePeerSecurity(
      {
        a: { peerId: 'a', status: 'encrypted', updatedAt: 1 },
        b: { peerId: 'b', status: 'mitm_blocked', updatedAt: 2 },
      },
      ['a', 'b']
    )
    expect(resolved?.status).toBe('mitm_blocked')

    const agg = aggregatePeersSecurity(
      {
        p1: { peerId: 'p1', status: 'verified', mediaEncrypted: true, updatedAt: 1 },
        p2: { peerId: 'p2', status: 'encrypted', mediaEncrypted: true, updatedAt: 1 },
      },
      [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
      ]
    )
    expect(agg.status).toBe('encrypted')
    expect(agg.mediaEncryptedCount).toBe(2)
  })
})
