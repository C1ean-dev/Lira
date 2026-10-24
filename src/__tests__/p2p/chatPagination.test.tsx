import { describe, it, expect } from 'vitest'
import { getMessagePage, getPageEndId } from '../../utils/chatPagination'

const messages = Array.from({ length: 123 }, (_, i) => ({ id: `message-${i + 1}` }))

describe('chat pagination', () => {
  it('opens with only the 50 most recent messages in chronological order', () => {
    const page = getMessagePage(messages, null)
    expect(page.messages).toEqual(messages.slice(73))
    expect(page.hasOlder).toBe(true)
    expect(page.hasNewer).toBe(false)
  })

  it('navigates through the entire history without overlap or gaps', () => {
    const latest = getMessagePage(messages, null)
    const middleEnd = getPageEndId(messages, latest, 'older')
    const middle = getMessagePage(messages, middleEnd)
    const first = getMessagePage(messages, getPageEndId(messages, middle, 'older'))
    expect(middle.messages).toEqual(messages.slice(23, 73))
    expect(first.messages).toEqual(messages.slice(0, 23))
    expect(first.hasOlder).toBe(false)
    expect(first.hasNewer).toBe(true)
    const next = getMessagePage(messages, getPageEndId(messages, first, 'newer'))
    expect(next.messages).toEqual(middle.messages)
    expect(getPageEndId(messages, next, 'newer')).toBeNull()
  })

  it('keeps the history page stable when new messages arrive', () => {
    const endId = getPageEndId(messages, getMessagePage(messages, null), 'older')
    const updated = [...messages, { id: 'new-message' }]
    expect(getMessagePage(updated, endId).messages).toEqual(messages.slice(23, 73))
    expect(getMessagePage(updated, null).messages).toEqual(updated.slice(-50))
  })

  it.each([0, 1, 49, 50, 51, 100, 101, 123])('handles %i messages and all page boundaries', (count) => {
    const items = messages.slice(0, count)
    let page = getMessagePage(items, null)
    const collected = [...page.messages]
    while (page.hasOlder) {
      page = getMessagePage(items, getPageEndId(items, page, 'older'))
      expect(page.messages.length).toBeLessThanOrEqual(50)
      collected.unshift(...page.messages)
    }
    expect(collected).toEqual(items)
  })

  it('falls back to the latest page if the history anchor was removed', () => {
    expect(getMessagePage(messages, 'deleted').messages).toEqual(messages.slice(-50))
  })

})
