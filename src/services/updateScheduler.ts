import { useUpdateStore, UPDATE_STALE_AFTER_MS } from '../store/useUpdateStore'

/** Leave the first moments of startup to the app itself. */
export const UPDATE_FIRST_CHECK_DELAY_MS = 1500
/** How often to ask the store whether a check is due (it decides, see checkIfDue). */
const TICK_MS = 60 * 1000

/**
 * Keep looking for a new release for as long as the app is open: shortly
 * after startup, then whenever the store says a check is due (the regular
 * interval, or sooner after a failed one), and when the user comes back to
 * the window. Returns the function that stops it.
 */
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
