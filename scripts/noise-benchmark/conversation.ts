import type { ConversationPeer } from './conversation-peer'

const captureSource = `class ConversationCapture extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.offset = 0;
    this.channels = Array.from({length:12},()=>new Float32Array(options.processorOptions.samples));
  }
  process(inputs) {
    if (this.offset >= this.channels[0].length) return true;
    const count = Math.min(128,this.channels[0].length-this.offset);
    for(let i=0;i<12;i++) if(inputs[0]?.[i]) this.channels[i].set(inputs[0][i].subarray(0,count),this.offset);
    this.offset+=count;
    if(this.offset===this.channels[0].length) {
      const buffers=this.channels.map(channel=>channel.buffer);
      this.port.postMessage(buffers,buffers);
    }
    return true;
  }
}; registerProcessor('conversation-capture',ConversationCapture);`

function base64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let text = ''
  for (let offset = 0; offset < bytes.length; offset += 0x4000) text += String.fromCharCode(...bytes.subarray(offset, offset + 0x4000))
  return btoa(text)
}

async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 60000) {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Conversation timed out: ' + label)
}

Object.assign(window, { conversationBenchmark: {
  async run(config: { urls: string[]; engine: string; signalingPort: number; room: string; variant?: string; encodedProbe?: boolean; warmupMs?: number }) {
    const context = new AudioContext({ sampleRate: 48000 })
    const frames: HTMLIFrameElement[] = []
    const participants: ConversationPeer[] = []
    const sourceNodes: AudioBufferSourceNode[] = []
    const inputNodes: MediaStreamAudioDestinationNode[] = []
    const warmupNodes: AudioBufferSourceNode[] = []
    let recorder: AudioWorkletNode | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let moduleUrl: string | undefined
    try {
      await context.resume()
      const samples = await Promise.all(config.urls.map(async url => {
        const response = await fetch(url)
        if (!response.ok) throw new Error('Missing Microsoft fixture')
        return new Float32Array(await response.arrayBuffer())
      }))
      if (samples[0].length !== samples[1].length) throw new Error('Input lengths differ')
      const inputs = samples.map(values => {
        const buffer = context.createBuffer(1, values.length, 48000)
        buffer.copyToChannel(values, 0)
        const source = context.createBufferSource()
        source.buffer = buffer
        sourceNodes.push(source)
        const input = context.createMediaStreamDestination()
        inputNodes.push(input)
        source.connect(input)
        return input.stream
      })
      for (let i = 0; i < 2; i++) {
        console.log('[conversation-stage] loading participant ' + i)
        const frame = document.createElement('iframe')
        frame.allow = 'autoplay'
        frames.push(frame)
        frame.src = '/participant.html'
        document.body.append(frame)
        await until(() => Boolean((frame.contentWindow as any)?.conversationPeer), 'participant script')
        const participant = (frame.contentWindow as any).conversationPeer as ConversationPeer
        participants.push(participant)
        await participant.configure(inputs[i], config.engine, config.signalingPort, i ? 'Microsoft B' : 'Microsoft A', config.variant, config.encodedProbe)
      }
      if (config.variant === 'prewarm-model') {
        console.log('[conversation-stage] warming engines for 15 seconds before opening any peer connection')
        await new Promise(resolve => setTimeout(resolve, 15000))
      }
      console.log('[conversation-stage] opening room ' + config.engine)
      await participants[0].create(config.room)
      console.log('[conversation-stage] host room created')
      await participants[1].join(config.room)
      console.log('[conversation-stage] guest joined')
      await until(async () => (await Promise.all(participants.map(participant => participant.connected()))).every(Boolean), 'bidirectional Lira call')
      console.log('[conversation-stage] connected, opening remote playback')
      const playback = await Promise.all(participants.map(participant => participant.playback()))
      if (config.warmupMs) {
        // Warm the SAME microphone/processor/RTP graphs with actual fixture
        // audio, not silence, before starting the scored source and recorder.
        for (const [index, source] of sourceNodes.entries()) {
          const warmup = context.createBufferSource()
          warmup.buffer = source.buffer
          warmup.loop = true
          warmup.connect(inputNodes[index])
          warmup.start()
          warmupNodes.push(warmup)
        }
        await new Promise(resolve => setTimeout(resolve, config.warmupMs))
        warmupNodes.forEach(source => { source.stop(); source.disconnect() })
        warmupNodes.length = 0
      }
      if (config.variant?.startsWith('settled')) {
        console.log('[conversation-stage] allowing 15 seconds for startup buffers to settle')
        await new Promise(resolve => setTimeout(resolve, 15000))
      }
      const before = await Promise.all(participants.map(participant => participant.stats()))
      const measurementStartMs = performance.timeOrigin + performance.now()
      const merger = context.createChannelMerger(12)
      const streamNodes = new Map<MediaStreamTrack, MediaStreamAudioSourceNode>()
      for (let i = 0; i < 2; i++) {
        const offset = i * 6
        // Direction i sends from i and receives at 1-i. Reference and every
        // downstream stage enter one recorder, eliminating clock-sync estimates.
        sourceNodes[i].connect(merger, 0, offset)
        const streams = [inputs[i], participants[i].local(), playback[1 - i].decoded, playback[1 - i].gain, playback[1 - i].played]
        streams.forEach((stream, index) => {
          // Object identity matters: remote RTP can preserve a sender track ID.
          // Only the exact same track (bypass mic/local) may share a source.
          const key = stream.getAudioTracks()[0]
          let node = streamNodes.get(key)
          if (!node) { node = context.createMediaStreamSource(stream); streamNodes.set(key, node) }
          node.connect(merger, 0, offset + index + 1)
        })
      }
      moduleUrl = URL.createObjectURL(new Blob([captureSource], { type: 'text/javascript' }))
      await context.audioWorklet.addModule(moduleUrl)
      recorder = new AudioWorkletNode(context, 'conversation-capture', { channelCount: 12, channelCountMode: 'explicit', outputChannelCount: [1], processorOptions: { samples: samples[0].length + 48000 * 3 } })
      merger.connect(recorder)
      recorder.connect(context.destination) // Recorder produces silence.
      const captured = new Promise<ArrayBuffer[]>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Conversation recorder timeout')), 20000)
        recorder!.port.onmessage = event => { clearTimeout(timer); resolve(event.data) }
      })
      const start = context.currentTime + 0.25
      sourceNodes.forEach(source => source.start(start))
      console.log('[conversation-stage] recording ' + config.engine)
      const channels = await captured
      const measurementEndMs = performance.timeOrigin + performance.now()
      const after = await Promise.all(participants.map(participant => participant.stats()))
      return { channels: channels.map(base64), measurementStartMs, measurementEndMs, participants: participants.map((participant, index) => ({ ...participant.status(), before: before[index], after: after[index], frames: participant.frames() })),
        context: { sampleRate: context.sampleRate, baseLatency: context.baseLatency, outputLatency: context.outputLatency,
          channelOrder: ['source', 'virtualMicBridge', 'localProcessed', 'remoteDecoded', 'remoteGain', 'remoteAudioElement'], clock: 'one shared AudioWorklet sample clock for both directions' } }
    } finally {
      clearTimeout(timer)
      warmupNodes.forEach(source => { try { source.stop(); source.disconnect() } catch {} })
      recorder?.port.close()
      recorder?.disconnect()
      for (const participant of participants) { try { participant.dispose() } catch {} }
      frames.forEach(frame => frame.remove())
      await context.close()
      if (moduleUrl) URL.revokeObjectURL(moduleUrl)
    }
  },
} })
