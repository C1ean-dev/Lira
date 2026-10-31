import { useLayoutEffect, useRef, useState, UIEvent, WheelEvent, TouchEvent } from 'react'
import { getMessagePage, getPageEndId } from '../utils/chatPagination'

export function useChatPagination<T extends { id: string }>(messages: T[], channelId: string) {
  const [selection, setSelection] = useState<{ channelId: string; endId: string | null }>({ channelId, endId: null })
  const endId = selection.channelId === channelId ? selection.endId : null
  if (selection.channelId !== channelId) setSelection({ channelId, endId: null })
  const page = getMessagePage(messages, endId)
  const messagesRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followBottom = useRef(true)
  const previousChannel = useRef(channelId)
  const previousTop = useRef(0)
  const pendingDirection = useRef<'older' | 'newer' | null>(null)
  const touchY = useRef<number | null>(null)
  const lastMessageId = messages[messages.length - 1]?.id

  useLayoutEffect(() => {
    const container = messagesRef.current
    if (!container) return
    if (previousChannel.current !== channelId) {
      followBottom.current = true
      pendingDirection.current = null
    }
    previousChannel.current = channelId
    const bottom = Math.max(0, container.scrollHeight - container.clientHeight)
    if (pendingDirection.current) {
      // Enter the adjoining batch at its reading edge. The one-pixel inset
      // prevents the programmatic scroll from loading another batch immediately.
      container.scrollTop = pendingDirection.current === 'older' ? Math.max(0, bottom - 1) : Math.min(1, bottom)
      followBottom.current = false
    } else if (endId === null && followBottom.current) {
      container.scrollTop = bottom
    }
    previousTop.current = container.scrollTop
    pendingDirection.current = null
    // Deferred image/font layout changes scrollHeight after the opening commit.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (endId !== null || !followBottom.current) return
      container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
      previousTop.current = container.scrollTop
    })
    observer.observe(container)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [channelId, endId, lastMessageId])

  const loadBatch = (direction: 'older' | 'newer') => {
    if (pendingDirection.current || !(direction === 'older' ? page.hasOlder : page.hasNewer)) return
    pendingDirection.current = direction
    setSelection({ channelId, endId: getPageEndId(messages, page, direction) })
  }

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const container = event.currentTarget
    const delta = container.scrollTop - previousTop.current
    previousTop.current = container.scrollTop
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
      followBottom.current = endId === null
    } else if (delta < 0) {
      followBottom.current = false
    }
    if (delta < 0 && container.scrollTop <= 2) loadBatch('older')
    if (delta > 0 && container.scrollTop + container.clientHeight >= container.scrollHeight - 2) loadBatch('newer')
  }

  // A short first batch may not overflow, so it cannot dispatch scroll events.
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.currentTarget.scrollHeight <= event.currentTarget.clientHeight && event.deltaY !== 0) {
      loadBatch(event.deltaY < 0 ? 'older' : 'newer')
    }
  }

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    touchY.current = event.touches[0]?.clientY ?? null
  }
  const onTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const y = event.touches[0]?.clientY
    if (y === undefined || touchY.current === null) return
    const delta = touchY.current - y
    if (event.currentTarget.scrollHeight <= event.currentTarget.clientHeight && Math.abs(delta) > 10) {
      loadBatch(delta < 0 ? 'older' : 'newer')
      touchY.current = y
    }
  }

  return {
    page,
    messagesRef,
    contentRef,
    onScroll,
    onWheel,
    onTouchStart,
    onTouchMove,
  }
}
