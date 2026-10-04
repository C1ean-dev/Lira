import { describe, it, expect } from 'vitest'
import { buildRoomInviteMessage, getRoomInviteState, readRoomInvite } from '../utils/roomInvite'

const ME = 'u-aaaaaaaaaaaaaaaaaaaa'
const BOB = 'u-bbbbbbbbbbbbbbbbbbbb'

describe('readRoomInvite', () => {
  it('reads a well-formed invite', () => {
    expect(readRoomInvite({ roomCode: 'ROOM-42', roomName: 'Escritório' })).toEqual({
      roomCode: 'ROOM-42',
      roomName: 'Escritório',
    })
  })

  it('normalizes the room code the way joining a room does', () => {
    expect(readRoomInvite({ roomCode: '  f8fea8df-bc1d ', roomName: 'Sala' })?.roomCode).toBe('F8FEA8DF-BC1D')
  })

  it('is nothing without a usable room code', () => {
    expect(readRoomInvite(undefined)).toBeUndefined()
    expect(readRoomInvite('ROOM-42')).toBeUndefined()
    expect(readRoomInvite({ roomName: 'Sala' })).toBeUndefined()
    expect(readRoomInvite({ roomCode: '   ', roomName: 'Sala' })).toBeUndefined()
    expect(readRoomInvite({ roomCode: 42, roomName: 'Sala' })).toBeUndefined()
  })

  it('refuses a code that could not be a room', () => {
    expect(readRoomInvite({ roomCode: 'ROOM<script>', roomName: 'Sala' })).toBeUndefined()
    expect(readRoomInvite({ roomCode: 'A'.repeat(200), roomName: 'Sala' })).toBeUndefined()
  })

  it('falls back to a generic name and cuts a long one', () => {
    expect(readRoomInvite({ roomCode: 'ROOM-42' })?.roomName).toBe('Espaço')
    expect(readRoomInvite({ roomCode: 'ROOM-42', roomName: { html: '<b>' } })?.roomName).toBe('Espaço')
    expect(readRoomInvite({ roomCode: 'ROOM-42', roomName: 'x'.repeat(300) })?.roomName).toHaveLength(80)
  })

  it('carries nothing else along', () => {
    expect(readRoomInvite({ roomCode: 'ROOM-42', roomName: 'Sala', onJoin: 'evil', extra: 1 })).toEqual({
      roomCode: 'ROOM-42',
      roomName: 'Sala',
    })
  })
})

describe('buildRoomInviteMessage', () => {
  const message = buildRoomInviteMessage({
    id: 'inv-1',
    from: { id: ME, name: 'Ana', avatar: { shirtColor: '#123456' } },
    to: { id: BOB, name: 'Bob' },
    room: { code: 'ROOM-42', name: 'Escritório' },
    channelId: 'dm-a-b',
    timestamp: 1234,
  })

  it('is a private message from me to the friend', () => {
    expect(message).toMatchObject({
      id: 'inv-1',
      senderId: ME,
      senderName: 'Ana',
      recipientId: BOB,
      recipientName: 'Bob',
      channelId: 'dm-a-b',
      timestamp: 1234,
      status: 'sent',
    })
  })

  it('carries the room to join', () => {
    expect(message.roomInvite).toEqual({ roomCode: 'ROOM-42', roomName: 'Escritório' })
  })

  it('still reads as an invite where the card is not shown', () => {
    expect(message.content).toContain('Convite')
    expect(message.content).toContain('Escritório')
  })
})

describe('getRoomInviteState', () => {
  const invite = { roomCode: 'ROOM-42', roomName: 'Escritório' }
  const there = { isOnline: true, inRoom: true, roomCode: 'ROOM-42' }

  it('is "sent" for the person who invited', () => {
    expect(getRoomInviteState({ invite, isMine: true, currentRoomId: 'ROOM-42', inviterPresence: null })).toBe('sent')
  })

  it('is "open" while the person who invited is in that space', () => {
    expect(getRoomInviteState({ invite, isMine: false, currentRoomId: null, inviterPresence: there })).toBe('open')
    expect(getRoomInviteState({ invite, isMine: false, currentRoomId: 'OTHER', inviterPresence: there })).toBe('open')
  })

  it('compares room codes without regard to case', () => {
    const presence = { isOnline: true, inRoom: true, roomCode: 'room-42' }
    expect(getRoomInviteState({ invite, isMine: false, currentRoomId: null, inviterPresence: presence })).toBe('open')
  })

  it('is "here" when I am already in that space', () => {
    expect(getRoomInviteState({ invite, isMine: false, currentRoomId: 'room-42', inviterPresence: there })).toBe('here')
  })

  it('is "closed" once the person who invited left that space or went offline', () => {
    const elsewhere = { isOnline: true, inRoom: true, roomCode: 'ROOM-7' }
    const lobby = { isOnline: true, inRoom: false, roomCode: null }
    const offline = { isOnline: false, inRoom: true, roomCode: 'ROOM-42' }
    // Back on the home screen, with the last room still reported.
    const leftTheRoom = { isOnline: true, inRoom: false, roomCode: 'ROOM-42' }
    for (const inviterPresence of [elsewhere, lobby, offline, leftTheRoom]) {
      expect(getRoomInviteState({ invite, isMine: false, currentRoomId: null, inviterPresence })).toBe('closed')
    }
  })

  it('stays "open" when nothing is known about the person who invited', () => {
    expect(getRoomInviteState({ invite, isMine: false, currentRoomId: null, inviterPresence: null })).toBe('open')
  })
})
