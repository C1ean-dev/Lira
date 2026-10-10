import { RefObject, useEffect } from 'react'
import { liveViewReporter } from '../media/liveView'
import { PictureFit, pictureHeight, viewHeightStep } from '../p2p/liveLayers'

/**
 * What is asked of who is live for a picture drawn in `box` (in device
 * pixels): the height the picture has there, rounded up to a step. `video`
 * gives the shape of the live once its first frame arrived.
 */
export function viewHeightFor(
  box: { width: number; height: number },
  video: { videoWidth?: number; videoHeight?: number } | null | undefined,
  fit: PictureFit
): number {
  const width = video?.videoWidth ?? 0
  const height = video?.videoHeight ?? 0
  return viewHeightStep(pictureHeight(box, width > 0 && height > 0 ? width / height : null, fit))
}

let boxSeq = 0

/**
 * While `active`, tells who is live how tall its live is drawn in this
 * <video>, so it is not sent larger than that (see liveViewReporter).
 */
export function useLiveViewBox(
  sharerId: string | undefined,
  videoRef: RefObject<HTMLVideoElement | null>,
  fit: PictureFit,
  active: boolean
): void {
  useEffect(() => {
    const video = videoRef.current
    if (!active || !sharerId || !video) return
    const key = `view-${++boxSeq}`
    // The observer gives the box in device pixels; until it does, CSS pixels times the scale of the screen.
    let exact: { width: number; height: number } | null = null

    const report = () => {
      const scale = window.devicePixelRatio || 1
      const box = exact ?? { width: video.clientWidth * scale, height: video.clientHeight * scale }
      liveViewReporter.setBox(key, sharerId, viewHeightFor(box, video, fit))
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
    // The shape of the live comes with its first frame, and a shared window can change shape.
    video.addEventListener('resize', report)
    video.addEventListener('loadedmetadata', report)

    return () => {
      observer?.disconnect()
      video.removeEventListener('resize', report)
      video.removeEventListener('loadedmetadata', report)
      liveViewReporter.clearBox(key)
    }
  }, [sharerId, videoRef, fit, active])
}
