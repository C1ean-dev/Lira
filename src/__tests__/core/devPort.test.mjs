import { afterEach, expect, it } from 'vitest'
import net from 'node:net'
import { assertDevelopmentPortAvailable } from '../../../scripts/check-dev-port.mjs'

const servers = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

async function occupyPort() {
  const server = net.createServer()
  servers.push(server)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, resolve)
  })
  return server.address().port
}

it('rejects an occupied development port before either app is launched', async () => {
  const port = await occupyPort()
  await expect(assertDevelopmentPortAvailable(port)).rejects.toThrow(`A porta ${port} já está em uso`)
})

it('releases its probe so Vite can bind the available port', async () => {
  const port = await occupyPort()
  await new Promise(resolve => servers.pop().close(resolve))
  await assertDevelopmentPortAvailable(port)
  const server = net.createServer()
  servers.push(server)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, resolve)
  })
})
