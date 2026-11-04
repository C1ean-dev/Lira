import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AutoCroppedThumbnail } from '../../components/avatar-customizer/AutoCroppedThumbnail'
import { RasterImage } from '../../components/common/RasterImage'
import * as avatarBakeService from '../../engine/avatar/avatarBakeService'
import * as spriteFrame from '../../assets/spriteFrame'

describe('AutoCroppedThumbnail', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    avatarBakeService.clearCroppedContentCache()
  })

  it('renders a spinning circle loader while cropping and image are pending', () => {
    const html = renderToStaticMarkup(
      <AutoCroppedThumbnail
        src="data:image/png;base64,initial-src"
        alt="Avatar Test"
      />
    )

    // Spinner must be present in initial render
    expect(html).toContain('data-testid="thumbnail-loading-spinner"')
    expect(html).toContain('animate-spin')
    expect(html).toContain('aria-label="Carregando..."')
  })

  it('renders custom container background when isSkinCategory and skinTone are passed', () => {
    const html = renderToStaticMarkup(
      <AutoCroppedThumbnail
        src="data:image/png;base64,skin-src"
        alt="Skin Tone Test"
        isSkinCategory={true}
        skinTone="#f1c27d"
      />
    )

    expect(html).toContain('background-color:#f1c27d')
    expect(html).toContain('data-testid="thumbnail-loading-spinner"')
  })

  it('displays graceful fallback when src is empty', () => {
    const html = renderToStaticMarkup(
      <AutoCroppedThumbnail
        src=""
        alt="Empty Avatar"
        fallbackIcon="user"
      />
    )

    expect(html).toContain('data-testid="thumbnail-error-fallback"')
    expect(html).not.toContain('<img')
  })

  it('displays pet fallback when fallbackIcon is pet and src is empty', () => {
    const html = renderToStaticMarkup(
      <AutoCroppedThumbnail
        src=""
        alt="Empty Pet"
        fallbackIcon="pet"
      />
    )

    expect(html).toContain('data-testid="thumbnail-error-fallback"')
    expect(html).not.toContain('<img')
  })

  it('caches cropContentDataUrl across multiple calls for same src', async () => {
    let callCount = 0
    const fakeDataUrl = 'data:image/png;base64,cached-test-source'

    vi.stubGlobal('Image', class {
      private _src = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      get src() {
        return this._src
      }
      set src(val: string) {
        this._src = val
        callCount++
        setTimeout(() => this.onload?.(), 0)
      }
    })

    vi.stubGlobal('document', {
      createElement: () => ({
        width: 32,
        height: 32,
        getContext: () => ({
          getImageData: () => ({ data: new Uint8ClampedArray(32 * 32 * 4) }),
          drawImage: () => {},
        }),
        toDataURL: () => 'data:image/png;base64,cached-crop-output',
      }),
    })

    const first = await avatarBakeService.cropContentDataUrl(fakeDataUrl, 1)
    expect(first).toBe('data:image/png;base64,cached-crop-output')
    expect(callCount).toBe(1)

    // Second call with same parameters must return immediately from cache
    const second = await avatarBakeService.cropContentDataUrl(fakeDataUrl, 1)
    expect(second).toBe('data:image/png;base64,cached-crop-output')
    expect(callCount).toBe(1)

    // Clearing cache must cause another crop computation
    avatarBakeService.clearCroppedContentCache()
    const third = await avatarBakeService.cropContentDataUrl(fakeDataUrl, 1)
    expect(third).toBe('data:image/png;base64,cached-crop-output')
    expect(callCount).toBe(2)

    vi.unstubAllGlobals()
  })
})

describe('RasterImage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders transparent pixel with opacity 0 while resolving sprite frames to prevent broken image artifacts', () => {
    vi.spyOn(spriteFrame, 'readSpriteFrame').mockReturnValue({
      source: 'sheet.png',
      x: 0,
      y: 0,
      width: 32,
      height: 32,
    } as any)

    const html = renderToStaticMarkup(
      <RasterImage
        src="sprite:sheet.png#down_0"
        alt="Sprite Character"
      />
    )

    // While resolving, src should be transparent 1px GIF and opacity: 0
    expect(html).toContain('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')
    expect(html).toContain('opacity:0')
  })

  it('renders standard image src directly when not a sprite', () => {
    vi.spyOn(spriteFrame, 'readSpriteFrame').mockReturnValue(null)

    const html = renderToStaticMarkup(
      <RasterImage
        src="https://example.com/character.png"
        alt="Direct Character"
      />
    )

    expect(html).toContain('src="https://example.com/character.png"')
    expect(html).not.toContain('opacity:0')
  })
})
