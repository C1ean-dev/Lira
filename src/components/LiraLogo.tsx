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
  textColor = 'text-lira-accent',
  iconColor = 'var(--accent, #d1b5ff)',
}) => {
  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <div
        className="relative flex items-center justify-center shrink-0 rounded-[9px] overflow-hidden"
        style={{ width: size, height: size }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 128 128"
          role="img"
          aria-label="Lira — ícone ASCII"
          className="w-full h-full"
        >
          <path
            fill="var(--ground, #100c18)"
            d="M16 4h96v4h8v8h4v96h-4v8h-8v4H16v-4H8v-8H4V16h4V8h8Z"
          />
          <g
            fill="none"
            stroke={iconColor}
            strokeWidth="2.6"
            strokeLinecap="square"
            strokeLinejoin="miter"
          >
            <path d="M28 18h16v12H28Z M84 18h16v12H84Z" />
            <path d="M36 30 28 38V70H32V78H40V86H48V90H80V86H88V78H96V70H100V38L92 30" />
            <path d="M28 38H100" />
            <path d="M44 38V86 M54 38V90 M64 38V90 M74 38V90 M84 38V86" />
            <path d="M52 90V108 M76 90V108 M40 108H88" />
            <path d="M28 34V42 M24 38H32 M100 34V42 M96 38H104" />
            <path d="M52 104V112 M76 104V112" />
          </g>
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col">
          <span
            className={`font-display text-base font-bold tracking-tight leading-none ${textColor}`}
          >
            Lira
          </span>
          <span className="text-[10px] font-mono text-lira-muted tracking-wide mt-0.5">
            Espaço Virtual
          </span>
        </div>
      )}
    </div>
  )
}
