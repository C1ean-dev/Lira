import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatUserContextMenu } from '../components/chat/ChatUserContextMenu'

const render = (friendState: 'self' | 'friend' | 'pending' | 'can-add') =>
  renderToStaticMarkup(
    React.createElement(ChatUserContextMenu, {
      x: 40,
      y: 60,
      name: 'Bob',
      friendState,
      onAddFriend: vi.fn(),
      onRemoveFriend: vi.fn(),
      onCopyName: vi.fn(),
      onClose: vi.fn(),
    })
  )

describe('ChatUserContextMenu', () => {
  it('offers to add a stranger as a friend', () => {
    const html = render('can-add')
    expect(html).toContain('Bob')
    expect(html).toContain('Adicionar aos amigos')
    expect(html).toContain('Copiar nome')
    expect(html).not.toContain('Remover dos amigos')
  })

  it('shows a pending request as unavailable', () => {
    const html = render('pending')
    expect(html).toContain('Solicitação pendente')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Solicitação pendente/s)
    expect(html).not.toContain('Adicionar aos amigos')
  })

  it('offers to remove a friend', () => {
    const html = render('friend')
    expect(html).toContain('Remover dos amigos')
    expect(html).not.toContain('Adicionar aos amigos')
  })

  it('has no friend actions on my own messages', () => {
    const html = render('self')
    expect(html).toContain('Copiar nome')
    expect(html).toContain('(Você)')
    expect(html).not.toContain('Adicionar aos amigos')
    expect(html).not.toContain('Remover dos amigos')
  })

  it('is a context menu positioned where it was opened', () => {
    const html = render('can-add')
    expect(html).toContain('role="menu"')
    expect(html).toContain('left:40px')
    expect(html).toContain('top:60px')
  })
})
