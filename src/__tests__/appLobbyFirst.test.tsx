import { describe, it, expect } from 'vitest'
import React from 'react'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from '../App'

// The first screen is the menu. Everything that belongs to being inside a space
// (the world canvas and its render loop, the editor palette, chat, calls, the
// heavy modals) used to be mounted behind it from the first moment, and was the
// bulk of the work before the menu showed up. It now loads when it is needed.

const read = (relative: string) => fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
const appSource = read('../App.tsx')

describe('the first screen', () => {
  const html = renderToStaticMarkup(React.createElement(App))

  it('is the menu', () => {
    expect(html).toContain('Conectar')
    expect(html).toContain('Salas Salvas')
  })

  it('has nothing of the space behind it: no world canvas, no space area', () => {
    expect(html).not.toContain('<canvas')
    expect(html).not.toContain('<main')
  })
})

describe('what App does not load up front', () => {
  const onDemand = ['SpaceShell', 'AvatarCustomizerModal', 'AudioSettingsModal']

  it.each(onDemand)('does not import %s statically', (name) => {
    expect(appSource).not.toMatch(new RegExp(`from '\\./components/${name}'`))
  })

  it.each(onDemand)('loads %s with a dynamic import', (name) => {
    expect(appSource).toContain(`import('./components/${name}')`)
  })

  it('does not import the pieces of the space statically either', () => {
    const pieces = [
      ['components', 'TopNavBar'],
      ['components', 'MapViewport'],
      ['components', 'ChatDrawer'],
      ['components', 'MiniCallOverlay'],
      ['components', 'FullScreenGrid'],
      ['components', 'OnlineUsersMenu'],
      ['components', 'DoorKnockNotification'],
      ['components', 'DoorKnockPrompt'],
      ['editor', 'AssetPalette'],
      ['editor', 'CustomElementModal'],
    ]
    for (const [folder, name] of pieces) {
      expect(appSource, name).not.toMatch(new RegExp(`from '\\./${folder}/${name}'`))
    }
  })

  it('mounts the space only outside the menu', () => {
    // SSR cannot show it (a lazy component renders its fallback), so the condition is checked in the source.
    expect(appSource).toMatch(/\{!inLobby && \(\s*<Suspense fallback=\{null\}>\s*<SpaceShell\b/)
    expect(appSource).toMatch(/\{inLobby && \(\s*<LobbyModal\b/)
  })

  it('mounts each modal only after its first opening', () => {
    expect(appSource).toMatch(/useMountOnFirstOpen\(isSettingsModalOpen\)/)
    expect(appSource).toMatch(/useMountOnFirstOpen\(isAvatarModalOpen\)/)
    expect(appSource).toMatch(/\{mountAudioSettings && <AudioSettingsModal \/>\}/)
    expect(appSource).toMatch(/\{mountAvatarModal && \(\s*<AvatarCustomizerModal\b/)
  })

  it('warms the lazy parts up once the menu is there', () => {
    expect(appSource).toMatch(/requestIdleCallback/)
    for (const load of ['loadSpaceShell', 'loadAvatarCustomizerModal', 'loadAudioSettingsModal']) {
      expect(appSource, load).toMatch(new RegExp(`\\[[^\\]]*\\b${load}\\b[^\\]]*\\]`))
    }
  })
})

describe('SpaceShell', () => {
  const shell = read('../components/SpaceShell.tsx')

  it.each([
    'TopNavBar',
    'MapViewport',
    'AssetPalette',
    'ChatDrawer',
    'MiniCallOverlay',
    'FullScreenGrid',
    'OnlineUsersMenu',
    'DoorKnockNotification',
    'DoorKnockPrompt',
    'CustomElementModal',
  ])('still renders %s', (name) => {
    expect(shell).toMatch(new RegExp(`<${name}\\b`))
  })

  it('is exported by name, as App loads it', () => {
    expect(shell).toMatch(/export const SpaceShell\b/)
  })
})
