import React from 'react'
import {
  Sparkles,
  Gamepad2,
  Compass,
  Music,
  Code2,
  Palette,
  Moon,
  Heart,
  Crown,
  Star,
  Shield,
  Layers,
} from 'lucide-react'
import { PROFILE_MEDAL_MAP } from '../../data/profileCatalog'
import { ProfileMedalId } from '../../types/profile'

export const MedalIcon: React.FC<{ medalId: ProfileMedalId; className?: string }> = ({
  medalId,
  className = 'w-3.5 h-3.5',
}) => {
  switch (medalId) {
    case 'pioneer':
      return <Sparkles className={className} />
    case 'gamer':
      return <Gamepad2 className={className} />
    case 'architect':
      return <Layers className={className} />
    case 'dj':
      return <Music className={className} />
    case 'dev':
      return <Code2 className={className} />
    case 'artist':
      return <Palette className={className} />
    case 'night-owl':
      return <Moon className={className} />
    case 'friendly':
      return <Heart className={className} />
    case 'explorer':
      return <Compass className={className} />
    case 'host':
      return <Crown className={className} />
    case 'vip':
      return <Star className={className} />
    case 'supporter':
      return <Shield className={className} />
    default:
      return <Sparkles className={className} />
  }
}

interface Props {
  medals?: ProfileMedalId[]
  size?: 'xs' | 'sm' | 'md'
  maxVisible?: number
  className?: string
}

export const MedalBadgeList: React.FC<Props> = ({
  medals = [],
  size = 'md',
  maxVisible = 8,
  className = '',
}) => {
  const valid = medals.filter((id) => !!PROFILE_MEDAL_MAP[id]).slice(0, maxVisible)
  if (valid.length === 0) return null

  const iconClass = size === 'xs' ? 'w-3 h-3' : size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  const pillPadding = size === 'xs' ? 'px-1.5 py-0.5 gap-1' : size === 'sm' ? 'px-2 py-0.5 gap-1.5' : 'px-2.5 py-1 gap-1.5'

  return (
    <div
      className={`inline-flex items-center flex-wrap rounded-lg bg-[#16181f]/90 border border-white/10 shadow-inner ${pillPadding} ${className}`}
      aria-label="Medalhas do perfil"
    >
      {valid.map((medalId) => {
        const meta = PROFILE_MEDAL_MAP[medalId]
        return (
          <span
            key={medalId}
            className="group relative inline-flex items-center justify-center rounded-md p-0.5 transition-transform hover:scale-125"
            style={{ color: meta.color }}
            title={`${meta.name} — ${meta.description}`}
            aria-label={meta.name}
          >
            <MedalIcon medalId={medalId} className={iconClass} />
          </span>
        )
      })}
    </div>
  )
}
