import {
  computeKeyFingerprint,
  constantTimeEqual,
  deriveEcdhBits,
  deriveSas,
  exportPublicKeyB64,
  generateEphemeralKeyPair,
  hkdfDeriveBytes,
  importEphemeralPublicKey,
  importIdentityPublicKey,
  randomBytes,
  sha256,
  signData,
  toBase64Url,
  utf8Bytes,
  verifySignature,
} from './primitives'
import { getLocalIdentity, type LocalIdentity } from './identityStore'
import type { DtlsBinding } from './dtlsBinding'

const HANDSHAKE_MAX_SKEW_MS = 300_000

export interface E2EEHandshakePayload {
  v: 1
  to: string
  from: string
  phase: 'init' | 'ack'
  sessionNonce: string
  peerNonce?: string
  identityPub: string
  ephemeralPub: string
  dtlsFingerprint?: string
  remoteDtlsFingerprint?: string
  timestamp: number
  signature: string
}

export interface E2EESas {
  code: string
  emojis: string[]
}

export interface EstablishedE2EESession {
  peerId: string
  remoteIdentityPub: string
  remoteFingerprint: string
  rootKey: Uint8Array
  sendChainKey: Uint8Array
  recvChainKey: Uint8Array
  sas: E2EESas
  dtlsBound: boolean
  establishedAt: number
}

export type E2EEHandshakeFailureReason =
  | 'invalid_payload'
  | 'timestamp_skew'
  | 'invalid_signature'
  | 'dtls_mismatch'
  | 'host_key_mismatch'
  | 'pinned_key_changed'

export type E2EEHandshakeResult =
  | { ok: true; session: EstablishedE2EESession; reply?: E2EEHandshakePayload }
  | {
      ok: false
      reason: E2EEHandshakeFailureReason
      message: string
      remoteFingerprint?: string
      remoteIdentityPub?: string
    }

interface PendingHandshake {
  localNonce: string
  localEphKeyPair: CryptoKeyPair
  localEphPubB64: string
  establishedRemoteNonce?: string
  establishedRemoteEphPub?: string
}

export function canonicalHandshakeString(p: Omit<E2EEHandshakePayload, 'signature'>): string {
  return [
    'lira-e2ee-hs-v1',
    p.v,
    p.phase,
    p.from,
    p.to,
    p.sessionNonce,
    p.peerNonce ?? '',
    p.identityPub,
    p.ephemeralPub,
    p.dtlsFingerprint ?? '',
    p.remoteDtlsFingerprint ?? '',
    p.timestamp,
  ].join('|')
}

export class E2EESessionManager {
  private pending = new Map<string, PendingHandshake>()
  private creating = new Map<string, Promise<PendingHandshake>>()
  private sessions = new Map<string, EstablishedE2EESession>()

  constructor(private readonly identityProvider: () => Promise<LocalIdentity> = getLocalIdentity) {}

  private async ensurePending(remotePeerId: string): Promise<PendingHandshake> {
    const existing = this.pending.get(remotePeerId)
    if (existing) return existing
    const creating = this.creating.get(remotePeerId)
    if (creating) return creating
    const creation = (async () => {
      const localEphKeyPair = await generateEphemeralKeyPair()
      const localEphPubB64 = await exportPublicKeyB64(localEphKeyPair.publicKey)
      return { localNonce: toBase64Url(randomBytes(16)), localEphKeyPair, localEphPubB64 }
    })()
    this.creating.set(remotePeerId, creation)
    try {
      const entry = await creation
      if (this.creating.get(remotePeerId) === creation) this.pending.set(remotePeerId, entry)
      return entry
    } finally {
      if (this.creating.get(remotePeerId) === creation) this.creating.delete(remotePeerId)
    }
  }

  private async buildSignedPayload(
    identity: LocalIdentity,
    unsigned: Omit<E2EEHandshakePayload, 'signature'>
  ): Promise<E2EEHandshakePayload> {
    const signature = await signData(identity.privateKey, utf8Bytes(canonicalHandshakeString(unsigned)))
    return { ...unsigned, signature }
  }

  public async startHandshake(
    remotePeerId: string,
    localId: string,
    dtls?: DtlsBinding
  ): Promise<E2EEHandshakePayload> {
    const identity = await this.identityProvider()
    const pending = await this.ensurePending(remotePeerId)
    return this.buildSignedPayload(identity, {
      v: 1,
      to: remotePeerId,
      from: localId,
      phase: 'init',
      sessionNonce: pending.localNonce,
      identityPub: identity.publicKeyB64,
      ephemeralPub: pending.localEphPubB64,
      ...(dtls?.local ? { dtlsFingerprint: dtls.local } : {}),
      ...(dtls?.remote ? { remoteDtlsFingerprint: dtls.remote } : {}),
      timestamp: Date.now(),
    })
  }

  public async handleHandshake(
    payload: E2EEHandshakePayload,
    ctx: {
      localId: string
      remotePeerId: string
      dtls?: DtlsBinding
      expectedFingerprint?: string
      pinnedIdentityPub?: string
      now?: number
    }
  ): Promise<E2EEHandshakeResult> {
    const now = ctx.now ?? Date.now()
    if (
      !payload ||
      payload.v !== 1 ||
      payload.to !== ctx.localId ||
      payload.from !== ctx.remotePeerId ||
      (payload.phase !== 'init' && payload.phase !== 'ack') ||
      !payload.sessionNonce ||
      !payload.identityPub ||
      !payload.ephemeralPub ||
      !payload.signature ||
      !Number.isFinite(payload.timestamp)
    ) {
      return { ok: false, reason: 'invalid_payload', message: 'Handshake E2EE malformado.' }
    }

    if (Math.abs(now - payload.timestamp) > HANDSHAKE_MAX_SKEW_MS) {
      return {
        ok: false,
        reason: 'timestamp_skew',
        message: 'Timestamp do handshake E2EE fora da janela permitida.',
      }
    }

    let remoteIdentityKey: CryptoKey
    try {
      remoteIdentityKey = await importIdentityPublicKey(payload.identityPub)
    } catch {
      return {
        ok: false,
        reason: 'invalid_signature',
        message: 'Chave pública de identidade inválida no handshake.',
      }
    }

    const { signature, ...unsigned } = payload
    const validSig = await verifySignature(
      remoteIdentityKey,
      signature,
      utf8Bytes(canonicalHandshakeString(unsigned))
    )
    if (!validSig) {
      return {
        ok: false,
        reason: 'invalid_signature',
        message: 'Assinatura criptográfica do handshake inválida (possível adulteração ou MITM).',
        remoteIdentityPub: payload.identityPub,
      }
    }

    const remoteFingerprint = await computeKeyFingerprint(payload.identityPub)

    if (ctx.expectedFingerprint && !constantTimeEqual(remoteFingerprint, ctx.expectedFingerprint)) {
      return {
        ok: false,
        reason: 'host_key_mismatch',
        message: 'A chave pública do anfitrião não corresponde ao convite autenticado (possível MITM).',
        remoteFingerprint,
        remoteIdentityPub: payload.identityPub,
      }
    }

    if (ctx.pinnedIdentityPub && !constantTimeEqual(payload.identityPub, ctx.pinnedIdentityPub)) {
      return {
        ok: false,
        reason: 'pinned_key_changed',
        message: 'A chave pública do contato mudou desde a última verificação (possível MITM ou sequestro de ID).',
        remoteFingerprint,
        remoteIdentityPub: payload.identityPub,
      }
    }

    if (ctx.dtls) {
      if (ctx.dtls.remote) {
        if (!payload.dtlsFingerprint || !constantTimeEqual(payload.dtlsFingerprint, ctx.dtls.remote)) {
          return {
            ok: false,
            reason: 'dtls_mismatch',
            message: 'Fingerprint DTLS do SDP não corresponde à identidade assinada do par (bloqueio MITM).',
            remoteFingerprint,
            remoteIdentityPub: payload.identityPub,
          }
        }
      }
      if (ctx.dtls.local && payload.remoteDtlsFingerprint) {
        if (!constantTimeEqual(payload.remoteDtlsFingerprint, ctx.dtls.local)) {
          return {
            ok: false,
            reason: 'dtls_mismatch',
            message: 'O par enxerga um fingerprint DTLS diferente do nosso SDP local (bloqueio MITM).',
            remoteFingerprint,
            remoteIdentityPub: payload.identityPub,
          }
        }
      }
    }

    const identity = await this.identityProvider()
    const pending = await this.ensurePending(ctx.remotePeerId)

    if (payload.phase === 'ack') {
      if (!payload.peerNonce || !constantTimeEqual(payload.peerNonce, pending.localNonce)) {
        return {
          ok: false,
          reason: 'invalid_signature',
          message: 'Nonce de confirmação do handshake E2EE não confere (possível replay).',
          remoteFingerprint,
          remoteIdentityPub: payload.identityPub,
        }
      }
    }

    const existing = this.sessions.get(ctx.remotePeerId)
    if (
      existing && existing.remoteIdentityPub === payload.identityPub &&
      pending.establishedRemoteNonce === payload.sessionNonce &&
      pending.establishedRemoteEphPub === payload.ephemeralPub
    ) {
      return this.confirmHandshake(existing, payload, ctx, identity, pending)
    }

    let remoteEphKey: CryptoKey
    try {
      remoteEphKey = await importEphemeralPublicKey(payload.ephemeralPub)
    } catch {
      return {
        ok: false,
        reason: 'invalid_payload',
        message: 'Chave efêmera ECDH inválida no handshake.',
        remoteFingerprint,
        remoteIdentityPub: payload.identityPub,
      }
    }

    const dtlsBound = Boolean(
      ctx.dtls?.local &&
        ctx.dtls?.remote &&
        payload.dtlsFingerprint &&
        constantTimeEqual(payload.dtlsFingerprint, ctx.dtls.remote)
    )

    const dtlsPart = dtlsBound
      ? [ctx.dtls!.local!, ctx.dtls!.remote!].sort().join('|')
      : 'no-dtls'

    const localSide = {
      fp: identity.fingerprint,
      ephPub: pending.localEphPubB64,
      nonce: pending.localNonce,
    }
    const remoteSide = {
      fp: remoteFingerprint,
      ephPub: payload.ephemeralPub,
      nonce: payload.sessionNonce,
    }
    const localIsLow =
      localSide.fp < remoteSide.fp ||
      (localSide.fp === remoteSide.fp && localSide.nonce <= remoteSide.nonce)
    const [low, high] = localIsLow ? [localSide, remoteSide] : [remoteSide, localSide]

    const transcriptHash = await sha256(
      utf8Bytes(
        [
          'lira-e2ee-v1',
          low.fp,
          high.fp,
          low.ephPub,
          high.ephPub,
          low.nonce,
          high.nonce,
          dtlsPart,
        ].join('|')
      )
    )

    const sharedBits = await deriveEcdhBits(pending.localEphKeyPair.privateKey, remoteEphKey)
    const rootKey = await hkdfDeriveBytes(sharedBits, transcriptHash, 'lira-e2ee-v1-root', 32)
    const lowToHigh = await hkdfDeriveBytes(rootKey, transcriptHash, 'lira-e2ee-v1-l2h', 32)
    const highToLow = await hkdfDeriveBytes(rootKey, transcriptHash, 'lira-e2ee-v1-h2l', 32)

    const sendChainKey = localIsLow ? lowToHigh : highToLow
    const recvChainKey = localIsLow ? highToLow : lowToHigh
    const sas = await deriveSas(rootKey, transcriptHash)

    const session: EstablishedE2EESession = {
      peerId: ctx.remotePeerId,
      remoteIdentityPub: payload.identityPub,
      remoteFingerprint,
      rootKey,
      sendChainKey,
      recvChainKey,
      sas,
      dtlsBound,
      establishedAt: now,
    }
    this.sessions.set(ctx.remotePeerId, session)
    pending.establishedRemoteNonce = payload.sessionNonce
    pending.establishedRemoteEphPub = payload.ephemeralPub

    return this.confirmHandshake(session, payload, ctx, identity, pending)
  }

  private async confirmHandshake(
    session: EstablishedE2EESession,
    payload: E2EEHandshakePayload,
    ctx: Parameters<E2EESessionManager['handleHandshake']>[1],
    identity: LocalIdentity,
    pending: PendingHandshake,
  ): Promise<E2EEHandshakeResult> {
    if (payload.phase === 'init') {
      const reply = await this.buildSignedPayload(identity, {
        v: 1,
        to: ctx.remotePeerId,
        from: ctx.localId,
        phase: 'ack',
        sessionNonce: pending.localNonce,
        peerNonce: payload.sessionNonce,
        identityPub: identity.publicKeyB64,
        ephemeralPub: pending.localEphPubB64,
        ...(ctx.dtls?.local ? { dtlsFingerprint: ctx.dtls.local } : {}),
        ...(ctx.dtls?.remote ? { remoteDtlsFingerprint: ctx.dtls.remote } : {}),
        timestamp: Date.now(),
      })
      return { ok: true, session, reply }
    }

    return { ok: true, session }
  }

  public getSession(peerId: string): EstablishedE2EESession | undefined {
    return this.sessions.get(peerId)
  }

  public removePeer(peerId: string): void {
    this.pending.delete(peerId)
    this.creating.delete(peerId)
    this.sessions.delete(peerId)
  }

  public clear(): void {
    this.pending.clear()
    this.creating.clear()
    this.sessions.clear()
  }
}
