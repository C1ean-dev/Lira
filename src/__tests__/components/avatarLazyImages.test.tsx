import '../helpers/mockAssetPersistence'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerAvatar } from '../../components/common/PlayerAvatar'
import { AvatarRenderer } from '../../engine/AvatarRenderer'
import { getCustomAssetImage } from '../../store/useCustomAssetsStore'
import { clearAvatarSnapshotCache, renderAvatarSnapshot } from '../../utils/avatarUtils'
import { getAssetRevision } from '../../assets/assetRevision'

let loaded: boolean
let finishImage: () => void
let sequence = 0
const unsubscribers: (() => void)[] = []
beforeEach(() => {
  clearAvatarSnapshotCache()
  loaded = false
  const src = `/assets/library/images/lazy-avatar-${++sequence}.png`
  vi.stubGlobal('Image', class {
    src = ''; complete = false; naturalWidth = 0
    addEventListener(event: string, fn: () => void) {
      if (event !== 'load') return
      finishImage = () => { loaded = true; this.complete = true; this.naturalWidth = 32; fn() }
    }
  })
  vi.stubGlobal('document', { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(128 * 128 * 4) }), drawImage() {}, save() {}, restore() {}, scale() {} }),
    toDataURL: () => `data:image/png;base64,${loaded ? 'loaded-avatar' : 'pending-avatar'}`,
  }) })
  vi.spyOn(AvatarRenderer, 'drawPlayer').mockImplementation(() => { getCustomAssetImage(src) })
})
afterEach(() => {
  unsubscribers.splice(0).forEach(unsubscribe => unsubscribe())
  vi.restoreAllMocks(); vi.unstubAllGlobals(); clearAvatarSnapshotCache()
})
describe('avatar previews after lazy image loading', () => {
  it('replaces the cached placeholder once the requested character image arrives', () => {
    const revision = getAssetRevision()
    expect(renderAvatarSnapshot()).toContain('pending-avatar')
    finishImage()
    expect(renderAvatarSnapshot()).toContain('loaded-avatar')
    // Loading pixels must not invalidate the peer transfer catalog.
    expect(getAssetRevision()).toBe(revision)
  })
  it('notifies PlayerAvatar to update even when the catalog and avatar props do not change', () => {
    const snapshots: (() => unknown)[] = []
    const notify = vi.fn()
    vi.spyOn(React, 'useSyncExternalStore').mockImplementation((subscribe, getSnapshot) => {
      snapshots.push(getSnapshot)
      unsubscribers.push(subscribe(notify))
      return getSnapshot()
    })
    renderToStaticMarkup(<PlayerAvatar name="Hero" />)
    const before = snapshots.map(get => get())
    finishImage()
    expect(notify).toHaveBeenCalled()
    expect(snapshots.some((get, i) => !Object.is(get(), before[i]))).toBe(true)
  })
})
