import type { LocalIdentity } from './identityStore'
import {
  importIdentityPublicKey,
  signData,
  utf8Bytes,
  verifySignature,
} from './primitives'
import { deriveMediaKeyMaterial, type SFrameMediaKind } from './sframe'

export type CallDtlsSignalPayload = {
  to: string
  connectionId: string
  dtlsFingerprint: string
  signature: string
  timestamp: number
  kind?: 'main' | 'live-voice'
}

export interface DerivedPeerMediaKeys {
  send: { kid: number; rawKey: Uint8Array; salt: Uint8Array }
  recv: { kid: number; rawKey: Uint8Array; salt: Uint8Array }
}

interface WorkerLike {
  postMessage: (message: unknown, transfer?: Transferable[]) => void
  terminate: () => void
  onmessage: ((event: MessageEvent<any>) => void) | null
}

const DEFAULT_SIGNAL_SKEW_MS = 300_000

export function canonicalCallDtlsSignString(
  from: string,
  to: string,
  connectionId: string,
  dtlsFingerprint: string,
  timestamp: number
): string {
  return [
    'lira-e2ee-call-dtls-v1',
    from,
    to,
    connectionId,
    dtlsFingerprint,
    timestamp,
  ].join('|')
}

export async function signCallDtlsSignal(
  identity: LocalIdentity,
  from: string,
  to: string,
  connectionId: string,
  dtlsFingerprint: string,
  kind?: 'main' | 'live-voice',
  timestamp = Date.now()
): Promise<CallDtlsSignalPayload> {
  const canonical = canonicalCallDtlsSignString(
    from,
    to,
    connectionId,
    dtlsFingerprint,
    timestamp
  )
  const signature = await signData(identity.privateKey, utf8Bytes(canonical))
  return {
    to,
    connectionId,
    dtlsFingerprint,
    signature,
    timestamp,
    ...(kind ? { kind } : {}),
  }
}

export async function verifyCallDtlsSignal(
  from: string,
  payload: CallDtlsSignalPayload,
  expectedSenderPubB64: string,
  maxSkewMs = DEFAULT_SIGNAL_SKEW_MS
): Promise<boolean> {
  if (
    !payload ||
    typeof payload.to !== 'string' ||
    typeof payload.connectionId !== 'string' ||
    typeof payload.dtlsFingerprint !== 'string' ||
    typeof payload.signature !== 'string' ||
    !Number.isFinite(payload.timestamp)
  ) {
    return false
  }
  if (Math.abs(Date.now() - payload.timestamp) > maxSkewMs) {
    return false
  }
  try {
    const pubKey = await importIdentityPublicKey(expectedSenderPubB64)
    const canonical = canonicalCallDtlsSignString(
      from,
      payload.to,
      payload.connectionId,
      payload.dtlsFingerprint,
      payload.timestamp
    )
    return await verifySignature(pubKey, payload.signature, utf8Bytes(canonical))
  } catch {
    return false
  }
}

function hasScriptTransformApi(): boolean {
  return typeof (globalThis as any).RTCRtpScriptTransform === 'function'
}

function hasEncodedStreamsApi(): boolean {
  if (typeof RTCRtpSender === 'undefined') return false
  return typeof (RTCRtpSender.prototype as any).createEncodedStreams === 'function'
}

/**
 * Coordenador de SFrame Encoded Transforms para chamadas WebRTC 1:1 / zona / voz live.
 */
export class MediaE2EEManager {
  private worker: WorkerLike | null = null
  private configuredPeers = new Set<string>()
  private configuring = new Map<string, symbol>()
  private transformedSenders = new WeakSet<object>()
  private transformedReceivers = new WeakSet<object>()
  private attachedPcs = new WeakSet<RTCPeerConnection>()
  private onDecryptError?: (peerId: string, count: number) => void

  constructor(
    private readonly workerFactory?: () => WorkerLike,
    onDecryptError?: (peerId: string, count: number) => void
  ) {
    this.onDecryptError = onDecryptError
  }

  public isSupported(): boolean {
    if (this.workerFactory) return true
    return (
      typeof Worker === 'function' &&
      (hasScriptTransformApi() || hasEncodedStreamsApi())
    )
  }

  private ensureWorker(): WorkerLike | null {
    if (this.worker) return this.worker
    if (!this.isSupported()) return null
    try {
      const worker = this.workerFactory
        ? this.workerFactory()
        : (new Worker(new URL('./mediaTransform.worker.ts', import.meta.url), {
            type: 'module',
          }) as unknown as WorkerLike)
      worker.onmessage = (event) => {
        const data = event?.data
        if (data?.type === 'decrypt-error' && typeof data.peerId === 'string') {
          this.onDecryptError?.(data.peerId, Number(data.count) || 1)
        }
      }
      this.worker = worker
      return worker
    } catch {
      return null
    }
  }

  public async configurePeerKeys(
    peerId: string,
    localPeerId: string,
    rootKey: Uint8Array,
    kid = 0,
    keepPrevious = false
  ): Promise<DerivedPeerMediaKeys> {
    const operation = Symbol()
    this.configuring.set(peerId, operation)
    const send = await deriveMediaKeyMaterial(rootKey, localPeerId, peerId, kid)
    const recv = await deriveMediaKeyMaterial(rootKey, peerId, localPeerId, kid)
    if (this.configuring.get(peerId) !== operation) return { send, recv }
    this.configuring.delete(peerId)

    const worker = this.ensureWorker()
    if (worker) {
      worker.postMessage({
        type: 'set-key',
        peerId,
        direction: 'encrypt',
        kid: send.kid,
        rawKey: send.rawKey,
        salt: send.salt,
      })
      worker.postMessage({
        type: 'set-key',
        peerId,
        direction: 'decrypt',
        kid: recv.kid,
        rawKey: recv.rawKey,
        salt: recv.salt,
        keepPrevious,
      })
      this.configuredPeers.add(peerId)
    }

    return { send, recv }
  }

  public hasPeerKeys(peerId: string): boolean {
    return this.configuredPeers.has(peerId)
  }

  private attachSender(sender: RTCRtpSender, peerId: string, worker: WorkerLike, kind = sender.track?.kind): boolean {
    if (this.transformedSenders.has(sender)) return true
    const mediaType: SFrameMediaKind = kind === 'video' ? 'video' : 'audio'
    const ScriptTransform = (globalThis as any).RTCRtpScriptTransform
    if (typeof ScriptTransform === 'function' && 'transform' in sender) {
      ;(sender as any).transform = new ScriptTransform(worker, {
        peerId,
        direction: 'encrypt',
        mediaType,
      })
      this.transformedSenders.add(sender)
      return true
    }
    const createStreams = (sender as any).createEncodedStreams
    if (typeof createStreams === 'function') {
      const { readable, writable } = createStreams.call(sender)
      worker.postMessage(
        {
          type: 'transform-streams',
          peerId,
          direction: 'encrypt',
          mediaType,
          readable,
          writable,
        },
        [readable, writable]
      )
      this.transformedSenders.add(sender)
      return true
    }
    return false
  }

  private attachReceiver(
    receiver: RTCRtpReceiver,
    peerId: string,
    worker: WorkerLike,
    hintKind?: SFrameMediaKind
  ): boolean {
    if (this.transformedReceivers.has(receiver)) return true
    const mediaType: SFrameMediaKind =
      hintKind || (receiver.track?.kind === 'video' ? 'video' : 'audio')
    const ScriptTransform = (globalThis as any).RTCRtpScriptTransform
    if (typeof ScriptTransform === 'function' && 'transform' in receiver) {
      ;(receiver as any).transform = new ScriptTransform(worker, {
        peerId,
        direction: 'decrypt',
        mediaType,
      })
      this.transformedReceivers.add(receiver)
      return true
    }
    const createStreams = (receiver as any).createEncodedStreams
    if (typeof createStreams === 'function') {
      const { readable, writable } = createStreams.call(receiver)
      worker.postMessage(
        {
          type: 'transform-streams',
          peerId,
          direction: 'decrypt',
          mediaType,
          readable,
          writable,
        },
        [readable, writable]
      )
      this.transformedReceivers.add(receiver)
      return true
    }
    return false
  }

  public attachPeerConnection(
    pc: RTCPeerConnection | null | undefined,
    peerId: string,
    onFailure?: () => void,
  ): boolean {
    if (!pc || !peerId || !this.configuredPeers.has(peerId)) return false
    const worker = this.ensureWorker()
    if (!worker) return false

    try {
      const senders = pc.getSenders?.() ?? []
      const receivers = pc.getReceivers?.() ?? []
      const transceivers = pc.getTransceivers?.() ?? []
      if (senders.length + receivers.length === 0 ||
          !senders.every(sender => this.attachSender(sender, peerId, worker,
            sender.track?.kind ?? transceivers.find(t => t.sender === sender)?.receiver.track?.kind)) ||
          !receivers.every(receiver => this.attachReceiver(receiver, peerId, worker))) return false

      if (!this.attachedPcs.has(pc)) {
        if (pc.addTrack) {
          const addTrack = pc.addTrack.bind(pc)
          pc.addTrack = (track, ...streams) => {
            const sender = addTrack(track, ...streams)
            try {
              if (this.attachSender(sender, peerId, worker)) return sender
            } catch {}
            pc.close()
            onFailure?.()
            throw new Error('Não foi possível proteger a nova faixa da chamada')
          }
        }
        pc.addEventListener?.('track', (evt) => {
          const trackEvent = evt as RTCTrackEvent
          try {
            const kind = trackEvent.track?.kind === 'video' ? 'video' : 'audio'
            if (trackEvent.receiver && this.attachReceiver(trackEvent.receiver, peerId, worker, kind)) return
          } catch {}
          pc.close()
          onFailure?.()
        }, true)
        this.attachedPcs.add(pc)
      }
      return true
    } catch {
      return false
    }
  }

  public clearPeer(peerId: string): void {
    this.configuredPeers.delete(peerId)
    this.configuring.delete(peerId)
    this.worker?.postMessage({ type: 'clear-peer', peerId })
  }

  public clearAll(): void {
    this.configuredPeers.clear()
    this.configuring.clear()
    this.worker?.postMessage({ type: 'clear-all' })
  }

  public dispose(): void {
    this.configuredPeers.clear()
    this.configuring.clear()
    try {
      this.worker?.terminate()
    } catch {}
    this.worker = null
  }
}
