type DjPeer = {
  on: (event: 'open' | 'error', listener: (...args: any[]) => void) => unknown
  off: (event: 'open' | 'error', listener: (...args: any[]) => void) => unknown
}

export function waitForDjPeerReady(peer: DjPeer, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      peer.off('open', onOpen)
      peer.off('error', onError)
    }
    const onOpen = () => { cleanup(); resolve() }
    const onError = (error: Error) => { cleanup(); reject(error) }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('O DJ não conseguiu conectar à sala. Tente novamente.'))
    }, timeoutMs)
    peer.on('open', onOpen)
    peer.on('error', onError)
  })
}
