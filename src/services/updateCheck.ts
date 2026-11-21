import { isNewerVersion } from '../utils/versionUtils'
export { isNewerVersion } from '../utils/versionUtils'
export const GITHUB_REPO = 'C1ean-dev/Lira'
export const UPDATE_CACHE_URL = 'https://p01--lira--tj9yvq5j5cgs.code.run/updates/lira/latest'
const ASSET_PREFIX = 'https://p01--lira--tj9yvq5j5cgs.code.run/updates/lira/assets/'

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

/** Prefer Render's verified installers; query GitHub if Render cannot confirm the latest release. */
export async function checkCachedUpdate(currentVersion: string, platform: 'windows' | 'android', fetcher: typeof fetch = fetch): Promise<UpdateInfo & { assetSize: number }> {
  const fallback = { hasUpdate: false, currentVersion, latestVersion: currentVersion, releaseName: '', releaseNotes: '',
    downloadUrl: null, releaseUrl: `https://github.com/${GITHUB_REPO}/releases`, checkFailed: true, assetSize: 0 }
  const sources = [
    // Render can need time to wake up or finish caching new installers.
    { url: UPDATE_CACHE_URL, timeout: 65000, cached: true },
    { url: `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, timeout: 15000, cached: false },
  ]
  for (const source of sources) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), source.timeout)
    try {
      const response = await fetcher(source.url, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } })
      if (!response.ok) continue
      const data = await response.json()
      if (!/^v?\d+\.\d+\.\d+$/.test(data?.tag_name || '') || !Array.isArray(data.assets) ||
          data.draft || data.prerelease || (source.cached && data.stale === true)) continue
      const extension = platform === 'android' ? '.apk' : '.exe'
      const asset = data.assets.find((item: { name?: string }) => typeof item?.name === 'string' && item.name.toLowerCase().endsWith(extension))
      const url = asset?.browser_download_url
      const validUrl = typeof url === 'string' && (source.cached
        ? url.startsWith(ASSET_PREFIX) && /^[1-9]\d*$/.test(url.slice(ASSET_PREFIX.length))
        : url === `https://github.com/${GITHUB_REPO}/releases/download/${data.tag_name}/${encodeURIComponent(asset.name)}`)
      const downloadUrl = validUrl ? url : null
      const newer = isNewerVersion(data.tag_name, currentVersion)
      if (newer && !downloadUrl) continue
      const notes = typeof data.body === 'string' ? data.body : ''
      return { hasUpdate: newer, currentVersion, latestVersion: data.tag_name,
        releaseName: typeof data.name === 'string' ? data.name : data.tag_name, releaseNotes: notes, downloadUrl,
        releaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/${data.tag_name}`,
        prUrl: notes.match(/https:\/\/github\.com\/(?:[^\s/]+\/[^\s/]+\/)?pull\/\d+/i)?.[0] || null,
        assetSize: Number.isSafeInteger(asset?.size) && asset.size > 0 ? asset.size : 0 }
    } catch { /* Try the next source after a network, timeout or metadata failure. */ }
    finally { clearTimeout(timer) }
  }
  return fallback
}
