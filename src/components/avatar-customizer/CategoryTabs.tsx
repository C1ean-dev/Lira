import React from 'react'
import {
  UserCircle,
  Sparkles,
  Footprints,
  Cat,
  UserCog,
} from 'lucide-react'

export type CategoryKey =
  | 'other'
  | 'aura'
  | 'steps'
  | 'pet'
  | 'profile'

interface Props {
  activeCategory: CategoryKey
  onSelectCategory: (category: CategoryKey) => void
  className?: string
}

export const CATEGORIES = [
  { id: 'other', label: 'Personagem', icon: UserCircle },
  { id: 'aura', label: 'Aura', icon: Sparkles },
  { id: 'steps', label: 'Passos', icon: Footprints },
  { id: 'pet', label: 'Pet / Mascote', icon: Cat },
  { id: 'profile', label: 'Config. de Perfil', icon: UserCog },
]

export const CategoryTabs: React.FC<Props> = ({ activeCategory, onSelectCategory, className = '' }) => {
  return (
    <div className={className || "w-48 bg-lira-sidebar border-r border-lira-quiet p-3 flex flex-col gap-1 overflow-y-auto shrink-0"}>
      {CATEGORIES.map((cat) => {
        const Icon = cat.icon
        const isActive = activeCategory === cat.id
        return (
          <button
            key={cat.id}
            onClick={() => onSelectCategory(cat.id as CategoryKey)}
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-[8px] text-xs font-mono font-bold transition-colors text-left border ${
              isActive
                ? 'bg-lira-accent text-lira-ground border-lira-accent'
                : 'text-lira-muted border-transparent hover:bg-lira-surface hover:text-lira-ink hover:border-lira-rule'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="truncate">{cat.label}</span>
          </button>
        )
      })}
    </div>
  )
}
