import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TERRA_IMAGE_DATA_URL } from '../generated/terraImage'
import { LUA_ROXA_IMAGE_DATA_URL } from '../generated/luaRoxaImage'
import { AUSENTE_IMAGE_DATA_URL } from '../generated/ausenteImage'
import { MARTE_IMAGE_DATA_URL } from '../generated/marteImage'

const imageForStatus = vi.fn()

vi.mock('../engine/avatar/statusIcons', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/avatar/statusIcons')>()
  return { ...actual, getStatusIconImage: (status: string) => imageForStatus(status) }
})

import { getStatusIconSrc } from '../engine/avatar/statusIcons'
import { NameTagRenderer } from '../engine/avatar/nameTagRenderer'

type Call = { name: string; args: unknown[] }

function makeCtx() {
  const calls: Call[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop in target) return target[prop]
      if (prop === 'measureText') return (text: string) => ({ width: text.length * 4 })
      return (...args: unknown[]) => {
        calls.push({ name: prop, args })
      }
    },
    set(target, prop, value) {
      target[prop as string] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

const player = (over: Record<string, unknown> = {}) =>
  ({ id: 'p1', name: 'Player', x: 0, y: 0, direction: 'down', isMoving: false, ...over }) as any

const count = (calls: Call[], name: string) => calls.filter((c) => c.name === name).length

describe('getStatusIconSrc', () => {
  it('maps each presence status to its planet image', () => {
    expect(getStatusIconSrc('available')).toBe(TERRA_IMAGE_DATA_URL)
    expect(getStatusIconSrc('focusing')).toBe(LUA_ROXA_IMAGE_DATA_URL)
    expect(getStatusIconSrc('away')).toBe(AUSENTE_IMAGE_DATA_URL)
    expect(getStatusIconSrc('busy')).toBe(MARTE_IMAGE_DATA_URL)
  })

  it('has no image for offline or unknown statuses', () => {
    expect(getStatusIconSrc('offline')).toBeNull()
    expect(getStatusIconSrc('whatever')).toBeNull()
  })
})

describe('NameTagRenderer status icon', () => {
  beforeEach(() => {
    imageForStatus.mockReset()
  })

  it('draws the status image instead of a colored dot', () => {
    const image = { complete: true, naturalWidth: 10 }
    imageForStatus.mockReturnValue(image)
    const { ctx, calls } = makeCtx()

    NameTagRenderer.drawNameTag(ctx, player({ status: 'busy' }), false, 100, 50)

    const draws = calls.filter((c) => c.name === 'drawImage')
    expect(draws).toHaveLength(1)
    expect(draws[0].args[0]).toBe(image)
    expect(imageForStatus).toHaveBeenCalledWith('busy')
  })

  it('asks for the available image when the player has no status', () => {
    imageForStatus.mockReturnValue({ complete: true, naturalWidth: 10 })
    const { ctx } = makeCtx()

    NameTagRenderer.drawNameTag(ctx, player(), true, 100, 50)

    expect(imageForStatus).toHaveBeenCalledWith('available')
  })

  it('falls back to the colored dot while the image is not loaded', () => {
    imageForStatus.mockReturnValue(null)
    const { ctx, calls } = makeCtx()

    NameTagRenderer.drawNameTag(ctx, player({ status: 'away' }), false, 100, 50)

    expect(count(calls, 'drawImage')).toBe(0)
    expect(count(calls, 'arc')).toBe(1)
  })

  it('keeps the pill the same width whether or not the image is ready', () => {
    const widthOf = (image: unknown) => {
      imageForStatus.mockReturnValue(image)
      const { ctx, calls } = makeCtx()
      NameTagRenderer.drawNameTag(ctx, player({ status: 'focusing' }), false, 100, 50)
      return calls.find((c) => c.name === 'roundRect')!.args[2]
    }
    expect(widthOf({ complete: true, naturalWidth: 10 })).toBe(widthOf(null))
  })

  it('shows the pulsing connecting dot, not the status image, during the handshake', () => {
    imageForStatus.mockReturnValue({ complete: true, naturalWidth: 10 })
    const { ctx, calls } = makeCtx()

    NameTagRenderer.drawNameTag(ctx, player({ callState: 'connecting' }), false, 100, 50)

    expect(count(calls, 'drawImage')).toBe(0)
    expect(count(calls, 'arc')).toBe(1)
  })
})
