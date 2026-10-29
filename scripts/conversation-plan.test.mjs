import test from 'node:test'
import assert from 'node:assert/strict'
import { conversationPlan } from './conversation-plan.mjs'

test('balances cold/order effects and gives each repeat its own reference', () => {
  const engines = ['bypass', 'classic', 'rnnoise', 'deepfilter']
  const plan = conversationPlan(engines, 4, 2)
  assert.equal(plan.length, 32)
  assert.equal(new Set(plan.map(row => row.id)).size, 32)
  for (let pair = 0; pair < 4; pair++) {
    const first = plan.filter(row => row.pairIndex === pair && row.repetition === 0)
    const second = plan.filter(row => row.pairIndex === pair && row.repetition === 1)
    assert.deepEqual(second.map(row => row.engine), first.map(row => row.engine).reverse())
    assert.equal(first.filter(row => row.engine === 'bypass').length, 1)
    assert.equal(second.filter(row => row.engine === 'bypass').length, 1)
  }
  const firstPositions = plan.filter(row => row.repetition === 0).filter((_, index) => index % 4 === 0)
  assert.deepEqual(new Set(firstPositions.map(row => row.engine)), new Set(engines))
})
