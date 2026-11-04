/** The presenter owns this tree. Changes preserve every unrelated edge. */
export class AlmTree {
  readonly parents = new Map<string, string>()
  private capacities = new Map<string, number>()
  private health = new Map<string, { deliveredBps: number; rttMs: number | null }>()

  constructor(readonly root: string, readonly fanout = 3) {
    this.capacities.set(root, fanout)
  }

  children(id: string): string[] {
    return [...this.parents].filter(([, parent]) => parent === id).map(([child]) => child)
  }

  private descendants(id: string): Set<string> {
    const result = new Set([id])
    for (const node of result) for (const child of this.children(node)) result.add(child)
    return result
  }

  private available(excluded: Set<string>): string | undefined {
    // Breadth first keeps the tree shallow, with deterministic insertion order.
    const queue = [this.root]
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]
      if (!excluded.has(id) && this.children(id).length < (this.capacities.get(id) ?? this.fanout)) return id
      queue.push(...this.children(id).sort((a, b) => this.score(b) - this.score(a)))
    }
    return undefined
  }

  report(id: string, capacity: number, deliveredBps: number, rttMs: number | null): void {
    if (!this.capacities.has(id)) return
    this.capacities.set(id, Math.max(0, Math.min(this.fanout, Math.floor(capacity))))
    this.health.set(id, { deliveredBps, rttMs })
  }

  private score(id: string): number {
    const health = this.health.get(id)
    if (!health) return 0
    return Math.log2(1 + health.deliveredBps / 1000) - (health.rttMs ?? 0) / 100
  }

  add(id: string): boolean {
    if (!id || id === this.root || this.parents.has(id)) return false
    const parent = this.available(new Set([id]))
    if (!parent) return false
    this.parents.set(id, parent)
    this.capacities.set(id, this.fanout)
    return true
  }

  /** Move only the excess children, never a node under its own descendants. */
  shed(id: string, capacity: number): boolean {
    if (!this.capacities.has(id) || !Number.isFinite(capacity)) return false
    this.capacities.set(id, Math.max(0, Math.min(this.fanout, Math.floor(capacity))))
    let changed = false
    for (const child of this.children(id).slice().reverse()) {
      if (this.children(id).length <= this.capacities.get(id)!) break
      const excluded = new Set([id, ...this.descendants(child)])
      // Prefer an idle retained child, keeping the move inside this branch.
      const parent = this.children(id).sort((a, b) => this.score(b) - this.score(a)).find(candidate => !excluded.has(candidate) &&
        this.children(candidate).length < (this.capacities.get(candidate) ?? this.fanout)) ?? this.available(excluded)
      if (!parent) break
      this.parents.set(child, parent)
      changed = true
    }
    return changed
  }

  remove(id: string): string[] {
    const children = this.children(id)
    this.parents.delete(id)
    this.capacities.delete(id)
    this.health.delete(id)
    for (const child of children) this.parents.delete(child)
    const detached: string[] = []
    for (const child of children) {
      const parent = this.available(this.descendants(child))
      if (parent) this.parents.set(child, parent)
      else detached.push(child)
    }
    // No orphan subtrees: return their members so the coordinator can fall back.
    const reachable = this.descendants(this.root)
    for (const child of [...this.parents.keys()]) {
      if (!reachable.has(child)) { this.parents.delete(child); this.capacities.delete(child); detached.push(child) }
    }
    return detached
  }
}
