import { ViewCounters, readViewStats } from '../p2p/liveQualityLog'
import { diagLog } from '../utils/diagnosticLogger'

/**
 * What a viewer tells who is live: whether it is watching, and how tall the
 * picture is on its screen.
 *
 * Who is live sends each viewer its own stream, so it can send this one only
 * what this one shows: nothing before the click to watch, a small picture for
 * the mini player, the full one for the full screen (see videoSendPolicy for
 * the other end). A larger picture is asked for at once; a smaller one only
 * after it stayed smaller for a while, so walking through the layouts does not
 * make the picture go soft and sharp again. What was asked is repeated every
 * 10 s: who is live lets go of a size that stops being confirmed.
 */

/** Long enough for the picture of a click to be on screen and measured. */
export const VIEW_SEND_DELAY_MS = 50
/** How long the picture has to stay smaller before less is asked for. */
export const VIEW_SHRINK_DELAY_MS = 2500
export const VIEW_RENEW_MS = 10_000

export interface LiveViewDeps {
  /**
   * Tell `sharerId` what this viewer wants of its live. `h` is the height of
   * the picture in device pixels, 0 while this window shows nothing, null when
   * the size is not known (everything is asked for).
   */
  send: (sharerId: string, watch: boolean, h: number | null) => void
  /** The stats of the call with `sharerId`, for the log of what arrives. */
  stats?: (sharerId: string) => Promise<any> | null | undefined
}

interface Ask {
  watch: boolean
  h: number | null
}

type Timer = ReturnType<typeof setTimeout>

const unref = (timer: Timer) => {
  ;(timer as unknown as { unref?: () => void })?.unref?.()
}

/** null is "everything": more than any size. */
const rank = (h: number | null) => (h === null ? Number.POSITIVE_INFINITY : h)

export class LiveViewReporter {
  private sharers = new Set<string>()
  private watching = new Set<string>()
  private boxes = new Map<string, { sharerId: string; height: number }>()
  private visible = true
  private sent = new Map<string, Ask>()
  private dirty = new Set<string>()
  private shrinkTimers = new Map<string, Timer>()
  private viewCounters = new Map<string, ViewCounters>()
  private flushTimer: Timer | null = null
  private renewTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  constructor(private deps: LiveViewDeps) {}

  /** The lives this viewer is asked before being sent: running, in its call. */
  setSharers(ids: string[]): void {
    if (this.disposed) return
    const next = new Set(ids)
    for (const id of [...this.sharers]) {
      if (next.has(id)) continue
      this.sharers.delete(id)
      this.sent.delete(id)
      this.dirty.delete(id)
      this.viewCounters.delete(id)
      this.cancelShrink(id)
    }
    for (const id of next) {
      if (this.sharers.has(id)) continue
      this.sharers.add(id)
      this.reconsider(id)
    }
    this.syncRenewTimer()
  }

  /** The lives this user clicked to watch. */
  setWatching(ids: string[]): void {
    if (this.disposed) return
    const next = new Set(ids)
    const changed = [...this.watching].filter((id) => !next.has(id)).concat(ids.filter((id) => !this.watching.has(id)))
    this.watching = next
    for (const id of changed) {
      // What arrives is compared from the click on, not with an earlier watch.
      this.viewCounters.delete(id)
      this.reconsider(id)
    }
  }

  /**
   * A place on screen that shows the live of `sharerId`, `height` device
   * pixels tall. A place with no size shows nothing and does not count: zero
   * is what is asked for a window that shows nothing at all.
   */
  setBox(key: string, sharerId: string, height: number): void {
    if (this.disposed) return
    if (!(height > 0)) {
      this.clearBox(key)
      return
    }
    const before = this.boxes.get(key)
    this.boxes.set(key, { sharerId, height })
    if (before && before.sharerId !== sharerId) this.reconsider(before.sharerId)
    this.reconsider(sharerId)
  }

  clearBox(key: string): void {
    if (this.disposed) return
    const before = this.boxes.get(key)
    if (!before) return
    this.boxes.delete(key)
    this.reconsider(before.sharerId)
  }

  /** Whether the window of the app shows anything (false while minimized or in the tray). */
  setWindowVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return
    this.visible = visible
    for (const id of this.sharers) this.reconsider(id)
  }

  /** The call with a sharer connected: what was asked before went to a call that is gone. */
  callConnected(sharerId: string): void {
    if (this.disposed || !this.sharers.has(sharerId)) return
    this.markDirty(sharerId)
  }

  dispose(): void {
    this.reset()
    this.disposed = true
  }

  /** Back to the start: nobody live, nothing watched, nothing on screen, no timer left. */
  reset(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    if (this.renewTimer) clearInterval(this.renewTimer)
    this.flushTimer = null
    this.renewTimer = null
    for (const timer of this.shrinkTimers.values()) clearTimeout(timer)
    this.shrinkTimers.clear()
    this.dirty.clear()
    this.sent.clear()
    this.viewCounters.clear()
    this.sharers.clear()
    this.watching.clear()
    this.boxes.clear()
    this.visible = true
  }

  private wanted(sharerId: string): Ask {
    if (!this.watching.has(sharerId)) return { watch: false, h: 0 }
    if (!this.visible) return { watch: true, h: 0 }
    let tallest: number | null = null
    for (const box of this.boxes.values()) {
      if (box.sharerId === sharerId && (tallest === null || box.height > tallest)) tallest = box.height
    }
    return { watch: true, h: tallest }
  }

  /** Something that decides what is asked of `sharerId` changed. */
  private reconsider(sharerId: string): void {
    if (!this.sharers.has(sharerId)) return
    const want = this.wanted(sharerId)
    const sent = this.sent.get(sharerId)
    if (!sent || sent.watch !== want.watch) {
      this.cancelShrink(sharerId)
      this.markDirty(sharerId)
      return
    }
    if (rank(want.h) > rank(sent.h)) {
      this.cancelShrink(sharerId)
      this.markDirty(sharerId)
    } else if (rank(want.h) < rank(sent.h)) {
      // Counted from the first moment it got smaller, not from each resize after.
      if (this.shrinkTimers.has(sharerId)) return
      const timer = setTimeout(() => {
        this.shrinkTimers.delete(sharerId)
        this.markDirty(sharerId)
      }, VIEW_SHRINK_DELAY_MS)
      unref(timer)
      this.shrinkTimers.set(sharerId, timer)
    } else {
      this.cancelShrink(sharerId)
    }
  }

  private cancelShrink(sharerId: string): void {
    const timer = this.shrinkTimers.get(sharerId)
    if (!timer) return
    clearTimeout(timer)
    this.shrinkTimers.delete(sharerId)
  }

  private markDirty(sharerId: string): void {
    this.dirty.add(sharerId)
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, VIEW_SEND_DELAY_MS)
    unref(this.flushTimer)
  }

  private flush(): void {
    const ids = [...this.dirty]
    this.dirty.clear()
    for (const sharerId of ids) {
      if (!this.sharers.has(sharerId)) continue
      // While a smaller size waits its turn, the size in force is the one sent before.
      const waiting = this.shrinkTimers.has(sharerId) ? this.sent.get(sharerId) : undefined
      const ask = waiting ?? this.wanted(sharerId)
      this.sent.set(sharerId, ask)
      try {
        this.deps.send(sharerId, ask.watch, ask.h)
      } catch {}
    }
  }

  private syncRenewTimer(): void {
    if (this.sharers.size === 0) {
      if (this.renewTimer) clearInterval(this.renewTimer)
      this.renewTimer = null
      return
    }
    if (this.renewTimer) return
    this.renewTimer = setInterval(() => this.renew(), VIEW_RENEW_MS)
    unref(this.renewTimer as unknown as Timer)
  }

  private renew(): void {
    for (const sharerId of this.sharers) this.dirty.add(sharerId)
    this.flush()
    for (const sharerId of this.sharers) {
      if (this.watching.has(sharerId)) this.logWhatArrives(sharerId)
    }
  }

  private logWhatArrives(sharerId: string): void {
    if (!this.deps.stats) return
    try {
      const pending = this.deps.stats(sharerId)
      if (!pending) return
      Promise.resolve(pending).then(
        (stats) => {
          try {
            if (this.disposed || !stats || !this.watching.has(sharerId) || !this.sharers.has(sharerId)) return
            const reading = readViewStats(stats, this.viewCounters.get(sharerId) ?? null)
            if (!reading) return
            this.viewCounters.set(sharerId, reading.counters)
            diagLog('screenshare', 'view-stats', {
              fromPeer: sharerId,
              askH: this.sent.get(sharerId)?.h ?? null,
              ...reading.sample,
            })
          } catch {}
        },
        () => {}
      )
    } catch {}
  }
}
