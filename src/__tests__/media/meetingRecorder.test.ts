import { afterEach, expect, it, vi } from 'vitest'
import { MeetingRecorder } from '../../media/meetingRecorder'
import { useMeetingStore } from '../../store/useMeetingStore'

const original = useMeetingStore.getState()
afterEach(() => { useMeetingStore.setState(original); vi.unstubAllGlobals(); vi.useRealTimers() })
it('drains the last Whisper results after the call UI unmounts and archives only that meeting', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('AudioContext', class { resume = async () => {}; close = async () => {} })
  const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as any }
  const onEntry = vi.fn()
  const recorder = new MeetingRecorder(worker as any, { roomId: 'room', zoneId: 'zone', title: 'Review' }, { onStatus: vi.fn(), onEntry, onReady: vi.fn() })
  await recorder.start()
  worker.onmessage({ data: { type: 'ready' } })
  recorder.detach()
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'stop' })
  worker.onmessage({ data: { type: 'result', entry: { id: 1, speakerId: 'ana', speakerName: 'Ana', text: 'Última decisão.', timestamp: 10 } } })
  worker.onmessage({ data: { type: 'stopped' } })
  expect(onEntry).not.toHaveBeenCalled()
  expect(useMeetingStore.getState().meetings[0].entries[0].text).toBe('Última decisão.')
  expect(useMeetingStore.getState().meetings[0].endedAt).toBeDefined()
  expect(worker.terminate).toHaveBeenCalledOnce()
})
