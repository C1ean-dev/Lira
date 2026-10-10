import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AudioDevicesTab } from '../components/settings/AudioDevicesTab'
import { SystemSettingsTab } from '../components/settings/SystemSettingsTab'

const noop = () => {}

describe('AudioDevicesTab texts', () => {
  const html = renderToStaticMarkup(
    React.createElement(AudioDevicesTab, {
      inputDevices: [],
      outputDevices: [],
      videoDevices: [],
      isPlayingTestSound: false,
      onPlayTestSound: noop,
    })
  )

  it('calls the output "Dispositivo de Saída", without the (Fones/Caixas) hint', () => {
    expect(html).toContain('Dispositivo de Saída')
    expect(html).not.toContain('Fones/Caixas')
    expect(html).not.toContain('Dispositivo de Saída (')
  })

  it('keeps the other device titles', () => {
    expect(html).toContain('Dispositivo de Entrada (Microfone)')
    expect(html).toContain('Dispositivo de Vídeo (Câmera / Webcam)')
  })

  it('selects the system default as "Padrão do Sistema" in each dropdown', () => {
    expect(html).toContain('Microfone Padrão do Sistema')
    expect(html).toContain('Alto-Falante Padrão do Sistema')
    expect(html).toContain('Câmera Padrão do Sistema')
    expect(html).not.toMatch(/Default/)
  })
})

describe('SystemSettingsTab texts', () => {
  const html = renderToStaticMarkup(React.createElement(SystemSettingsTab))

  it('offers only "start with Windows" under Inicialização Automática', () => {
    expect(html).toContain('Inicialização Automática')
    expect(html).toContain('Iniciar o Lira com o Windows')
  })

  it('no longer offers to start hidden in the tray', () => {
    expect(html).not.toContain('Iniciar em segundo plano')
    expect(html).not.toContain('oculto na bandeja')
  })

  it('keeps the tray card for closing and minimizing', () => {
    expect(html).toContain('Manter rodando nos ícones ocultos ao fechar (X)')
    expect(html).toContain('Minimizar para a bandeja ao clicar em minimizar')
  })
})
