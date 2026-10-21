import React, { forwardRef, useEffect, useState } from 'react'
import { readSpriteFrame } from '../../assets/spriteFrame'
import { rasterImageUrl } from '../../utils/rasterImageSource'

export const RasterImage = forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(({ src, ...props }, ref) => {
  const [preview, setPreview] = useState<{ source: string; url: string } | null>(null)
  const isSprite = !!src && !!readSpriteFrame(src)
  useEffect(() => {
    if (!src || !isSprite) return
    let active = true
    void rasterImageUrl(src).then(url => { if (active) setPreview({ source: src, url }) }, () => { if (active) setPreview(null) })
    return () => { active = false }
  }, [src, isSprite])
  return <img {...props} ref={ref} src={isSprite ? (preview?.source === src ? preview.url : undefined) : src} />
})
RasterImage.displayName = 'RasterImage'
