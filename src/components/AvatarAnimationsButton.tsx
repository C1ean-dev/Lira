import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Smile, Square } from 'lucide-react'
import { useGameStore } from '../store/useGameStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { avatarAnimationOptions } from '../utils/avatarAnimationOptions'
import { playAvatarAnimation } from '../engine/avatar/avatarAnimationControls'

export const AvatarAnimationsButton: React.FC = () => {
  const avatar = useGameStore(state => state.localPlayer.avatar)
  const activity = useGameStore(state => state.localPlayer.activityAnimation)
  const assets = useCustomAssetsStore(state => state.customAssets)
  const options = avatarAnimationOptions(avatar, assets)
  const active = options.find(option => option.id === activity)
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null)
  const close = (restoreFocus = false) => { setPosition(null); if (restoreFocus) button.current?.focus() }

  useEffect(() => {
    if (!position) return
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const outside = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) } }
    const resize = () => close()
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', resize)
    }
  }, [position])

  return <>
    <button ref={button} type="button" aria-label="Animações do personagem" title="Animações do personagem"
      aria-haspopup="dialog" aria-expanded={!!position} aria-controls={position ? 'avatar-animations-panel' : undefined}
      onClick={() => {
        if (position) { close(); return }
        const rect = button.current!.getBoundingClientRect()
        const width = Math.min(256, window.innerWidth - 16)
        const vertical = rect.top > window.innerHeight / 2
          ? { bottom: window.innerHeight - rect.top + 8, maxHeight: Math.min(288, rect.top - 16) }
          : { top: rect.bottom + 8, maxHeight: Math.min(288, window.innerHeight - rect.bottom - 16) }
        setPosition({ width, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), ...vertical })
      }}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border font-mono transition-colors ${active ? 'border-lira-accent bg-lira-accent text-lira-ground' : 'border-lira-quiet bg-lira-surface text-lira-ink hover:border-lira-accent hover:text-lira-accent'}`}>
      <Smile aria-hidden="true" className="h-4 w-4" />
    </button>
    {position && createPortal(<div ref={panel} id="avatar-animations-panel" role="dialog" aria-label="Escolher animação do personagem" data-no-drag="true"
      style={position} className="fixed z-[160] overflow-y-auto rounded-[12px] border border-dashed border-lira-rule bg-lira-panel p-2 font-mono text-lira-ink">
      <div className="mb-1 flex items-center justify-between border-b border-dashed border-lira-rule/60 px-2 py-1">
        <span className="font-display text-xs font-bold text-lira-accent">Animações</span>
        <button type="button" aria-label="Fechar animações" onClick={() => close(true)} className="rounded-[6px] px-2 text-lira-muted hover:bg-lira-surface hover:text-lira-ink">×</button>
      </div>
      {options.length ? options.map(option => <button key={option.id} type="button" data-animation={option.id} aria-pressed={activity === option.id}
        onClick={() => { if (playAvatarAnimation(option.id)) close(true) }}
        className={`flex w-full items-center gap-3 rounded-[8px] border px-3 py-2 text-left text-xs text-lira-ink transition-colors ${activity === option.id ? 'border-lira-accent bg-lira-surface text-lira-accent font-semibold' : 'border-transparent hover:border-lira-quiet hover:bg-lira-surface'}`}>
        <span>{option.label}</span>
      </button>) : <p className="px-3 py-2 text-xs text-lira-muted">Este personagem ainda não tem animações.</p>}
      <button type="button" aria-label="Parar animação" disabled={!activity || activity === 'none'} onClick={() => { playAvatarAnimation('none'); close(true) }}
        className="mt-2 flex w-full items-center gap-3 rounded-[8px] border-t border-dashed border-lira-rule/60 px-3 py-2 text-xs text-lira-error hover:bg-lira-surface disabled:opacity-40">
        <Square aria-hidden="true" className="h-3.5 w-3.5" />Parar animação
      </button>
    </div>, document.body)}
  </>
}
