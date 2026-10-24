import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

describe('local regression tests', () => {
  it('removes the dedicated GitHub Actions test workflow', () => {
    expect(existsSync('.github/workflows/core-realtime.yml')).toBe(false)
  })

  it('keeps test execution and browser installation out of every CI workflow', () => {
    for (const file of readdirSync('.github/workflows').filter(file => /\.ya?ml$/.test(file))) {
      const workflow = load(readFileSync(`.github/workflows/${file}`, 'utf8')) as any
      for (const job of Object.values(workflow.jobs) as any[]) {
        for (const step of job.steps ?? []) {
          expect(step.run ?? '', `${file}: ${step.name ?? 'run'}`).not.toMatch(
            /\b(?:npm\s+(?:test|run\s+test[^\s]*)|npx\s+(?:vitest|playwright)|node\s+--test)\b/,
          )
        }
      }
    }
  })

  it('preserves the local unit and browser test commands', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(scripts.test).toContain('vitest run src/__tests__')
    expect(scripts['test:core:browser']).toContain('scripts/core-realtime.browser.test.mjs')
  })
})
