import { describe, expect, it } from 'vitest'
import { findMentionQuery, insertMention, updateMentions, resolveMentions, mentionSegments, isPersonMentioned, prepareMentionMessage } from '../../utils/chatMentions'

const options = [
  { kind: 'person' as const, id: 'ana', name: 'Ana Silva' },
  { kind: 'pet' as const, id: 'owner-1', name: 'Mingau', ownerName: 'Ana' },
  { kind: 'pet' as const, id: 'owner-2', name: 'Mingau', ownerName: 'Bia' },
]

describe('chat mentions', () => {
  it('finds an @ query at the cursor without matching email addresses', () => {
    expect(findMentionQuery('oi @Min', 7)).toEqual({ start: 3, end: 7, query: 'Min' })
    expect(findMentionQuery('ana@example', 11)).toBeNull()
    expect(findMentionQuery('oi @Ana Silva', 13)).toEqual({ start: 3, end: 13, query: 'Ana Silva' })
  })
  it('inserts the selected identity and preserves it across edits outside its span', () => {
    const result = insertMention('oi @Min!', { start: 3, end: 7 }, options[2], [])
    expect(result.text).toBe('oi @Mingau !')
    expect(result.mentions[0]).toMatchObject({ kind: 'pet', id: 'owner-2', start: 3, end: 10 })
    const updated = updateMentions(result.text, 'Olá ' + result.text, result.mentions)
    expect(updated[0]).toMatchObject({ id: 'owner-2', start: 7, end: 14 })
    expect(updateMentions(result.text, 'oi @Minga !', result.mentions)).toEqual([])
  })
  it('resolves typed unambiguous names without inventing an identity for duplicate names', () => {
    const result = resolveMentions('@Ana Silva oi @Mingau', options, [])
    expect(result).toEqual([expect.objectContaining({ kind: 'person', id: 'ana', name: 'Ana Silva' })])
  })
  it('keeps the selected pet identity when names are duplicated', () => {
    const selected = insertMention('@Min', { start: 0, end: 4 }, options[1], [])
    expect(resolveMentions(selected.text, options, selected.mentions)).toEqual([expect.objectContaining({ kind: 'pet', id: 'owner-1' })])
  })
  it('prepares one visible message and separate requests for each pet mention', () => {
    const first = insertMention('  oi @Min', { start: 5, end: 9 }, options[1], [])
    const draft = first.text + 'como vai?'
    const prepared = prepareMentionMessage(draft, options, first.mentions, true)
    expect(prepared.text).toBe('oi @Mingau como vai?')
    expect(prepared.mentions).toEqual([expect.objectContaining({ kind: 'pet', id: 'owner-1', start: 3, end: 10 })])
    expect(prepared.petRequests).toEqual([{ id: 'owner-1', question: 'oi  como vai?' }])
    expect(prepareMentionMessage(draft, options, first.mentions, false).petRequests).toEqual([])
  })
  it('recognizes only a valid mention of the person by stable id', () => {
    const mentions = [{ kind: 'person' as const, id: 'ana', name: 'Ana', start: 3, end: 7 }]
    expect(isPersonMentioned('oi @Ana', mentions, ['ana'])).toBe(true)
    expect(isPersonMentioned('oi @Ana', mentions, ['other'])).toBe(false)
    expect(isPersonMentioned('oi xxxx', mentions, ['ana'])).toBe(false)
    expect(isPersonMentioned('oi @Ana', [{ ...mentions[0], kind: 'pet' }], ['ana'])).toBe(false)
  })
  it('renders valid mention ranges and ignores malformed metadata', () => {
    expect(mentionSegments('oi @Ana Silva!', [{ kind: 'person', id: 'ana', name: 'Ana Silva', start: 3, end: 13 }])).toEqual([
      { text: 'oi ' }, { text: '@Ana Silva', mention: true }, { text: '!' },
    ])
    expect(mentionSegments('hello', [{ kind: 'person', id: 'ana', name: 'Ana', start: 0, end: 4 }])).toEqual([{ text: 'hello' }])
  })
})
