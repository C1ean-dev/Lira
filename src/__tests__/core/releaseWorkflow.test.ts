import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

describe('release publication', () => {
  const workflow = load(readFileSync('.github/workflows/release.yml', 'utf8')) as any

  it('preserves Windows packaging and Android publication without running tests', () => {
    const steps = workflow.jobs['build-and-release'].steps
    expect(steps.some((step: any) => step.run === 'npm run build')).toBe(true)
    expect(steps.some((step: any) => /npm (?:test|run test:)/.test(step.run ?? ''))).toBe(false)
    expect(workflow.jobs.android.uses).toBe('./.github/workflows/android.yml')
  })

  it('serializes version allocation through Windows and Android publication', () => {
    // Manual runs on other refs also share the same release tag namespace.
    expect(workflow.concurrency?.group).toBe('lira-release-publication')
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(false)
    expect(workflow.jobs.android.needs).toBe('build-and-release')
  })

  it('refreshes tags before choosing a version and publishes the compiled commit', () => {
    const steps = workflow.jobs['build-and-release'].steps
    const versionStep = steps.find((step: any) => step.id === 'tag')
    const releaseStep = steps.find((step: any) => step.uses === 'softprops/action-gh-release@v2')

    expect(versionStep.run).toMatch(/git fetch origin --tags[\s\S]*node scripts\/bump-version\.js/)
    expect(releaseStep.with.target_commitish).toBe('${{ github.sha }}')
  })
})
