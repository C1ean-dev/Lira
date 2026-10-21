import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LobbyModal } from '../../components/LobbyModal'
import { TopNavBar } from '../../components/TopNavBar'
import { useUpdateStore } from '../../store/useUpdateStore'
import * as platform from '../../utils/platform'

afterEach(() => {
  useUpdateStore.setState({ updateInfo: null, status: 'idle' })
  vi.restoreAllMocks()
})

describe('update buttons wait for the saved installer', () => {
  const components = [
    ['lobby', (ready: boolean) => <LobbyModal onJoined={() => {}} onOpenAvatarCustomizer={() => {}} onApplyUpdate={() => {}} hasUpdate isUpdateReady={ready} />],
    ['navigation', (ready: boolean) => <TopNavBar onOpenAvatarModal={() => {}} onApplyUpdate={() => {}} hasUpdate isUpdateReady={ready} />],
  ] as const

  it.each(components)('hides the %s update action until the download completes', (_name, render) => {
    expect(renderToStaticMarkup(render(false)).includes('Clique para atualizar agora.')).toBe(false)
    expect(renderToStaticMarkup(render(true)).includes('Clique para atualizar agora.')).toBe(true)
  })

  it.each(components)('preserves the existing Android %s APK update action', (_name, render) => {
    vi.spyOn(platform, 'isAndroid').mockReturnValue(true)
    expect(renderToStaticMarkup(render(false)).includes('Clique para atualizar agora.')).toBe(true)
  })
})
