import { useEffect, useRef, useState } from 'react'

/** Reveal optional inline content only when the surrounding controls still fit. */
export function useInlineContentFit(enabled: boolean, contentKey: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const [fits, setFits] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    const parent = content?.parentElement
    if (!enabled || !container || !content || !parent) {
      setFits(false)
      return
    }

    const controls = (Array.from(container.children) as HTMLElement[]).filter(node => node.getClientRects().length > 0)
    const update = () => {
      const style = getComputedStyle(container)
      const gap = parseFloat(style.columnGap) || 0
      const width = container.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
      const occupied = controls.reduce((sum, node) => sum + node.offsetWidth, 0) + gap * Math.max(0, controls.length - 1)
      const required = content.offsetWidth + (parseFloat(getComputedStyle(parent).columnGap) || 0)
      // Once shown, its width is already included in the controls' occupied space.
      setFits(width - occupied + (fits ? required : 0) >= required)
    }

    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    for (const node of [container, ...controls, content]) observer?.observe(node)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [enabled, contentKey, fits])

  return { containerRef, contentRef, fits }
}
