import { z } from 'zod'

const session = z.uuid()
export const gstreamerSignalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('watch'), session }),
  z.object({ kind: z.literal('end'), session, retry: z.literal(true).optional() }),
  z.object({ kind: z.literal('ready'), session }),
  z.object({
    kind: z.literal('sdp'), session,
    description: z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().min(1).max(131072) }),
    dtlsSig: z.string().min(32).max(256).optional(),
  }),
  z.object({
    kind: z.literal('ice'), session,
    candidate: z.object({ candidate: z.string().min(1).max(2048), sdpMLineIndex: z.number().int().min(0).max(16) }),
  }),
])

export type GStreamerSignal = z.infer<typeof gstreamerSignalSchema>
export interface GStreamerCapture {
  sourceId: string
  width: number
  height: number
  fps: number
}
export interface GStreamerCaptureAPI {
  startGStreamerCapture(id: string, capture: GStreamerCapture): Promise<boolean>
  stopGStreamerCapture(id: string): Promise<void>
  sendGStreamerSignal(id: string, signal: GStreamerSignal): Promise<boolean>
  onGStreamerSignal(listener: (id: string, signal: GStreamerSignal | null) => void): () => void
}

function h264Payloads(media: string) {
  return [...media.matchAll(/^a=rtpmap:(\d+)[ \t]+H264\/90000[ \t]*\r?$/gim)].map(match => match[1])
}

export function normalizeGStreamerOffer(sdp: string): string {
  return sdp.split(/(?=^m=)/m).map(media => {
    if (!media.startsWith('m=video ')) return media
    const payloads = h264Payloads(media)
    return media.replace(/^a=fmtp:(\d+)[ \t]+[^\r\n]+/gm, (line, payload) => {
      if (!payloads.includes(payload)) return line
      // AMF sets constraint_set5 on Baseline. libwebrtc's Baseline SDP match requires it clear.
      return line.replace(/(\bprofile-level-id[ \t]*=[ \t]*)4204([\da-f]{2})(?=[; \t]|$)/gi,
        (_value, prefix, level) => `${prefix}4200${level}`)
    })
  }).join('')
}

export function acceptsGStreamerVideo(sdp: string): boolean {
  return sdp.split(/(?=^m=)/m).some(media => {
    if (!media.startsWith('m=video ') || /^a=inactive\r?$/m.test(media)) return false
    const [, port, , ...payloads] = media.split(/\r?\n/, 1)[0].trim().split(/\s+/)
    return Number(port) > 0 && h264Payloads(media).some(payload => payloads.includes(payload))
  })
}
