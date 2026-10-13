// Join before cleanup or file checks: another caller must never delete an active .tmp.
export function singleFlightDownload(work: (url: string, version?: string) => Promise<boolean>) {
  let active: Promise<boolean> | null = null
  return (url: string, version?: string): Promise<boolean> => {
    if (active) return active
    const pending = work(url, version)
    active = pending
    return pending.finally(() => { if (active === pending) active = null })
  }
}
