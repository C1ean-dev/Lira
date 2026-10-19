/// <reference types="vite/client" />

interface Window {
  electronAPI?: import('../electron/preload').IElectronAPI
}

declare module 'virtual:lira-individual-library' { const exists: boolean; export default exists }

declare module 'virtual:lira-asset-atlases' {
  const xmlFileNames: string[]
  export default xmlFileNames
}

interface ImportMetaEnv {
  readonly VITE_TURN_CREDENTIALS_URL?: string
  readonly VITE_TURN_URLS?: string
  readonly VITE_TURN_USERNAME?: string
  readonly VITE_TURN_CREDENTIAL?: string
}
