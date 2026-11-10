import { afterEach, expect, it } from 'vitest'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { appTrail } from '../../utils/breadcrumbs'

afterEach(() => appTrail.clear())

it('distinguishes the TURN client transport from the UDP relay candidate in diagnostics', async () => {
  const pc = { getStats: async () => new Map<string, object>([
    ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
    ['pair', { type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote', currentRoundTripTime: 0.030 }],
    ['local', { candidateType: 'relay', protocol: 'udp', relayProtocol: 'tcp' }],
    ['remote', { candidateType: 'srflx', protocol: 'udp' }],
  ]) }
  await MediaCallHandler.logReceiverSnapshot({ peerConnection: pc, connectionId: 'call' } as any, 'peer', 'periodic', () => true)
  expect(appTrail.stats()['p2p/receiver-stats']).toEqual(expect.objectContaining({ event: 'receiver-stats', data: expect.objectContaining({
    route: { localType: 'relay', remoteType: 'srflx', protocol: 'udp', relayProtocol: 'tcp', rttMs: 30 },
  }) }))
})
