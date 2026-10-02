export interface VersionResolution {
  version: string
  tagName: string
  releaseTitle: string
}

/**
 * Calculates the next version based on package.json version and the latest git tag.
 * - If current package version is strictly higher than latest tag, respect the user's manual bump.
 * - If current package version <= latest tag, auto-increment the patch number of the latest tag.
 * - If no git tag exists, use current version.
 */
export function calculateNextVersion(
  currentVersion: string = '1.1.80',
  latestGitTag: string = ''
): VersionResolution {
  let targetVersion = currentVersion.trim() || '1.1.80'

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
