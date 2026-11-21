import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

describe('release publication', () => {
  const workflow = load(readFileSync('.github/workflows/release.yml', 'utf8')) as any

  it('runs unit and core browser tests before packaging Windows and Android releases', () => {
    const steps = workflow.jobs['build-and-release'].steps
    const unitIndex = steps.findIndex((step: any) => /^npm test\b/.test(step.run ?? ''))
    const browserIndex = steps.findIndex((step: any) => step.run === 'npm run test:core:browser')
    const buildIndex = steps.findIndex((step: any) => step.run === 'npm run build')
    const releaseIndex = steps.findIndex((step: any) => step.uses === 'softprops/action-gh-release@v2')

    expect(unitIndex).toBeGreaterThan(-1)
    expect(browserIndex).toBeGreaterThan(unitIndex)
    expect(buildIndex).toBeGreaterThan(browserIndex)
    expect(releaseIndex).toBeGreaterThan(buildIndex)
    expect(workflow.jobs.android.uses).toBe('./.github/workflows/android.yml')
  })

  it('serializes version allocation through Windows, Android and release pruning', () => {
    // Manual runs on other refs also share the same release tag namespace.
    expect(workflow.concurrency?.group).toBe('lira-release-publication')
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(false)
    expect(workflow.jobs.android.needs).toBe('build-and-release')
    expect(workflow.jobs['prune-releases'].needs).toEqual(['build-and-release', 'android'])
    const pruneSteps = workflow.jobs['prune-releases'].steps
    expect(pruneSteps.some((step: any) => step.run === 'node scripts/prune-releases.mjs')).toBe(true)
  })

  it('refreshes tags before choosing a version and publishes the compiled commit', () => {
    const steps = workflow.jobs['build-and-release'].steps
    const versionStep = steps.find((step: any) => step.id === 'tag')
    const releaseStep = steps.find((step: any) => step.uses === 'softprops/action-gh-release@v2')

    expect(versionStep.run).toMatch(/git fetch origin --tags[\s\S]*node scripts\/bump-version\.js/)
    expect(releaseStep.with.target_commitish).toBe('${{ github.sha }}')
  })
})
