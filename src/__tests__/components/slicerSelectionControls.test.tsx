import '../helpers/mockAssetPersistence'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AvatarSpritesheetSlicerModal } from '../../components/avatar-customizer/AvatarSpritesheetSlicerModal'

describe('slicer selection controls', () => {
  it('keeps the grid controls without full-sheet or selection-size presets', () => {
    const html = renderToStaticMarkup(
      <AvatarSpritesheetSlicerModal isOpen onClose={() => {}} imageSrc="test.png" category="hair" />,
    )
    expect(html).toContain('Grade / Snap:')
    expect(html).toContain('type="range"')
    expect(html).toContain('Ajusta a grade para 16px')
    expect(html).not.toContain('Folha Máxima')
    expect(html).not.toMatch(/>\s*(?:1×1|16×32|32×64|256×256)\s*</)
  })
})
