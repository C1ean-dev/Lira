// Rotate positions between fixtures and reverse them on the next repetition.
// Every engine sees the same cases; none is always the cold first call.
export function conversationPlan(engines, pairCount, repetitions) {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 4) throw new Error('Invalid repetition count')
  const plan = []
  for (let repetition = 0; repetition < repetitions; repetition++) {
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
      const offset = pairIndex % engines.length
      const order = [...engines.slice(offset), ...engines.slice(0, offset)]
      if (repetition % 2) order.reverse()
      for (const engine of order) plan.push({ engine, pairIndex, repetition, id: `${engine}-${pairIndex}-r${repetition}` })
    }
  }
  return plan
}
