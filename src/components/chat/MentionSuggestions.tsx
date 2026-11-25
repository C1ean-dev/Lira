import React from 'react'
import type { MentionCandidate } from '../../utils/chatMentions'

type Props = { candidates: MentionCandidate[]; selectedIndex: number; onSelect(candidate: MentionCandidate): void }
export const MentionSuggestions: React.FC<Props> = ({ candidates, selectedIndex, onSelect }) => {
  if (!candidates.length) return null
  return <div id="chat-mention-suggestions" role="listbox" aria-label="Pessoas e pets para mencionar" className="mb-2 max-h-44 overflow-y-auto rounded-xl border border-dashed border-lira-rule bg-lira-surface p-1 font-mono">
    {candidates.map((candidate, index) => <button type="button" role="option" aria-selected={index === selectedIndex}
      key={`${candidate.kind}:${candidate.id}`} onMouseDown={event => event.preventDefault()} onClick={() => onSelect(candidate)}
      className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${index === selectedIndex ? 'bg-lira-amber/15 text-lira-amber border border-lira-amber/40' : 'text-lira-ink hover:bg-lira-panel border border-transparent'}`}>
      <span className="font-semibold">@{candidate.name}</span> <span className="text-lira-muted">{candidate.kind === 'pet' ? `Pet de ${candidate.ownerName || 'participante'}` : 'Pessoa'}</span>
    </button>)}
  </div>
}
