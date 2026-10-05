import { useState, useEffect, useCallback } from 'react'

const STORAGE_FIREWALL_ALLOWED = 'lira_firewall_allowed'

export function useFirewallStatus() {
  const [isAllowed, setIsAllowed] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(STORAGE_FIREWALL_ALLOWED)
        return stored === 'true'
      }
    } catch (e) {}
    return true
  })
  const [isChecking, setIsChecking] = useState<boolean>(false)
  const [isRequesting, setIsRequesting] = useState<boolean>(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const checkStatus = useCallback(async () => {
    const api = (window as any).electronAPI
    if (api && typeof api.checkFirewallStatus === 'function') {
      try {
        setIsChecking(true)
        const res = await api.checkFirewallStatus()
        const allowed = !!res?.isAllowed
        setIsAllowed(allowed)
        if (allowed) {
          setFeedback(null)
          try {
            window.localStorage.setItem(STORAGE_FIREWALL_ALLOWED, 'true')
          } catch (e) {}
        }
      } catch (err) {
        // ignore
      } finally {
        setIsChecking(false)
      }
    }
  }, [])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  const requestAccess = useCallback(async () => {
    const api = (window as any).electronAPI
    if (api && typeof api.requestFirewallAccess === 'function') {
      try {
        setIsRequesting(true)
        setFeedback(null)
        const res = await api.requestFirewallAccess()
        if (res?.success) {
          setIsAllowed(true)
          try {
            window.localStorage.setItem(STORAGE_FIREWALL_ALLOWED, 'true')
          } catch (e) {}
          setFeedback({
            type: 'success',
            text: 'Regra de liberação adicionada ao Firewall do Windows com sucesso!',
          })
        } else {
          setFeedback({
            type: 'error',
            text: res?.error ? `Não foi possível liberar: ${res.error}` : 'Solicitação cancelada pelo usuário.',
          })
        }
      } catch (err: any) {
        setFeedback({
          type: 'error',
          text: `Erro: ${err.message || err}`,
        })
      } finally {
        setIsRequesting(false)
      }
    }
  }, [])

  return {
    isAllowed,
    isChecking,
    isRequesting,
    feedback,
    checkStatus,
    requestAccess,
  }
}
