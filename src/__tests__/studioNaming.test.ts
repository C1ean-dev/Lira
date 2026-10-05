import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { COPY_SUFFIX, presetNameForStudio } from '../utils/studioNaming'

// Editing something in the pixel art studio used to rename it: the studio opened with "<name> (Custom)"
// and saving wrote that back, so the suffix piled up on every edit ("Mesa (Custom) (Custom)").

const read = (relative: string) => fs.readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8')

describe('presetNameForStudio', () => {
  it('keeps the name of an asset the user already made', () => {
    expect(presetNameForStudio('Mesa de roleta', true)).toBe('Mesa de roleta')
  })

  it('keeps it however many times it is edited', () => {
    let name = 'Mesa de roleta'
    for (let editCount = 0; editCount < 3; editCount++) name = presetNameForStudio(name, true)
    expect(name).toBe('Mesa de roleta')
  })

  it('tells a copy of a built-in preset apart from the original', () => {
    expect(presetNameForStudio('Rabo de cavalo', false)).toBe(`Rabo de cavalo${COPY_SUFFIX}`)
  })

  it('does not stack the suffix once the copy is edited as an asset of its own', () => {
    const copy = presetNameForStudio('Rabo de cavalo', false)
    expect(presetNameForStudio(copy, true)).toBe(copy)
  })
})

describe('where the studio gets its name', () => {
  it('the studio takes the name as it is given, with no suffix of its own', () => {
    const studio = read('src/editor/avatar/AvatarPixelArtModal.tsx')
    expect(studio).not.toContain('(Custom)')
    expect(studio).toMatch(/useState<string>\(\s*presetName \|\| `Novo \$\{CATEGORY_LABELS\[category\]\}`\s*\)/)
  })

  it('the avatar customizer adds the suffix only to a built-in preset it copies', () => {
    expect(read('src/components/AvatarCustomizerModal.tsx')).toContain('presetNameForStudio(label, !!customAsset)')
  })
})
