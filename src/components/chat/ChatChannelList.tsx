import React, { useState } from 'react'
import { ChevronDown, Hash, Lock, Plus } from 'lucide-react'
import { Channel } from '../../types/chat'

export type ChannelEditing = { mode: 'create' } | { mode: 'rename'; channelId: string } | null

interface Props {
  channels: Channel[]
  activeChannelId: string
  canManage: boolean
  editing: ChannelEditing
  error?: string | null
  onSelect: (channelId: string) => void
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
      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-lira-ground border border-lira-accent/60">
        <Hash className="w-3 h-3 shrink-0 text-lira-muted" />
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
          className="w-full min-w-0 bg-transparent text-xs font-mono text-lira-ink placeholder-lira-muted/60 focus:outline-none"
        />
      </div>
      {error && <div className="text-[10px] font-mono leading-snug text-lira-error px-2 pt-1">{error}</div>}
    </form>
  )
}

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
        className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors border ${
          isCurrent
            ? 'bg-indigo-600/30 bg-lira-surface text-lira-accent font-semibold border-lira-rule/50'
            : 'text-lira-muted hover:text-lira-ink hover:bg-lira-surface/60 border-transparent'
        }`}
      >
        <div className="flex items-center gap-1.5 truncate">
          {ch.type === 'zone' ? (
            <Lock className="w-3 h-3 text-emerald-400 text-lira-online shrink-0" />
          ) : (
            <Hash className="w-3 h-3 shrink-0" />
          )}
          <span className="truncate">{ch.name}</span>
        </div>
        {ch.unreadCount > 0 && (
          <span className="bg-indigo-500 bg-lira-accent text-lira-ground text-[10px] px-1.5 py-0.2 rounded font-mono font-bold">
            {ch.unreadCount}
          </span>
        )}
      </button>
    )
  }

  return (
    <section aria-label="Canais" className="space-y-1" onContextMenu={(e) => onContextMenu(e, null)}>
      <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-lira-muted px-2 py-1 flex items-center justify-between">
        <span>Canais</span>
        {canManage ? (
          <button
            type="button"
            onClick={onStartCreate}
            title="Novo canal"
            className="p-0.5 rounded text-lira-muted hover:text-lira-accent hover:bg-lira-surface transition-colors"
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
