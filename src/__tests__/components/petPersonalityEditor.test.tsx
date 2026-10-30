import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PetPersonalityEditor } from '../../components/avatar-customizer/PetPersonalityEditor'

vi.mock('../../services/petPersonalities', () => ({ getPetPersonality: () => 'Pet curioso', savePetPersonality: vi.fn() }))

describe('pet personality editor', () => {
  it('shows the personality of the selected pet with an explicit save action', () => {
    const html = renderToStaticMarkup(<PetPersonalityEditor pet={{ type: 'custom', customAssetId: 'pet-1', name: 'Mingau' }} />)
    expect(html).toContain('Personalidade do pet')
    expect(html).toContain('Pet curioso')
    expect(html).toContain('Salvar personalidade')
  })
})
