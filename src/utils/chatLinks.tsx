import React from 'react'
import { mentionSegments } from './chatMentions'
import type { ChatMention } from '../types/chat'

const URL_REGEX = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi

export function openExternalUrl(rawUrl: string): void {
  const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl) ? rawUrl : `https://${rawUrl}`
  try {
    const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null
    if (electronAPI && typeof electronAPI.openExternal === 'function') {
      electronAPI.openExternal(url)?.catch?.(() => {})
      return
    }
  } catch {}

  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export function parseUrlTrailing(raw: string): { url: string; trailing: string } {
  let url = raw
  let trailing = ''
  while (url.length > 0) {
    const last = url[url.length - 1]
    if (['.', ',', ';', ':', '!', '?'].includes(last)) {
      trailing = last + trailing
      url = url.slice(0, -1)
    } else if (last === ')' && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
      trailing = last + trailing
      url = url.slice(0, -1)
    } else {
      break
    }
  }
  return { url, trailing }
}

export function linkifyText(text: string): React.ReactNode {
  if (!text) return text
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  URL_REGEX.lastIndex = 0

  while ((match = URL_REGEX.exec(text)) !== null) {
    const matchIndex = match.index
    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex))
    }

    const matchedRaw = match[0]
    const { url, trailing } = parseUrlTrailing(matchedRaw)
    if (url) {
      const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
      parts.push(
        <a
          key={`link-${matchIndex}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            openExternalUrl(href)
          }}
          className="text-sky-400 hover:text-sky-300 underline break-all cursor-pointer font-medium"
        >
          {url}
        </a>
      )
    }
    if (trailing) {
      parts.push(trailing)
    }
    lastIndex = matchIndex + matchedRaw.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  if (parts.length === 0) return text
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts
}

export function renderChatContent(content: string, mentions?: ChatMention[]): React.ReactNode {
  if (!content) return null
  const segments = mentionSegments(content, mentions)
  return segments.map((part, index) => {
    if (part.mention) {
      return (
        <span key={index} className="text-indigo-300 font-semibold bg-indigo-500/20 rounded px-0.5">
          {part.text}
        </span>
      )
    }
    return <React.Fragment key={index}>{linkifyText(part.text)}</React.Fragment>
  })
}
