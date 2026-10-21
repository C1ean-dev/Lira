import React from 'react'
import { Download } from 'lucide-react'

interface UpdateDownloadIndicatorProps {
  downloading: boolean
  percent: number
}

export const UpdateDownloadIndicator: React.FC<UpdateDownloadIndicatorProps> = ({ downloading, percent }) => {
  if (!downloading) {
    return <Download className="w-4 h-4" aria-hidden="true" />
  }

  const safePercent = Math.round(Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0)))

  return (
    <span
      className="inline-block h-4 w-4 rounded-full transition-[background] duration-200 ease-out motion-reduce:transition-none"
      role="progressbar"
      aria-label="Download da atualização"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safePercent}
      aria-valuetext={`${safePercent}%`}
      style={{
        background: `conic-gradient(currentColor ${safePercent}%, color-mix(in srgb, currentColor 24%, transparent) 0)`,
      }}
    />
  )
}
