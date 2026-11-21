import { describe, expect, it, vi } from 'vitest'
import {
  parseSemverTag,
  pruneGitHubReleases,
  selectReleasesToPrune,
} from '../../../scripts/prune-releases.mjs'

function makeRelease(patch: number, overrides: Record<string, unknown> = {}) {
  return {
    id: 1000 + patch,
    tag_name: `v1.1.${patch}`,
    draft: false,
    prerelease: false,
    ...overrides,
  }
}

describe('prune-releases retention policy', () => {
  it('parses standard vX.Y.Z tags and ignores invalid ones', () => {
    expect(parseSemverTag('v1.1.218')).toEqual({ major: 1, minor: 1, patch: 218 })
    expect(parseSemverTag('v2.0.0')).toEqual({ major: 2, minor: 0, patch: 0 })
    expect(parseSemverTag('1.1.218')).toBeNull()
    expect(parseSemverTag('v1.1.218-beta.1')).toBeNull()
    expect(parseSemverTag('latest')).toBeNull()
  })

  it('keeps the 5 most recent releases and every patch multiple of 10', () => {
    const releases = []
    for (let p = 110; p <= 218; p += 1) {
      releases.push(makeRelease(p))
    }
    // Deliberately shuffle out of timestamp order (e.g., 200 after 198).
    const shuffled = [...releases].reverse()
    const idx200 = shuffled.findIndex(r => r.tag_name === 'v1.1.200')
    const [r200] = shuffled.splice(idx200, 1)
    shuffled.push(r200)

    const { keep, remove, skipped } = selectReleasesToPrune(shuffled)
    expect(skipped).toEqual([])

    const keptTags = keep.map(r => r.tag_name)
    expect(keptTags).toEqual([
      'v1.1.218',
      'v1.1.217',
      'v1.1.216',
      'v1.1.215',
      'v1.1.214',
      'v1.1.210',
      'v1.1.200',
      'v1.1.190',
      'v1.1.180',
      'v1.1.170',
      'v1.1.160',
      'v1.1.150',
      'v1.1.140',
      'v1.1.130',
      'v1.1.120',
      'v1.1.110',
    ])

    const removedTags = new Set(remove.map(r => r.tag_name))
    expect(removedTags.has('v1.1.213')).toBe(true)
    expect(removedTags.has('v1.1.211')).toBe(true)
    expect(removedTags.has('v1.1.209')).toBe(true)
    expect(removedTags.has('v1.1.111')).toBe(true)
    expect(removedTags.has('v1.1.210')).toBe(false)
    expect(removedTags.has('v1.1.200')).toBe(false)
    expect(removedTags.size + keptTags.length).toBe(releases.length)
  })

  it('keeps drafts, prereleases, non-semver tags, and the current release tag untouched', () => {
    const releases = [
      makeRelease(220),
      makeRelease(219),
      makeRelease(218),
      makeRelease(217),
      makeRelease(216),
      makeRelease(215),
      makeRelease(214),
      makeRelease(213),
      makeRelease(210),
      makeRelease(212, { draft: true }),
      makeRelease(211, { prerelease: true }),
      { id: 999, tag_name: 'nightly', draft: false, prerelease: false },
    ]

    const { keep, remove, skipped } = selectReleasesToPrune(releases, { currentTag: 'v1.1.214' })
    expect(keep.map(r => r.tag_name)).toEqual([
      'v1.1.220',
      'v1.1.219',
      'v1.1.218',
      'v1.1.217',
      'v1.1.216',
      'v1.1.214',
      'v1.1.210',
    ])
    expect(remove.map(r => r.tag_name)).toEqual(['v1.1.215', 'v1.1.213'])
    expect(skipped.map(r => r.tag_name)).toEqual(['v1.1.212', 'v1.1.211', 'nightly'])
  })

  it('paginates GitHub API releases and deletes only unkept releases unless dryRun is true', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => makeRelease(250 - i))
    const page2 = [makeRelease(150), makeRelease(149)]

    const fetchDry = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(page1))
      .mockResolvedValueOnce(Response.json(page2))

    const dryResult = await pruneGitHubReleases({
      repo: 'C1ean-dev/Lira',
      token: 'test-token',
      dryRun: true,
      fetchFn: fetchDry,
      log: () => {},
    })
    expect(dryResult.deleted).toEqual([])
    expect(dryResult.remove.length).toBeGreaterThan(0)
    expect(fetchDry).toHaveBeenCalledTimes(2)

    const fetchLive = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([
        makeRelease(218),
        makeRelease(217),
        makeRelease(216),
        makeRelease(215),
        makeRelease(214),
        makeRelease(213),
        makeRelease(210),
      ]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const liveResult = await pruneGitHubReleases({
      repo: 'C1ean-dev/Lira',
      token: 'test-token',
      currentTag: 'v1.1.218',
      fetchFn: fetchLive,
      log: () => {},
    })

    expect(liveResult.deleted).toEqual(['v1.1.213'])
    expect(fetchLive).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/C1ean-dev/Lira/releases/1213',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
