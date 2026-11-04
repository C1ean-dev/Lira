import React, { forwardRef, useEffect, useState } from 'react'
import { readSpriteFrame } from '../../assets/spriteFrame'
import { rasterImageUrl } from '../../utils/rasterImageSource'

const TRANSPARENT_1PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

export const RasterImage = forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(
  ({ src, style, className, onLoad, onError, ...props }, ref) => {
    const [preview, setPreview] = useState<{ source: string; url: string } | null>(null)
    const isSprite = !!src && !!readSpriteFrame(src)

    useEffect(() => {
      if (!src || !isSprite) return
      let active = true
      void rasterImageUrl(src).then(
        (url) => {
          if (active) setPreview({ source: src, url })
        },
        () => {
          if (active) setPreview(null)
        }
      )
      return () => {
        active = false
      }
    }, [src, isSprite])

    const isPendingSprite = Boolean(isSprite && (!preview || preview.source !== src))
    const resolvedSrc = isSprite ? (preview?.source === src ? preview.url : undefined) : src
    const finalSrc = isPendingSprite || !resolvedSrc ? TRANSPARENT_1PX : resolvedSrc

    const handleLoad = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
      if (finalSrc === TRANSPARENT_1PX) return
      onLoad?.(e)
    }

    const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
      if (finalSrc === TRANSPARENT_1PX) return
      onError?.(e)
    }

    return (
      <img
        {...props}
        ref={ref}
        src={finalSrc}
        className={className}
        style={{
          ...style,
          ...(isPendingSprite || !resolvedSrc ? { opacity: 0 } : {}),
        }}
        onLoad={handleLoad}
        onError={handleError}
      />
    )
  }
)
RasterImage.displayName = 'RasterImage'
