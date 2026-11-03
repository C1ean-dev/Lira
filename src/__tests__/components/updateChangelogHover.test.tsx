import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UpdateChangelogHover, parseReleaseNotes } from '../../components/common/UpdateChangelogHover'
import { LobbyModal } from '../../components/LobbyModal'
import { useUpdateStore } from '../../store/useUpdateStore'

vi.mock('../../hooks/useRoomPublication', () => ({ useRoomPublication: () => [] }))

describe('parseReleaseNotes', () => {
  it('parses GitHub Actions generated release notes and strips PR URL boilerplate', () => {
    const raw = `## What's Changed
* fix(p2p): evitar que desconexao do bot DJ dispare failover by @C1ean-dev in https://github.com/C1ean-dev/Lira/pull/124
* feat(audio): ajuste de ganho automatico by @erick in https://github.com/C1ean-dev/Lira/pull/125

**Full Changelog**: https://github.com/C1ean-dev/Lira/compare/v1.1.184...v1.1.185`

    const items = parseReleaseNotes(raw)
    expect(items).toEqual([
      'fix(p2p): evitar que desconexao do bot DJ dispare failover',
      'feat(audio): ajuste de ganho automatico',
    ])
  })

  it('parses standard markdown bullet points with dashes', () => {
    const raw = `- Correção de travamento no áudio\n- Novo suporte a drag and drop`
    const items = parseReleaseNotes(raw)
    expect(items).toEqual([
      'Correção de travamento no áudio',
      'Novo suporte a drag and drop',
    ])
  })

  it('handles plain text notes without bullets', () => {
    const raw = 'Atualização geral de desempenho e correções de conexão.'
    const items = parseReleaseNotes(raw)
    expect(items).toEqual([
      'Atualização geral de desempenho e correções de conexão.',
    ])
  })

  it('returns empty array for null, undefined, or empty string', () => {
    expect(parseReleaseNotes(null)).toEqual([])
    expect(parseReleaseNotes(undefined)).toEqual([])
    expect(parseReleaseNotes('   ')).toEqual([])
  })
})

describe('UpdateChangelogHover Component', () => {
  const sampleUpdateInfo = {
    hasUpdate: true,
    currentVersion: '1.1.184',
    latestVersion: 'v1.1.185',
    releaseName: 'Lira - v1.1.185',
    releaseNotes: `## What's Changed\n* fix(p2p): correcao do bot DJ by @C1ean-dev in https://github.com/pull/124`,
    downloadUrl: 'https://example.com/Lira.exe',
    releaseUrl: 'https://github.com/C1ean-dev/Lira/releases/tag/v1.1.185',
  }

  it('renders trigger children', () => {
    const html = renderToStaticMarkup(
      <UpdateChangelogHover updateInfo={sampleUpdateInfo}>
        <button id="test-trigger">Atualizar</button>
      </UpdateChangelogHover>
    )

    expect(html).toContain('id="test-trigger"')
    expect(html).toContain('Atualizar')
  })

  it('renders changelog content when forceOpen is true', () => {
    const html = renderToStaticMarkup(
      <UpdateChangelogHover
        updateInfo={sampleUpdateInfo}
        forceOpen={true}
        isUpdateReady={true}
        onApplyUpdate={() => {}}
      >
        <button>Trigger</button>
      </UpdateChangelogHover>
    )

    expect(html).toContain('Novidades da Atualização')
    expect(html).toContain('v1.1.185')
    expect(html).toContain('fix(p2p): correcao do bot DJ')
    expect(html).toContain('Instalar')
    expect(html).not.toContain('Instalar Atualização Agora')
    expect(html).toContain('Ver notas completas no GitHub')
  })

  it('shows fallback message when releaseNotes is empty', () => {
    const emptyNotesInfo = {
      ...sampleUpdateInfo,
      releaseNotes: '',
    }

    const html = renderToStaticMarkup(
      <UpdateChangelogHover
        updateInfo={emptyNotesInfo}
        forceOpen={true}
      >
        <button>Trigger</button>
      </UpdateChangelogHover>
    )

    expect(html).toContain('Melhorias gerais de estabilidade, áudio e correções de desempenho.')
  })

  it('shows download progress when isDownloading is true', () => {
    const html = renderToStaticMarkup(
      <UpdateChangelogHover
        updateInfo={sampleUpdateInfo}
        forceOpen={true}
        isDownloading={true}
        downloadPercent={73}
      >
        <button>Trigger</button>
      </UpdateChangelogHover>
    )

    expect(html).toContain('73%')
    expect(html).toContain('Baixando atualização')
  })
})

describe('LobbyModal integration with UpdateChangelogHover', () => {
  const initial = useUpdateStore.getState()

  beforeEach(() => {
    vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, getSnapshot) => getSnapshot())
    useUpdateStore.setState({
      ...initial,
      status: 'ready',
      updateInfo: {
        hasUpdate: true,
        currentVersion: '1.1.184',
        latestVersion: 'v1.1.185',
        releaseName: 'Lira - v1.1.185',
        releaseNotes: `## What's Changed\n* fix(p2p): correcao de audio no DJ by @C1ean-dev in https://github.com/pr/124`,
        downloadUrl: 'https://example.com/setup.exe',
        releaseUrl: 'https://github.com/C1ean-dev/Lira/releases',
      },
    })
  })

  afterEach(() => {
    useUpdateStore.setState(initial)
  })

  it('renders update action wrapped with changelog hover on the right side', () => {
    const html = renderToStaticMarkup(
      <LobbyModal
        hasUpdate={true}
        isUpdateReady={true}
        onApplyUpdate={() => {}}
        onJoined={() => {}}
        onOpenAvatarCustomizer={() => {}}
      />
    )

    expect(html).toContain('aria-label="Instalar atualização"')
    expect(html).toContain('Novidades da Atualização')
    expect(html).toContain('fix(p2p): correcao de audio no DJ')
  })
})
