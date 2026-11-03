import React, { useState, useRef, useEffect } from 'react'
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
  children: React.ReactNode
}

/**
 * Parses release notes text (e.g. from GitHub releases) into clean bullet items.
 */
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
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
  }

  const handleMouseEnter = () => {
    clearTimer()
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
    setIsOpen((prev) => !prev)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
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
  const changes = parseReleaseNotes(updateInfo?.releaseNotes)
  const targetVersion = updateInfo?.latestVersion || updateInfo?.currentVersion || ''
  const hasUpdate = !!updateInfo?.hasUpdate
  const title = hasUpdate ? 'Novidades da Atualização' : 'Últimas Alterações'
  const safePercent = Math.max(0, Math.min(100, Math.round(downloadPercent)))

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

      <div
        className={`absolute top-full ${
          align === 'right' ? 'right-0' : 'left-0'
        } pt-2.5 z-50 transition-all duration-200 ease-out origin-top-right ${
          shouldShow
            ? 'opacity-100 pointer-events-auto scale-100 translate-y-0'
            : 'opacity-0 pointer-events-none scale-95 -translate-y-1 group-hover:opacity-100 group-hover:pointer-events-auto group-hover:scale-100 group-hover:translate-y-0'
        }`}
        role="tooltip"
        aria-hidden={!shouldShow}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-80 sm:w-96 rounded-2xl bg-[#141824]/95 backdrop-blur-xl border border-indigo-500/30 p-4 shadow-2xl shadow-indigo-950/60 text-left relative">
          {/* Subtle pointer arrow */}
          <div
            className={`absolute -top-1.5 ${
              align === 'right' ? 'right-4' : 'left-4'
            } w-3 h-3 bg-[#141824] border-t border-l border-indigo-500/30 rotate-45 transform`}
          />

          {/* Header */}
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#2a3142]/60">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-white tracking-wide">{title}</h3>
                <span className="text-[10px] text-slate-400">
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
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[11px] font-bold shrink-0">
                {targetVersion}
              </span>
            )}
          </div>

          {/* Download progress bar if currently downloading */}
          {isDownloading && (
            <div className="my-2.5 p-2 rounded-xl bg-[#1b202c] border border-indigo-500/20">
              <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1">
                <span className="flex items-center gap-1.5 text-indigo-300">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Baixando atualização...
                </span>
                <span className="font-mono font-bold text-emerald-400">{safePercent}%</span>
              </div>
              <div className="w-full h-1.5 bg-[#12151d] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-300 rounded-full"
                  style={{ width: `${safePercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Changelog list */}
          <div className="py-2.5">
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2">
              O que mudou nesta versão:
            </div>

            {changes.length > 0 ? (
              <div className="max-h-52 overflow-y-auto space-y-2 pr-1 select-text">
                {changes.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs text-slate-300 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic py-1 leading-relaxed">
                Melhorias gerais de estabilidade, áudio e correções de desempenho.
              </p>
            )}
          </div>

          {/* Footer with action button */}
          {onApplyUpdate && (
            <div className="pt-2 border-t border-[#2a3142]/60">
              <button
                type="button"
                onClick={onApplyUpdate}
                disabled={isDownloading}
                className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-500/20 transition-all active:scale-95 cursor-pointer disabled:opacity-60"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {isDownloading
                    ? `Baixando... (${safePercent}%)`
                    : 'Instalar'}
                </span>
              </button>
            </div>
          )}

          {/* External release notes link */}
          {updateInfo?.releaseUrl && (
            <div className="mt-2 text-center">
              <a
                href={updateInfo.releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors hover:underline"
              >
                <span>Ver notas completas no GitHub</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
