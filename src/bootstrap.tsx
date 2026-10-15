import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { markStartup } from './utils/startupTrace'
import './index.css'
import { initializeCustomAssets } from './store/useCustomAssetsStore'

markStartup('graph')

async function start() {
  await initializeCustomAssets()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
void start().catch(error => {
  console.error('[Assets] Startup failed:', error)
  const status = document.getElementById('boot-splash-status')
  if (status) status.textContent = 'Não foi possível carregar os assets. Seus dados foram preservados. Feche e abra novamente.'
})
