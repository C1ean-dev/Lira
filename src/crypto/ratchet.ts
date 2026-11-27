import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  deriveChainStep,
  utf8Bytes,
  utf8Decode,
} from './primitives'

export const MAX_SKIPPED_KEYS = 256
const MAX_SEEN_SEQS = 512

export interface DirectCipherEnvelope {
  version: 1
  senderId: string
  recipientId: string
  seq: number
  iv: string
  ciphertext: string
}

interface PeerRatchetState {
  sessionId: string
  sendChainKey: Uint8Array
  sendSeq: number
  recvChainKey: Uint8Array
  recvSeq: number
  skippedKeys: Map<number, Uint8Array>
  seenSeqs: Set<number>
}

function buildDirectAad(senderId: string, recipientId: string, seq: number): Uint8Array {
  return utf8Bytes(`lira-e2ee-v1-dm|${senderId}|${recipientId}|${seq}`)
}

function trackSeenSeq(seenSeqs: Set<number>, seq: number): void {
  seenSeqs.add(seq)
  if (seenSeqs.size > MAX_SEEN_SEQS) {
    const oldest = seenSeqs.values().next().value
    if (oldest !== undefined) {
      seenSeqs.delete(oldest)
    }
  }
}

/**
 * Gerenciador de ratchet simetrico 1:1 para DMs e distribuicao de Sender Keys.
 * Garante forward secrecy por mensagem e previne DoS de cadeia nao comitando
 * estado de recepcao antes da descriptografia + parse JSON validarem.
 */
export class PairwiseRatchetManager {
  private states = new Map<string, PeerRatchetState>()
  private peerQueues = new Map<string, Promise<unknown>>()

  private enqueue<T>(peerId: string, op: () => Promise<T>): Promise<T> {
    const prev = this.peerQueues.get(peerId) ?? Promise.resolve()
    const next = prev.then(op, op)
    const settled = next.then(
      () => undefined,
      () => undefined
    )
    this.peerQueues.set(peerId, settled)
    return next
  }

  public initSession(
    peerId: string,
    sendChainKey: Uint8Array,
    recvChainKey: Uint8Array,
    sessionId?: string
  ): void {
    const nextSessionId = sessionId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.states.set(peerId, {
      sessionId: nextSessionId,
      sendChainKey: new Uint8Array(sendChainKey),
      sendSeq: 0,
      recvChainKey: new Uint8Array(recvChainKey),
      recvSeq: 0,
      skippedKeys: new Map(),
      seenSeqs: new Set(),
    })
  }

  public hasSession(peerId: string): boolean {
    return this.states.has(peerId)
  }

  public removeSession(peerId: string): void {
    this.states.delete(peerId)
  }

  public clear(): void {
    this.states.clear()
    this.peerQueues.clear()
  }

  public encryptJson(
    peerId: string,
    senderId: string,
    recipientId: string,
    payload: unknown
  ): Promise<DirectCipherEnvelope> {
    return this.enqueue(peerId, async () => {
      const state = this.states.get(peerId)
      if (!state) {
        throw new Error(`No active ratchet session for peer ${peerId}`)
      }
      const seq = state.sendSeq
      const { nextChainKey, messageKey } = await deriveChainStep(
        state.sendChainKey,
        'lira-e2ee-v1-dm-chain'
      )
      const aad = buildDirectAad(senderId, recipientId, seq)
      const plaintext = utf8Bytes(JSON.stringify(payload))
      const { ivB64, ciphertextB64 } = await aesGcmEncrypt(messageKey, plaintext, aad)

      state.sendChainKey = nextChainKey
      state.sendSeq = seq + 1

      return {
        version: 1,
        senderId,
        recipientId,
        seq,
        iv: ivB64,
        ciphertext: ciphertextB64,
      }
    })
  }

  public decryptJson<T = unknown>(
    peerId: string,
    envelope: DirectCipherEnvelope
  ): Promise<T> {
    return this.enqueue(peerId, async () => {
      const state = this.states.get(peerId)
      if (!state) {
        throw new Error(`No active ratchet session for peer ${peerId}`)
      }

      const { senderId, recipientId, seq, iv, ciphertext } = envelope
      if (!Number.isInteger(seq) || seq < 0) {
        throw new Error(`Invalid ratchet sequence: ${seq}`)
      }
      if (state.seenSeqs.has(seq)) {
        throw new Error(`Replay detected for peer ${peerId} seq ${seq}`)
      }

      const aad = buildDirectAad(senderId, recipientId, seq)
      const skippedKey = state.skippedKeys.get(seq)

      if (skippedKey) {
        const plainBytes = await aesGcmDecrypt(skippedKey, iv, ciphertext, aad)
        const parsed = JSON.parse(utf8Decode(plainBytes)) as T
        state.skippedKeys.delete(seq)
        trackSeenSeq(state.seenSeqs, seq)
        return parsed
      }

      if (seq < state.recvSeq) {
        throw new Error(`Missing skipped key for past seq ${seq} (recvSeq=${state.recvSeq})`)
      }

      const skipCount = seq - state.recvSeq
      if (skipCount > MAX_SKIPPED_KEYS) {
        throw new Error(`Ratchet skip gap ${skipCount} exceeds limit ${MAX_SKIPPED_KEYS}`)
      }

      let candidateChain = state.recvChainKey
      const pendingSkipped = new Map<number, Uint8Array>()

      for (let cursor = state.recvSeq; cursor < seq; cursor++) {
        const step = await deriveChainStep(candidateChain, 'lira-e2ee-v1-dm-chain')
        pendingSkipped.set(cursor, step.messageKey)
        candidateChain = step.nextChainKey
      }

      const targetStep = await deriveChainStep(candidateChain, 'lira-e2ee-v1-dm-chain')
      const plainBytes = await aesGcmDecrypt(targetStep.messageKey, iv, ciphertext, aad)
      const parsed = JSON.parse(utf8Decode(plainBytes)) as T

      // Commit state only AFTER AEAD tag verification + JSON parsing succeed.
      state.recvChainKey = targetStep.nextChainKey
      state.recvSeq = seq + 1
      for (const [kSeq, kBytes] of pendingSkipped.entries()) {
        state.skippedKeys.set(kSeq, kBytes)
        if (state.skippedKeys.size > MAX_SKIPPED_KEYS) {
          const oldestKey = state.skippedKeys.keys().next().value
          if (oldestKey !== undefined) {
            state.skippedKeys.delete(oldestKey)
          }
        }
      }
      trackSeenSeq(state.seenSeqs, seq)

      return parsed
    })
  }
}
