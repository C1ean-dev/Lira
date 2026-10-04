import { useState } from 'react'

/** A modal that has been opened once stays mounted, so it keeps handling its own opening and closing. */
export const nextMounted = (mounted: boolean, open: boolean): boolean => mounted || open

/**
 * For modals that are loaded on demand: false until the first time `open` is true, true from then on.
 * It turns true in the same render in which `open` does, so there is no frame without the modal.
 */
export function useMountOnFirstOpen(open: boolean): boolean {
  const [mounted, setMounted] = useState(open)
  const next = nextMounted(mounted, open)
  if (next !== mounted) setMounted(next)
  return next
}
