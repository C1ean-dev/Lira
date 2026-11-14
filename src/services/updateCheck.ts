export const GITHUB_REPO = 'C1ean-dev/Lira'
export const UPDATE_CACHE_URL = 'https://lira-signaling.onrender.com/updates/lira/latest'
const ASSET_PREFIX = 'https://lira-signaling.onrender.com/updates/lira/assets/'

export interface UpdateInfo {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseName: string
  releaseNotes: string
  downloadUrl: string | null
  releaseUrl: string
  prUrl?: string | null
  checkFailed?: boolean
}

export function isNewerVersion(latestTag: string, currentVer: string): boolean {
  const clean = (v: string) => v.replace(/^v/i, '').trim().split('.').map(Number)
  const latest = clean(latestTag)
  const current = clean(currentVer)
  for (let i = 0; i < Math.max(latest.length, current.length); i++) {
    const l = Number.isNaN(latest[i]) || latest[i] === undefined ? 0 : latest[i]
    const c = Number.isNaN(current[i]) || current[i] === undefined ? 0 : current[i]
    if (l !== c) return l > c
  }
  return false
}

/** Desktop and Android consume the same daily cache, without querying GitHub. */
export async function checkCachedUpdate(currentVersion: string, platform: 'windows' | 'android', fetcher: typeof fetch = fetch): Promise<UpdateInfo & { assetSize: number }> {
  const fallback = { hasUpdate: false, currentVersion, latestVersion: currentVersion, releaseName: '', releaseNotes: '',
    downloadUrl: null, releaseUrl: `https://github.com/${GITHUB_REPO}/releases`, checkFailed: true, assetSize: 0 }
  const controller = new AbortController()
  // Render can need time to wake up after an idle period.
  const timer = setTimeout(() => controller.abort(), 65000)
  try {
    const response = await fetcher(UPDATE_CACHE_URL, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) return fallback
    const data = await response.json()
    if (!/^v?\d+\.\d+\.\d+$/.test(data?.tag_name || '') || !Array.isArray(data.assets)) return fallback
    const extension = platform === 'android' ? '.apk' : '.exe'
    const asset = data.assets.find((item: { name?: string }) => typeof item?.name === 'string' && item.name.toLowerCase().endsWith(extension))
    const url = asset?.browser_download_url
    const downloadUrl = typeof url === 'string' && url.startsWith(ASSET_PREFIX) && /^\d+$/.test(url.slice(ASSET_PREFIX.length)) ? url : null
    const newer = isNewerVersion(data.tag_name, currentVersion)
    if (newer && !downloadUrl) return fallback
    const notes = typeof data.body === 'string' ? data.body : ''
    return { hasUpdate: newer, currentVersion, latestVersion: data.tag_name,
      releaseName: typeof data.name === 'string' ? data.name : data.tag_name, releaseNotes: notes, downloadUrl,
      releaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/${data.tag_name}`,
      prUrl: notes.match(/https:\/\/github\.com\/(?:[^\s/]+\/[^\s/]+\/)?pull\/\d+/i)?.[0] || null,
      assetSize: Number.isSafeInteger(asset?.size) && asset.size > 0 ? asset.size : 0 }
  } catch { return fallback }
  finally { clearTimeout(timer) }
}
