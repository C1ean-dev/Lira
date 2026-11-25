// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  formatProfileHandle,
  getNameplateStyle,
  resolveProfile,
  sanitizeIncomingProfile,
  stripProfileMedia,
} from '../../utils/profileUtils'
import { POPULAR_GAMES } from '../../data/profileCatalog'
import { parseNetworkMessage, userPresenceSchema } from '../../validation/schemas'
import { useGameStore } from '../../store/useGameStore'
import { useProfileModalStore } from '../../store/useProfileModalStore'
import { DEFAULT_AVATAR } from '../../engine/Constants'
import { PlayerAvatar } from '../../components/common/PlayerAvatar'
import { ProfileBar } from '../../components/profile/ProfileBar'
import { MedalBadgeList } from '../../components/profile/MedalBadgeList'
import { UserProfileModal } from '../../components/profile/UserProfileModal'
import { UserProfile } from '../../types/profile'

const sampleProfile: UserProfile = {
  handle: '.sehai',
  bio: 'Jogando e construindo espaços no Lira.',
  memberSince: new Date('2024-03-01T12:00:00Z').getTime(),
  bannerPreset: 'spirit-cyan',
  themePrimary: '#0b151a',
  themeAccent: '#0891b2',
  avatarFrame: 'spirit-flame',
  nameplate: 'spirit-mist',
  medals: ['pioneer', 'gamer', 'dev', 'night-owl'],
  games: ['zzz', 'valorant', 'minecraft', 'stardew-valley'],
}

describe('Discord-inspired Profile System', () => {
  beforeEach(() => {
    useProfileModalStore.setState({
      isOpen: false,
      mode: 'view',
      editorSection: null,
      target: null,
      notes: {},
    })
    useGameStore.setState({
      localPlayer: {
        id: 'u-local-1',
        gameId: 'u-local-1',
        name: 'Sehai',
        profilePicture: '',
        profile: sampleProfile,
        avatar: { ...DEFAULT_AVATAR },
        x: 0,
        y: 0,
        direction: 'down',
        isMoving: false,
        status: 'available',
        statusText: 'Disponível',
        lastUpdated: Date.now(),
      },
      remotePlayers: {},
      friends: [],
      friendProfiles: {},
    })
  })

  it('sanitizes incoming profile payloads, filters unknown games/medals and strips unsafe banner images', () => {
    const sanitized = sanitizeIncomingProfile({
      handle: '  .sehai  ',
      bio: 'Bio segura',
      avatarFrame: 'spirit-flame',
      nameplate: 'spirit-mist',
      bannerImage: 'javascript:alert(1)',
      medals: ['pioneer', 'invalid-medal', 'gamer', 'pioneer'],
      games: ['valorant', 'unknown-game', 'minecraft', 'valorant'],
    })

    expect(sanitized).toBeDefined()
    expect(sanitized?.bannerImage).toBeUndefined()
    expect(sanitized?.medals).toEqual(['pioneer', 'gamer'])
    expect(sanitized?.games).toEqual(['valorant', 'minecraft'])
    expect(POPULAR_GAMES.length).toBeGreaterThanOrEqual(20)
    expect(POPULAR_GAMES.every((g) => g.coverUrl.startsWith('https://'))).toBe(true)
  })

  it('strips heavy banner data URLs for lightweight presence cache without losing games or frames', () => {
    const withMedia: UserProfile = {
      ...sampleProfile,
      bannerImage: 'data:image/png;base64,AAAA',
    }

    const stripped = stripProfileMedia(withMedia)
    expect(stripped?.avatarFrame).toBe('spirit-flame')
    expect(stripped?.nameplate).toBe('spirit-mist')
    expect(stripped?.games).toEqual(['zzz', 'valorant', 'minecraft', 'stardew-valley'])
    expect(stripped?.bannerImage).toBeUndefined()
  })

  it('resolves handles and custom nameplate styles accurately', () => {
    expect(formatProfileHandle('Lucas Silva')).toBe('@lucas.silva')
    expect(formatProfileHandle('Sehai', '.sehai')).toBe('.sehai')

    const customStyle = getNameplateStyle({
      nameplate: 'custom',
      nameplateColor: '#1e1b4b',
      nameplateAccent: '#ec4899',
    })
    expect(customStyle.hasCustomNameplate).toBe(true)
    expect(customStyle.background).toContain('#ec4899')
    expect(resolveProfile(undefined).avatarFrame).toBe('none')
  })

  it('validates profile fields in P2P PLAYER_UPDATE messages and UserPresence schema', () => {
    const parsedMsg = parseNetworkMessage({
      type: 'PLAYER_UPDATE',
      senderId: 'peer-2',
      timestamp: Date.now(),
      payload: {
        player: {
          id: 'peer-2',
          name: 'Sehai',
          profile: sampleProfile,
        },
      },
    })
    expect(parsedMsg).not.toBeNull()
    expect(parsedMsg?.type === 'PLAYER_UPDATE' && parsedMsg.payload.player.profile?.games).toEqual([
      'zzz',
      'valorant',
      'minecraft',
      'stardew-valley',
    ])

    const parsedPresence = userPresenceSchema.safeParse({
      userId: 'u-peer-2',
      name: 'Sehai',
      profile: sampleProfile,
      inRoom: true,
      lastHeartbeat: Date.now(),
    })
    expect(parsedPresence.success).toBe(true)
  })

  it('syncs remote player profile customization into friendProfiles store', () => {
    const friendId = 'u-friend-42'
    useGameStore.setState({
      friends: [friendId],
      friendProfiles: {
        [friendId]: { id: friendId, name: 'Sehai', avatar: { ...DEFAULT_AVATAR } },
      },
    })

    useGameStore.getState().setRemotePlayer({
      id: friendId,
      gameId: friendId,
      name: 'Sehai',
      avatar: { ...DEFAULT_AVATAR },
      profile: sampleProfile,
      x: 1,
      y: 2,
      direction: 'down',
      isMoving: false,
      status: 'available',
      lastUpdated: Date.now(),
    })

    const synced = useGameStore.getState().friendProfiles[friendId]
    expect(synced.profile?.avatarFrame).toBe('spirit-flame')
    expect(synced.profile?.nameplate).toBe('spirit-mist')
    expect(synced.profile?.games).toEqual(['zzz', 'valorant', 'minecraft', 'stardew-valley'])
  })

  it('renders avatar frame, profile bar, medals, games mural and direct click-to-edit controls without tags or connections', () => {
    const avatarHtml = renderToStaticMarkup(
      <PlayerAvatar
        name="Sehai"
        avatar={DEFAULT_AVATAR}
        avatarFrame="spirit-flame"
        size="2xl"
      />
    )
    expect(avatarHtml).toContain('data-avatar-frame="spirit-flame"')

    const barHtml = renderToStaticMarkup(
      <ProfileBar
        name="Sehai"
        avatar={DEFAULT_AVATAR}
        profile={sampleProfile}
        status="available"
      />
    )
    expect(barHtml).toContain('data-nameplate="spirit-mist"')
    expect(barHtml).toContain('Sehai')

    const medalsHtml = renderToStaticMarkup(
      <MedalBadgeList medals={['pioneer', 'gamer', 'dev']} />
    )
    expect(medalsHtml).toContain('Pioneiro Lira')
    expect(medalsHtml).toContain('Gamer')

    useProfileModalStore.getState().openLocalProfile('view')
    const { container, getByLabelText, getByText } = render(<UserProfileModal />)
    const modalHtml = container.innerHTML
    expect(modalHtml).toContain('Sehai')
    expect(modalHtml).toContain('.sehai')
    expect(modalHtml).toContain('Jogos que eu jogo')
    expect(modalHtml).toContain('Zenless Zone Zero')
    expect(modalHtml).toContain('VALORANT')
    expect(modalHtml).toContain('images.igdb.com/igdb/image/upload/t_cover_big/coc9ff.jpg')
    expect(modalHtml).toContain('shared.fastly.steamstatic.com/store_item_assets/steam/apps/413150/library_600x900.jpg')
    expect(modalHtml).toContain('Nota (visível apenas para você)')
    expect(modalHtml).not.toContain('Conexões')

    // Click Banner pencil -> Banner & Tema editor
    fireEvent.click(getByLabelText('Editar banner'))
    expect(container.innerHTML).toContain('Banner &amp; Tema do Cartão')
    fireEvent.click(getByText('Concluir'))

    // Click Avatar pencil -> Foto, Borda & Status editor
    fireEvent.click(getByLabelText('Editar foto e borda da imagem'))
    expect(container.innerHTML).toContain('Foto, Borda &amp; Status')
    fireEvent.click(getByText('Coroa Dourada'))
    expect(useGameStore.getState().localPlayer.profile?.avatarFrame).toBe('golden-crown')
    fireEvent.click(getByText('Concluir'))

    // Click Nameplate bar -> Barra de Perfil editor
    fireEvent.click(getByLabelText('Editar barra de perfil'))
    expect(container.innerHTML).toContain('Barra de Perfil (Nameplate)')
    fireEvent.click(getByText('Grade Cyber'))
    expect(useGameStore.getState().localPlayer.profile?.nameplate).toBe('cyber-grid')
    fireEvent.click(getByText('Concluir'))

    // Embedded infinite-scroll paginated catalog is directly visible in the Mural (no separate "Ver catálogo" button)
    expect(modalHtml).not.toContain('Ver catálogo')
    expect(container.textContent).toContain('Página 1/')
    expect(container.textContent).toContain('Carregar mais jogos')

    // Load next page directly inside the Mural -> reveals Elden Ring (page 2) and toggles it
    fireEvent.click(getByText('Carregar mais jogos'))
    expect(container.textContent).toContain('Página 2/')
    fireEvent.click(getByText('Elden Ring'))
    expect(useGameStore.getState().localPlayer.profile?.games).toContain('elden-ring')
  })
})
