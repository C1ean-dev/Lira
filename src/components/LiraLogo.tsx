import React from 'react'

interface LiraLogoProps {
  className?: string
  size?: number
  showText?: boolean
  textColor?: string
  iconColor?: string
}

export const LiraLogo: React.FC<LiraLogoProps> = ({
  className = '',
  size = 32,
  showText = false,
  textColor = 'text-white',
  iconColor = '#ffffff',
}) => {
  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <div
        className="relative flex items-center justify-center shrink-0 bg-transparent"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-sm"
        >
          {/* Lyre Arms & Frame in pure white (no background) */}
          <g stroke={iconColor} strokeLinecap="round" strokeLinejoin="round">
            {/* Crossbar (Yoke) */}
            <line x1="28" y1="28" x2="72" y2="28" strokeWidth="6" />
            <circle cx="28" cy="28" r="3.5" fill={iconColor} stroke="none" />
            <circle cx="72" cy="28" r="3.5" fill={iconColor} stroke="none" />

            {/* Left curved arm with classical horn/scroll */}
            <path
              d="M 31 28 C 21 28 16 17 24 13 C 30 10 36 17 31 28 C 23 45 22 61 40 73"
              strokeWidth="5.5"
              fill="none"
            />

            {/* Right curved arm with classical horn/scroll */}
            <path
              d="M 69 28 C 79 28 84 17 76 13 C 70 10 64 17 69 28 C 77 45 78 61 60 73"
              strokeWidth="5.5"
              fill="none"
            />

            {/* Base Soundbox / Pedestal */}
            <path
              d="M 37 72 L 63 72 L 68 85 L 32 85 Z"
              strokeWidth="4"
              fill={iconColor}
              fillOpacity="0.25"
            />
            <line x1="30" y1="85" x2="70" y2="85" strokeWidth="5" />
          </g>

          {/* Vertical Pure White Lyre Strings */}
          <g stroke={iconColor} strokeWidth="2.8" strokeLinecap="round" opacity="0.95">
            <line x1="39" y1="29" x2="39" y2="72" />
            <line x1="46" y1="29" x2="46" y2="72" />
            <line x1="54" y1="29" x2="54" y2="72" />
            <line x1="61" y1="29" x2="61" y2="72" />
          </g>
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col">
          <span className={`text-sm font-extrabold tracking-wider leading-none uppercase ${textColor}`}>
            LIRA
          </span>
          <span className="text-[9px] font-medium text-slate-400 tracking-wide mt-0.5">
            Espaço Virtual
          </span>
        </div>
      )}
    </div>
  )
}
