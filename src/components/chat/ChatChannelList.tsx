import React, { useState } from 'react'
import { ChevronDown, Hash, Lock, Plus } from 'lucide-react'
import { Channel } from '../../types/chat'

export type ChannelEditing = { mode: 'create' } | { mode: 'rename'; channelId: string } | null

interface Props {
  /** The channels of the space plus the zone channel; no private conversations. */
  channels: Channel[]
  activeChannelId: string
  /** Only the owner of the space creates, renames and deletes channels. */
  canManage: boolean
  editing: ChannelEditing
  /** Why the name being edited was refused. */
  error?: string | null
  onSelect: (channelId: string) => void
  /** `channel` is null for a right-click outside any channel. */
  onContextMenu: (e: React.MouseEvent, channel: Channel | null) => void
  onStartCreate: () => void
  onSubmitName: (name: string) => void
  onCancelEdit: () => void
}

const ChannelNameEditor: React.FC<{
  initialName: string
  error?: string | null
  onSubmit: (name: string) => void
  onCancel: () => void
}> = ({ initialName, error, onSubmit, onCancel }) => {
  const [name, setName] = useState(initialName)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(name)
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#12151d] border border-indigo-500/60">
        <Hash className="w-3 h-3 shrink-0 text-slate-400" />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              onCancel()
            }
          }}
          onBlur={onCancel}
          maxLength={40}
          placeholder="nome-do-canal"
          aria-label={initialName ? 'Novo nome do canal' : 'Nome do novo canal'}
          className="w-full min-w-0 bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
        />
      </div>
      {error && <div className="text-[10px] leading-snug text-rose-300 px-2 pt-1">{error}</div>}
    </form>
  )
}

/** Channel side of the chat sidebar. */
export const ChatChannelList: React.FC<Props> = ({
  channels,
  activeChannelId,
  canManage,
  editing,
  error,
  onSelect,
  onContextMenu,
  onStartCreate,
  onSubmitName,
  onCancelEdit,
}) => {
  const newChannelEditor =
    editing?.mode === 'create' ? (
      <ChannelNameEditor key="new-channel" initialName="" error={error} onSubmit={onSubmitName} onCancel={onCancelEdit} />
    ) : null
  // A new channel lands above the zone channel, so that is where it is typed.
  const zoneIndex = channels.findIndex((c) => c.type === 'zone')
  const newChannelIndex = zoneIndex === -1 ? channels.length : zoneIndex

  const renderChannel = (ch: Channel) => {
    if (editing?.mode === 'rename' && editing.channelId === ch.id) {
      return (
        <ChannelNameEditor key={ch.id} initialName={ch.name} error={error} onSubmit={onSubmitName} onCancel={onCancelEdit} />
      )
    }
    const isCurrent = ch.id === activeChannelId
    return (
      <button
        key={ch.id}
        type="button"
        onClick={() => onSelect(ch.id)}
        onContextMenu={(e) => {
          e.stopPropagation()
          onContextMenu(e, ch)
        }}
        className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
          isCurrent
            ? 'bg-indigo-600/30 text-indigo-400 font-semibold'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
        }`}
      >
        <div className="flex items-center gap-1.5 truncate">
          {ch.type === 'zone' ? (
            <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
          ) : (
            <Hash className="w-3 h-3 shrink-0" />
          )}
          <span className="truncate">{ch.name}</span>
        </div>
        {ch.unreadCount > 0 && (
          <span className="bg-indigo-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
            {ch.unreadCount}
          </span>
        )}
      </button>
    )
  }

  return (
    <section aria-label="Canais" className="space-y-1" onContextMenu={(e) => onContextMenu(e, null)}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 py-1 flex items-center justify-between">
        <span>Canais</span>
        {canManage ? (
          <button
            type="button"
            onClick={onStartCreate}
            title="Novo canal"
            className="p-0.5 rounded text-slate-400 hover:text-indigo-300 hover:bg-slate-800/60 transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
      </div>

      {channels.slice(0, newChannelIndex).map(renderChannel)}
      {newChannelEditor}
      {channels.slice(newChannelIndex).map(renderChannel)}
    </section>
  )
}
