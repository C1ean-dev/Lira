import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Use an already cached compiler; the test never downloads tools or executes an installer.
function cachedCompiler(directory: string, depth = 0): string | null {
  if (!existsSync(directory)) return null
  const executable = path.join(directory, 'makensis.exe')
  if (existsSync(executable)) return executable
  if (depth >= 2) return null
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || (depth === 0 && !entry.name.startsWith('nsis-'))) continue
    const compiler = cachedCompiler(path.join(directory, entry.name), depth + 1)
    if (compiler) return compiler
  }
  return null
}

const cache = process.env.ELECTRON_BUILDER_CACHE || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'electron-builder', 'Cache')
const compiler = process.platform === 'win32' ? cachedCompiler(cache) : null

describe.skipIf(!compiler)('NSIS recovery hooks', () => {
  it.each(['installer', 'uninstaller'])('compiles the %s hooks with the embedded recovery script', mode => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'lira-nsis-test-'))
    const output = path.join(root, 'test.exe')
    const fixture = path.join(root, 'test.nsi')
    const source = [
      'Unicode true',
      'Name "Lira recovery test"',
      `OutFile "${output}"`,
      'RequestExecutionLevel user',
      '!define APP_PACKAGE_NAME "lira"',
      `!define BUILD_RESOURCES_DIR "${path.resolve('build')}"`,
      '!define isUpdated \'$R9 == "true"\'',
      ...(mode === 'uninstaller' ? ['!define BUILD_UNINSTALLER'] : []),
      'Var appExe',
      `!include "${path.resolve('build/installer.nsh')}"`,
      'Page instfiles',
      'Section',
      ...(mode === 'installer' ? [
        'StrCpy $appExe "$INSTDIR\\Lira.exe"',
        '!insertmacro customCheckAppRunning',
        '!insertmacro customInstall',
      ] : ['WriteUninstaller "$INSTDIR\\Uninstall.exe"']),
      'SectionEnd',
      ...(mode === 'installer' ? [
        'Function .onInit',
        '!insertmacro customInit',
        'FunctionEnd',
      ] : [
        'UninstPage instfiles',
        'Function un.onInit',
        '!insertmacro customUnInit',
        'FunctionEnd',
        'Section Uninstall',
        '!insertmacro customCheckAppRunning',
        '!insertmacro customUnInstall',
        'SectionEnd',
      ]),
    ].join('\n')
    try {
      writeFileSync(fixture, source)
      execFileSync(compiler!, ['-INPUTCHARSET', 'UTF8', '-V2', fixture], { windowsHide: true, stdio: 'pipe' })
      expect(existsSync(output)).toBe(true)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
