import { useUpdateStore, UPDATE_STALE_AFTER_MS } from '../store/useUpdateStore'

export const UPDATE_FIRST_CHECK_DELAY_MS = 1500
const TICK_MS = 60 * 1000

export function startAutoUpdateChecks(): () => void {
  const store = () => useUpdateStore.getState()

  const firstCheck = setTimeout(() => {
    store().checkIfDue()
  }, UPDATE_FIRST_CHECK_DELAY_MS)
  const tick = setInterval(() => {
    store().checkIfDue()
  }, TICK_MS)

  const onFocus = () => {
    store().checkIfDue(UPDATE_STALE_AFTER_MS)
  }
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') onFocus()
  }
  if (typeof window !== 'undefined') window.addEventListener('focus', onFocus)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)

  return () => {
    clearTimeout(firstCheck)
    clearInterval(tick)
    if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
  }
}
