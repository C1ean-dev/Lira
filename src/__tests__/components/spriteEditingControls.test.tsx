import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { OptionSelectorGrid } from '../../components/avatar-customizer/OptionSelectorGrid'
import { PetSelectorPanel } from '../../components/avatar-customizer/PetSelectorPanel'

const { assets } = vi.hoisted(() => ({ assets: [] as any[] }))
vi.mock('../../store/useCustomAssetsStore', () => ({ useCustomAssetsStore: () => ({ customAssets: assets, deleteCustomAsset: vi.fn() }) }))
vi.mock('../../components/avatar-customizer/AvatarSpritesheetSlicerModal', () => ({ AvatarSpritesheetSlicerModal: () => null }))
vi.mock('../../components/avatar-customizer/AtlasImportModal', () => ({ AtlasImportModal: () => null }))
vi.mock('../../engine/avatar/avatarAtlasExporter', () => ({ exportCategoryAtlas: vi.fn() }))

describe('editing sprites after painting in the studio', () => {
  it.each(['other', 'pet'])('keeps both pixel editing and slicing available for %s assets', slot => {
    assets.splice(0, assets.length, ...['Gengar', 'Franklin'].map((name, index) => ({
      id: `${slot}_sliced_${index}`, name, type: 'avatar', avatarSlot: slot,
      creationSource: index ? 'studio' : 'slicer', frames: ['frame.png'], width: 1, height: 1,
    })))
    const avatar = { pet: { type: 'none' }, skinTone: '#fff' } as any
    const props = { avatar, onChangeAvatar: vi.fn(), onEditPreset: vi.fn() }
    const html = renderToStaticMarkup(slot === 'pet'
      ? <PetSelectorPanel {...props} />
      : <OptionSelectorGrid {...props} activeCategory="other" />)
    for (const name of ['Gengar', 'Franklin']) {
      expect(html).toContain(`Pintar / Editar Pixels de ${name}`)
      expect(html).toContain(`Fatiar / Recortar Folha de Sprites de ${name}`)
    }
  })
})
