import { describe, expect, it, vi } from 'vitest'
import { resolveAppInstance } from '../../../electron/appInstance'
import { setupSingleInstanceLock } from '../../../electron/singleInstance'

const profile = 'C:/Users/test/AppData/Roaming/lira'
describe('development and installed instance isolation', () => {
  it('preserves the installed profile and uses a separate development profile and Windows identity', () => {
    const installed = resolveAppInstance({ defaultUserData: profile, isPackaged: true })
    const dev = resolveAppInstance({ defaultUserData: profile, isPackaged: false })
    expect(installed).toMatchObject({ userData: profile, instanceId: '1', isMultiInstance: false, title: 'Lira', appUserModelId: 'com.lira.app' })
    expect(dev).toMatchObject({ userData: `${profile}-dev`, instanceId: '1', isMultiInstance: false, title: 'Lira — Desenvolvimento', appUserModelId: 'com.lira.app.dev' })
  })
  it.each([{ instanceEnv: '2' }, { argv: ['--instance=2'] }, { argv: ['--multi'] }])('keeps the second development profile separate for %o', options => {
    expect(resolveAppInstance({ defaultUserData: profile, isPackaged: false, ...options })).toMatchObject({
      userData: `${profile}-dev-inst-2`, instanceId: '2', isMultiInstance: true,
    })
    expect(resolveAppInstance({ defaultUserData: profile, isPackaged: true, ...options }).userData).toBe(`${profile}-inst-2`)
  })
  it('allows development beside the installed app while still rejecting another normal launch of either profile', () => {
    const held = new Set<string>()
    const boot = (isPackaged: boolean) => {
      const { userData } = resolveAppInstance({ defaultUserData: profile, isPackaged })
      const quit = vi.fn()
      const accepted = setupSingleInstanceLock({ requestLock: () => {
        if (held.has(userData)) return false
        held.add(userData); return true
      }, quit, onSecondInstance: vi.fn(), getWindows: () => [] })
      return { accepted, quit }
    }
    expect(boot(true).accepted).toBe(true)
    expect(boot(false).accepted).toBe(true)
    for (const isPackaged of [true, false]) {
      const duplicate = boot(isPackaged)
      expect(duplicate.accepted).toBe(false)
      expect(duplicate.quit).toHaveBeenCalledOnce()
    }
  })
})
