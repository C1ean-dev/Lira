import React, { useState, useEffect, useRef } from 'react'
import { Loader2, User, Cat } from 'lucide-react'
import { RasterImage } from '../common/RasterImage'
import { cropContentDataUrl } from '../../engine/avatar/avatarBakeService'

export interface AutoCroppedThumbnailProps {
  src: string
  alt: string
  isSkinCategory?: boolean
  skinTone?: string
  className?: string
  fallbackIcon?: 'user' | 'pet'
}

export const AutoCroppedThumbnail: React.FC<AutoCroppedThumbnailProps> = ({
  src,
  alt,
  isSkinCategory,
  skinTone,
  className,
  fallbackIcon = 'user',
}) => {
  const [displayUrl, setDisplayUrl] = useState<string | null>(null)
  const [isCropping, setIsCropping] = useState<boolean>(Boolean(src))
  const [isImageLoaded, setIsImageLoaded] = useState<boolean>(false)
  const [hasError, setHasError] = useState<boolean>(!src)
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    let active = true
    if (!src) {
      setIsCropping(false)
      setHasError(true)
      setDisplayUrl(null)
      return
    }

    setIsCropping(true)
    setIsImageLoaded(false)
    setHasError(false)
    setDisplayUrl(null)

    cropContentDataUrl(src)
      .then((cropped) => {
        if (!active) return
        setDisplayUrl(cropped || src)
        setIsCropping(false)
      })
      .catch(() => {
        if (!active) return
        setDisplayUrl(src)
        setIsCropping(false)
      })

    return () => {
      active = false
    }
  }, [src])

  useEffect(() => {
    if (displayUrl && imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      setIsImageLoaded(true)
    }
  }, [displayUrl])

  const isLoading = Boolean(src) && (isCropping || (!isImageLoaded && !hasError))

  const defaultContainerClass =
    'w-12 h-12 rounded-xl mb-1.5 flex items-center justify-center relative shadow-sm overflow-hidden border border-slate-700/50'

  return (
    <div
      className={className || defaultContainerClass}
      style={{ backgroundColor: isSkinCategory && skinTone ? skinTone : '#18191c' }}
    >
      {isLoading && (
        <div
          data-testid="thumbnail-loading-spinner"
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
        >
          <Loader2 className="w-5 h-5 text-blue-400 animate-spin" aria-label="Carregando..." />
        </div>
      )}

      {hasError ? (
        <div
          data-testid="thumbnail-error-fallback"
          className="flex items-center justify-center w-full h-full text-slate-500"
          title="Erro ao carregar miniatura"
        >
          {fallbackIcon === 'pet' ? (
            <Cat className="w-5 h-5 opacity-40" />
          ) : (
            <User className="w-5 h-5 opacity-40" />
          )}
        </div>
      ) : displayUrl ? (
        <RasterImage
          ref={imgRef}
          src={displayUrl}
          alt={alt}
          onLoad={() => setIsImageLoaded(true)}
          onError={() => {
            setIsImageLoaded(true)
            setHasError(true)
          }}
          className={`w-full h-full object-contain [image-rendering:pixelated] transition-opacity duration-150 ${
            isImageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ) : null}
    </div>
  )
}
