/** A loss recovery trial uses reliable TURN transports when the provider offers
 * them. Initial connections continue to use the usual direct/UDP preference. */
export function selectVoiceRecoveryServers(servers: RTCIceServer[]): RTCIceServer[] {
  const reliable = servers.flatMap(server => {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
      .filter(url => /^turns:/i.test(url) || /^turn:.*\?transport=tcp$/i.test(url))
    return urls.length ? [{ ...server, urls: Array.isArray(server.urls) ? urls : urls[0] }] : []
  })
  return reliable.length ? reliable : servers
}
