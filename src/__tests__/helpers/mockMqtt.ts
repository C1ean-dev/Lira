import { vi } from 'vitest'

export class FakeMqttClient {
  connected = false
  events = new Map<string, Array<(...args: any[]) => void>>()
  subscribe = vi.fn((_topic: string, _options: unknown, callback: (error: Error | null) => void) => { callback(null) })
  publish = vi.fn()
  reconnect = vi.fn()
  end = vi.fn(() => { this.connected = false })
  removeAllListeners = vi.fn(() => { this.events.clear(); return this })
  constructor(public url: string, public options: Record<string, unknown>) {}
  on(event: string, listener: (...args: any[]) => void) { this.events.set(event, [...this.events.get(event) || [], listener]); return this }
  emit(event: string, ...args: unknown[]) {
    if (event === 'connect') this.connected = true
    if (event === 'close' || event === 'offline' || event === 'reconnect') this.connected = false
    for (const listener of this.events.get(event) || []) listener(...args)
  }
  receive(value: unknown) { this.emit('message', 'lira_public_hub/events', new TextEncoder().encode(JSON.stringify(value))) }
}
export const mqttMock = {
  clients: [] as FakeMqttClient[],
  connect: vi.fn((url: string, options: Record<string, unknown>) => {
    const client = new FakeMqttClient(url, options); mqttMock.clients.push(client); return client
  }),
  reset() { this.clients.length = 0; this.connect.mockClear() },
}

export const roomSockets: FakeRoomSocket[] = []
export class FakeRoomSocket {
  static OPEN = 1
  static CONNECTING = 0
  readyState = 0
  binaryType = ''
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => unknown) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn(() => { this.readyState = 3; this.onclose?.() })
  constructor(public url: string, public protocols?: string[]) { roomSockets.push(this) }
  open() { this.readyState = 1; this.onopen?.() }
  receive(value: unknown) { return this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) }) }
}
