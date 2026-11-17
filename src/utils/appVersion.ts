import pkg from '../../package.json'

declare const __APP_VERSION__: string | undefined

export const CURRENT_APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : pkg.version
