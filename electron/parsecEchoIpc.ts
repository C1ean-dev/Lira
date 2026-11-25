import type { ParsecEchoResult } from '../src/types/parsecEcho'

export interface ParsecEchoIpcHandler {
  (event: { sender: unknown; senderFrame: unknown }): Promise<ParsecEchoResult>
  run: () => Promise<ParsecEchoResult>
}

export function createParsecEchoHandler(
  getMainContents: () => { mainFrame: unknown } | null,
  configure: () => Promise<ParsecEchoResult>,
): ParsecEchoIpcHandler {
  let pending: Promise<ParsecEchoResult> | null = null
  const run = (): Promise<ParsecEchoResult> => {
    if (!pending) {
      pending = Promise.resolve().then(configure).finally(() => { pending = null })
    }
    return pending
  }
  const handler = ((event: { sender: unknown; senderFrame: unknown }): Promise<ParsecEchoResult> => {
    const contents = getMainContents()
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) {
      return Promise.resolve({ ok: false, error: 'Solicitação de configuração inválida.' })
    }
    return run()
  }) as ParsecEchoIpcHandler
  handler.run = run
  return handler
}
