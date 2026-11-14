import { describe, expect, it } from 'vitest'
import { selectVoiceRecoveryServers } from '../../p2p/voiceRecoveryServers'

describe('relay selection after sustained voice loss', () => {
  it('uses TCP/TLS alternatives when UDP is already losing voice packets', () => {
    const servers = [
      { urls: 'stun:stun.example:3478' },
      { urls: ['turn:relay.example:3478?transport=udp', 'turn:relay.example:3478?transport=tcp', 'turns:relay.example:443'],
        username: 'temporary', credential: 'secret' },
    ]
    expect(selectVoiceRecoveryServers(servers)).toEqual([{
      urls: ['turn:relay.example:3478?transport=tcp', 'turns:relay.example:443'], username: 'temporary', credential: 'secret',
    }])
    expect(servers[1].urls).toHaveLength(3)
  })

  it('preserves UDP-only providers so unavailable TCP never removes the last alternative', () => {
    const servers = [{ urls: 'turn:relay.example:3478?transport=udp', username: 'temporary', credential: 'secret' }]
    expect(selectVoiceRecoveryServers(servers)).toEqual(servers)
  })

  it('accepts a single TLS URL and preserves authentication', () => {
    const servers = [{ urls: 'turns:relay.example:443?transport=tcp', username: 'temporary', credential: 'secret' }]
    expect(selectVoiceRecoveryServers(servers)).toEqual(servers)
  })
})
