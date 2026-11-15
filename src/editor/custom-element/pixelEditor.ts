export type RGBA = readonly [number, number, number, number]
export type PixelImage = { width: number; height: number; data: Uint8ClampedArray; x: number; y: number }
export type TrimBounds = { x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number }
const clone = (image: PixelImage): PixelImage => ({ ...image, data: image.data.slice() })

// Canvas-independent tools: one history entry per gesture, including size changes.
export class PixelEditor {
  image: PixelImage
  private before?: PixelImage
  private past: PixelImage[] = []
  private future: PixelImage[] = []
  constructor(width: number, height: number, data?: Uint8ClampedArray) {
    this.image = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)), data: new Uint8ClampedArray(Math.max(1, Math.round(width)) * Math.max(1, Math.round(height)) * 4), x: 0, y: 0 }
    if (data) this.image.data.set(data.subarray(0, this.image.data.length))
  }
  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }
  begin() { if (!this.before) this.before = clone(this.image) }
  pick(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= this.image.width || y >= this.image.height) return [0, 0, 0, 0]
    const i = (Math.floor(y) * this.image.width + Math.floor(x)) * 4
    return [this.image.data[i], this.image.data[i + 1], this.image.data[i + 2], this.image.data[i + 3]]
  }
  private pixel(x: number, y: number, color: RGBA) {
    if (x >= 0 && y >= 0 && x < this.image.width && y < this.image.height) this.image.data.set(color, (y * this.image.width + x) * 4)
  }
  line(x: number, y: number, endX: number, endY: number, color: RGBA, size = 1) {
    x = Math.round(x); y = Math.round(y); endX = Math.round(endX); endY = Math.round(endY)
    const dx = Math.abs(endX - x), dy = -Math.abs(endY - y), sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1
    let error = dx + dy
    for (;;) {
      for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) this.pixel(x + col - Math.floor(size / 2), y + row - Math.floor(size / 2), color)
      if (x === endX && y === endY) break
      const twice = error * 2
      if (twice >= dy) { error += dy; x += sx }
      if (twice <= dx) { error += dx; y += sy }
    }
  }
  fill(x: number, y: number, color: RGBA) {
    if (x < 0 || y < 0 || x >= this.image.width || y >= this.image.height) return
    const target = this.pick(x, y)
    if (target.every((value, i) => value === color[i])) return
    const { width, height, data } = this.image
    const queue = new Int32Array(width * height)
    let head = 0, tail = 0
    const visit = (at: number) => {
      if (!target.every((value, c) => data[at * 4 + c] === value)) return
      data.set(color, at * 4); queue[tail++] = at
    }
    visit(Math.floor(y) * width + Math.floor(x))
    while (head < tail) {
      const at = queue[head++]
      if (at % width > 0) visit(at - 1)
      if (at % width < width - 1) visit(at + 1)
      if (at >= width) visit(at - width)
      if (at < width * (height - 1)) visit(at + width)
    }
  }
  move(dx: number, dy: number) {
    const source = this.before || this.image
    const next = new Uint8ClampedArray(source.data.length)
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      const toX = x + dx, toY = y + dy
      if (toX >= 0 && toY >= 0 && toX < source.width && toY < source.height) next.set(source.data.subarray((y * source.width + x) * 4, (y * source.width + x) * 4 + 4), (toY * source.width + toX) * 4)
    }
    this.image = { ...source, data: next }
  }
  commit(): boolean {
    const previous = this.before
    this.before = undefined
    if (!previous || previous.width === this.image.width && previous.height === this.image.height && previous.data.every((value, i) => value === this.image.data[i])) return false
    this.past.push(previous)
    let bytes = this.past.reduce((sum, frame) => sum + frame.data.byteLength, 0)
    while (this.past.length > 1 && (this.past.length > 40 || bytes > 32 * 1024 * 1024)) bytes -= this.past.shift()!.data.byteLength
    this.future = []
    return true
  }
  undo() { const previous = this.past.pop(); if (previous) { this.future.push(clone(this.image)); this.image = previous; this.before = undefined } }
  redo() { const next = this.future.pop(); if (next) { this.past.push(clone(this.image)); this.image = next; this.before = undefined } }
  trim(): TrimBounds | null {
    const { width, height, data } = this.image
    let x = width, y = height, right = -1, bottom = -1
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) if (data[(row * width + col) * 4 + 3]) {
      x = Math.min(x, col); y = Math.min(y, row); right = Math.max(right, col); bottom = Math.max(bottom, row)
    }
    if (right < 0 || x === 0 && y === 0 && right === width - 1 && bottom === height - 1) return null
    this.begin()
    const trimmed = new Uint8ClampedArray((right - x + 1) * (bottom - y + 1) * 4)
    for (let row = y; row <= bottom; row++) trimmed.set(data.subarray((row * width + x) * 4, (row * width + right + 1) * 4), (row - y) * (right - x + 1) * 4)
    this.image = { width: right - x + 1, height: bottom - y + 1, data: trimmed, x: this.image.x + x, y: this.image.y + y }
    this.commit()
    return { x, y, width: this.image.width, height: this.image.height, sourceWidth: width, sourceHeight: height }
  }
}
