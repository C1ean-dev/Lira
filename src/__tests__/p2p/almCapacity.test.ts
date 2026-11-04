import { expect, it } from 'vitest'
import { AlmCapacity } from '../../p2p/almCapacity'
import { AlmTree } from '../../p2p/almTree'

const healthy = { sentBps: 10_000_000, deliveredBps: 10_000_000, bufferedBytes: 0, droppedFrames: 0, rttMs: 30 }

it('measures delivered throughput, sheds after sustained pressure and restores capacity after recovery', () => {
  const capacity = new AlmCapacity()
  const stressed = { ...healthy, deliveredBps: 5_000_000, bufferedBytes: 700_000 }
  capacity.observe(stressed, 3, 0)
  expect(capacity.observe(stressed, 3, 2000).children).toBe(3)
  expect(capacity.observe(stressed, 3, 4000).children).toBe(2)
  for (let time = 6000; time < 14000; time += 2000) expect(capacity.observe(healthy, 2, time).children).toBe(2)
  const restored = capacity.observe(healthy, 2, 14000)
  expect(restored.children).toBe(3)
  expect(restored.deliveredBps).toBeGreaterThan(5_000_000)
})

it('does not mistake a static desktop with low bitrate for insufficient upload', () => {
  const capacity = new AlmCapacity()
  for (let time = 0; time <= 20_000; time += 2000)
    expect(capacity.observe({ ...healthy, sentBps: 20_000, deliveredBps: 5000 }, 3, time).children).toBe(3)
})

it('prefers a measured healthy relay without changing existing parent connections', () => {
  const tree = new AlmTree('1')
  for (const id of ['2', '3', '4']) tree.add(id)
  tree.report('2', 3, 4_000_000, 500)
  tree.report('3', 3, 15_000_000, 20)
  tree.add('5')
  expect(tree.parents.get('5')).toBe('3')
  expect(tree.children('1')).toEqual(['2', '3', '4'])
})
