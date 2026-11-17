import { useEffect, useRef, useState } from 'react'

export interface HeaderActionsFitOptions {
  enabled?: boolean
  buffer?: number
}

/**
 * Checks whether the full set of small header action icons fits into the header
 * alongside the left-aligned navigation controls without overflowing or wrapping.
 */
export function useHeaderActionsFit({ enabled = true, buffer = 12 }: HeaderActionsFitOptions = {}) {
  const headerRef = useRef<HTMLElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 1200 : false)

  useEffect(() => {
    const header = headerRef.current
    const left = leftRef.current
    const actions = actionsRef.current
    if (!enabled || !header || !left || !actions) {
      return
    }

    const update = () => {
      const headerStyle = getComputedStyle(header)
      const paddingLeft = parseFloat(headerStyle.paddingLeft) || 0
      const paddingRight = parseFloat(headerStyle.paddingRight) || 0
      const headerGap = parseFloat(headerStyle.columnGap || headerStyle.gap) || 8
      const availableWidth = header.clientWidth - paddingLeft - paddingRight

      // Measure the occupied width of visible controls on the left side
      const leftChildren = (Array.from(left.children) as HTMLElement[]).filter(
        node => node.getClientRects().length > 0 && getComputedStyle(node).position !== 'absolute',
      )
      const leftStyle = getComputedStyle(left)
      const leftGap = parseFloat(leftStyle.columnGap || leftStyle.gap) || 8
      const leftOccupied = leftChildren.reduce((sum, node) => sum + node.offsetWidth, 0) +
        leftGap * Math.max(0, leftChildren.length - 1)

      // Actions width: scrollWidth or offsetWidth of the small icons container
      const actionsWidth = actions.offsetWidth || actions.scrollWidth

      // Check for any optional sibling like currentZone pill
      const zonePill = header.querySelector('[data-nav-zone-pill]') as HTMLElement | null
      const zoneWidth = (zonePill && zonePill.getClientRects().length > 0)
        ? zonePill.offsetWidth + headerGap
        : 0

      const required = leftOccupied + headerGap + actionsWidth + zoneWidth + buffer
      setFits(availableWidth >= required)
    }

    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(header)
    observer?.observe(left)
    observer?.observe(actions)

    const leftChildren = Array.from(left.children) as HTMLElement[]
    for (const child of leftChildren) {
      observer?.observe(child)
    }

    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [enabled, buffer])

  return { fits, headerRef, leftRef, actionsRef }
}
