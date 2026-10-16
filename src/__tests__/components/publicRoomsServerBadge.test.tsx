import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PublicRoomsTab } from '../../components/lobby/PublicRoomsTab'

const broker = vi.hoisted(() => ({
  status: 'connected',
  serverHost: 'broker.emqx.io' as string | null,
  servers: [
    { name: 'EMQX', host: 'broker.emqx.io', status: 'connected' },
    { name: 'HiveMQ', host: 'broker.hivemq.com', status: 'disconnected' },
    { name: 'Render', host: 'lira-signaling.onrender.com', status: 'disconnected' },
  ],
  isResolving: false,
  feedback: null,
  resolveConnection: vi.fn(),
}))
vi.mock('../../hooks/useBrokerStatus', () => ({ useBrokerStatus: () => broker }))

function renderTab() {
  return renderToStaticMarkup(<PublicRoomsTab
    publicRooms={[]} filteredPublicRooms={[]} searchQuery="" setSearchQuery={() => {}}
    isRefreshing={false} handleManualRefresh={() => {}} copiedRoomCode={null}
    handleCopyCode={() => {}} handleJoinPublicRoom={() => {}} handleJoinByCode={() => {}} loading={false}
  />)
}

describe('public rooms server badge', () => {
  beforeEach(() => {
    broker.status = 'connected'
    broker.serverHost = 'broker.emqx.io'
    broker.servers[0].status = 'connected'
    broker.servers[1].status = 'disconnected'
    broker.servers[2].status = 'disconnected'
  })

  it.each([
    ['connected', 'connected', 'Conectado', 'Conectado'],
    ['connecting', 'connecting', 'Conectando...', 'Conectando...'],
    ['connected', 'disconnected', 'Conectado', 'Não conectado'],
    ['disconnected', 'connected', 'Não conectado', 'Conectado'],
    ['connecting', 'disconnected', 'Conectando...', 'Não conectado'],
    ['disconnected', 'connecting', 'Não conectado', 'Conectando...'],
    ['disconnected', 'disconnected', 'Não conectado', 'Não conectado'],
  ])('shows both servers separately (EMQX=%s, HiveMQ=%s)', (emqx, hive, emqxText, hiveText) => {
    broker.servers[0].status = emqx
    broker.servers[1].status = hive
    const html = renderTab()
    expect(html).toContain(`aria-label="EMQX: ${emqxText}"`)
    expect(html).toContain(`aria-label="HiveMQ: ${hiveText}"`)
    expect(html).toContain('title="broker.emqx.io"')
    expect(html).toContain('title="broker.hivemq.com"')
    expect(html).toContain('aria-label="Render: Não conectado"')
    expect(html).toContain('aria-label="Servidores de salas"')
  })

  it('shows Render connected independently of the two MQTT servers', () => {
    broker.servers[0].status = 'disconnected'
    broker.servers[1].status = 'disconnected'
    broker.servers[2].status = 'connected'
    const html = renderTab()
    expect(html).toContain('aria-label="Render: Conectado"')
    expect(html).toContain('title="lira-signaling.onrender.com"')
    expect(html).toContain('aria-label="EMQX: Não conectado"')
    expect(html).toContain('aria-label="HiveMQ: Não conectado"')
  })

  it('shows RabbitMQ through Render when the backend advertises it', () => {
    broker.servers.push({ name: 'RabbitMQ', host: 'jaragua.lmq.cloudamqp.com', status: 'connected' })
    try {
      const html = renderTab()
      expect(html).toContain('aria-label="RabbitMQ: Conectado"')
      expect(html).toContain('title="jaragua.lmq.cloudamqp.com"')
    } finally { broker.servers.pop() }
  })

  it.each(['connecting', 'disconnected'])('does not announce a server as available while %s', status => {
    broker.status = status
    broker.serverHost = null
    broker.servers[0].status = status
    const html = renderTab()
    expect(html).not.toContain('aria-label="EMQX: Conectado"')
    expect(html).not.toContain('aria-label="HiveMQ: Conectado"')
    expect(html).toContain(status === 'connecting' ? 'Conectando...' : 'Não conectado')
  })
})
