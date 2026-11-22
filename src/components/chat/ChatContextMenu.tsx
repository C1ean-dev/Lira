import React, { useEffect, useRef } from 'react'

export interface ChatMenuItem {
  id: string
  label: string
  icon?: React.ReactNode
  tone?: 'danger'
  disabled?: boolean
}

interface Props {
  x: number
  y: number
  title: string
  items: ChatMenuItem[]
  note?: string
  onSelect: (id: string) => void
  onClose: () => void
}

const MENU_WIDTH = 224
const MENU_MARGIN = 10
const HEADER_HEIGHT = 44
const ITEM_HEIGHT = 36
const NOTE_HEIGHT = 44

export function placeContextMenu(
  pointer: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number } {
  return {
    left: Math.max(MENU_MARGIN, Math.min(pointer.x, viewport.width - size.width - MENU_MARGIN)),
    top: Math.max(MENU_MARGIN, Math.min(pointer.y, viewport.height - size.height - MENU_MARGIN)),
  }
}

const itemClass =
  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-xs font-mono font-semibold transition-colors'

export const ChatContextMenu: React.FC<Props> = ({ x, y, title, items, note, onSelect, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const height = HEADER_HEIGHT + items.length * ITEM_HEIGHT + (note ? NOTE_HEIGHT : 0)
  const viewport =
    typeof window !== 'undefined'
      ? { width: window.innerWidth, height: window.innerHeight }
      : { width: x + MENU_WIDTH + MENU_MARGIN, height: y + height + MENU_MARGIN }
  const { left, top } = placeContextMenu({ x, y }, { width: MENU_WIDTH, height }, viewport)

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ left, top }}
      className="fixed z-[100] w-56 bg-lira-panel border border-dashed border-lira-rule rounded-xl p-2 select-none text-lira-ink font-mono"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-2.5 py-1.5 mb-1 border-b border-dashed border-lira-rule/60 text-xs font-display font-bold text-lira-accent truncate">
        {title}
      </div>

      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(item.id)
            onClose()
          }}
          className={`${itemClass} ${
            item.disabled
              ? 'opacity-50 cursor-not-allowed text-lira-muted'
              : item.tone === 'danger'
              ? 'hover:bg-lira-error/15 text-rose-300 text-lira-error'
              : 'hover:bg-lira-surface text-lira-ink'
          }`}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}

      {note && <div className="px-2.5 py-1.5 text-[11px] leading-snug text-lira-muted">{note}</div>}
    </div>
  )
}
