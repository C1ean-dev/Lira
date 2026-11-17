/** Set before the first SDK import so fonts never fall back to a remote CDN. */
export function prepareBoardAssets(): void {
  if (typeof window === 'undefined') return
  if (window.location.protocol === 'file:' && window.electronAPI) {
    Object.assign(window, { EXCALIDRAW_ASSET_PATH: 'lira-board-font://local/' })
    return
  }
  const base = window.location.protocol === 'file:' && import.meta.env.BASE_URL === '/' ? './' : import.meta.env.BASE_URL
  Object.assign(window, { EXCALIDRAW_ASSET_PATH: new URL(`${base}excalidraw-assets/`, window.location.href).href })
}
