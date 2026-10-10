import { useState } from 'react'

export const nextMounted = (mounted: boolean, open: boolean): boolean => mounted || open

export function useMountOnFirstOpen(open: boolean): boolean {
  const [mounted, setMounted] = useState(open)
  const next = nextMounted(mounted, open)
  if (next !== mounted) setMounted(next)
  return next
}
