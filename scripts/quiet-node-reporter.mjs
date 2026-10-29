import { inspect } from 'node:util'
import { SLOW_TEST_MS, compactNotices, slowTestLine } from './quiet-test-output.mjs'

export default async function* quietNodeReporter(events) {
  const notices = new Set()
  for await (const { type, data } of events) {
    if (type === 'test:pass' && !data.skip && !data.todo && data.details?.type !== 'suite' && data.details?.duration_ms > SLOW_TEST_MS) {
      yield slowTestLine([data.file, data.name].filter(Boolean).join(' > '), data.details.duration_ms)
    } else if (type === 'test:fail' && !data.todo) {
      yield `[ERRO] ${[data.file, data.name].filter(Boolean).join(' > ')}\n`
      yield inspect(data.details?.error || data, { colors: false, depth: null }) + '\n'
    } else if (['test:stderr', 'test:stdout', 'test:diagnostic'].includes(type)) {
      for (const notice of compactNotices(data.message, type === 'test:stderr' ? 'stderr' : 'stdout', notices)) yield notice + '\n'
    }
  }
}
