import React from 'react'
import { PlayerAvatar } from '../common/PlayerAvatar'
import { ChatPeople, ChatPerson, getChatPersonStatusDisplay } from '../../utils/chatPeople'

interface Props {
  people: ChatPeople
  onOpen: (person: ChatPerson) => void
  onContextMenu?: (e: React.MouseEvent, person: ChatPerson) => void
}

const HEADING_CLASS = 'text-[10px] font-mono font-bold uppercase tracking-wider text-lira-muted px-2 py-1'
const EMPTY_CLASS = 'text-[11px] font-mono text-lira-muted/80 px-2 py-1 italic'

const whereabouts = (person: ChatPerson): string =>
  person.inSpace
    ? `${person.name} está neste espaço`
    : `${person.name} está ${person.isOnline ? 'online' : 'offline'}`

const PersonRow: React.FC<Pick<Props, 'onOpen' | 'onContextMenu'> & { person: ChatPerson }> = ({
  person,
  onOpen,
  onContextMenu,
}) => {
  const statusDisplay = getChatPersonStatusDisplay(person)

  return (
    <button
      type="button"
      onClick={() => onOpen(person)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, person) : undefined}
      className={`w-full flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg text-xs font-mono transition-colors ${
        person.isCurrent
          ? person.isOnline
            ? 'bg-indigo-600/30 bg-lira-surface text-lira-accent font-semibold border border-lira-rule/50'
            : 'bg-indigo-600/30 bg-lira-surface/80 text-lira-muted font-semibold border border-lira-rule/40'
          : person.isOnline
          ? 'text-lira-ink hover:text-lira-accent hover:bg-lira-surface/60 border border-transparent'
          : 'text-lira-muted/70 hover:text-lira-ink hover:bg-lira-surface/50 border border-transparent'
      }`}
      title={whereabouts(person)}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <PlayerAvatar
          name={person.name}
          player={person.avatarSource}
          showStatus={true}
          status={person.status}
          size="sm"
          className={person.isOnline ? 'rounded-[6px]' : 'rounded-[6px] opacity-45 grayscale'}
        />
        <div className="flex flex-col min-w-0 text-left">
          <span className="truncate text-xs">{person.name}</span>
          <span className="flex items-center gap-1 text-[10px] leading-tight min-w-0 font-normal">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDisplay.dotClass}`} />
            <span className={`truncate ${statusDisplay.isOnline ? statusDisplay.textClass : 'text-lira-muted/75'}`}>
              {statusDisplay.statusLabel}
            </span>
          </span>
        </div>
      </div>
      {person.unreadCount > 0 && (
        <span className="bg-indigo-500 bg-lira-accent text-lira-ground text-[10px] px-1.5 py-0.2 rounded font-mono font-bold shrink-0">
          {person.unreadCount}
        </span>
      )}
    </button>
  )
}

export const ChatPeopleList: React.FC<Props> = ({ people, onOpen, onContextMenu }) => {
  const { friends, inSpace, conversations } = people
  const onlineFriends = friends.filter((p) => p.isOnline)
  const offlineFriends = friends.filter((p) => !p.isOnline)
  const hasFriendsHere = friends.some((p) => p.inSpace)
  const row = (person: ChatPerson) => (
    <PersonRow key={person.key} person={person} onOpen={onOpen} onContextMenu={onContextMenu} />
  )

  return (
    <>
      <section aria-label="Amigos" className="space-y-1">
        <div className={HEADING_CLASS}>Amigos ({friends.length})</div>
        {friends.length === 0 ? (
          <div className={EMPTY_CLASS}>Nenhum amigo ainda</div>
        ) : (
          <div className="space-y-1.5">
            {onlineFriends.length > 0 && (
              <div className="space-y-0.5" data-group="online">
                <div className="flex items-center gap-1.5 px-2 pt-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-lira-online">
                  <span className="w-1.5 h-1.5 rounded-full bg-lira-online shadow-[0_0_6px_rgb(var(--online-rgb)/0.9)] shrink-0" />
                  <span>Online ({onlineFriends.length})</span>
                </div>
                {onlineFriends.map(row)}
              </div>
            )}
            {offlineFriends.length > 0 && (
              <div className="space-y-0.5" data-group="offline">
                <div className="flex items-center gap-1.5 px-2 pt-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-lira-muted/80">
                  <span className="w-1.5 h-1.5 rounded-full border border-lira-muted/70 bg-lira-ground shrink-0" />
                  <span>Offline ({offlineFriends.length})</span>
                </div>
                {offlineFriends.map(row)}
              </div>
            )}
          </div>
        )}
      </section>

      <section aria-label="No espaço" className="space-y-1">
        <div className={HEADING_CLASS} title="Quem está neste espaço e não é seu amigo">
          No espaço ({inSpace.length})
        </div>
        {inSpace.length === 0 ? (
          <div className={EMPTY_CLASS}>{hasFriendsHere ? 'Só seus amigos' : 'Ninguém online'}</div>
        ) : (
          inSpace.map(row)
        )}
      </section>

      {conversations.length > 0 && (
        <section aria-label="Conversas" className="space-y-1">
          <div className={HEADING_CLASS} title="Conversas com quem não está neste espaço nem é seu amigo">
            Conversas ({conversations.length})
          </div>
          {conversations.map(row)}
        </section>
      )}
    </>
  )
}
