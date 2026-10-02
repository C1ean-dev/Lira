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
  color,
  withBackground = false,
}) => {
  switch (status) {
    case 'available':
      // Disponível: Terra (Imagem Pixel Art fornecida pelo usuário, ocupando 100% do espaço)
      return (
        <img
          src={TERRA_IMAGE_DATA_URL}
          alt="Disponível (Terra)"
          className={`${className} rounded-full object-cover select-none pointer-events-none shrink-0`}
          style={{ imageRendering: 'pixelated' }}
        />
      )

    case 'focusing':
      // Em foco: Lua e silêncio (Imagem Pixel Art da lua roxa com estrela fornecida pelo usuário)
      return (
        <div
          className={`${className} rounded-full overflow-hidden flex items-center justify-center shrink-0`}
          style={{ backgroundColor: withBackground ? '#251a3a' : undefined }}
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
      // Ausente: Lua dourada (Imagem Pixel Art fornecida pelo usuário, ocupando 100% do espaço)
      return (
        <div
          className={`${className} rounded-full overflow-hidden flex items-center justify-center shrink-0`}
          style={{ backgroundColor: withBackground ? '#352914' : undefined }}
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
      // Ocupado: Marte (Imagem Pixel Art de Marte fornecida pelo usuário, ocupando 100% do espaço)
      return (
        <div
          className={`${className} rounded-full overflow-hidden flex items-center justify-center shrink-0`}
          style={{ backgroundColor: withBackground ? '#35151b' : undefined }}
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
          {withBackground && <circle cx="16" cy="16" r="16" fill="#1e2024" />}
          <circle
            cx="16"
            cy="16"
            r="11"
            stroke="#64748b"
            strokeWidth="2"
            fill="none"
            opacity="0.6"
          />
        </svg>
      )
  }
}

