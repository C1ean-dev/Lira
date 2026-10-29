const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { createReadStream } = require('node:fs')

const manifestName = 'resources/update-manifest.json'
const contexts = new Map()

async function hashFile(file) {
  const hash = crypto.createHash('sha256')
  for await (const bytes of createReadStream(file)) hash.update(bytes)
  return hash.digest('hex').toUpperCase()
}

async function writeUpdateManifest(root, version) {
  const files = []
  async function visit(relative = '') {
    for (const item of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = path.join(relative, item.name)
      const file = path.join(root, name)
      const stat = await fs.lstat(file)
      if (stat.isSymbolicLink()) throw new Error('Linked package entry: ' + name)
      if (stat.isDirectory()) await visit(name)
      else if (stat.isFile() && name.replaceAll('\\', '/') !== manifestName) {
        files.push({ Name: name.replaceAll('/', '\\'), Length: stat.size, Hash: await hashFile(file) })
      } else if (!stat.isFile()) throw new Error('Non-regular package entry: ' + name)
    }
  }
  await visit()
  files.sort((a, b) => a.Name < b.Name ? -1 : a.Name > b.Name ? 1 : 0)
  const manifest = { FormatVersion: 1, Version: version, Files: files }
  await fs.writeFile(path.join(root, manifestName), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

function rememberPack(context) {
  if (context.electronPlatformName === 'win32') contexts.set(context.arch, context)
}

async function generateInstallerScript(projectDir) {
  const templates = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis')
  const original = await fs.readFile(path.join(templates, 'installer.nsi'), 'utf8')
  const section = '!include "installSection.nsh"'
  const uninstaller = '!ifdef BUILD_UNINSTALLER\n  !include "uninstaller.nsh"\n!endif'
  const source = original.replaceAll('\r\n', '\n')
  if (source.split(section).length !== 2 || source.split('!insertmacro addLangs').length !== 2 || !source.includes(uninstaller)) {
    throw new Error('electron-builder NSIS template changed; review the selective installer integration')
  }
  // Custom NSIS scripts contain both installer and uninstaller. WriteUninstaller
  // in our install section embeds it; electron-builder still signs the outer EXE.
  const script = source.replace(section, '!include "${BUILD_RESOURCES_DIR}\\selective-install-section.nsh"')
    .replace('!insertmacro addLangs', '!insertmacro MUI_UNPAGE_INSTFILES\n!insertmacro addLangs')
    .replace(uninstaller, '!define BUILD_UNINSTALLER\n!macroundef CHECK_APP_RUNNING\n!macro CHECK_APP_RUNNING\n  !insertmacro customCheckAppRunning\n!macroend\n!include "uninstaller.nsh"')
  const output = path.join(projectDir, '.scratch/windows-installer')
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(output, 'installer.nsi'), script)
}

async function artifactBuildStarted(event) {
  if (event.targetPresentableName !== 'nsis') return
  const context = contexts.get(event.arch)
  if (!context) throw new Error('Missing final Windows package context')
  // NSIS emits this event after signing/fuses, before archiving the app. Unlike
  // afterSign, it also runs for unsigned local builds.
  await writeUpdateManifest(context.appOutDir, context.packager.appInfo.version)
  await generateInstallerScript(context.packager.projectDir)
}

module.exports = artifactBuildStarted
Object.assign(module.exports, { writeUpdateManifest, rememberPack, artifactBuildStarted, generateInstallerScript })
