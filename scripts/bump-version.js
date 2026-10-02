import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const pkgPath = path.join(rootDir, 'package.json')

export function calculateNextVersion(currentVersion = '1.1.80', latestGitTag = '') {
  let targetVersion = (currentVersion || '1.1.80').trim()

  if (latestGitTag && latestGitTag.trim()) {
    const latestVer = latestGitTag.replace(/^v/i, '').trim()
    const [pMaj = 0, pMin = 0, pPatch = 0] = targetVersion.split('.').map(Number)
    const [lMaj = 0, lMin = 0, lPatch = 0] = latestVer.split('.').map(Number)

    const isPkgNewer =
      pMaj > lMaj ||
      (pMaj === lMaj && pMin > lMin) ||
      (pMaj === lMaj && pMin === lMin && pPatch > lPatch)

    if (!isPkgNewer) {
      targetVersion = `${lMaj}.${lMin}.${lPatch + 1}`
    }
  }

  return {
    version: targetVersion,
    tagName: `v${targetVersion}`,
    releaseTitle: `Lira - v${targetVersion}`,
  }
}

export function determineNextVersion() {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  let latestTag = ''

  try {
    const tagsOutput = execSync('git tag -l "v*" --sort=-v:refname', {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    latestTag = tagsOutput ? tagsOutput.split(/\r?\n/)[0]?.trim() : ''
  } catch (e) {
    console.warn('[bump-version] Warning reading git tags:', e instanceof Error ? e.message : e)
  }

  return calculateNextVersion(pkg.version, latestTag)
}

// Executed directly
if (process.argv[1] && process.argv[1].endsWith('bump-version.js')) {
  const { version, tagName, releaseTitle } = determineNextVersion()

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  pkg.version = version
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`[bump-version] Updated package.json version to: ${version}`)

  const githubOutput = process.env.GITHUB_OUTPUT
  if (githubOutput) {
    fs.appendFileSync(githubOutput, `tag_name=${tagName}\n`)
    fs.appendFileSync(githubOutput, `release_title=${releaseTitle}\n`)
    console.log(`[bump-version] Exported to GITHUB_OUTPUT: tag_name=${tagName}, release_title=${releaseTitle}`)
  }
}
