import { DefaultReporter } from 'vitest/node'
import { SLOW_TEST_MS, compactNotices, slowTestLine } from './quiet-test-output.mjs'

export default class QuietVitestReporter extends DefaultReporter {
  constructor() { super({ isTTY: false, summary: false }); this.notices = new Set() }

  onInit(ctx) {
    this.ctx = ctx
    this.silent = false
  }

  onTestModuleEnd() {}
  reportTestSummary() {}

  onTestCaseResult(test) {
    const duration = test.diagnostic()?.duration || 0
    if (test.result().state === 'passed' && duration > SLOW_TEST_MS) {
      this.log(slowTestLine(test.module.moduleId + ' > ' + test.fullName, duration).trimEnd())
    }
  }

  onUserConsoleLog(log) {
    for (const notice of compactNotices(log.content, log.type, this.notices)) this.error(notice)
  }
  // DefaultReporter's final error reporting remains enabled, including collection
  // failures, assertion diffs, unhandled exceptions and async leaks.
}
