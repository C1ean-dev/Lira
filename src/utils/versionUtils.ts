import { valid, gt, inc } from 'semver'

export interface VersionResolution {
  version: string
  tagName: string
  releaseTitle: string
}

export function normalizeVersion(value: string): string | null {
  return valid(value.trim().replace(/^v/i, ''))
}
export function isNewerVersion(latestTag: string, currentVersion: string): boolean {
  const latest = normalizeVersion(latestTag), current = normalizeVersion(currentVersion)
  return !!latest && !!current && gt(latest, current)
}
export function calculateNextVersion(currentVersion = '1.1.80', latestGitTag = ''): VersionResolution {
  const current = normalizeVersion(currentVersion.trim() || '1.1.80')
  if (!current) throw new Error('Invalid package version')
  const latest = normalizeVersion(latestGitTag)
  const version = latest && !gt(current, latest) ? inc(latest, 'patch')! : current
  return { version, tagName: `v${version}`, releaseTitle: `Lira - v${version}` }
}
