import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatPeopleList } from '../components/chat/ChatPeopleList'
import { ChatPeople, ChatPerson } from '../utils/chatPeople'

const person = (name: string, extra: Partial<ChatPerson> = {}): ChatPerson => ({
  key: name,
  kind: 'space',
  name,
  inSpace: true,
  isOnline: true,
  status: 'available',
  unreadCount: 0,
  isCurrent: false,
  open: { kind: 'user', id: name, name },
  ...extra,
})

const elsewhere = (name: string, isOnline: boolean, extra: Partial<ChatPerson> = {}) =>
  person(name, { inSpace: false, isOnline, status: isOnline ? 'available' : 'offline', ...extra })

const render = (people: Partial<ChatPeople> = {}) =>
  renderToStaticMarkup(
    <ChatPeopleList people={{ friends: [], inSpace: [], conversations: [], ...people }} onOpen={vi.fn()} />
  )

const section = (html: string, label: string): string | null => {
  const match = html.match(new RegExp(`<section[^>]*aria-label="${label}"[^>]*>(.*?)</section>`, 's'))
  return match ? match[1] : null
}

// Names are read from the rows: the avatar images are base64 and can contain
// any short name by chance.
const namesIn = (html: string | null): string[] =>
  [...(html || '').matchAll(/<span class="truncate text-xs">(.*?)<\/span>/g)].map((m) => m[1])

const rowOf = (html: string, name: string): string => {
  const rows = html.match(/<button.*?<\/button>/gs) || []
  const row = rows.find((r) => r.includes(`>${name}</span>`))
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

describe('ChatPeopleList', () => {
  it('lists friends apart from the other people in the space', () => {
    const html = render({ friends: [person('Bob')], inSpace: [person('Carol'), person('Dan')] })
    const friends = section(html, 'Amigos')!
    const inSpace = section(html, 'No espaço')!

    expect(friends).toContain('Amigos (1)')
    expect(namesIn(friends)).toEqual(['Bob'])

    expect(inSpace).toContain('No espaço (2)')
    expect(namesIn(inSpace)).toEqual(['Carol', 'Dan'])
  })

  it('puts friends before the people in the space', () => {
    const html = render({ friends: [person('Bob')], inSpace: [person('Carol')] })
    expect(html.indexOf('aria-label="Amigos"')).toBeLessThan(html.indexOf('aria-label="No espaço"'))
  })

  it('says so when there are no friends yet', () => {
    const html = render({ inSpace: [person('Carol')] })
    const friends = section(html, 'Amigos')!
    expect(friends).toContain('Amigos (0)')
    expect(friends).toContain('Nenhum amigo ainda')
    expect(friends).not.toContain('<button')
  })

  it('says nobody is online when the space is empty', () => {
    const html = render({ friends: [elsewhere('Bob', false)] })
    const inSpace = section(html, 'No espaço')!
    expect(inSpace).toContain('No espaço (0)')
    expect(inSpace).toContain('Ninguém online')
  })

  it('does not say nobody is online when only friends are in the space', () => {
    const html = render({ friends: [person('Bob')] })
    const inSpace = section(html, 'No espaço')!
    expect(inSpace).toContain('No espaço (0)')
    expect(inSpace).not.toContain('Ninguém online')
    expect(inSpace).toContain('Só seus amigos')
  })

  it('shows other conversations only when there are some', () => {
    expect(section(render({ inSpace: [person('Carol')] }), 'Conversas')).toBeNull()

    const html = render({ conversations: [elsewhere('Eve', false)] })
    const conversations = section(html, 'Conversas')!
    expect(conversations).toContain('Conversas (1)')
    expect(namesIn(conversations)).toEqual(['Eve'])
    expect(namesIn(section(html, 'Amigos'))).toEqual([])
    expect(namesIn(section(html, 'No espaço'))).toEqual([])
  })

  it('tells where a friend is', () => {
    const html = render({
      friends: [person('Bob'), elsewhere('Carol', true, { status: 'busy' }), elsewhere('Dan', false)],
    })
    expect(rowOf(html, 'Bob')).toContain('title="Bob está neste espaço"')
    expect(rowOf(html, 'Carol')).toContain('title="Carol está online"')
    expect(rowOf(html, 'Dan')).toContain('title="Dan está offline"')
  })

  it('shows the status of each person on the avatar', () => {
    const html = render({
      friends: [person('Bob'), elsewhere('Carol', true, { status: 'busy' }), elsewhere('Dan', false)],
    })
    expect(rowOf(html, 'Bob')).toContain('Status: Disponível')
    expect(rowOf(html, 'Carol')).toContain('Status: Ocupado')
    expect(rowOf(html, 'Dan')).toContain('Status: Offline')
  })

  it('dims who is offline', () => {
    const html = render({ friends: [person('Bob'), elsewhere('Dan', false)] })
    expect(rowOf(html, 'Dan')).toContain('opacity-70')
    expect(rowOf(html, 'Dan')).toContain('text-slate-400')
    expect(rowOf(html, 'Bob')).not.toContain('opacity-70')
    expect(rowOf(html, 'Bob')).toContain('text-slate-300')
  })

  it('shows the unread count only when there is one', () => {
    const html = render({ inSpace: [person('Carol', { unreadCount: 3 }), person('Dan')] })
    expect(rowOf(html, 'Carol')).toMatch(/<span class="bg-indigo-500[^"]*">3<\/span>/)
    expect(rowOf(html, 'Dan')).not.toContain('bg-indigo-500')
  })

  it('highlights the open conversation', () => {
    const html = render({ inSpace: [person('Carol', { isCurrent: true }), person('Dan')] })
    expect(rowOf(html, 'Carol')).toContain('bg-indigo-600/30')
    expect(rowOf(html, 'Dan')).not.toContain('bg-indigo-600/30')
  })

  it('uses the picture of the person', () => {
    const picture = 'data:image/png;base64,AAAA'
    const html = render({
      friends: [elsewhere('Bob', true, { avatarSource: { name: 'Bob', profilePicture: picture } })],
    })
    expect(rowOf(html, 'Bob')).toContain(`src="${picture}"`)
  })
})
