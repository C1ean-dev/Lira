export const CHAT_PAGE_SIZE = 50

export interface MessagePage<T> {
  messages: T[]
  start: number
  end: number
  total: number
  hasOlder: boolean
  hasNewer: boolean
}

// Anchor history pages by message ID so incoming messages do not shift them.
export function getMessagePage<T extends { id: string }>(messages: T[], endId: string | null): MessagePage<T> {
  const anchor = endId === null ? -1 : messages.findIndex((message) => message.id === endId)
  const end = anchor < 0 ? messages.length : anchor + 1
  const start = Math.max(0, end - CHAT_PAGE_SIZE)
  return {
    messages: messages.slice(start, end), start, end, total: messages.length,
    hasOlder: start > 0, hasNewer: end < messages.length,
  }
}

export function getPageEndId<T extends { id: string }>(messages: T[], page: MessagePage<T>, direction: 'older' | 'newer'): string | null {
  if (direction === 'older') return messages[Math.max(0, page.start - 1)]?.id ?? null
  const end = Math.min(messages.length, page.end + CHAT_PAGE_SIZE)
  return end === messages.length ? null : messages[end - 1].id
}
