import React, { useId } from 'react'
import { AvatarConfig, PresenceStatus } from '../../types/game'
import { NameplateId, UserProfile } from '../../types/profile'
import { getNameplateStyle, resolveProfile } from '../../utils/profileUtils'
import { PlayerAvatar } from '../common/PlayerAvatar'

export const NameplateArtwork: React.FC<{ nameplateId: NameplateId; accentColor?: string }> = ({
  nameplateId,
  accentColor = '#38bdf8',
}) => {
  const uid = useId().replace(/:/g, '')
  if (nameplateId === 'none') return null

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      {nameplateId === 'spirit-mist' && (
        <svg viewBox="0 0 340 60" preserveAspectRatio="xMaxYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`np-sm-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
              <stop offset="55%" stopColor="#22d3ee" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.5" />
            </linearGradient>
          </defs>
          <path
            d="M170 60 C205 44, 222 50, 246 34 C264 22, 286 16, 340 12 L340 60 Z"
            fill={`url(#np-sm-${uid})`}
          />
          <path
            d="M210 60 C240 42, 265 44, 290 26 C308 12, 322 14, 340 4 L340 60 Z"
            fill="#38bdf8"
            opacity="0.22"
          />
          <g transform="translate(278 6)">
            <path
              d="M24 44 C12 44, 6 33, 8 20 L11 4 L20 15 C23 13, 28 13, 31 15 L40 4 L43 20 C45 33, 38 44, 24 44 Z"
              fill="#1e293b"
              stroke="#0f172a"
              strokeWidth="2.5"
            />
            <ellipse cx="25.5" cy="29" rx="10" ry="7.5" fill="#f8fafc" />
            <circle cx="25.5" cy="31" r="4" fill="#ef4444" />
          </g>
        </svg>
      )}

      {nameplateId === 'cyber-grid' && (
        <svg viewBox="0 0 340 60" preserveAspectRatio="xMaxYMid slice" className="w-full h-full">
          <path d="M180 12 H340 M195 26 H340 M210 40 H340 M225 54 H340" stroke="#22d3ee" strokeWidth="1" opacity="0.24" />
          <path d="M230 0 L210 60 M265 0 L245 60 M300 0 L280 60 M335 0 L315 60" stroke="#c084fc" strokeWidth="1" opacity="0.28" />
          <polygon points="306,12 324,30 306,48 288,30" fill="none" stroke="#22d3ee" strokeWidth="2.2" opacity="0.7" />
          <circle cx="306" cy="30" r="5" fill="#ec4899" opacity="0.85" />
        </svg>
      )}

      {nameplateId === 'sakura-breeze' && (
        <svg viewBox="0 0 340 60" preserveAspectRatio="xMaxYMid slice" className="w-full h-full">
          <path d="M190 58 C230 40, 275 46, 340 16 L340 60 Z" fill="#f472b6" opacity="0.2" />
          {[
            [252, 20, -25, 0.85],
            [284, 38, 18, 0.9],
            [312, 18, 35, 1],
            [225, 42, -45, 0.65],
          ].map(([cx, cy, rot, sc], idx) => (
            <g key={idx} transform={`translate(${cx} ${cy}) rotate(${rot}) scale(${sc})`}>
              <ellipse cx="0" cy="-6" rx="3.4" ry="6" fill="#fbcfe8" opacity="0.85" />
              <ellipse cx="5" cy="-2" rx="3.4" ry="6" fill="#f9a8d4" transform="rotate(72)" opacity="0.85" />
              <ellipse cx="3" cy="5" rx="3.4" ry="6" fill="#f472b6" transform="rotate(144)" opacity="0.85" />
              <circle cx="0" cy="0" r="2.2" fill="#fef08a" />
            </g>
          ))}
        </svg>
      )}

      {nameplateId === 'solar-flare' && (
        <svg viewBox="0 0 340 60" preserveAspectRatio="xMaxYMid slice" className="w-full h-full">
          <circle cx="310" cy="30" r="26" fill="#f97316" opacity="0.28" />
          <circle cx="310" cy="30" r="16" fill="#fbbf24" opacity="0.4" />
          <path d="M190 60 C235 38, 275 44, 340 8 L340 60 Z" fill="#f43f5e" opacity="0.25" />
        </svg>
      )}

      {nameplateId === 'aurora-boreal' && (
        <svg viewBox="0 0 340 60" preserveAspectRatio="xMaxYMid slice" className="w-full h-full">
          <path d="M150 54 C205 16, 250 48, 340 10 L340 34 C265 62, 215 36, 150 60 Z" fill="#34d399" opacity="0.28" />
          <path d="M180 60 C235 28, 285 44, 340 22 L340 60 Z" fill="#2dd4bf" opacity="0.2" />
        </svg>
      )}

      {nameplateId === 'midnight-stars' && (
        <svg viewBox="0 0 340 60" preserveAspectRatio="xMaxYMid slice" className="w-full h-full">
          <circle cx="242" cy="18" r="1.5" fill="#e0e7ff" opacity="0.8" />
          <circle cx="268" cy="40" r="1.8" fill="#c7d2fe" opacity="0.7" />
          <circle cx="286" cy="14" r="1.3" fill="#fef08a" opacity="0.9" />
          <path d="M312 12 A16 16 0 1 0 326 42 A12 12 0 1 1 312 12 Z" fill="#fde68a" opacity="0.8" />
        </svg>
      )}

      {nameplateId === 'pixel-wave' && (
        <svg viewBox="0 0 340 60" preserveAspectRatio="xMaxYMid slice" className="w-full h-full">
          <circle cx="305" cy="34" r="18" fill="#f472b6" opacity="0.45" />
          <rect x="285" y="34" width="42" height="3" fill="#2b1448" opacity="0.7" />
          <rect x="285" y="40" width="42" height="3" fill="#2b1448" opacity="0.7" />
          <rect x="285" y="46" width="42" height="3" fill="#2b1448" opacity="0.7" />
          <path d="M200 54 H340 M220 44 H340" stroke="#e879f9" strokeWidth="1" opacity="0.35" />
        </svg>
      )}

      {nameplateId === 'royal-gold' && (
        <svg viewBox="0 0 340 60" preserveAspectRatio="xMaxYMid slice" className="w-full h-full">
          <path d="M210 60 L265 0 L282 0 L227 60 Z" fill="#fbbf24" opacity="0.12" />
          <path d="M240 60 L295 0 L306 0 L251 60 Z" fill="#fde68a" opacity="0.1" />
          <path
            d="M286 38 L290 22 L299 30 L306 18 L313 30 L322 22 L326 38 Z"
            fill="#fbbf24"
            opacity="0.7"
          />
        </svg>
      )}

      {nameplateId === 'custom' && (
        <svg viewBox="0 0 340 60" preserveAspectRatio="xMaxYMid slice" className="w-full h-full">
          <circle cx="308" cy="30" r="28" fill={accentColor} opacity="0.22" />
          <path d="M185 60 C235 34, 275 46, 340 12 L340 60 Z" fill={accentColor} opacity="0.2" />
        </svg>
      )}
    </div>
  )
}

interface ProfileBarProps {
  name: string
  profilePicture?: string
  avatar?: AvatarConfig
  profile?: UserProfile | null
  status?: PresenceStatus | 'offline' | string
  subtitle?: React.ReactNode
  avatarSize?: 'xs' | 'sm' | 'md' | 'lg'
  showStatus?: boolean
  compact?: boolean
  rightSlot?: React.ReactNode
  onClick?: (e: React.MouseEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
  className?: string
  title?: string
}

export const ProfileBar: React.FC<ProfileBarProps> = ({
  name,
  profilePicture,
  avatar,
  profile,
  status = 'available',
  subtitle,
  avatarSize = 'md',
  showStatus = true,
  compact = false,
  rightSlot,
  onClick,
  onContextMenu,
  className = '',
  title,
}) => {
  const resolved = resolveProfile(profile)
  const styleInfo = getNameplateStyle(resolved)

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      data-nameplate={styleInfo.nameplateId}
      style={{
        background: styleInfo.background,
        borderColor: styleInfo.borderColor,
      }}
      className={`relative overflow-hidden border flex items-center justify-between gap-2.5 transition-all select-none ${
        compact ? 'px-2.5 py-1.5 rounded-xl' : 'px-3 py-2 rounded-2xl'
      } ${onClick ? 'cursor-pointer hover:brightness-110' : ''} ${className}`}
    >
      <NameplateArtwork nameplateId={styleInfo.nameplateId} accentColor={styleInfo.accentColor} />

      <div className="relative z-10 flex items-center gap-2.5 min-w-0 flex-1">
        <PlayerAvatar
          name={name}
          profilePicture={profilePicture}
          avatar={avatar}
          avatarFrame={resolved.avatarFrame}
          status={status}
          showStatus={showStatus}
          size={avatarSize}
          className="rounded-full"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`font-bold text-slate-100 truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)] ${
                compact ? 'text-xs' : 'text-sm'
              }`}
            >
              {name}
            </span>
          </div>
          {subtitle && <div className="text-[11px] text-slate-300/90 truncate mt-0.5">{subtitle}</div>}
        </div>
      </div>

      {rightSlot && <div className="relative z-10 flex items-center gap-1.5 shrink-0">{rightSlot}</div>}
    </div>
  )
}
