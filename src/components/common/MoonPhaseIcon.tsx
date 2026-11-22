import React from 'react'
import { PresenceStatus } from '../../types/game'
import { TERRA_IMAGE_DATA_URL } from '../../generated/terraImage'
import { LUA_ROXA_IMAGE_DATA_URL } from '../../generated/luaRoxaImage'
import { AUSENTE_IMAGE_DATA_URL } from '../../generated/ausenteImage'
import { MARTE_IMAGE_DATA_URL } from '../../generated/marteImage'

export interface MoonPhaseIconProps {
  status?: PresenceStatus | 'offline' | string
  className?: string
  color?: string
  withBackground?: boolean
}

export const MoonPhaseIcon: React.FC<MoonPhaseIconProps> = ({
  status = 'available',
  className = 'w-4 h-4',
  withBackground = false,
}) => {
  switch (status) {
    case 'available':
      return (
        <img
          src={TERRA_IMAGE_DATA_URL}
          alt="Disponível (Terra)"
          className={`${className} rounded-full object-cover select-none pointer-events-none shrink-0`}
          style={{ imageRendering: 'pixelated' }}
        />
      )

    case 'focusing':
      return (
        <div
          className={`${className} rounded-full overflow-hidden flex items-center justify-center shrink-0`}
          style={{ backgroundColor: withBackground ? '#1e162b' : undefined }}
        >
          <img
            src={LUA_ROXA_IMAGE_DATA_URL}
            alt="Em foco (Lua e silêncio)"
            className="w-full h-full object-contain p-1 select-none pointer-events-none"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      )

    case 'away':
      return (
        <div
          className={`${className} rounded-full overflow-hidden flex items-center justify-center shrink-0`}
          style={{ backgroundColor: withBackground ? '#291f14' : undefined }}
        >
          <img
            src={AUSENTE_IMAGE_DATA_URL}
            alt="Ausente (Lua dourada)"
            className="w-full h-full object-contain select-none pointer-events-none"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      )

    case 'busy':
      return (
        <div
          className={`${className} rounded-full overflow-hidden flex items-center justify-center shrink-0`}
          style={{ backgroundColor: withBackground ? '#2d141d' : undefined }}
        >
          <img
            src={MARTE_IMAGE_DATA_URL}
            alt="Ocupado (Marte)"
            className="w-full h-full object-contain select-none pointer-events-none"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      )

    case 'offline':
    default:
      return (
        <svg
          viewBox="0 0 32 32"
          className={`${className} shrink-0`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Offline"
        >
          {withBackground && <circle cx="16" cy="16" r="16" fill="#100c18" />}
          <circle
            cx="16"
            cy="16"
            r="11"
            stroke="#826998"
            strokeWidth="2"
            fill="none"
            opacity="0.7"
          />
        </svg>
      )
  }
}
