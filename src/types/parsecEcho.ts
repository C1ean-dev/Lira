export interface ParsecEchoResult {
  ok: boolean
  restartRequired?: boolean
  configPath?: string
  backupPath?: string
  error?: string
}
