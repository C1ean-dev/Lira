import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function assertDevelopmentPortAvailable(port = 5173) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', error => {
      reject(error.code === 'EADDRINUSE'
        ? new Error(`A porta ${port} já está em uso. Encerre a execução anterior do Lira com Ctrl+C no terminal antes de iniciar outra. Nenhuma nova janela foi aberta.`)
        : error)
    })
    server.listen({ port, exclusive: true }, () => server.close(error => error ? reject(error) : resolve()))
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await assertDevelopmentPortAvailable() }
  catch (error) {
    console.error(`[Lira] ${error.message}`)
    process.exitCode = 1
  }
}
