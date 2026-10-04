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
  onCopyName: () => void
  onClose: () => void
}

const MENU_WIDTH = 224
const MENU_HEIGHT = 150

const itemClass =
  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-xs font-semibold transition-colors'

/** Right-click menu for the author of a chat message. */
export const ChatUserContextMenu: React.FC<Props> = ({
  x,
  y,
  name,
  friendState,
  onAddFriend,
  onRemoveFriend,
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
      className="fixed z-[100] w-56 bg-[#12151d]/95 backdrop-blur-xl border border-[#2a3142] rounded-2xl shadow-2xl p-2 select-none text-slate-200"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-2.5 py-1.5 mb-1 border-b border-[#2a3142]/80 text-xs font-bold text-white truncate">
        {friendState === 'self' ? `${name} (Você)` : name}
      </div>

      {friendState === 'can-add' && (
        <button type="button" role="menuitem" onClick={run(onAddFriend)} className={`${itemClass} hover:bg-indigo-600/20 text-slate-100`}>
          <UserPlus className="w-4 h-4 text-indigo-400 shrink-0" />
          <span>Adicionar aos amigos</span>
        </button>
      )}

      {friendState === 'pending' && (
        <button type="button" role="menuitem" disabled className={`${itemClass} opacity-50 cursor-not-allowed text-slate-300`}>
          <Clock className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Solicitação pendente</span>
        </button>
      )}

      {friendState === 'friend' && (
        <button type="button" role="menuitem" onClick={run(onRemoveFriend)} className={`${itemClass} hover:bg-rose-500/15 text-rose-300`}>
          <UserMinus className="w-4 h-4 text-rose-400 shrink-0" />
          <span>Remover dos amigos</span>
        </button>
      )}

      <button type="button" role="menuitem" onClick={run(onCopyName)} className={`${itemClass} hover:bg-slate-800/80 text-slate-200`}>
        <Copy className="w-4 h-4 text-slate-400 shrink-0" />
        <span>Copiar nome</span>
      </button>
    </div>
  )
}
