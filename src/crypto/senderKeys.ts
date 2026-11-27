import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  deriveChainStep,
  fromBase64Url,
  importIdentityPublicKey,
  randomBytes,
  signData,
  toBase64Url,
  utf8Bytes,
  utf8Decode,
  verifySignature,
} from './primitives'
import { MAX_SKIPPED_KEYS } from './ratchet'
import type { LocalIdentity } from './identityStore'

export type SenderKeyScope = 'room' | `zone:${string}`

export interface SenderKeyDistributionPayload {
  version: 1
  senderId: string
  scope: string
  epoch: number
  seq: number
  chainKeyB64: string
  senderPubB64: string
  signature: string
}

export interface GroupCipherEnvelope {
  version: 1
  senderId: string
  scope: string
  epoch: number
  seq: number
  iv: string
  ciphertext: string
  signature: string
  attachmentDigest?: string
}

interface OutboundSenderState {
  epoch: number
  chainKey: Uint8Array
  seq: number
  distributedPeers: Set<string>
}

interface InboundSenderState {
  epoch: number
  chainKey: Uint8Array
  recvSeq: number
  senderPubB64: string
  skippedKeys: Map<number, Uint8Array>
  seenSeqs: Set<number>
}

const MAX_SEEN_SEQS = 512

function buildDistributionSignBytes(
  senderId: string,
  scope: string,
  epoch: number,
  seq: number,
  chainKeyB64: string
): Uint8Array {
  return utf8Bytes(`lira-e2ee-v1-sk-dist|${senderId}|${scope}|${epoch}|${seq}|${chainKeyB64}`)
}

function buildGroupAad(
  senderId: string,
  scope: string,
  epoch: number,
  seq: number,
  attachmentDigest?: string
): Uint8Array {
  return utf8Bytes(
    `lira-e2ee-v1-group-aad|${senderId}|${scope}|${epoch}|${seq}|${attachmentDigest ?? ''}`
  )
}

function buildGroupSignBytes(envelope: Omit<GroupCipherEnvelope, 'signature'>): Uint8Array {
  return utf8Bytes(
    `lira-e2ee-v1-group-msg|${envelope.senderId}|${envelope.scope}|${envelope.epoch}|${envelope.seq}|${envelope.iv}|${envelope.ciphertext}|${envelope.attachmentDigest ?? ''}`
  )
}

function trackSeen(seen: Set<number>, seq: number): void {
  seen.add(seq)
  if (seen.size > MAX_SEEN_SEQS) {
    const oldest = seen.values().next().value
    if (oldest !== undefined) {
      seen.delete(oldest)
    }
  }
}

/**
 * Gerenciador de Sender Keys para canais da sala (`room`) e zonas isoladas (`zone:<zoneId>`).
 * Cada remetente possui sua propria cadeia por escopo e epoca; a saida ou remocao de um
 * participante rotaciona a epoca para garantir forward secrecy e isolamento de zona.
 */
export class SenderKeyManager {
  private outbound = new Map<string, OutboundSenderState>()
  private inbound = new Map<string, InboundSenderState>()
  private queues = new Map<string, Promise<unknown>>()

  private enqueue<T>(key: string, op: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve()
    const next = prev.then(op, op)
    const settled = next.then(
      () => undefined,
      () => undefined
    )
    this.queues.set(key, settled)
    return next
  }

  private remoteKey(senderId: string, scope: string): string {
    return `${senderId}::${scope}`
  }

  public getOrCreateOutbound(scope: string): OutboundSenderState {
    let state = this.outbound.get(scope)
    if (!state) {
      state = {
        epoch: 1,
        chainKey: randomBytes(32),
        seq: 0,
        distributedPeers: new Set(),
      }
      this.outbound.set(scope, state)
    }
    return state
  }

  public rotateScope(scope: string): number {
    const prev = this.outbound.get(scope)
    const nextEpoch = (prev?.epoch ?? 0) + 1
    this.outbound.set(scope, {
      epoch: nextEpoch,
      chainKey: randomBytes(32),
      seq: 0,
      distributedPeers: new Set(),
    })
    return nextEpoch
  }

  public rotateAllActiveScopes(): void {
    for (const scope of Array.from(this.outbound.keys())) {
      this.rotateScope(scope)
    }
  }

  public needsDistribution(scope: string, peerId: string): boolean {
    const state = this.outbound.get(scope)
    if (!state) return true
    return !state.distributedPeers.has(peerId)
  }

  public markDistributed(scope: string, peerId: string): void {
    const state = this.outbound.get(scope)
    state?.distributedPeers.add(peerId)
  }

  public unmarkPeer(peerId: string): void {
    for (const state of this.outbound.values()) {
      state.distributedPeers.delete(peerId)
    }
  }

  public clearRemotePeer(senderId: string, scope?: string): void {
    if (scope) {
      this.inbound.delete(this.remoteKey(senderId, scope))
      return
    }
    const prefix = `${senderId}::`
    for (const key of Array.from(this.inbound.keys())) {
      if (key.startsWith(prefix)) {
        this.inbound.delete(key)
      }
    }
  }

  public clear(): void {
    this.outbound.clear()
    this.inbound.clear()
    this.queues.clear()
  }

  public exportDistribution(
    scope: string,
    senderId: string,
    localIdentity: LocalIdentity
  ): Promise<SenderKeyDistributionPayload> {
    return this.enqueue(`out::${scope}`, async () => {
      const state = this.getOrCreateOutbound(scope)
      const chainKeyB64 = toBase64Url(state.chainKey)
      const signBytes = buildDistributionSignBytes(
        senderId,
        scope,
        state.epoch,
        state.seq,
        chainKeyB64
      )
      const signature = await signData(localIdentity.privateKey, signBytes)
      return {
        version: 1,
        senderId,
        scope,
        epoch: state.epoch,
        seq: state.seq,
        chainKeyB64,
        senderPubB64: localIdentity.publicKeyB64,
        signature,
      }
    })
  }

  public async acceptDistribution(
    dist: SenderKeyDistributionPayload,
    pinnedSenderPubB64?: string
  ): Promise<void> {
    const expectedPub = pinnedSenderPubB64 ?? dist.senderPubB64
    if (pinnedSenderPubB64 && dist.senderPubB64 !== pinnedSenderPubB64) {
      throw new Error(`Sender key distribution identity mismatch for ${dist.senderId}`)
    }
    if (!Number.isInteger(dist.seq) || dist.seq < 0) {
      throw new Error(`Invalid sender key seq ${dist.seq} from ${dist.senderId}`)
    }
    const pubKey = await importIdentityPublicKey(expectedPub)
    const signBytes = buildDistributionSignBytes(
      dist.senderId,
      dist.scope,
      dist.epoch,
      dist.seq,
      dist.chainKeyB64
    )
    const valid = await verifySignature(pubKey, dist.signature, signBytes)
    if (!valid) {
      throw new Error(`Invalid sender key distribution signature from ${dist.senderId}`)
    }
    const chainKey = fromBase64Url(dist.chainKeyB64)
    if (chainKey.byteLength !== 32) {
      throw new Error(`Invalid sender chain key length from ${dist.senderId}`)
    }

    const rKey = this.remoteKey(dist.senderId, dist.scope)
    const existing = this.inbound.get(rKey)
    if (existing && dist.epoch <= existing.epoch) {
      throw new Error(
        `Rejected stale/downgrade sender key epoch ${dist.epoch} <= ${existing.epoch} for ${dist.senderId}`
      )
    }

    this.inbound.set(rKey, {
      epoch: dist.epoch,
      chainKey,
      recvSeq: dist.seq,
      senderPubB64: expectedPub,
      skippedKeys: new Map(),
      seenSeqs: new Set(),
    })
  }

  public hasInboundSenderKey(senderId: string, scope: string): boolean {
    return this.inbound.has(this.remoteKey(senderId, scope))
  }

  public encryptGroupJson(
    scope: string,
    senderId: string,
    localIdentity: LocalIdentity,
    payload: unknown,
    attachmentDigest?: string
  ): Promise<GroupCipherEnvelope> {
    return this.enqueue(`out::${scope}`, async () => {
      const state = this.getOrCreateOutbound(scope)
      const seq = state.seq
      const epoch = state.epoch
      const step = await deriveChainStep(state.chainKey, `lira-e2ee-v1-sk|${scope}|${epoch}`)
      const aad = buildGroupAad(senderId, scope, epoch, seq, attachmentDigest)
      const plaintext = utf8Bytes(JSON.stringify(payload))
      const { ivB64, ciphertextB64 } = await aesGcmEncrypt(step.messageKey, plaintext, aad)

      const unsigned: Omit<GroupCipherEnvelope, 'signature'> = {
        version: 1,
        senderId,
        scope,
        epoch,
        seq,
        iv: ivB64,
        ciphertext: ciphertextB64,
        ...(attachmentDigest ? { attachmentDigest } : {}),
      }
      const signature = await signData(localIdentity.privateKey, buildGroupSignBytes(unsigned))

      state.chainKey = step.nextChainKey
      state.seq = seq + 1

      return {
        ...unsigned,
        signature,
      }
    })
  }

  public decryptGroupJson<T = unknown>(
    envelope: GroupCipherEnvelope,
    pinnedSenderPubB64?: string
  ): Promise<T> {
    const rKey = this.remoteKey(envelope.senderId, envelope.scope)
    return this.enqueue(`in::${rKey}`, async () => {
      const state = this.inbound.get(rKey)
      if (!state) {
        throw new Error(`No sender key for ${envelope.senderId} in scope ${envelope.scope}`)
      }
      if (envelope.epoch !== state.epoch) {
        throw new Error(
          `Epoch mismatch for ${envelope.senderId} in ${envelope.scope}: got ${envelope.epoch}, expected ${state.epoch}`
        )
      }
      const expectedPub = pinnedSenderPubB64 ?? state.senderPubB64
      if (pinnedSenderPubB64 && state.senderPubB64 !== pinnedSenderPubB64) {
        throw new Error(`Sender public key mismatch for ${envelope.senderId}`)
      }
      const pubKey = await importIdentityPublicKey(expectedPub)
      const { signature, ...unsigned } = envelope
      const sigValid = await verifySignature(pubKey, signature, buildGroupSignBytes(unsigned))
      if (!sigValid) {
        throw new Error(`Invalid group envelope signature from ${envelope.senderId}`)
      }

      const { seq, iv, ciphertext, senderId, scope, epoch, attachmentDigest } = envelope
      if (!Number.isInteger(seq) || seq < 0) {
        throw new Error(`Invalid group sequence: ${seq}`)
      }
      if (state.seenSeqs.has(seq)) {
        throw new Error(`Replay detected in ${scope} from ${senderId} seq ${seq}`)
      }

      const aad = buildGroupAad(senderId, scope, epoch, seq, attachmentDigest)
      const skipped = state.skippedKeys.get(seq)
      if (skipped) {
        const plainBytes = await aesGcmDecrypt(skipped, iv, ciphertext, aad)
        const parsed = JSON.parse(utf8Decode(plainBytes)) as T
        state.skippedKeys.delete(seq)
        trackSeen(state.seenSeqs, seq)
        return parsed
      }

      if (seq < state.recvSeq) {
        throw new Error(`Missing skipped group key for seq ${seq} (recvSeq=${state.recvSeq})`)
      }

      const skipCount = seq - state.recvSeq
      if (skipCount > MAX_SKIPPED_KEYS) {
        throw new Error(`Group ratchet skip gap ${skipCount} exceeds limit ${MAX_SKIPPED_KEYS}`)
      }

      let candidateChain = state.chainKey
      const pendingSkipped = new Map<number, Uint8Array>()
      for (let cursor = state.recvSeq; cursor < seq; cursor++) {
        const step = await deriveChainStep(candidateChain, `lira-e2ee-v1-sk|${scope}|${epoch}`)
        pendingSkipped.set(cursor, step.messageKey)
        candidateChain = step.nextChainKey
      }

      const targetStep = await deriveChainStep(candidateChain, `lira-e2ee-v1-sk|${scope}|${epoch}`)
      const plainBytes = await aesGcmDecrypt(targetStep.messageKey, iv, ciphertext, aad)
      const parsed = JSON.parse(utf8Decode(plainBytes)) as T

      state.chainKey = targetStep.nextChainKey
      state.recvSeq = seq + 1
      for (const [kSeq, kBytes] of pendingSkipped.entries()) {
        state.skippedKeys.set(kSeq, kBytes)
        if (state.skippedKeys.size > MAX_SKIPPED_KEYS) {
          const oldest = state.skippedKeys.keys().next().value
          if (oldest !== undefined) {
            state.skippedKeys.delete(oldest)
          }
        }
      }
      trackSeen(state.seenSeqs, seq)

      return parsed
    })
  }
}
