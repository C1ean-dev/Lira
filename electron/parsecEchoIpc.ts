import type { ParsecEchoResult } from '../src/types/parsecEcho'

export function createParsecEchoHandler(
  getMainContents: () => { mainFrame: unknown } | null,
  configure: () => Promise<ParsecEchoResult>,
) {
  let pending: Promise<ParsecEchoResult> | null = null
  return (event: { sender: unknown; senderFrame: unknown }): Promise<ParsecEchoResult> => {
    const contents = getMainContents()
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) {
      return Promise.resolve({ ok: false, error: 'Solicitação de configuração inválida.' })
    }
    if (!pending) {
      pending = Promise.resolve().then(configure).finally(() => { pending = null })
    }
    return pending
  }
}
