const synchronized = new WeakSet<MediaStream>()
export interface AlmAudioOutput {
  setConsumer(key: object, output: { muted: boolean; volume: number; sinkId?: string }): void
  removeConsumer(key: object): void
  level(): number
}
const outputs = new WeakMap<MediaStream, AlmAudioOutput>()
export function markAlmStream(stream: MediaStream, output?: AlmAudioOutput): void {
  synchronized.add(stream)
  if (output) outputs.set(stream, output)
}
export function isAlmStream(stream: MediaStream): boolean { return synchronized.has(stream) }
export function almAudioOutput(stream: MediaStream): AlmAudioOutput | undefined { return outputs.get(stream) }
