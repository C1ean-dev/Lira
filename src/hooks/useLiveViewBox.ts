import { RefObject, useEffect } from 'react'
import { liveViewReporter } from '../media/liveView'
import { MAX_VIEW_HEIGHT, PictureFit, pictureHeight, viewHeightStep } from '../p2p/liveLayers'

export function viewHeightFor(
  box: { width: number; height: number },
  video: { videoWidth?: number; videoHeight?: number } | null | undefined,
  fit: PictureFit,
  quality: 'adaptive' | 'full' = 'adaptive'
): number {
  if (quality === 'full') return box.width > 0 && box.height > 0 ? MAX_VIEW_HEIGHT : 0
  const width = video?.videoWidth ?? 0
  const height = video?.videoHeight ?? 0
  return viewHeightStep(pictureHeight(box, width > 0 && height > 0 ? width / height : null, fit))
}

let boxSeq = 0

export function useLiveViewBox(
  sharerId: string | undefined,
  videoRef: RefObject<HTMLVideoElement | null>,
  fit: PictureFit,
  active: boolean,
  quality: 'adaptive' | 'full' = 'adaptive'
): void {
  useEffect(() => {
    const video = videoRef.current
    if (!active || !sharerId || !video) return
    const key = `view-${++boxSeq}`
    let exact: { width: number; height: number } | null = null

    const report = () => {
      const scale = window.devicePixelRatio || 1
      const box = exact ?? { width: video.clientWidth * scale, height: video.clientHeight * scale }
      liveViewReporter.setBox(key, sharerId, viewHeightFor(box, video, fit, quality))
    }

    report()
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        const size = entries[entries.length - 1]?.devicePixelContentBoxSize?.[0]
        exact = size ? { width: size.inlineSize, height: size.blockSize } : null
        report()
      })
      try {
        observer.observe(video, { box: 'device-pixel-content-box' })
      } catch {
        observer.observe(video)
      }
    }
    video.addEventListener('resize', report)
    video.addEventListener('loadedmetadata', report)

    return () => {
      observer?.disconnect()
      video.removeEventListener('resize', report)
      video.removeEventListener('loadedmetadata', report)
      liveViewReporter.clearBox(key)
    }
  }, [sharerId, videoRef, fit, active, quality])
}
