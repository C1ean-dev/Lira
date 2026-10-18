import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

describe('realtime regression workflow', () => {
  it('runs the regression suite only on Windows and preserves browser coverage', () => {
    const workflow = load(readFileSync('.github/workflows/core-realtime.yml', 'utf8')) as any
    const job = workflow.jobs.test
    const runners = job.strategy?.matrix?.os ?? [job['runs-on']]

    expect(runners).toEqual(['windows-latest'])
    expect(job.steps.map((step: any) => step.run)).toEqual(expect.arrayContaining([
      'npm test',
      'npm run test:core:browser',
    ]))
  })
})
