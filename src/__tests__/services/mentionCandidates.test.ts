import { describe, expect, it } from 'vitest'
import { buildMentionCandidates } from '../../utils/mentionCandidates'

describe('mention candidates', () => {
  const local = { id: 'self', name: 'Ana', currentZoneId: 'zone', avatar: { pet: { type: 'custom' as const, name: 'Mingau' } } }
  const remote = [{ id: 'other', gameId: 'stable', name: 'Bia', currentZoneId: 'zone' }]
  it('includes people in the space and pets in the current room', () => {
    expect(buildMentionCandidates(local, remote, { id: 'general', type: 'general', name: 'general' })).toEqual([
      expect.objectContaining({ kind: 'person', id: 'self', name: 'Ana' }),
      expect.objectContaining({ kind: 'person', id: 'stable', name: 'Bia' }),
      expect.objectContaining({ kind: 'pet', id: 'self', name: 'Mingau', ownerName: 'Ana' }),
    ])
  })
  it('includes a private conversation recipient but excludes pets to protect message privacy', () => {
    expect(buildMentionCandidates(local, remote, { id: 'dm-x', type: 'dm', name: 'Carla', recipientId: 'carla' })).toContainEqual(expect.objectContaining({ kind: 'person', id: 'carla', name: 'Carla' }))
    expect(buildMentionCandidates(local, remote, { id: 'dm-x', type: 'dm', name: 'Carla', recipientId: 'carla' }).some(c => c.kind === 'pet')).toBe(false)
  })
})
