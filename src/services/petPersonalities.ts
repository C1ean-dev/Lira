import type { PetConfig } from '../types/game'

const STORAGE_KEY = 'lira_pet_personalities'
const petKey = (pet: PetConfig) => pet.type === 'custom' ? `custom:${pet.customAssetId || ''}` : `builtin:${pet.type}`

function readPersonalities(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

export function getPetPersonality(pet: PetConfig): string {
  const value = readPersonalities()[petKey(pet)]
  return typeof value === 'string' ? value : ''
}

export function savePetPersonality(pet: PetConfig, personality: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readPersonalities(), [petKey(pet)]: personality }))
    return true
  } catch { return false }
}

export function withSavedPetPersonality(pet: PetConfig): PetConfig {
  return { ...pet, personality: getPetPersonality(pet) }
}
