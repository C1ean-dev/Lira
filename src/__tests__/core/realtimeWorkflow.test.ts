import { existsSync, readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

describe('realtime regression tests in CI and locally', () => {
  it('keeps regression checks inside release.yml instead of a duplicate workflow', () => {
    expect(existsSync('.github/workflows/core-realtime.yml')).toBe(false)
    const workflow = load(readFileSync('.github/workflows/release.yml', 'utf8')) as any
    const steps = workflow.jobs['build-and-release'].steps as Array<{ run?: string }>
    expect(steps.some(step => /^npm test\b/.test(step.run ?? ''))).toBe(true)
    expect(steps.some(step => step.run === 'npx playwright install chromium')).toBe(true)
    expect(steps.some(step => step.run === 'npm run test:core:browser')).toBe(true)
  })

  it('preserves the local unit and browser test commands', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(scripts.test).toContain('vitest run src/__tests__')
    expect(scripts['test:core:browser']).toContain('scripts/core-realtime.browser.test.mjs')
  })
})
