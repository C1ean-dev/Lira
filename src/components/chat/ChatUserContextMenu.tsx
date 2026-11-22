import React, { useEffect, useRef } from 'react'
import { UserPlus, UserMinus, Clock, Copy } from 'lucide-react'
import { ChatUserFriendState } from '../../utils/chatUserActions'

interface Props {
  x: number
  y: number
  name: string
  friendState: ChatUserFriendState
  onAddFriend: () => void
  onRemoveFriend: () => void
  onCopyContent?: () => void
  onCopyName?: () => void
  onClose: () => void
}

const MENU_WIDTH = 224
const MENU_HEIGHT = 150

const itemClass =
  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-xs font-mono font-semibold transition-colors'

export const ChatUserContextMenu: React.FC<Props> = ({
  x,
  y,
  name,
  friendState,
  onAddFriend,
  onRemoveFriend,
  onCopyContent,
  onCopyName,
  onClose,
}) => {
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

  const viewportW = typeof window !== 'undefined' ? window.innerWidth : x + MENU_WIDTH + 20
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : y + MENU_HEIGHT + 20
  const left = Math.min(Math.max(10, x), viewportW - MENU_WIDTH - 10)
  const top = Math.min(Math.max(10, y), viewportH - MENU_HEIGHT - 10)

  const run = (action: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    action()
    onClose()
  }

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
        {friendState === 'self' ? `${name} (Você)` : name}
      </div>

      {friendState === 'can-add' && (
        <button type="button" role="menuitem" onClick={run(onAddFriend)} className={`${itemClass} hover:bg-lira-surface text-lira-ink`}>
          <UserPlus className="w-4 h-4 text-lira-accent shrink-0" />
          <span>Adicionar aos amigos</span>
        </button>
      )}

      {friendState === 'pending' && (
        <button type="button" role="menuitem" disabled className={`${itemClass} opacity-50 cursor-not-allowed text-lira-muted`}>
          <Clock className="w-4 h-4 text-lira-amber shrink-0" />
          <span>Solicitação pendente</span>
        </button>
      )}

      {friendState === 'friend' && (
        <button type="button" role="menuitem" onClick={run(onRemoveFriend)} className={`${itemClass} hover:bg-lira-error/15 text-lira-error`}>
          <UserMinus className="w-4 h-4 text-lira-error shrink-0" />
          <span>Remover dos amigos</span>
        </button>
      )}

      {onCopyContent ? (
        <button type="button" role="menuitem" onClick={run(onCopyContent)} className={`${itemClass} hover:bg-lira-surface text-lira-ink`}>
          <Copy className="w-4 h-4 text-lira-muted shrink-0" />
          <span>Copiar conteúdo</span>
        </button>
      ) : onCopyName ? (
        <button type="button" role="menuitem" onClick={run(onCopyName)} className={`${itemClass} hover:bg-lira-surface text-lira-ink`}>
          <Copy className="w-4 h-4 text-lira-muted shrink-0" />
          <span>Copiar nome</span>
        </button>
      ) : null}
    </div>
  )
}
