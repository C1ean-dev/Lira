import type { ChatMention } from '../types/chat'

export type MentionCandidate = Pick<ChatMention, 'kind' | 'id' | 'name'> & { ownerName?: string }
type Query = { start: number; end: number; query: string }

export function findMentionQuery(text: string, caret: number): Query | null {
  const before = text.slice(0, caret)
  const match = /(?:^|\s)@([^@\n]{0,60})$/u.exec(before)
  return match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null
}

export function updateMentions(before: string, after: string, mentions: ChatMention[]): ChatMention[] {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let oldEnd = before.length, newEnd = after.length
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd-- }
  const delta = newEnd - oldEnd
  return mentions.flatMap(mention => {
    if (mention.end <= start) return [mention]
    if (mention.start >= oldEnd) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }]
    return []
  })
}

export function insertMention(text: string, query: Pick<Query, 'start' | 'end'>, candidate: MentionCandidate, existing: ChatMention[]) {
  const token = `@${candidate.name}`
  const next = text.slice(0, query.start) + token + ' ' + text.slice(query.end)
  return { text: next, caret: query.start + token.length + 1, mentions: [
    ...updateMentions(text, next, existing),
    { kind: candidate.kind, id: candidate.id, name: candidate.name, start: query.start, end: query.start + token.length },
  ] }
}

const valid = (text: string, mention: ChatMention) => mention && (mention.kind === 'person' || mention.kind === 'pet') &&
  typeof mention.id === 'string' && typeof mention.name === 'string' && Number.isInteger(mention.start) && Number.isInteger(mention.end) &&
  mention.start >= 0 && mention.end <= text.length && mention.end > mention.start && text.slice(mention.start, mention.end) === `@${mention.name}`

export function isPersonMentioned(text: string, mentions: ChatMention[] | undefined, ids: (string | undefined)[]): boolean {
  return Array.isArray(mentions) && mentions.some(mention => valid(text, mention) && mention.kind === 'person' && ids.some(id => !!id && id === mention.id))
}

export function resolveMentions(text: string, candidates: MentionCandidate[], selected: ChatMention[]): ChatMention[] {
  const found = selected.filter(m => valid(text, m) && candidates.some(c => c.kind === m.kind && c.id === m.id && c.name === m.name))
  const byName = new Map<string, MentionCandidate[]>()
  for (const candidate of candidates) {
    const key = candidate.name.toLocaleLowerCase()
    byName.set(key, [...(byName.get(key) || []), candidate])
  }
  const unique = [...byName.values()].filter(group => group.length === 1).map(group => group[0]).sort((a, b) => b.name.length - a.name.length)
  for (const candidate of unique) {
    const escaped = candidate.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(^|[\\s(])@${escaped}(?=$|[\\s.,!?;:)])`, 'giu')
    for (const match of text.matchAll(pattern)) {
      const start = match.index! + match[1].length
      const end = start + 1 + candidate.name.length
      if (found.some(m => start < m.end && end > m.start)) continue
      found.push({ kind: candidate.kind, id: candidate.id, name: text.slice(start + 1, end), start, end })
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

export function prepareMentionMessage(draft: string, candidates: MentionCandidate[], selected: ChatMention[], allowPets: boolean) {
  const text = draft.trim()
  const leading = draft.length - draft.trimStart().length
  const mentions = resolveMentions(draft, candidates, selected)
    .map(mention => ({ ...mention, start: mention.start - leading, end: mention.end - leading }))
    .filter(mention => valid(text, mention))
  const pets = allowPets ? mentions.filter(mention => mention.kind === 'pet') : []
  let question = text
  for (const mention of [...pets].reverse()) question = question.slice(0, mention.start) + question.slice(mention.end)
  question = question.trim() || 'Olá!'
  return { text, mentions, petRequests: [...new Set(pets.map(pet => pet.id))].map(id => ({ id, question })) }
}

export function mentionSegments(text: string, mentions: ChatMention[] | undefined): { text: string; mention?: true }[] {
  const result: { text: string; mention?: true }[] = []
  let cursor = 0
  for (const mention of (Array.isArray(mentions) ? [...mentions] : []).filter(m => valid(text, m)).sort((a, b) => a.start - b.start)) {
    if (mention.start < cursor) continue
    if (mention.start > cursor) result.push({ text: text.slice(cursor, mention.start) })
    result.push({ text: text.slice(mention.start, mention.end), mention: true })
    cursor = mention.end
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor) })
  return result
}
