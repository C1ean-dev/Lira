import React from 'react'
import { PlayerAvatar } from '../common/PlayerAvatar'
import { ChatPeople, ChatPerson } from '../../utils/chatPeople'

interface Props {
  people: ChatPeople
  onOpen: (person: ChatPerson) => void
  onContextMenu?: (e: React.MouseEvent, person: ChatPerson) => void
}

const HEADING_CLASS = 'text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 py-1'
const EMPTY_CLASS = 'text-[11px] text-slate-400 px-2 py-1 italic'

const whereabouts = (person: ChatPerson): string =>
  person.inSpace
    ? `${person.name} está neste espaço`
    : `${person.name} está ${person.isOnline ? 'online' : 'offline'}`

const PersonRow: React.FC<Pick<Props, 'onOpen' | 'onContextMenu'> & { person: ChatPerson }> = ({
  person,
  onOpen,
  onContextMenu,
}) => (
  <button
    type="button"
    onClick={() => onOpen(person)}
    onContextMenu={onContextMenu ? (e) => onContextMenu(e, person) : undefined}
    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-all ${
      person.isCurrent
        ? 'bg-indigo-600/30 text-indigo-300 font-semibold border border-indigo-500/30'
        : person.isOnline
        ? 'text-slate-300 hover:text-white hover:bg-slate-800/40'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
    }`}
    title={whereabouts(person)}
  >
    <div className="flex items-center gap-2 truncate">
      <PlayerAvatar
        name={person.name}
        player={person.avatarSource}
        showStatus={true}
        status={person.status}
        size="xs"
        className={person.isOnline ? 'rounded-full' : 'rounded-full opacity-70'}
      />
      <span className="truncate text-xs">{person.name}</span>
    </div>
    {person.unreadCount > 0 && (
      <span className="bg-indigo-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
        {person.unreadCount}
      </span>
    )}
  </button>
)

/**
 * Direct-message side of the chat sidebar: friends, the other people in this
 * space, and saved conversations with anyone else.
 */
export const ChatPeopleList: React.FC<Props> = ({ people, onOpen, onContextMenu }) => {
  const { friends, inSpace, conversations } = people
  const hasFriendsHere = friends.some((p) => p.inSpace)
  const row = (person: ChatPerson) => (
    <PersonRow key={person.key} person={person} onOpen={onOpen} onContextMenu={onContextMenu} />
  )

  return (
    <>
      <section aria-label="Amigos" className="space-y-1">
        <div className={HEADING_CLASS}>Amigos ({friends.length})</div>
        {friends.length === 0 ? <div className={EMPTY_CLASS}>Nenhum amigo ainda</div> : friends.map(row)}
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
