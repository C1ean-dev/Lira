import React, { useId } from 'react'
import { AvatarFrameId } from '../../types/profile'

interface Props {
  frame?: AvatarFrameId
  compact?: boolean
}

export const AvatarFrameOverlay: React.FC<Props> = ({ frame = 'none', compact = false }) => {
  const uid = useId().replace(/:/g, '')
  if (!frame || frame === 'none') return null

  const gradId = `af-g-${uid}`
  const gradId2 = `af-g2-${uid}`

  return (
    <div
      data-avatar-frame={frame}
      aria-hidden="true"
      className="pointer-events-none absolute -inset-[15%] z-10 flex items-center justify-center select-none"
    >
      {frame === 'spirit-flame' && (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible animate-profile-glow">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7dd3fc" />
              <stop offset="45%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#1e3a8a" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="44" fill="none" stroke={`url(#${gradId})`} strokeWidth="4.5" opacity="0.95" />
          <path
            d="M24 44 C18 24, 42 12, 62 15 C76 17, 94 22, 102 36 C90 29, 72 22, 56 23 C40 24, 30 34, 24 44 Z"
            fill="#38bdf8"
            opacity="0.9"
          />
          <path
            d="M16 74 C22 96, 46 108, 72 104 C56 101, 34 94, 24 76 Z"
            fill="#cbd5e1"
            opacity="0.75"
          />
          {!compact && (
            <g transform="translate(82 14)">
              <path
                d="M13 24 C6 24, 3 18, 4 11 L6 2 L11 8 C13 7, 16 7, 18 8 L23 2 L24 11 C25 18, 21 24, 13 24 Z"
                fill="#1e293b"
                stroke="#38bdf8"
                strokeWidth="1.8"
              />
              <ellipse cx="14" cy="16" rx="5.5" ry="4" fill="#f8fafc" />
              <circle cx="14" cy="17" r="2.1" fill="#ef4444" />
            </g>
          )}
          <circle cx="22" cy="30" r="2.2" fill="#bae6fd" />
          <circle cx="101" cy="64" r="1.8" fill="#7dd3fc" />
        </svg>
      )}

      {frame === 'neon-cyber' && (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="50%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#ec4899" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="44.5" fill="none" stroke={`url(#${gradId})`} strokeWidth="3.5" />
          <circle
            cx="60"
            cy="60"
            r="49"
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth="1.8"
            strokeDasharray="14 8 4 8"
            className="origin-center animate-profile-spin"
          />
          <path d="M16 44 L16 24 L36 16" fill="none" stroke="#22d3ee" strokeWidth="2.8" strokeLinecap="round" />
          <path d="M104 76 L104 96 L84 104" fill="none" stroke="#ec4899" strokeWidth="2.8" strokeLinecap="round" />
        </svg>
      )}

      {frame === 'cosmic-orbit' && (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#c084fc" />
              <stop offset="50%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#38bdf8" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="44" fill="none" stroke={`url(#${gradId})`} strokeWidth="3.8" />
          <g className="origin-center animate-profile-spin">
            <ellipse
              cx="60"
              cy="60"
              rx="52"
              ry="44"
              fill="none"
              stroke="#a855f7"
              strokeWidth="1.6"
              strokeDasharray="6 6"
              opacity="0.85"
            />
            <circle cx="111" cy="60" r="4.5" fill="#fde047" />
            <circle cx="10" cy="54" r="3" fill="#38bdf8" />
          </g>
          <path d="M94 20 L96 25 L101 27 L96 29 L94 34 L92 29 L87 27 L92 25 Z" fill="#fef08a" />
        </svg>
      )}

      {frame === 'golden-crown' && (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#b45309" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="44" fill="none" stroke={`url(#${gradId})`} strokeWidth="4.2" />
          <circle cx="60" cy="60" r="48.5" fill="none" stroke="#fde68a" strokeWidth="1.2" strokeDasharray="3 4" opacity="0.85" />
          <path
            d="M42 20 L46 8 L55 15 L60 5 L65 15 L74 8 L78 20 Z"
            fill={`url(#${gradId})`}
            stroke="#78350f"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <circle cx="60" cy="5" r="2.2" fill="#fef9c3" />
        </svg>
      )}

      {frame === 'sakura-bloom' && (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fbcfe8" />
              <stop offset="50%" stopColor="#f472b6" />
              <stop offset="100%" stopColor="#db2777" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="44" fill="none" stroke={`url(#${gradId})`} strokeWidth="3.8" />
          {[
            [24, 28, -20],
            [96, 26, 25],
            [22, 88, 40],
            [94, 90, -35],
          ].map(([cx, cy, rot], idx) => (
            <g key={idx} transform={`translate(${cx} ${cy}) rotate(${rot})`}>
              <ellipse cx="0" cy="-5" rx="3.2" ry="5.5" fill="#fbcfe8" />
              <ellipse cx="4.8" cy="-1.5" rx="3.2" ry="5.5" fill="#f9a8d4" transform="rotate(72)" />
              <ellipse cx="3" cy="4.2" rx="3.2" ry="5.5" fill="#f472b6" transform="rotate(144)" />
              <ellipse cx="-3" cy="4.2" rx="3.2" ry="5.5" fill="#fbcfe8" transform="rotate(216)" />
              <ellipse cx="-4.8" cy="-1.5" rx="3.2" ry="5.5" fill="#f9a8d4" transform="rotate(288)" />
              <circle cx="0" cy="0" r="2.2" fill="#fef08a" />
            </g>
          ))}
        </svg>
      )}

      {frame === 'crimson-eclipse' && (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible animate-profile-glow">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fb923c" />
              <stop offset="50%" stopColor="#f43f5e" />
              <stop offset="100%" stopColor="#881337" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="44.5" fill="none" stroke={`url(#${gradId})`} strokeWidth="4.8" />
          <path d="M18 52 C14 30, 32 14, 54 14 C36 20, 24 34, 18 52 Z" fill="#fb923c" opacity="0.9" />
          <path d="M102 68 C106 90, 88 106, 66 106 C84 100, 96 86, 102 68 Z" fill="#f43f5e" opacity="0.9" />
        </svg>
      )}

      {frame === 'pixel-arcade' && (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
          <rect
            x="14"
            y="14"
            width="92"
            height="92"
            rx="16"
            fill="none"
            stroke="#4ade80"
            strokeWidth="4"
            strokeDasharray="8 4"
          />
          <rect x="11" y="11" width="8" height="8" fill="#38bdf8" />
          <rect x="101" y="11" width="8" height="8" fill="#f472b6" />
          <rect x="11" y="101" width="8" height="8" fill="#facc15" />
          <rect x="101" y="101" width="8" height="8" fill="#4ade80" />
        </svg>
      )}

      {frame === 'emerald-pulse' && (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible animate-profile-glow">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6ee7b7" />
              <stop offset="50%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#047857" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="44" fill="none" stroke={`url(#${gradId})`} strokeWidth="4.2" />
          <polygon points="60,8 66,18 60,24 54,18" fill="#6ee7b7" />
          <polygon points="112,60 102,66 96,60 102,54" fill="#34d399" />
          <polygon points="8,60 18,54 24,60 18,66" fill="#34d399" />
        </svg>
      )}

      {frame === 'aurora-prism' && (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id={gradId2} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#2dd4bf" />
              <stop offset="33%" stopColor="#818cf8" />
              <stop offset="66%" stopColor="#f472b6" />
              <stop offset="100%" stopColor="#fde047" />
            </linearGradient>
          </defs>
          <circle
            cx="60"
            cy="60"
            r="45"
            fill="none"
            stroke={`url(#${gradId2})`}
            strokeWidth="4.5"
            className="origin-center animate-profile-spin"
          />
          <circle cx="60" cy="60" r="49" fill="none" stroke="#ffffff" strokeWidth="1" opacity="0.35" />
        </svg>
      )}

      {frame === 'cat-ears' && (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#c084fc" />
              <stop offset="100%" stopColor="#f472b6" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="62" r="43" fill="none" stroke={`url(#${gradId})`} strokeWidth="4" />
          <path d="M22 38 L24 10 L46 24 Z" fill="#1e1b2e" stroke="#c084fc" strokeWidth="3" strokeLinejoin="round" />
          <path d="M27 33 L28 18 L40 26 Z" fill="#f472b6" opacity="0.8" />
          <path d="M98 38 L96 10 L74 24 Z" fill="#1e1b2e" stroke="#f472b6" strokeWidth="3" strokeLinejoin="round" />
          <path d="M93 33 L92 18 L80 26 Z" fill="#f472b6" opacity="0.8" />
        </svg>
      )}

      {frame === 'frost-crystal' && (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#e0f2fe" />
              <stop offset="50%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#0284c7" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="44" fill="none" stroke={`url(#${gradId})`} strokeWidth="4" />
          <polygon points="24,22 30,28 24,34 18,28" fill="#bae6fd" />
          <polygon points="96,22 102,28 96,34 90,28" fill="#7dd3fc" />
          <polygon points="60,8 64,16 60,22 56,16" fill="#e0f2fe" />
          <polygon points="22,92 26,96 22,100 18,96" fill="#7dd3fc" />
        </svg>
      )}
    </div>
  )
}
