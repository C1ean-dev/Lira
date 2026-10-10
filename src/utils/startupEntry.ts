import { markStartup, observeLongTasks, probeStorage } from './startupTrace'

try {
  performance.setResourceTimingBufferSize(2000)
} catch {
}
markStartup('entry')
observeLongTasks()
probeStorage()
