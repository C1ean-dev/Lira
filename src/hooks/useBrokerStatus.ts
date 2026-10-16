import { useState, useEffect, useCallback } from 'react'
import { PublicRoomsService, BrokerConnectionStatus, BrokerServerStatus } from '../services/publicRoomsService'

export function useBrokerStatus() {
  const service = PublicRoomsService.getInstance()
  const [{ status, serverHost, servers }, setConnection] = useState<{
    status: BrokerConnectionStatus
    serverHost: string | null
    servers: BrokerServerStatus[]
  }>(() => ({ status: service.getBrokerStatus(), serverHost: service.getBrokerServerHost(), servers: service.getBrokerServers() }))
  const [isResolving, setIsResolving] = useState<boolean>(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    return service.subscribeBrokerStatus((newStatus) => {
      setConnection({ status: newStatus, serverHost: service.getBrokerServerHost(), servers: service.getBrokerServers() })
      if (newStatus === 'connected') {
        setFeedback(null)
      }
    })
  }, [service])

  const resolveConnection = useCallback(async () => {
    setIsResolving(true)
    setFeedback(null)

    try {
      const api = (window as any).electronAPI
      if (api && typeof api.requestFirewallAccess === 'function') {
        try {
          await api.requestFirewallAccess()
        } catch (e) {
        }
      }

      const isConnected = await service.testConnection()
      if (isConnected) {
        setFeedback({
          type: 'success',
          text: 'Conexão estabelecida com sucesso com o broker de salas!',
        })
      } else {
        setFeedback({
          type: 'error',
          text: 'Não foi possível conectar ao broker. Verifique sua conexão ou tente outro Wi-Fi.',
        })
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: 'Erro ao tentar restabelecer a conexão.',
      })
    } finally {
      setIsResolving(false)
    }
  }, [service])

  return {
    status,
    serverHost,
    servers,
    isResolving,
    feedback,
    resolveConnection,
  }
}
