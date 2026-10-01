import React from 'react'
import { NetworkRating } from '../store/useNetworkQualityStore'

interface NetworkSignalIconProps {
  rating: NetworkRating
  pingMs?: number
  lossPct?: number
  showPingText?: boolean
  className?: string
  size?: 'sm' | 'md'
}

export const NetworkSignalIcon: React.FC<NetworkSignalIconProps> = ({
  rating,
  pingMs = 0,
  lossPct = 0,
  showPingText = false,
  className = '',
  size = 'sm',
}) => {
  // Bar count based on rating
  const barsActive = rating === 'excellent' ? 4 : rating === 'good' ? 3 : rating === 'poor' ? 2 : 1

  const activeColor =
    rating === 'excellent'
      ? 'bg-emerald-400'
      : rating === 'good'
      ? 'bg-lime-400'
      : rating === 'poor'
      ? 'bg-amber-400'
      : 'bg-rose-500'

  const activeTextColor =
    rating === 'excellent'
      ? 'text-emerald-400'
      : rating === 'good'
      ? 'text-lime-400'
      : rating === 'poor'
      ? 'text-amber-400'
      : 'text-rose-400'

  const ratingLabel =
    rating === 'excellent'
      ? 'Excelente'
      : rating === 'good'
      ? 'Boa'
      : rating === 'poor'
      ? 'Instável'
      : 'Crítica'

  const tooltipText = `Conexão: ${ratingLabel}\nPing: ${pingMs > 0 ? `${pingMs}ms` : '<10ms'}\nPerda de pacotes: ${lossPct}%`

  const barH = size === 'sm' ? ['h-1', 'h-2', 'h-2.5', 'h-3.5'] : ['h-1.5', 'h-2.5', 'h-3.5', 'h-4.5']
  const barW = size === 'sm' ? 'w-0.5' : 'w-1'

  return (
    <div
      className={`inline-flex items-center gap-1.5 cursor-help ${className}`}
      title={tooltipText}
    >
      <div className="flex items-end gap-0.5 h-3.5">
        {[0, 1, 2, 3].map((index) => {
          const isActive = index < barsActive
          return (
            <span
              key={index}
              className={`rounded-sm transition-all ${barW} ${barH[index]} ${
                isActive ? activeColor : 'bg-slate-700/60'
              }`}
            />
          )
        })}
      </div>

      {showPingText && (
        <span className={`text-[10px] font-mono font-bold leading-none ${activeTextColor}`}>
          {pingMs > 0 ? `${pingMs}ms` : '<10ms'}
        </span>
      )}
    </div>
  )
}
