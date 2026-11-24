import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { UpdateInfo } from '../../services/updateService'

export interface UpdateChangelogHoverProps {
  updateInfo?: UpdateInfo | null
  isUpdateReady?: boolean
  isDownloading?: boolean
  downloadPercent?: number
  onApplyUpdate?: () => void
  forceOpen?: boolean
  align?: 'right' | 'left'
  placement?: 'bottom' | 'right'
  children: React.ReactNode
}

/**
 * Parses release notes text (e.g. from GitHub releases) into clean bullet items.
 */
export function extractPullRequestUrl(notes?: string | null): string | null {
  if (!notes || typeof notes !== 'string') return null
  const match = notes.match(/https:\/\/github\.com\/(?:[^\s/]+\/[^\s/]+\/)?pull\/\d+/i)
  return match ? match[0] : null
}

export function resolveChangelogUrl(updateInfo?: UpdateInfo | null): string | undefined {
  if (!updateInfo) return undefined
  if (updateInfo.prUrl) return updateInfo.prUrl
  const prUrl = extractPullRequestUrl(updateInfo.releaseNotes)
  if (prUrl) return prUrl
  return updateInfo.releaseUrl || undefined
}

export function parseReleaseNotes(notes?: string | null): string[] {
  if (!notes || typeof notes !== 'string' || !notes.trim()) {
    return []
  }

  const lines = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith('##') &&
        !line.toLowerCase().startsWith('**full changelog')
    )

  const items = lines
    .map((line) => {
      let text = line.replace(/^[-*•]\s*/, '').trim()
      // Remove trailing GitHub boilerplate "by @user in https://..." or "in https://..."
      text = text.replace(/\s+by\s+@[^\s]+\s+in\s+https?:\/\/\S+/gi, '')
      text = text.replace(/\s+in\s+https?:\/\/\S+/gi, '')
      return text.trim()
    })
    .filter((line) => line.length > 0)

  return items
}

export const UpdateChangelogHover: React.FC<UpdateChangelogHoverProps> = ({
  updateInfo,
  isUpdateReady,
  isDownloading,
  downloadPercent = 0,
  onApplyUpdate,
  forceOpen,
  align = 'right',
  placement = 'bottom',
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [rightCoords, setRightCoords] = useState<{ left: number; bottom: number }>({ left: 78, bottom: 12 })
  const wrapperRef = useRef<HTMLDivElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
  }

  const updateRightCoords = useCallback(() => {
    if (typeof window === 'undefined' || !wrapperRef.current) return
    const rect = wrapperRef.current.getBoundingClientRect()
    const left = Math.min(rect.right + 10, Math.max(rect.right + 4, window.innerWidth - 280))
    const bottom = Math.max(12, window.innerHeight - rect.bottom)
    setRightCoords({ left, bottom })
  }, [])

  const handleMouseEnter = () => {
    clearTimer()
    if (placement === 'right') updateRightCoords()
    setIsOpen(true)
  }

  const handleMouseLeave = () => {
    clearTimer()
    leaveTimerRef.current = setTimeout(() => {
      setIsOpen(false)
    }, 200)
  }

  const toggle = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation()
    }
    clearTimer()
    if (placement === 'right') updateRightCoords()
    setIsOpen((prev) => !prev)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(target) &&
        (!portalRef.current || !portalRef.current.contains(target))
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      clearTimer()
    }
  }, [])

  const shouldShow = forceOpen !== undefined ? forceOpen : isOpen

  useEffect(() => {
    if (placement !== 'right' || !shouldShow || typeof window === 'undefined') return
    updateRightCoords()
    window.addEventListener('resize', updateRightCoords)
    window.addEventListener('scroll', updateRightCoords, true)
    return () => {
      window.removeEventListener('resize', updateRightCoords)
      window.removeEventListener('scroll', updateRightCoords, true)
    }
  }, [placement, shouldShow, updateRightCoords])

  const changes = parseReleaseNotes(updateInfo?.releaseNotes)
  const changelogUrl = resolveChangelogUrl(updateInfo)
  const targetVersion = updateInfo?.latestVersion || updateInfo?.currentVersion || ''
  const hasUpdate = !!updateInfo?.hasUpdate
  const title = hasUpdate ? 'Novidades da Atualização' : 'Últimas Alterações'
  const safePercent = Math.max(0, Math.min(100, Math.round(downloadPercent)))

  const cardBody = (
    <div className="w-80 sm:w-96 max-w-full rounded-[12px] bg-lira-panel border border-dashed border-lira-rule p-4 text-left relative font-mono text-lira-ink shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-dashed border-lira-quiet">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-[8px] bg-lira-surface border border-lira-rule text-lira-accent">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-display text-sm font-bold text-lira-accent leading-tight">
              {title}
            </h3>
            <span className="text-[10px] text-lira-muted">
              {isDownloading
                ? `Baixando atualização (${safePercent}%)`
                : isUpdateReady
                ? 'Pronta para reiniciar e aplicar'
                : hasUpdate
                ? 'Nova versão disponível'
                : 'Versão mais recente'}
            </span>
          </div>
        </div>

        {targetVersion && (
          <span className="px-2 py-0.5 rounded-[6px] bg-lira-surface border border-lira-rule text-lira-online font-mono text-[11px] font-bold shrink-0">
            {targetVersion}
          </span>
        )}
      </div>

      {/* Download progress bar if currently downloading */}
      {isDownloading && (
        <div className="my-2.5 p-2 rounded-[8px] bg-lira-surface border border-lira-rule">
          <div className="flex items-center justify-between text-[11px] text-lira-ink mb-1">
            <span className="flex items-center gap-1.5 text-lira-accent">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Baixando atualização...
            </span>
            <span className="font-mono font-bold text-lira-online tabular-nums">
              {safePercent}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-lira-ground border border-lira-quiet rounded-full overflow-hidden">
            <div
              className="h-full bg-lira-accent transition-all duration-300 rounded-full"
              style={{ width: `${safePercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Changelog list */}
      <div className="py-2.5">
        <div className="text-[10px] uppercase font-bold tracking-wider text-lira-muted mb-2">
          O que mudou nesta versão:
        </div>

        {changes.length > 0 ? (
          <div className="max-h-52 overflow-y-auto space-y-2 pr-1 select-text">
            {changes.map((item, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 text-xs text-lira-ink leading-relaxed"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-lira-accent mt-1.5 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-lira-muted italic py-1 leading-relaxed">
            Melhorias gerais de estabilidade, áudio e correções de desempenho.
          </p>
        )}
      </div>

      {/* Footer with action button */}
      {onApplyUpdate && (
        <div className="pt-2 border-t border-dashed border-lira-quiet">
          <button
            type="button"
            onClick={onApplyUpdate}
            disabled={isDownloading}
            className="w-full py-2 px-3 rounded-[8px] bg-lira-accent hover:bg-lira-ink text-lira-ground border-2 border-lira-accent hover:border-lira-ink font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isDownloading ? `Baixando... (${safePercent}%)` : 'Instalar'}</span>
          </button>
        </div>
      )}

      {/* External release notes link */}
      {changelogUrl && (
        <div className="mt-2 text-center">
          <a
            href={changelogUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-lira-accent hover:text-lira-ink transition-colors hover:underline"
          >
            <span>Ver notas completas no GitHub</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  )

  return (
    <div
      ref={wrapperRef}
      className="relative inline-block group"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      <div
        onClick={toggle}
        className="inline-block cursor-pointer"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle()
          }
        }}
      >
        {children}
      </div>

      {placement === 'right' ? (
        shouldShow &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={portalRef}
            className="fixed z-[95] max-w-[calc(100vw-var(--rail-width)-20px)] max-h-[calc(100dvh-24px)] overflow-y-auto"
            style={{ left: `${rightCoords.left}px`, bottom: `${rightCoords.bottom}px` }}
            role="tooltip"
            aria-hidden={!shouldShow}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={(e) => e.stopPropagation()}
          >
            {cardBody}
          </div>,
          document.body
        )
      ) : (
        <div
          className={`absolute top-full ${
            align === 'right' ? 'right-0' : 'left-0'
          } pt-2.5 z-50 transition-opacity duration-150 ${
            shouldShow
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
          }`}
          role="tooltip"
          aria-hidden={!shouldShow}
          onClick={(e) => e.stopPropagation()}
        >
          {cardBody}
        </div>
      )}
    </div>
  )
}
