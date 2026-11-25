import React from 'react'
import { LIRA_THEMES, useThemeStore } from '../../store/useThemeStore'
import { cn } from '../../lib/cn'

export interface ThemeToggleProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  showLabel?: boolean
  size?: 'sm' | 'md'
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  className,
  showLabel = false,
  size = 'md',
  ...props
}) => {
  const theme = useThemeStore((s) => s.theme)
  const cycleTheme = useThemeStore((s) => s.cycleTheme)

  const currentIdx = Math.max(
    0,
    LIRA_THEMES.findIndex((t) => t.key === theme)
  )
  const current = LIRA_THEMES[currentIdx].label
  const next = LIRA_THEMES[(currentIdx + 1) % LIRA_THEMES.length].label
  const label = `Tema ${current}. Alternar para ${next}.`

  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center border border-lira-rule bg-lira-surface text-lira-accent transition-colors hover:border-lira-accent hover:text-lira-ink active:bg-lira-ground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lira-accent shrink-0',
        showLabel
          ? 'h-9 px-3 gap-2 rounded-[8px] text-xs font-mono font-medium'
          : size === 'sm'
          ? 'h-9 w-9 rounded-full'
          : 'h-11 w-11 rounded-full',
        className
      )}
      {...props}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'}
      >
        {theme === 'night' && (
          <path d="M20 15a8 8 0 0 1-11-11 8.5 8.5 0 1 0 11 11Z" data-icon="night" />
        )}
        {theme === 'day' && (
          <path
            d="M9 9h6v6H9zM12 2v4m0 12v4M2 12h4m12 0h4M4 4l3 3m10 10 3 3M4 20l3-3M17 7l3-3"
            data-icon="day"
          />
        )}
        {theme === 'nature' && (
          <path
            d="M12 22V10m0 6C4 16 3 12 3 7c5 0 9 1 9 9Zm0-4c0-7 4-10 9-10 0 6-3 10-9 10Z"
            data-icon="nature"
          />
        )}
      </svg>
      {showLabel && <span>{current}</span>}
    </button>
  )
}
