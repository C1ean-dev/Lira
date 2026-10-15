import { describe, expect, it } from 'vitest'
import { buildIceServers } from '../../p2p/rtcIceServers'

describe('call ICE servers', () => {
  it('uses discovery servers without anonymous TURN credentials by default', () => {
    expect(buildIceServers({})).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ])
  })

  it('uses explicitly configured authenticated UDP and TLS relays', () => {
    expect(buildIceServers({
      VITE_TURN_URLS: ' turn:relay.example.com:3478, turns:relay.example.com:443?transport=tcp ',
      VITE_TURN_USERNAME: 'relay-user',
      VITE_TURN_CREDENTIAL: 'relay-password',
    }).slice(2)).toEqual([{
      urls: ['turn:relay.example.com:3478', 'turns:relay.example.com:443?transport=tcp'],
      username: 'relay-user',
      credential: 'relay-password',
    }])
  })

  it.each([
    { VITE_TURN_URLS: 'turn:relay.example.com:3478' },
    { VITE_TURN_URLS: 'turn:relay.example.com:3478', VITE_TURN_USERNAME: 'user' },
    { VITE_TURN_URLS: 'https://relay.example.com', VITE_TURN_USERNAME: 'user', VITE_TURN_CREDENTIAL: 'password' },
    { VITE_TURN_URLS: 'turn:', VITE_TURN_USERNAME: 'user', VITE_TURN_CREDENTIAL: 'password' },
    { VITE_TURN_URLS: 'turn:relay.example.com:3478,https://bad.example.com', VITE_TURN_USERNAME: 'user', VITE_TURN_CREDENTIAL: 'password' },
  ])('keeps discovery usable when relay settings are incomplete or invalid: %j', env => {
    expect(buildIceServers(env)).toEqual(buildIceServers({}))
  })
})
