import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CallPanelBody } from '../../components/common/CallPanelBody'

describe('collapsed call media container', () => {
  it('keeps its media mounted with a layout box while clipping the collapsed contents', () => {
    for (const collapsed of [false, true, false]) {
      const html = renderToStaticMarkup(<CallPanelBody collapsed={collapsed}><video autoPlay muted /><audio autoPlay /></CallPanelBody>)
      expect(html).toContain('<video')
      expect(html).toContain('<audio')
      expect(html).not.toMatch(/display:\s*none|class="hidden"/)
      if (collapsed) {
        expect(html).toContain('height:0')
        expect(html).toContain('overflow:hidden')
        expect(html).toContain('pointer-events:none')
      }
    }
  })
})
