import './utils/startupEntry'
import { installRendererLogging } from './utils/logger'
import { markStartup } from './utils/startupTrace'

installRendererLogging()

markStartup('bootstrap')
import('./bootstrap').catch((error) => {
  console.error('[Startup] could not load the app:', error)
  const status = document.getElementById('boot-splash-status')
  if (status) status.textContent = 'Não foi possível abrir o Lira. Feche e abra de novo.'
})

