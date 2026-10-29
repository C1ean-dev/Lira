"""Run unittest files with warnings, failures and tests slower than 5000ms only."""
import argparse
import contextlib
import importlib.util
import io
import re
import sys
import time
import unittest


class QuietResult(unittest.TestResult):
    def __init__(self, slow_ms):
        super().__init__()
        self.slow_ms = slow_ms

    def startTest(self, test):
        super().startTest(test)
        self.started = time.perf_counter()

    def addSuccess(self, test):
        super().addSuccess(test)
        duration = (time.perf_counter() - self.started) * 1000
        if duration > self.slow_ms:
            print(f'[LENTO] {test.id()} ({duration:.1f}ms)', file=sys.stderr)

    def addFailure(self, test, error):
        super().addFailure(test, error)
        self.report(test, self.failures[-1][1])

    def addError(self, test, error):
        super().addError(test, error)
        self.report(test, self.errors[-1][1])

    def addSubTest(self, test, subtest, error):
        super().addSubTest(test, subtest, error)
        if error is not None:
            self.report(subtest, self._exc_info_to_string(error, test))

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self.report(test, 'Unexpected success (expected failure)')

    @staticmethod
    def report(test, details):
        print(f'[ERRO] {test}\n{details}', file=sys.stderr)


def main():
    args = argparse.ArgumentParser()
    args.add_argument('file')
    args.add_argument('--slow-ms', type=float, default=5000)
    options = args.parse_args()
    spec = importlib.util.spec_from_file_location('lira_test_suite', options.file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    result = QuietResult(options.slow_ms)
    with contextlib.redirect_stdout(io.StringIO()) as output:
        spec.loader.exec_module(module)
        unittest.defaultTestLoader.loadTestsFromModule(module).run(result)
    for line in output.getvalue().splitlines():
        if re.search(r'warning|\bwarn\b|\berror\b|\berro\b|\bfatal\b|\balerta\b|\baviso\b', line, re.I):
            print(line)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())
