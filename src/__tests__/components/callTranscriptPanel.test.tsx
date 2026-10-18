import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CallTranscriptPanel } from '../../components/grid/CallTranscriptPanel'

describe('expanded call transcript panel', () => {
  it('shows each utterance with its speaker, timestamp and escaped content', () => {
    const html = renderToStaticMarkup(<CallTranscriptPanel status="recording" onStart={vi.fn()} onStop={vi.fn()} onClose={vi.fn()} entries={[
      { id: 1, speakerId: 'ana', speakerName: 'Ana', text: 'Bom dia <equipe>', timestamp: 1000 },
      { id: 2, speakerId: 'bruno', speakerName: 'Bruno', text: 'Bom dia, Ana', timestamp: 2000 },
    ]} />)
    expect(html).toContain('Ana')
    expect(html).toContain('Bruno')
    expect(html).toContain('Bom dia &lt;equipe&gt;')
    expect(html).toContain('<time')
    expect(html).toContain('Parar transcrição')
    expect(html).toContain('role="log"')
  })

  it('explains the model download before starting and allows cancellation while loading', () => {
    const props = { onStart: vi.fn(), onStop: vi.fn(), onClose: vi.fn(), entries: [] }
    const idle = renderToStaticMarkup(<CallTranscriptPanel {...props} status="idle" />)
    expect(idle).toContain('Iniciar transcrição')
    expect(idle).toContain('baixado')
    const loading = renderToStaticMarkup(<CallTranscriptPanel {...props} status="loading" />)
    expect(loading).toContain('Cancelar')
    expect(loading).toContain('Carregando')
    const error = renderToStaticMarkup(<CallTranscriptPanel {...props} status="error" error="Falha no modelo" />)
    expect(error).toContain('Falha no modelo')
    expect(error).toContain('Tentar novamente')
  })
})
