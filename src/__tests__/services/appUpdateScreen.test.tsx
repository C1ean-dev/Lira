import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppUpdateScreen } from '../../components/AppUpdateScreen'
import { UpdateModal } from '../../components/UpdateModal'

describe('Update UI - Error State with Manual Browser Download', () => {
  it('offers an explicit install action and close after a background retry finishes', () => {
    const html = renderToStaticMarkup(<AppUpdateScreen status="ready" />)
    expect(html).toContain('Atualização pronta para instalar')
    expect(html).toContain('Atualizar agora')
    expect(html).toContain('Fechar')
    expect(html).not.toContain('Preparando atualização...')
  })
  const mockUpdateInfo = {
    hasUpdate: true,
    currentVersion: '1.0.0',
    latestVersion: '1.1.109',
    releaseName: 'Release v1.1.109',
    releaseNotes: 'Melhorias de desempenho',
    downloadUrl: 'https://github.com/C1ean-dev/Lira/releases/download/v1.1.109/Lira.Setup.1.1.109.exe',
    releaseUrl: 'https://github.com/C1ean-dev/Lira/releases/tag/v1.1.109',
  }

  it('renders error message and manual download button in AppUpdateScreen', () => {
    const html = renderToStaticMarkup(
      React.createElement(AppUpdateScreen, {
        updateInfo: mockUpdateInfo,
        status: 'error',
        error: 'Não foi possível baixar a atualização automaticamente.',
      })
    )

    // Should display error message
    expect(html).toContain('Não foi possível baixar a atualização automaticamente.')

    // Should display the target version badge
    expect(html).toContain('1.1.109')

    // Should display the manual browser download button
    expect(html).toContain('Baixar pelo Navegador')

    // Should also have retry and close buttons
    expect(html).toContain('Tentar Novamente')
    expect(html).toContain('Fechar')
  })

  it('renders manual download button in UpdateModal when an error occurs', () => {
    const html = renderToStaticMarkup(
      React.createElement(UpdateModal, {
        updateInfo: mockUpdateInfo,
        isOpen: true,
        onClose: () => {},
        error: 'Falha ao iniciar o instalador da atualização.',
      })
    )

    // Should display error message
    expect(html).toContain('Falha ao iniciar o instalador da atualização.')

    // Should display the manual browser download button
    expect(html).toContain('Baixar pelo Navegador')
  })
})
