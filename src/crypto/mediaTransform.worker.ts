import { SFrameCryptoContext, type SFrameMediaKind } from './sframe'

export type MediaTransformControlMessage =
  | {
      type: 'set-key'
      peerId: string
      direction: 'encrypt' | 'decrypt'
      kid: number
      rawKey: Uint8Array
      salt: Uint8Array
      keepPrevious?: boolean
    }
  | {
      type: 'clear-peer'
      peerId: string
    }
  | {
      type: 'clear-all'
    }
  | {
      type: 'transform-streams'
      peerId: string
      direction: 'encrypt' | 'decrypt'
      mediaType: SFrameMediaKind
      readable: ReadableStream<EncodedFrameLike>
      writable: WritableStream<EncodedFrameLike>
    }

interface EncodedFrameLike {
  data: ArrayBuffer
  type?: 'key' | 'delta' | string
}

interface RtcTransformEventLike {
  transformer: {
    options?: {
      peerId?: string
      direction?: 'encrypt' | 'decrypt'
      mediaType?: SFrameMediaKind
    }
    readable: ReadableStream<EncodedFrameLike>
    writable: WritableStream<EncodedFrameLike>
  }
}

interface WorkerScopeLike {
  onmessage: ((event: MessageEvent<MediaTransformControlMessage>) => void) | null
  onrtctransform: ((event: RtcTransformEventLike) => void) | null
  postMessage: (message: unknown) => void
}

const contexts = new Map<string, SFrameCryptoContext>()
const decryptErrorCounts = new Map<string, number>()

function getOrCreateContext(peerId: string): SFrameCryptoContext {
  let ctx = contexts.get(peerId)
  if (!ctx) {
    ctx = new SFrameCryptoContext()
    contexts.set(peerId, ctx)
  }
  return ctx
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  return buf
}

function attachPipeline(
  peerId: string,
  direction: 'encrypt' | 'decrypt',
  mediaType: SFrameMediaKind,
  readable: ReadableStream<EncodedFrameLike>,
  writable: WritableStream<EncodedFrameLike>,
  post: (msg: unknown) => void
): void {
  const transformer = new TransformStream<EncodedFrameLike, EncodedFrameLike>({
    async transform(frame, controller) {
      const ctx = contexts.get(peerId)
      if (!ctx) return
      const input = new Uint8Array(frame.data)

      if (direction === 'encrypt') {
        if (!ctx.hasSendKey()) return
        try {
          const encrypted = await ctx.encryptFrame(
            input,
            mediaType,
            frame.type === 'key'
          )
          frame.data = toExactArrayBuffer(encrypted)
          controller.enqueue(frame)
        } catch {
          // Fail-closed: drop outbound frame if encryption fails
        }
        return
      }

      if (!ctx.hasRecvKeys()) return
      try {
        const decrypted = await ctx.decryptFrame(input)
        frame.data = toExactArrayBuffer(decrypted)
        controller.enqueue(frame)
      } catch {
        const nextCount = (decryptErrorCounts.get(peerId) || 0) + 1
        decryptErrorCounts.set(peerId, nextCount)
        if (nextCount === 1 || nextCount % 50 === 0) {
          post({ type: 'decrypt-error', peerId, count: nextCount })
        }
      }
    },
  })

  void readable.pipeThrough(transformer).pipeTo(writable).catch(() => {})
}

const scope = self as unknown as WorkerScopeLike

scope.onmessage = (event: MessageEvent<MediaTransformControlMessage>) => {
  const msg = event.data
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'set-key') {
    const ctx = getOrCreateContext(msg.peerId)
    const material = {
      kid: msg.kid,
      rawKey: new Uint8Array(msg.rawKey),
      salt: new Uint8Array(msg.salt),
    }
    const installKey = msg.direction === 'encrypt'
      ? ctx.setSendKey(material)
      : ctx.setRecvKey(material, msg.keepPrevious === true)
    void installKey.catch(() => {
      if (contexts.get(msg.peerId) === ctx) scope.postMessage({ type: 'key-error', peerId: msg.peerId })
    })
    return
  }

  if (msg.type === 'clear-peer') {
    contexts.get(msg.peerId)?.clear()
    contexts.delete(msg.peerId)
    decryptErrorCounts.delete(msg.peerId)
    return
  }

  if (msg.type === 'clear-all') {
    for (const ctx of contexts.values()) {
      ctx.clear()
    }
    contexts.clear()
    decryptErrorCounts.clear()
    return
  }

  if (msg.type === 'transform-streams') {
    attachPipeline(
      msg.peerId,
      msg.direction,
      msg.mediaType,
      msg.readable,
      msg.writable,
      (payload) => scope.postMessage(payload)
    )
  }
}

scope.onrtctransform = (event: RtcTransformEventLike) => {
  const { transformer } = event
  const options = transformer.options || {}
  const peerId = options.peerId
  const direction = options.direction
  const mediaType: SFrameMediaKind = options.mediaType === 'video' ? 'video' : 'audio'
  if (!peerId || (direction !== 'encrypt' && direction !== 'decrypt')) {
    return
  }
  attachPipeline(
    peerId,
    direction,
    mediaType,
    transformer.readable,
    transformer.writable,
    (payload) => scope.postMessage(payload)
  )
}
