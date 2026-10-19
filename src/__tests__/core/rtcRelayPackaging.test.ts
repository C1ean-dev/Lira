import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { parse } from 'dotenv'
import { describe, expect, it } from 'vitest'
import { buildIceServers } from '../../p2p/rtcIceServers'

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

  it.each([
    ['release.yml', 'build-and-release', 'Build and Package Electron App'],
    ['android.yml', 'build-apk', 'Build web bundle'],
  ])('passes authenticated TURN settings into the bundle built by %s', (file, job, stepName) => {
    const workflow = load(readFileSync(`.github/workflows/${file}`, 'utf8')) as any
    const step = workflow.jobs[job].steps.find((candidate: any) => candidate.name === stepName)
    const secrets: Record<string, string> = {
      VITE_TURN_URLS: 'turn:relay.example.com:3478,turns:relay.example.com:443?transport=tcp',
      VITE_TURN_USERNAME: 'app-relay-user',
      VITE_TURN_CREDENTIAL: 'test-relay-credential',
    }
    const env = Object.fromEntries(Object.keys(secrets).map(key => {
      const binding = step.env?.[key]?.match(/^\$\{\{\s*secrets\.([A-Z_]+)\s*\}\}$/)
      expect(binding, `${stepName} must receive ${key} from repository secrets`).toBeTruthy()
      return [key, secrets[binding![1]]]
    }))
    expect(buildIceServers(env)).toContainEqual({
      urls: ['turn:relay.example.com:3478', 'turns:relay.example.com:443?transport=tcp'],
      username: secrets.VITE_TURN_USERNAME,
      credential: secrets.VITE_TURN_CREDENTIAL,
    })
  })

  it.each([
    ['release.yml', 'build-and-release', 'Build and Package Electron App'],
    ['android.yml', 'build-apk', 'Build web bundle'],
  ])('bundles only the credential service URL for Cloudflare in %s', (file, job, stepName) => {
    const workflow = load(readFileSync(`.github/workflows/${file}`, 'utf8')) as any
    const env = workflow.jobs[job].steps.find((step: any) => step.name === stepName).env
    expect(env.VITE_TURN_CREDENTIALS_URL).toBe('${{ secrets.VITE_TURN_CREDENTIALS_URL }}')
    expect(Object.keys(env).some(key => /CLOUDFLARE.*TOKEN|CLOUDFLARE.*KEY/.test(key))).toBe(false)
  })
})
