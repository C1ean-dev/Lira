import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'

const cache = process.env.ELECTRON_BUILDER_CACHE || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'electron-builder/Cache')
function findFile(directory: string, name: string): string | undefined {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isFile() && entry.name === name) return file
    if (entry.isDirectory()) { const found = findFile(file, name); if (found) return found }
  }
}
const compiler = findFile(path.join(cache, 'nsis-3.0.4.1'), 'makensis.exe')
const spider = findFile(path.join(cache, 'nsis-resources-3.4.1'), 'SpiderBanner.dll')
const enabled = process.platform === 'win32' && !!compiler && !!spider
let runtime: string
let application: Buffer
let fixture: string

beforeAll(() => {
  if (!enabled) return
  runtime = mkdtempSync(path.join(os.tmpdir(), 'lira-rollback-runtime-'))
  const exe = path.join(runtime, 'fixture.exe')
  // Stay alive until released, to catch an installer waiting for the restored app.
  const appSource = `using System; using System.IO; using System.Threading;
public class Fixture { public static void Main() {
  string root = AppDomain.CurrentDomain.BaseDirectory;
  File.AppendAllText(Path.Combine(root, "started"), "started\\n");
  for (int i = 0; i < 100 && !File.Exists(Path.Combine(root, "stop")); i++) Thread.Sleep(100);
} }`
  const command = `Add-Type -OutputAssembly '${exe.replace(/'/g, "''")}' -OutputType WindowsApplication -TypeDefinition @'\n${appSource}\n'@`
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'pipe' })
  application = readFileSync(exe)
  fixture = path.join(runtime, 'installer.exe')
  writeFileSync(path.join(runtime, 'update-recovery.ps1'), 'param($Action,$InstallDir,$UserDataDir,$ProgressWindow)\nexit ([int](Get-Content -LiteralPath (Join-Path (Split-Path $InstallDir) "worker-code")))')
  const source = readFileSync('build/installer.nsh', 'utf8')
    .replace(/!macro KillAppProcesses[\s\S]*?!macroend/, '!macro KillAppProcesses\n!macroend')
    .replaceAll('$PLUGINSDIR\\update-recovery.ps1', path.join(runtime, 'update-recovery.ps1'))
    .replaceAll('$APPDATA\\${APP_PACKAGE_NAME}', '$liraFixtureRoot\\profile')
    .replaceAll('$TEMP', '$liraFixtureRoot')
    // Simulate acknowledgement only in interactive cases. Silent cases still
    // execute the real MessageBox, including its /SD behavior.
    .replace(/(MessageBox [^\n]*"\$liraFailureMessage"[^\n]*)/, '${If} ${Silent}\n$1\n${Else}\nSystem::Call \'user32::IsWindowVisible(p $HWNDPARENT) i.r0\'\n${If} $0 != 0\nSetErrorLevel 91\nQuit\n${EndIf}\nSleep 10\n${EndIf}')
  writeFileSync(path.join(runtime, 'recovery-ui.nsh'), source)
  writeFileSync(path.join(runtime, 'fixture.nsi'), `
Unicode true
Name "Lira rollback exit fixture"
OutFile "${fixture}"
RequestExecutionLevel user
!define ONE_CLICK
!addplugindir /x86-unicode "${path.dirname(spider!).replace('x86-ansi', 'x86-unicode')}"
!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "FileFunc.nsh"
Var appExe
Var liraFixtureRoot
Var liraFixtureRoute
!include "${path.join(runtime, 'recovery-ui.nsh')}"
Page instfiles
Function .onInit
  \${GetParameters} $0
  \${GetOptions} $0 "/ROOT=" $liraFixtureRoot
  \${GetOptions} $0 "/MODE=" $liraFixtureRoute
  StrCpy $INSTDIR "$liraFixtureRoot\\app"
  StrCpy $appExe "$INSTDIR\\Lira.exe"
FunctionEnd
Section
  StrCpy $liraUpdatePending "true"
  \${IfNot} \${Silent}
    SpiderBanner::Show /MODERN
    FindWindow $R1 "#32770" "" $HWNDPARENT
    FindWindow $R1 "#32770" "" $HWNDPARENT $R1
    GetDlgItem $liraProgressLabel $R1 1000
    \${If} $liraProgressLabel == 0
      FindWindow $R1 "#32770" "" $HWNDPARENT
      GetDlgItem $liraProgressLabel $R1 1006
    \${EndIf}
  \${EndIf}
  \${If} $liraFixtureRoute == "backup"
  \${OrIf} $liraFixtureRoute == "pending"
    StrCpy $liraUpdatePending "false"
    !insertmacro customCheckAppRunning
  \${ElseIf} $liraFixtureRoute == "gui-end"
    Quit
  \${Else}
    Call LiraRollback
  \${EndIf}
  SetErrorLevel 1
  Quit
SectionEnd
`)
  execFileSync(compiler!, ['/V2', path.join(runtime, 'fixture.nsi')], { windowsHide: true, stdio: 'pipe', timeout: 15000 })
}, 30000)
afterAll(async () => { if (runtime) await rm(runtime, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })

// Execute the production NSIS error flow against a stub recovery worker. No real
// installation, registry entry or running Lira process is touched by this fixture.
it.skipIf(!enabled).each([
  { name: 'successful rollback', workerCode: 0, route: 'rollback', silent: true, app: 'slow', restart: true },
  { name: 'failed restoration', workerCode: 1, route: 'rollback', silent: true, app: 'slow', restart: false },
  { name: 'previous pending restoration fails', workerCode: 1, route: 'pending', silent: true, app: 'slow', restart: false },
  { name: 'preparation already undone', workerCode: 1, route: 'backup', silent: true, app: 'slow', restart: true },
  { name: 'missing previous executable', workerCode: 0, route: 'rollback', silent: true, app: 'missing', restart: false },
  { name: 'previous executable cannot start', workerCode: 0, route: 'rollback', silent: true, app: 'invalid', restart: false },
  { name: 'interactive notice acknowledged', workerCode: 0, route: 'rollback', silent: false, app: 'slow', restart: true },
  { name: 'rollback triggered by GUI shutdown', workerCode: 0, route: 'gui-end', silent: false, app: 'slow', restart: true },
])('finishes $name without waiting for the app or a hidden notice', { timeout: 30000 }, async scenario => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lira-rollback-exit-'))
  const install = path.join(root, 'app')
  const profile = path.join(root, 'profile')
  mkdirSync(install)
  mkdirSync(profile)
  if (scenario.app !== 'missing') writeFileSync(path.join(install, 'Lira.exe'), scenario.app === 'slow' ? application : 'invalid executable')
  writeFileSync(path.join(root, 'worker-code'), String(scenario.workerCode))
  if (scenario.route === 'pending') writeFileSync(path.join(root, 'lira.update-pending.json'), '{}')
  try {
    const child = spawn(fixture, [...(scenario.silent ? ['/S'] : []), `/ROOT=${root}`, `/MODE=${scenario.route}`], { windowsHide: true, stdio: 'ignore' })
    const result = await new Promise<{ code: number | null; timedOut: boolean }>((resolve, reject) => {
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; child.kill() }, 10000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); resolve({ code, timedOut }) })
    })
    expect(result.timedOut, 'rollback finished, but the installer still waits for an invisible dialog').toBe(false)
    expect(result.code).toBe(1)
    const log = readFileSync(path.join(root, 'lira_install.log'), 'utf8')
    expect(log.match(/Aviso concluido/g)).toHaveLength(1)
    if (scenario.restart) {
      for (let retry = 0; retry < 100 && !existsSync(path.join(install, 'started')); retry++) await new Promise(resolve => setTimeout(resolve, 25))
      expect(readFileSync(path.join(install, 'started'), 'utf8')).toBe('started\n')
      expect(log.indexOf('Aviso concluido')).toBeLessThan(log.indexOf('Reabrindo versao'))
      expect(log.match(/Reinicio disparado/g)).toHaveLength(1)
    } else expect(existsSync(path.join(install, 'started'))).toBe(false)
    if (scenario.app === 'invalid') expect(log).toContain('Nao foi possivel reabrir o Lira')
  } finally {
    writeFileSync(path.join(install, 'stop'), '')
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
})
