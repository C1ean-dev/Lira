import { readFileSync } from 'node:fs'
import { parse } from 'dotenv'
import { describe, expect, it } from 'vitest'
import { buildIceServers } from '../../p2p/rtcIceServers'
import { buildEnvironment } from '../../../scripts/local-release.mjs'

describe('relay configuration in published apps', () => {
  it('provides a Metered environment template that activates every relay route after credentials are supplied', () => {
    const template = parse(readFileSync('.env.example', 'utf8'))
    expect(template.VITE_TURN_USERNAME).toBe('')
    expect(template.VITE_TURN_CREDENTIAL).toBe('')
    expect(buildIceServers(template).length).toBe(2)

    const servers = buildIceServers({
      ...template,
      VITE_TURN_USERNAME: 'template-test-user',
      VITE_TURN_CREDENTIAL: 'template/test+credential=',
    })
    const urls = servers.flatMap(server => typeof server.urls === 'string' ? [server.urls] : server.urls)
    expect(urls.filter(url => /^turns?:/.test(url))).toEqual([
      'turn:global.relay.metered.ca:80',
      'turn:global.relay.metered.ca:80?transport=tcp',
      'turn:global.relay.metered.ca:443',
      'turns:global.relay.metered.ca:443?transport=tcp',
    ])
  })

  it.each(['windows', 'android'])('passes local authenticated TURN settings into the %s bundle', platform => {
    const secrets: Record<string, string> = {
      VITE_TURN_URLS: 'turn:relay.example.com:3478,turns:relay.example.com:443?transport=tcp',
      VITE_TURN_USERNAME: 'app-relay-user',
      VITE_TURN_CREDENTIAL: 'test-relay-credential',
    }
    const env = { ...buildEnvironment(secrets, '1.1.207'), ...(platform === 'android' ? { LIRA_TARGET: 'web' } : {}) }
    expect(buildIceServers(env)).toContainEqual({
      urls: ['turn:relay.example.com:3478', 'turns:relay.example.com:443?transport=tcp'],
      username: secrets.VITE_TURN_USERNAME,
      credential: secrets.VITE_TURN_CREDENTIAL,
    })
  })

  it('preserves the Cloudflare credential service URL without requiring a workflow secret', () => {
    const env = buildEnvironment({ VITE_TURN_CREDENTIALS_URL: 'https://relay.test/credentials' }, '1.1.207')
    expect(env.VITE_TURN_CREDENTIALS_URL).toBe('https://relay.test/credentials')
  })
})
