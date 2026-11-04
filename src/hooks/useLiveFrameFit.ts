import { useEffect, useState, type CSSProperties, type RefObject } from 'react'

/** Fit the frame itself, including its border, instead of letterboxing inside it. */
export function fitLiveFrame(box: { width: number; height: number }, source: { width: number; height: number }, inset = 0) {
  if (!(box.width > inset) || !(box.height > inset) || !(source.width > 0) || !(source.height > 0) ||
    !Number.isFinite(source.width) || !Number.isFinite(source.height)) return undefined
  const scale = Math.min((box.width - inset) / source.width, (box.height - inset) / source.height)
  return { width: Math.min(box.width, source.width * scale + inset), height: Math.min(box.height, source.height * scale + inset) }
}

export function useLiveFrameFit(
  frameRef: RefObject<HTMLDivElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null | undefined,
  enabled: boolean,
  options: { inset?: number; widthOnly?: boolean; bounds?: { width: number; height: number } } = {},
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>()
  const { inset = 0, widthOnly = false, bounds } = options
  const width = bounds?.width, height = bounds?.height
  useEffect(() => {
    const frame = frameRef.current
    const video = videoRef.current
    if (!enabled || !frame || !stream) { setStyle(undefined); return }
    const container = widthOnly ? frame : frame.parentElement
    if (!container) return
    const update = () => {
      const settings = stream.getVideoTracks()[0]?.getSettings?.()
      const source = { width: video?.videoWidth || settings?.width || 0, height: video?.videoHeight || settings?.height || 0 }
      const box = {
        width: width ?? (widthOnly ? frame.getBoundingClientRect().width : container.clientWidth),
        height: height ?? (widthOnly ? Infinity : container.clientHeight),
      }
      const fitted = fitLiveFrame(box, source, inset)
      const next: CSSProperties | undefined = fitted ? (widthOnly ? { height: fitted.height } : { ...fitted, flex: '0 0 auto' }) : undefined
      setStyle(previous => previous?.width === next?.width && previous?.height === next?.height ? previous : next)
    }
    update()
    video?.addEventListener('loadedmetadata', update)
    video?.addEventListener('resize', update)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (width === undefined || height === undefined) observer?.observe(container)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      video?.removeEventListener('loadedmetadata', update)
      video?.removeEventListener('resize', update)
      window.removeEventListener('resize', update)
    }
  }, [enabled, stream, frameRef, videoRef, inset, widthOnly, width, height])
  return style
}
