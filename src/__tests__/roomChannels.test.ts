import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ROOM_CHANNELS,
  MAX_CHANNEL_NAME_LENGTH,
  MAX_ROOM_CHANNELS,
  applyRoomChannels,
  canDeleteChannel,
  canRenameChannel,
  getChannelMenu,
  getRoomChannels,
  normalizeChannelName,
  sanitizeRoomChannels,
  validateChannelName,
} from '../utils/roomChannels'
import { Channel } from '../types/chat'

const general: Channel = { id: 'general', name: 'general', type: 'general', unreadCount: 0 }
const social: Channel = { id: 'social', name: 'social', type: 'social', unreadCount: 0 }
const zone: Channel = { id: 'current-zone', name: 'zona-atual', type: 'zone', unreadCount: 0 }
const projects: Channel = { id: 'ch-abc123', name: 'projetos', type: 'custom', unreadCount: 0 }
const dm: Channel = { id: 'dm-a-b', name: 'Bob', type: 'dm', unreadCount: 2, recipientId: 'b' }

const actions = (menu: ReturnType<typeof getChannelMenu>) => menu.items.map((i) => i.action)

describe('normalizeChannelName', () => {
  it('lowercases and turns spaces into dashes', () => {
    expect(normalizeChannelName('  Sala de Reunião  ')).toBe('sala-de-reunião')
  })

  it('drops what cannot be part of a channel name', () => {
    expect(normalizeChannelName('#dev/ops! 2')).toBe('devops-2')
  })

  it('keeps underscores and digits', () => {
    expect(normalizeChannelName('time_01')).toBe('time_01')
  })

  it('never starts, ends or doubles on a dash', () => {
    expect(normalizeChannelName('--a   -  b--')).toBe('a-b')
  })

  it('cuts long names, without leaving a dash at the end', () => {
    const name = normalizeChannelName('a'.repeat(MAX_CHANNEL_NAME_LENGTH - 1) + ' bcd')
    expect(name).toBe('a'.repeat(MAX_CHANNEL_NAME_LENGTH - 1))
    expect(normalizeChannelName('x'.repeat(80))).toHaveLength(MAX_CHANNEL_NAME_LENGTH)
  })

  it('is empty when nothing usable is left', () => {
    expect(normalizeChannelName('  #!? ')).toBe('')
  })
})

describe('validateChannelName', () => {
  const channels = [general, social, zone, projects, dm]

  it('accepts a new name, normalized', () => {
    expect(validateChannelName('Avisos Gerais', channels)).toEqual({ ok: true, name: 'avisos-gerais' })
  })

  it('refuses an empty name', () => {
    const result = validateChannelName('   ', channels)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ error: expect.stringContaining('nome') })
  })

  it('refuses a name another channel already has', () => {
    expect(validateChannelName('Projetos', channels).ok).toBe(false)
    expect(validateChannelName('general', channels).ok).toBe(false)
  })

  it('lets a channel keep its own name when renamed', () => {
    expect(validateChannelName('projetos', channels, projects.id)).toEqual({ ok: true, name: 'projetos' })
  })

  it('does not compare against private conversations or the zone channel', () => {
    expect(validateChannelName('Bob', channels).ok).toBe(true)
    expect(validateChannelName('zona-atual', channels).ok).toBe(true)
  })
})

describe('what may be done to a channel', () => {
  it('renames any channel of the space, but not the zone channel or a conversation', () => {
    expect(canRenameChannel(general)).toBe(true)
    expect(canRenameChannel(social)).toBe(true)
    expect(canRenameChannel(projects)).toBe(true)
    expect(canRenameChannel(zone)).toBe(false)
    expect(canRenameChannel(dm)).toBe(false)
  })

  it('never deletes the general channel, the zone channel or a conversation', () => {
    expect(canDeleteChannel(projects)).toBe(true)
    expect(canDeleteChannel(social)).toBe(true)
    expect(canDeleteChannel(general)).toBe(false)
    expect(canDeleteChannel(zone)).toBe(false)
    expect(canDeleteChannel(dm)).toBe(false)
  })
})

describe('getRoomChannels', () => {
  it('lists the channels shared by the space, in order, without local state', () => {
    const list = getRoomChannels([
      { ...general, unreadCount: 4, description: 'Avisos' },
      social,
      zone,
      projects,
      dm,
    ])
    expect(list).toEqual([
      { id: 'general', name: 'general', description: 'Avisos' },
      { id: 'social', name: 'social' },
      { id: 'ch-abc123', name: 'projetos' },
    ])
  })
})

describe('sanitizeRoomChannels', () => {
  it('rejects what is not a list', () => {
    expect(sanitizeRoomChannels(undefined)).toBeNull()
    expect(sanitizeRoomChannels({ channels: [] })).toBeNull()
    expect(sanitizeRoomChannels('general')).toBeNull()
  })

  it('keeps well-formed channels', () => {
    expect(
      sanitizeRoomChannels([
        { id: 'general', name: 'avisos' },
        { id: 'ch-abc123', name: 'projetos', description: 'Tudo sobre projetos' },
      ])
    ).toEqual([
      { id: 'general', name: 'avisos' },
      { id: 'ch-abc123', name: 'projetos', description: 'Tudo sobre projetos' },
    ])
  })

  it('normalizes names and drops extra fields', () => {
    expect(sanitizeRoomChannels([{ id: 'general', name: 'Avisos Gerais', type: 'dm', unreadCount: 99 }])).toEqual([
      { id: 'general', name: 'avisos-gerais' },
    ])
  })

  it('drops entries that could pass for a conversation or the zone channel', () => {
    const list = sanitizeRoomChannels([
      { id: 'general', name: 'general' },
      { id: 'dm-a-b', name: 'bob' },
      { id: 'current-zone', name: 'zona' },
    ])
    expect(list).toEqual([{ id: 'general', name: 'general' }])
  })

  it('drops malformed entries', () => {
    const list = sanitizeRoomChannels([
      null,
      'general',
      { id: 'general', name: 'general' },
      { id: 42, name: 'numero' },
      { id: 'ch-ok', name: '   ' },
      { id: 'Ch Com Espaço', name: 'x' },
      { id: 'ch-' + 'a'.repeat(60), name: 'longo' },
      { id: 'ch-sem-nome' },
    ])
    expect(list).toEqual([{ id: 'general', name: 'general' }])
  })

  it('keeps only the first of two channels with the same id or the same name', () => {
    const list = sanitizeRoomChannels([
      { id: 'general', name: 'general' },
      { id: 'ch-1', name: 'projetos' },
      { id: 'ch-1', name: 'outro' },
      { id: 'ch-2', name: 'Projetos' },
    ])
    expect(list).toEqual([
      { id: 'general', name: 'general' },
      { id: 'ch-1', name: 'projetos' },
    ])
  })

  it('always has the general channel, first', () => {
    expect(sanitizeRoomChannels([])).toEqual([DEFAULT_ROOM_CHANNELS[0]])
    expect(sanitizeRoomChannels([{ id: 'ch-1', name: 'projetos' }])).toEqual([
      DEFAULT_ROOM_CHANNELS[0],
      { id: 'ch-1', name: 'projetos' },
    ])
  })

  it('does not let another channel take the name of a missing general channel', () => {
    expect(sanitizeRoomChannels([{ id: 'ch-1', name: 'general' }])).toEqual([DEFAULT_ROOM_CHANNELS[0]])
  })

  it('cuts descriptions and the number of channels', () => {
    const many = Array.from({ length: MAX_ROOM_CHANNELS + 10 }, (_, i) => ({ id: `ch-${i}`, name: `canal-${i}` }))
    const list = sanitizeRoomChannels([{ id: 'general', name: 'general', description: 'd'.repeat(500) }, ...many])!
    expect(list).toHaveLength(MAX_ROOM_CHANNELS)
    expect(list[0].description).toHaveLength(120)
  })

  it('ignores a description that is not text', () => {
    expect(sanitizeRoomChannels([{ id: 'general', name: 'general', description: { html: '<b>' } }])).toEqual([
      { id: 'general', name: 'general' },
    ])
  })
})

describe('applyRoomChannels', () => {
  const current: Channel[] = [
    { ...general, unreadCount: 3 },
    social,
    { ...zone, name: 'sala-1' },
    { ...projects, unreadCount: 1 },
    dm,
  ]

  it('replaces the channels of the space and keeps the zone channel and conversations', () => {
    const next = applyRoomChannels(current, [
      { id: 'general', name: 'avisos' },
      { id: 'ch-new', name: 'novo', description: 'Recém criado' },
    ])
    expect(next.map((c) => [c.id, c.name, c.type])).toEqual([
      ['general', 'avisos', 'general'],
      ['ch-new', 'novo', 'custom'],
      ['current-zone', 'sala-1', 'zone'],
      ['dm-a-b', 'Bob', 'dm'],
    ])
    expect(next[1].description).toBe('Recém criado')
  })

  it('keeps the unread count of the channels that stay', () => {
    const next = applyRoomChannels(current, [
      { id: 'general', name: 'general' },
      { id: 'ch-abc123', name: 'projetos-2' },
      { id: 'ch-new', name: 'novo' },
    ])
    expect(next.map((c) => [c.id, c.unreadCount])).toEqual([
      ['general', 3],
      ['ch-abc123', 1],
      ['ch-new', 0],
      ['current-zone', 0],
      ['dm-a-b', 2],
    ])
  })

  it('keeps the kind of the built-in channels', () => {
    const next = applyRoomChannels([], DEFAULT_ROOM_CHANNELS)
    expect(next.map((c) => [c.id, c.type])).toEqual([
      ['general', 'general'],
      ['social', 'social'],
    ])
  })
})

describe('getChannelMenu', () => {
  it('lets the owner rename, delete and create from a custom channel', () => {
    const menu = getChannelMenu(projects, { canManage: true })
    expect(actions(menu)).toEqual(['mark-read', 'rename', 'delete', 'create'])
    expect(menu.note).toBeUndefined()
  })

  it('does not offer to delete the general channel', () => {
    expect(actions(getChannelMenu(general, { canManage: true }))).toEqual(['mark-read', 'rename', 'create'])
  })

  it('only offers a new channel from the zone channel, and says why', () => {
    const menu = getChannelMenu(zone, { canManage: true })
    expect(actions(menu)).toEqual(['mark-read', 'create'])
    expect(menu.note).toMatch(/sala/)
  })

  it('offers just a new channel on the empty part of the list', () => {
    expect(actions(getChannelMenu(null, { canManage: true }))).toEqual(['create'])
  })

  it('gives someone who is not the owner nothing to change, and says who can', () => {
    const menu = getChannelMenu(projects, { canManage: false })
    expect(actions(menu)).toEqual(['mark-read'])
    expect(menu.note).toMatch(/dono/)
    expect(actions(getChannelMenu(null, { canManage: false }))).toEqual([])
    expect(getChannelMenu(null, { canManage: false }).note).toMatch(/dono/)
  })

  it('disables "mark as read" when there is nothing unread', () => {
    expect(getChannelMenu(projects, { canManage: true }).items[0]).toMatchObject({ action: 'mark-read', disabled: true })
    expect(getChannelMenu({ ...projects, unreadCount: 2 }, { canManage: true }).items[0].disabled).toBeFalsy()
  })

  it('marks deleting as the dangerous action', () => {
    const menu = getChannelMenu(projects, { canManage: true })
    expect(menu.items.find((i) => i.action === 'delete')).toMatchObject({ tone: 'danger' })
    expect(menu.items.filter((i) => i.tone === 'danger')).toHaveLength(1)
  })
})
