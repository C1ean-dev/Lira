import { DefaultReporter } from 'vitest/node'
import { SLOW_TEST_MS, compactNotices, slowTestLine } from './quiet-test-output.mjs'

export default class QuietVitestReporter extends DefaultReporter {
  constructor() {
    super({ isTTY: false, summary: false })
    this.notices = new Set()
    this.pendingLogs = new Map()
    this.results = new Map()
  }

  onInit(ctx) {
    this.ctx = ctx
    this.silent = false
  }

  onTestModuleEnd() {
    for (const [id, logs] of this.pendingLogs) {
      const entity = this.ctx?.state?.getReportedEntityById(id)
      const state = entity?.type === 'test' ? entity.result().state : entity?.state()
      if (state === 'pending' || state === 'queued') continue
      if (state === 'failed' || !entity) for (const log of logs) this.printNotice(log)
      this.pendingLogs.delete(id)
      if (state) this.results.set(id, state)
    }
  }
  reportTestSummary() {}

  onTestCaseResult(test) {
    const state = test.result().state
    if (test.id) {
      this.results.set(test.id, state)
      if (state === 'failed') for (const log of this.pendingLogs.get(test.id) || []) this.printNotice(log)
      this.pendingLogs.delete(test.id)
    }
    const duration = test.diagnostic()?.duration || 0
    if (state === 'passed' && duration > SLOW_TEST_MS) {
      this.log(slowTestLine(test.module.moduleId + ' > ' + test.fullName, duration).trimEnd())
    }
  }

  onUserConsoleLog(log) {
    if (!log.taskId || log.taskId === '__vitest__unknown_test__') return this.printNotice(log)
    const state = this.results.get(log.taskId)
    if (state === 'failed') return this.printNotice(log)
    if (state) return
    const logs = this.pendingLogs.get(log.taskId) || []
    logs.push(log)
    this.pendingLogs.set(log.taskId, logs)
  }

  printNotice(log) {
    for (const notice of compactNotices(log.content, log.type, this.notices)) this.error(notice)
  }
  // DefaultReporter's final error reporting remains enabled, including collection
  // failures, assertion diffs, unhandled exceptions and async leaks.
}
