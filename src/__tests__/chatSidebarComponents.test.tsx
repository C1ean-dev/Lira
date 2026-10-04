import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatContextMenu, ChatMenuItem, placeContextMenu } from '../components/chat/ChatContextMenu'
import { RoomInviteCard } from '../components/chat/RoomInviteCard'
import { ChatChannelList } from '../components/chat/ChatChannelList'
import { RoomInviteState } from '../utils/roomInvite'
import { Channel } from '../types/chat'

const buttons = (html: string) => html.match(/<button.*?<\/button>/gs) || []
const menuItems = (html: string) => buttons(html).filter((b) => b.includes('role="menuitem"'))
const textOf = (html: string) => html.replace(/<[^>]+>/g, '').trim()

describe('placeContextMenu', () => {
  const size = { width: 224, height: 200 }
  const viewport = { width: 1000, height: 800 }

  it('opens where the pointer is when there is room', () => {
    expect(placeContextMenu({ x: 40, y: 60 }, size, viewport)).toEqual({ left: 40, top: 60 })
  })

  it('moves back inside the window near the right and bottom edges', () => {
    expect(placeContextMenu({ x: 990, y: 790 }, size, viewport)).toEqual({ left: 766, top: 590 })
  })

  it('never goes past the top or left edge', () => {
    expect(placeContextMenu({ x: -50, y: 2 }, size, viewport)).toEqual({ left: 10, top: 10 })
    expect(placeContextMenu({ x: 5, y: 5 }, size, { width: 100, height: 100 })).toEqual({ left: 10, top: 10 })
  })
})

describe('ChatContextMenu', () => {
  const items: ChatMenuItem[] = [
    { id: 'message', label: 'Enviar mensagem', icon: <svg data-icon="message" /> },
    { id: 'invite', label: 'Convidar para este espaço (offline)', disabled: true },
    { id: 'remove-friend', label: 'Remover dos amigos', tone: 'danger' },
  ]

  const render = (props: Partial<React.ComponentProps<typeof ChatContextMenu>> = {}) =>
    renderToStaticMarkup(
      <ChatContextMenu x={40} y={60} title="Bob" items={items} onSelect={vi.fn()} onClose={vi.fn()} {...props} />
    )

  it('is a menu positioned where it was opened, named after its subject', () => {
    const html = render()
    expect(html).toContain('role="menu"')
    expect(html).toContain('left:40px')
    expect(html).toContain('top:60px')
    expect(html).toContain('>Bob<')
  })

  it('lists the items in order', () => {
    expect(menuItems(render()).map(textOf)).toEqual([
      'Enviar mensagem',
      'Convidar para este espaço (offline)',
      'Remover dos amigos',
    ])
  })

  it('shows the icon of an item', () => {
    expect(menuItems(render())[0]).toContain('data-icon="message"')
  })

  it('makes an unavailable item unclickable', () => {
    const [message, invite] = menuItems(render())
    expect(invite).toMatch(/<button[^>]*\sdisabled=""/)
    expect(invite).toContain('cursor-not-allowed')
    expect(message).not.toMatch(/<button[^>]*\sdisabled=""/)
  })

  it('sets the dangerous item apart', () => {
    const [message, , remove] = menuItems(render())
    expect(remove).toContain('text-rose-300')
    expect(message).not.toContain('text-rose-300')
  })

  it('shows a note when there is one', () => {
    expect(render()).not.toContain('Só o dono')
    const html = render({ items: [], note: 'Só o dono do espaço cria ou altera canais.' })
    expect(html).toContain('Só o dono do espaço cria ou altera canais.')
    expect(menuItems(html)).toHaveLength(0)
  })
})

describe('RoomInviteCard', () => {
  const render = (state: RoomInviteState) =>
    renderToStaticMarkup(
      <RoomInviteCard
        invite={{ roomCode: 'ROOM-42', roomName: 'Escritório' }}
        state={state}
        senderName="Ana"
        recipientName="Bob"
        onJoin={vi.fn()}
      />
    )

  it('lets the person invited enter the space', () => {
    const html = render('open')
    expect(html).toContain('Ana')
    expect(html).toContain('Escritório')
    expect(buttons(html).map(textOf)).toEqual(['Entrar no espaço'])
    expect(html).not.toContain('Você já está neste espaço')
    expect(html).not.toContain('Convite enviado')
  })

  it('shows the person who invited what they sent, without a button', () => {
    const html = render('sent')
    expect(html).toContain('Convite enviado')
    expect(textOf(html)).toContain('Você convidou Bob para Escritório')
    expect(buttons(html)).toHaveLength(0)
  })

  it('has nothing to enter for someone already in that space', () => {
    const html = render('here')
    expect(html).toContain('Você já está neste espaço')
    expect(buttons(html)).toHaveLength(0)
  })

  it('says when the invite is over, without a button', () => {
    const html = render('closed')
    expect(html).toContain('Convite encerrado')
    expect(textOf(html)).toContain('Ana não está mais neste espaço')
    expect(buttons(html)).toHaveLength(0)
  })

  it('never shows the room code', () => {
    for (const state of ['open', 'sent', 'here', 'closed'] as RoomInviteState[]) {
      expect(render(state)).not.toContain('ROOM-42')
    }
  })
})

describe('ChatChannelList', () => {
  const channels: Channel[] = [
    { id: 'general', name: 'general', type: 'general', unreadCount: 0 },
    { id: 'ch-1', name: 'projetos', type: 'custom', unreadCount: 3 },
    { id: 'current-zone', name: 'sala-1', type: 'zone', unreadCount: 0 },
  ]

  const render = (props: Partial<React.ComponentProps<typeof ChatChannelList>> = {}) =>
    renderToStaticMarkup(
      <ChatChannelList
        channels={channels}
        activeChannelId="general"
        canManage={false}
        editing={null}
        onSelect={vi.fn()}
        onContextMenu={vi.fn()}
        onStartCreate={vi.fn()}
        onSubmitName={vi.fn()}
        onCancelEdit={vi.fn()}
        {...props}
      />
    )

  const rows = (html: string) => buttons(html).filter((b) => !b.includes('title="Novo canal"'))
  const names = (html: string) =>
    [...html.matchAll(/<span class="truncate">(.*?)<\/span>/g)].map((m) => m[1])

  it('lists the channels in order', () => {
    expect(names(render())).toEqual(['general', 'projetos', 'sala-1'])
  })

  it('highlights the open channel only', () => {
    const [general, projects] = rows(render())
    expect(general).toContain('bg-indigo-600/30')
    expect(projects).not.toContain('bg-indigo-600/30')
  })

  it('shows the unread count only where there is one', () => {
    const [general, projects] = rows(render())
    expect(projects).toMatch(/<span class="bg-indigo-500[^"]*">3<\/span>/)
    expect(general).not.toContain('bg-indigo-500')
  })

  it('marks the zone channel with a lock', () => {
    const [general, , zone] = rows(render())
    expect(zone).toContain('text-emerald-400')
    expect(general).not.toContain('text-emerald-400')
  })

  it('offers a new channel only to who can manage them', () => {
    expect(render()).not.toContain('title="Novo canal"')
    expect(render({ canManage: true })).toContain('title="Novo canal"')
  })

  it('has no editor until one is asked for', () => {
    expect(render({ canManage: true })).not.toContain('<input')
  })

  it('opens an empty editor for a new channel, above the zone channel', () => {
    const html = render({ canManage: true, editing: { mode: 'create' } })
    expect(html).toMatch(/<input[^>]*placeholder="nome-do-canal"/)
    expect(html.match(/<input/g)).toHaveLength(1)
    expect(html).toMatch(/<input[^>]*value=""/)
    expect(names(html)).toEqual(['general', 'projetos', 'sala-1'])
    expect(html.indexOf('<input')).toBeGreaterThan(html.indexOf('>projetos<'))
    expect(html.indexOf('<input')).toBeLessThan(html.indexOf('>sala-1<'))
  })

  it('puts the new-channel editor last when there is no zone channel', () => {
    const html = render({ channels: channels.slice(0, 2), canManage: true, editing: { mode: 'create' } })
    expect(html.indexOf('<input')).toBeGreaterThan(html.indexOf('>projetos<'))
  })

  it('edits the name of a channel in place', () => {
    const html = render({ canManage: true, editing: { mode: 'rename', channelId: 'ch-1' } })
    expect(html).toMatch(/<input[^>]*value="projetos"/)
    expect(html.match(/<input/g)).toHaveLength(1)
    expect(names(html)).toEqual(['general', 'sala-1'])
    expect(html.indexOf('<input')).toBeGreaterThan(html.indexOf('>general<'))
    expect(html.indexOf('<input')).toBeLessThan(html.indexOf('>sala-1<'))
  })

  it('shows why a name was refused', () => {
    const html = render({
      canManage: true,
      editing: { mode: 'create' },
      error: 'Já existe um canal com esse nome.',
    })
    expect(html).toContain('Já existe um canal com esse nome.')
    expect(render({ canManage: true, error: 'Já existe um canal com esse nome.' })).not.toContain('Já existe')
  })
})
