import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const DEFAULT_KEEP_RECENT = 5
export const DEFAULT_MILESTONE_STEP = 10
const SEMVER_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/

export function parseSemverTag(tagName) {
  if (typeof tagName !== 'string') return null
  const match = SEMVER_TAG_RE.exec(tagName.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function compareSemverDesc(a, b) {
  if (a.major !== b.major) return b.major - a.major
  if (a.minor !== b.minor) return b.minor - a.minor
  return b.patch - a.patch
}

/**
 * Keeps the most recent N stable semver releases plus every milestone release
 * whose patch version is a multiple of `milestoneStep` (e.g. 1.1.110, 1.1.120...).
 * Drafts, prereleases, and non-semver tags are left untouched.
 */
export function selectReleasesToPrune(releases, options = {}) {
  const keepRecent = Number.isInteger(options.keepRecent) && options.keepRecent >= 1
    ? options.keepRecent
    : DEFAULT_KEEP_RECENT
  const milestoneStep = Number.isInteger(options.milestoneStep) && options.milestoneStep >= 1
    ? options.milestoneStep
    : DEFAULT_MILESTONE_STEP
  const currentTag = typeof options.currentTag === 'string' ? options.currentTag.trim() : ''

  const stable = []
  const skipped = []

  for (const release of releases) {
    if (!release || release.draft || release.prerelease) {
      skipped.push(release)
      continue
    }
    const parsed = parseSemverTag(release.tag_name)
    if (!parsed) {
      skipped.push(release)
      continue
    }
    stable.push({ release, parsed })
  }

  stable.sort((a, b) => compareSemverDesc(a.parsed, b.parsed))

  const keep = []
  const remove = []

  stable.forEach((entry, index) => {
    const isRecent = index < keepRecent
    const isMilestone = entry.parsed.patch % milestoneStep === 0
    const isCurrent = Boolean(currentTag && entry.release.tag_name === currentTag)
    if (isRecent || isMilestone || isCurrent) {
      keep.push(entry.release)
    } else {
      remove.push(entry.release)
    }
  })

  if (keep.length === 0 && remove.length > 0) {
    return { keep: remove, remove: [], skipped }
  }

  return { keep, remove, skipped }
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Lira-Release-Pruner',
  }
}

export async function listAllReleases(repo, token, fetchFn = fetch) {
  const all = []
  for (let page = 1; ; page += 1) {
    const url = `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`
    const response = await fetchFn(url, { headers: githubHeaders(token) })
    if (!response.ok) {
      throw new Error(`Failed to list releases (page ${page}): HTTP ${response.status}`)
    }
    const batch = await response.json()
    if (!Array.isArray(batch)) {
      throw new Error(`Unexpected GitHub releases response on page ${page}`)
    }
    all.push(...batch)
    if (batch.length < 100) break
  }
  return all
}

export async function pruneGitHubReleases({
  repo,
  token,
  currentTag = '',
  keepRecent = DEFAULT_KEEP_RECENT,
  milestoneStep = DEFAULT_MILESTONE_STEP,
  dryRun = false,
  fetchFn = fetch,
  log = console.log,
}) {
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error(`Invalid repository slug: "${repo}"`)
  }
  if (!token) {
    throw new Error('GITHUB_TOKEN (or GH_TOKEN) is required to prune releases')
  }

  const releases = await listAllReleases(repo, token, fetchFn)
  const plan = selectReleasesToPrune(releases, { keepRecent, milestoneStep, currentTag })

  log(`[prune-releases] Total: ${releases.length} | Keep: ${plan.keep.length} | Remove: ${plan.remove.length} | Skipped: ${plan.skipped.length}`)
  log(`[prune-releases] Keeping: ${plan.keep.map(r => r.tag_name).join(', ') || '(none)'}`)

  const deleted = []
  for (const release of plan.remove) {
    if (dryRun) {
      log(`[prune-releases] [dry-run] Would delete release ${release.tag_name} (id=${release.id})`)
      continue
    }
    const url = `https://api.github.com/repos/${repo}/releases/${release.id}`
    const response = await fetchFn(url, {
      method: 'DELETE',
      headers: githubHeaders(token),
    })
    if (response.status === 404) {
      log(`[prune-releases] Release ${release.tag_name} (id=${release.id}) already absent (404)`)
      continue
    }
    if (!response.ok) {
      throw new Error(`Failed to delete release ${release.tag_name} (id=${release.id}): HTTP ${response.status}`)
    }
    deleted.push(release.tag_name)
    log(`[prune-releases] Deleted release ${release.tag_name} (id=${release.id})`)
  }

  return { ...plan, deleted }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const dryRun = process.argv.includes('--dry-run')
  const repo = process.env.GITHUB_REPOSITORY || 'C1ean-dev/Lira'
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
  const currentTag = process.env.CURRENT_RELEASE_TAG || ''
  await pruneGitHubReleases({ repo, token, currentTag, dryRun })
}
