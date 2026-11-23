export interface ParsecEchoResult {
  ok: boolean
  restartRequired?: boolean
  restarted?: boolean
  alreadyConfigured?: boolean
  configPath?: string
  backupPath?: string
  error?: string
}
