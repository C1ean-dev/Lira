import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPetPersonality, savePetPersonality, withSavedPetPersonality } from '../../services/petPersonalities'

describe('personalidade de cada pet', () => {
  const data = new Map<string, string>()
  beforeEach(() => {
    data.clear()
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) })
  })
  it('keeps personalities separate for each custom pet and built-in type', () => {
    savePetPersonality({ type: 'custom', customAssetId: 'one' }, 'Gentil')
    savePetPersonality({ type: 'custom', customAssetId: 'two' }, 'Engraçado')
    savePetPersonality({ type: 'meowth' }, 'Curioso')
    expect(getPetPersonality({ type: 'custom', customAssetId: 'one' })).toBe('Gentil')
    expect(getPetPersonality({ type: 'custom', customAssetId: 'two' })).toBe('Engraçado')
    expect(getPetPersonality({ type: 'meowth' })).toBe('Curioso')
  })
  it('attaches the saved personality to the selected pet for the room owner', () => {
    const pet = { type: 'custom' as const, customAssetId: 'one', name: 'Mingau' }
    expect(savePetPersonality(pet, 'Curioso')).toBe(true)
    expect(withSavedPetPersonality(pet)).toEqual({ ...pet, personality: 'Curioso' })
    expect(pet).not.toHaveProperty('personality')
  })
  it('handles corrupt and unavailable storage', () => {
    data.set('lira_pet_personalities', '{bad')
    expect(getPetPersonality({ type: 'meowth' })).toBe('')
    vi.stubGlobal('localStorage', { getItem: () => { throw Error() }, setItem: () => { throw Error() } })
    expect(savePetPersonality({ type: 'meowth' }, 'Oi')).toBe(false)
    expect(getPetPersonality({ type: 'meowth' })).toBe('')
  })
})
