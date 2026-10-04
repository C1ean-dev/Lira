import './utils/startupEntry'
import { installRendererLogging } from './utils/logger'
import { markStartup } from './utils/startupTrace'

// First thing: from here on console output and uncaught errors are logged.
installRendererLogging()

// index.html carries a splash while the app loads. Running the app's modules keeps the main thread busy
// for seconds, so the splash has to be painted first: the second animation frame starts after the first one
// was handed to the compositor, which goes on showing it (and spinning it) while the thread is busy.
// Nothing of the app is imported up front for that reason: bootstrap.tsx has all of it.
let started = false
const loadApp = () => {
  if (started) return
  started = true
  markStartup('splash')
  import('./bootstrap').catch((error) => {
    console.error('[Startup] could not load the app:', error)
    const status = document.getElementById('boot-splash-status')
    if (status) status.textContent = 'Não foi possível abrir o Lira. Feche e abra de novo.'
  })
}
requestAnimationFrame(() => requestAnimationFrame(loadApp))
// A window that is not being drawn (minimized, covered) gets no animation frames: do not wait for them.
setTimeout(loadApp, 1500)

