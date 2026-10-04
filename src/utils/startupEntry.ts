import { markStartup, observeLongTasks, probeStorage } from './startupTrace'

// main.tsx imports this first, so it is the first module of the app to run: by then the browser
// has already fetched the whole module graph, and this mark says how long that took.
try {
  // The default buffer keeps 250 requests; in dev the modules alone are more than that.
  performance.setResourceTimingBufferSize(2000)
} catch {
  // not available
}
markStartup('entry')
observeLongTasks()
probeStorage()
