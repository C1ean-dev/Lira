import { describe, it, expect } from 'vitest'
import { getChatPersonMenu } from '../utils/chatPersonMenu'
import { ChatPerson } from '../utils/chatPeople'

const BOB = 'u-bbbbbbbbbbbbbbbbbbbb'

const inSpace = (extra: Partial<ChatPerson> = {}): ChatPerson => ({
  key: 'player:conn-bob',
  kind: 'space',
  name: 'Bob Silva',
  inSpace: true,
  isOnline: true,
  status: 'available',
  unreadCount: 0,
  isCurrent: false,
  open: { kind: 'user', id: BOB, name: 'Bob Silva' },
  contactId: BOB,
  playerId: 'conn-bob',
  ...extra,
})

const friendElsewhere = (extra: Partial<ChatPerson> = {}): ChatPerson => ({
  key: `friend:${BOB}`,
  kind: 'friend',
  name: 'Bob Silva',
  inSpace: false,
  isOnline: true,
  status: 'available',
  unreadCount: 0,
  isCurrent: false,
  open: { kind: 'user', id: BOB, name: 'Bob Silva' },
  contactId: BOB,
  friendKey: BOB,
  ...extra,
})

const conversation = (extra: Partial<ChatPerson> = {}): ChatPerson => ({
  key: 'channel:dm-a-b',
  kind: 'conversation',
  name: 'Bob Silva',
  inSpace: false,
  isOnline: false,
  status: 'offline',
  unreadCount: 0,
  isCurrent: false,
  open: { kind: 'channel', channelId: 'dm-a-b' },
  contactId: BOB,
  channelId: 'dm-a-b',
  ...extra,
})

const ctx = { roomId: 'ROOM-1', requestPending: false }
const actions = (items: ReturnType<typeof getChatPersonMenu>) => items.map((i) => i.action)
const item = (items: ReturnType<typeof getChatPersonMenu>, action: string) => items.find((i) => i.action === action)

describe('getChatPersonMenu', () => {
  describe('someone in the space who is not a friend', () => {
    it('can be messaged, walked to and asked to be a friend', () => {
      expect(actions(getChatPersonMenu(inSpace(), ctx))).toEqual(['message', 'goto', 'add-friend', 'copy-name'])
    })

    it('shows a request already waiting instead of sending another', () => {
      const menu = getChatPersonMenu(inSpace(), { ...ctx, requestPending: true })
      expect(actions(menu)).toEqual(['message', 'goto', 'add-friend', 'copy-name'])
      expect(item(menu, 'add-friend')).toMatchObject({ label: 'Solicitação pendente', disabled: true })
    })

    it('is never invited: invites are for friends', () => {
      expect(actions(getChatPersonMenu(inSpace(), ctx))).not.toContain('invite')
    })

    it('can be asked even when only the connection is known', () => {
      const guest = inSpace({ contactId: 'conn-bob', open: { kind: 'user', id: 'conn-bob', name: 'Bob Silva' } })
      expect(actions(getChatPersonMenu(guest, ctx))).toEqual(['message', 'goto', 'add-friend', 'copy-name'])
    })
  })

  describe('a friend in the space', () => {
    const friend = inSpace({ kind: 'friend', friendKey: BOB })

    it('can be messaged, walked to and removed', () => {
      expect(actions(getChatPersonMenu(friend, ctx))).toEqual([
        'message',
        'goto',
        'invite',
        'remove-friend',
        'copy-name',
      ])
    })

    it('cannot be invited, and the menu says they are already here', () => {
      const invite = item(getChatPersonMenu(friend, ctx), 'invite')
      expect(invite).toMatchObject({ disabled: true })
      expect(invite?.label).toMatch(/já está aqui/)
    })

    it('is not offered a friend request, even with one recorded', () => {
      expect(actions(getChatPersonMenu(friend, { ...ctx, requestPending: true }))).not.toContain('add-friend')
    })
  })

  describe('a friend who is somewhere else', () => {
    it('can be invited to this space when online', () => {
      const menu = getChatPersonMenu(friendElsewhere(), ctx)
      expect(actions(menu)).toEqual(['message', 'invite', 'remove-friend', 'copy-name'])
      expect(item(menu, 'invite')).toMatchObject({ label: 'Convidar para este espaço' })
      expect(item(menu, 'invite')?.disabled).toBeFalsy()
    })

    it('can also be followed to the space they are in', () => {
      const menu = getChatPersonMenu(friendElsewhere({ room: { code: 'ROOM-2', name: 'Outro' } }), ctx)
      expect(actions(menu)).toEqual(['message', 'invite', 'join', 'remove-friend', 'copy-name'])
      expect(item(menu, 'join')?.label).toBe('Entrar no espaço de Bob')
    })

    it('cannot be invited while offline, and the menu says why', () => {
      const menu = getChatPersonMenu(friendElsewhere({ isOnline: false, status: 'offline' }), ctx)
      expect(actions(menu)).toEqual(['message', 'invite', 'remove-friend', 'copy-name'])
      expect(item(menu, 'invite')).toMatchObject({ disabled: true })
      expect(item(menu, 'invite')?.label).toMatch(/offline/i)
      expect(item(menu, 'invite')?.label).not.toMatch(/já está aqui/)
    })

    it('is neither invited nor followed when presence says they are in this space', () => {
      const menu = getChatPersonMenu(friendElsewhere({ room: { code: 'room-1', name: 'Aqui' } }), ctx)
      expect(actions(menu)).toEqual(['message', 'invite', 'remove-friend', 'copy-name'])
      expect(item(menu, 'invite')).toMatchObject({ disabled: true })
      expect(item(menu, 'invite')?.label).toMatch(/já está aqui/)
    })

    it('cannot be invited when I am not in a space, but can still be followed', () => {
      const menu = getChatPersonMenu(friendElsewhere({ room: { code: 'ROOM-2' } }), { ...ctx, roomId: null })
      expect(actions(menu)).toEqual(['message', 'join', 'remove-friend', 'copy-name'])
    })
  })

  describe('a saved conversation with someone who is neither', () => {
    it('can be reopened, turned into a friendship and closed', () => {
      expect(actions(getChatPersonMenu(conversation(), ctx))).toEqual([
        'message',
        'add-friend',
        'close-conversation',
        'copy-name',
      ])
    })

    it('cannot ask for friendship without a user id to address it to', () => {
      for (const contactId of [undefined, 'conn-old']) {
        expect(actions(getChatPersonMenu(conversation({ contactId }), ctx))).toEqual([
          'message',
          'close-conversation',
          'copy-name',
        ])
      }
    })

    it('shows a request already waiting', () => {
      const menu = getChatPersonMenu(conversation(), { ...ctx, requestPending: true })
      expect(item(menu, 'add-friend')).toMatchObject({ label: 'Solicitação pendente', disabled: true })
    })
  })

  it('names the person by first name where a full name would not fit', () => {
    expect(item(getChatPersonMenu(inSpace(), ctx), 'goto')?.label).toBe('Ir até Bob')
  })

  it('marks removing a friend as the only dangerous action', () => {
    const menu = getChatPersonMenu(inSpace({ kind: 'friend', friendKey: BOB }), ctx)
    expect(menu.filter((i) => i.tone === 'danger').map((i) => i.action)).toEqual(['remove-friend'])
    expect(getChatPersonMenu(inSpace(), ctx).some((i) => i.tone === 'danger')).toBe(false)
  })

  it('always starts with the message and ends with copying the name', () => {
    for (const person of [inSpace(), friendElsewhere(), conversation()]) {
      const menu = getChatPersonMenu(person, ctx)
      expect(menu[0]).toMatchObject({ action: 'message', label: 'Enviar mensagem' })
      expect(menu[menu.length - 1]).toMatchObject({ action: 'copy-name', label: 'Copiar nome' })
    }
  })
})
