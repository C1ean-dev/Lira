import { describe, it, expect } from 'vitest'
import { describeProcessGone, exitCodeName } from '../../electron/processGone'

describe('exitCodeName', () => {
  it('names the Windows exit codes worth knowing', () => {
    expect(exitCodeName(-1073741819)).toBe('ACCESS_VIOLATION')
    expect(exitCodeName(-1073741510)).toBe('CONTROL_C_EXIT')
    expect(exitCodeName(-1073740791)).toBe('STACK_BUFFER_OVERRUN')
    expect(exitCodeName(-1073741571)).toBe('STACK_OVERFLOW')
    expect(exitCodeName(-536870904)).toBe('OUT_OF_MEMORY')
    expect(exitCodeName(0xc0000005)).toBe('ACCESS_VIOLATION')
  })

  it('has no name for ordinary codes', () => {
    expect(exitCodeName(0)).toBeUndefined()
    expect(exitCodeName(1)).toBeUndefined()
    expect(exitCodeName(undefined)).toBeUndefined()
  })
})

describe('describeProcessGone', () => {
  it('treats a clean exit as information', () => {
    expect(describeProcessGone('child', { type: 'Utility', reason: 'clean-exit', exitCode: 0 })).toMatchObject({
      level: 'info',
      message: 'Child process gone: Utility (clean-exit, exit 0)',
    })
  })

  it('treats the Ctrl+C that ends a dev run as a warning, not as a crash', () => {
    const renderer = describeProcessGone('renderer', { reason: 'killed', exitCode: -1073741510 })
    expect(renderer).toMatchObject({
      level: 'warn',
      message: 'Render process gone: killed (exit 0xC000013A CONTROL_C_EXIT)',
    })
    expect(renderer).not.toHaveProperty('severity')
    expect(describeProcessGone('child', { type: 'GPU', reason: 'killed', exitCode: -1073741510 }).level).toBe('warn')
  })

  it('reports a renderer crash as fatal, with the exit code decoded', () => {
    expect(describeProcessGone('renderer', { reason: 'crashed', exitCode: -1073741819 })).toEqual({
      level: 'error',
      severity: 'fatal',
      message: 'Render process gone: crashed (exit 0xC0000005 ACCESS_VIOLATION)',
      data: { process: 'renderer', reason: 'crashed', exitCode: -1073741819, exitCodeHex: '0xC0000005', exitCodeName: 'ACCESS_VIOLATION' },
    })
  })

  it('reports a renderer that ran out of memory or could not start as fatal', () => {
    expect(describeProcessGone('renderer', { reason: 'oom', exitCode: -536870904 })).toMatchObject({ level: 'error', severity: 'fatal' })
    expect(describeProcessGone('renderer', { reason: 'launch-failed', exitCode: 1 })).toMatchObject({ level: 'error', severity: 'fatal' })
  })

  it('reports a child process crash as an error the app survives', () => {
    const report = describeProcessGone('child', { type: 'GPU', reason: 'crashed', exitCode: 1 })
    expect(report).toEqual({
      level: 'error',
      message: 'Child process gone: GPU (crashed, exit 1)',
      data: { process: 'GPU', reason: 'crashed', exitCode: 1 },
    })
  })

  it('names the service of a utility process', () => {
    const report = describeProcessGone('child', {
      type: 'Utility',
      reason: 'crashed',
      exitCode: -1073741819,
      name: 'Audio Service',
      serviceName: 'audio.mojom.AudioService',
    })
    expect(report.message).toBe('Child process gone: Utility Audio Service (crashed, exit 0xC0000005 ACCESS_VIOLATION)')
    expect(report.data).toMatchObject({ process: 'Utility', name: 'Audio Service', serviceName: 'audio.mojom.AudioService' })
  })

  it('treats a process killed from outside as a warning', () => {
    expect(describeProcessGone('renderer', { reason: 'killed', exitCode: 1 }).level).toBe('warn')
  })

  it('survives missing details', () => {
    expect(describeProcessGone('child', {})).toMatchObject({ level: 'error', message: 'Child process gone: unknown (unknown)' })
    expect(describeProcessGone('renderer', undefined as never)).toMatchObject({ level: 'error', message: 'Render process gone: unknown' })
  })
})
