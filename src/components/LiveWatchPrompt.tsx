import React from 'react'
import { Loader2, Play, Radio } from 'lucide-react'

interface LiveWatchPromptProps {
  size: 'tile' | 'card' | 'stage'
  name: string
  connecting?: boolean
  onWatch?: () => void
}

export const LiveWatchPrompt: React.FC<LiveWatchPromptProps> = ({ size, name, connecting = false, onWatch }) => {
  const watch = (e: React.MouseEvent) => {
    e.stopPropagation()
    onWatch?.()
  }

  if (size === 'tile') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-lira-ground/80 pointer-events-none">
        {connecting ? (
          <span className="flex items-center gap-1 px-2 py-1 rounded-[8px] bg-lira-panel border border-dashed border-lira-rule text-[9px] font-mono font-bold text-lira-muted">
            <Loader2 className="w-2.5 h-2.5 animate-spin text-lira-accent" />
            Conectando…
          </span>
        ) : (
          <button
            type="button"
            onClick={watch}
            onDoubleClick={(e) => e.stopPropagation()}
            className="pointer-events-auto flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-lira-accent hover:bg-lira-ink text-lira-ground border border-lira-accent hover:border-lira-ink text-[10px] font-mono font-bold transition-colors cursor-pointer"
            title={`Ver a transmissão de ${name}`}
          >
            <Play className="w-2.5 h-2.5 fill-current" />
            Assistir
          </button>
        )}
      </div>
    )
  }

  const stage = size === 'stage'
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center text-center bg-lira-ground/95 pointer-events-none ${
        stage ? 'gap-4 p-6' : 'gap-2 p-3'
      }`}
    >
      <div
        className={`flex items-center font-mono font-bold text-lira-error uppercase tracking-wider ${
          stage ? 'gap-2 text-xs' : 'gap-1.5 text-[10px]'
        }`}
      >
        <Radio className={stage ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
        <span>Ao vivo</span>
      </div>
      <div className={`font-display font-bold text-lira-ink ${stage ? 'text-2xl' : 'text-sm'}`}>Tela de {name}</div>
      {stage && !connecting && (
        <p className="max-w-sm text-xs font-mono text-lira-muted leading-relaxed">
          O vídeo e o som da transmissão começam quando você clicar. Até lá você ouve só o microfone.
        </p>
      )}
      {connecting ? (
        <span className={`flex items-center font-mono font-bold text-lira-muted ${stage ? 'gap-2 text-xs' : 'gap-1.5 text-[11px]'}`}>
          <Loader2 className={`animate-spin text-lira-accent ${stage ? 'w-4 h-4' : 'w-3 h-3'}`} />
          Conectando…
        </span>
      ) : (
        <button
          type="button"
          onClick={watch}
          onDoubleClick={(e) => e.stopPropagation()}
          className={`pointer-events-auto flex items-center bg-lira-accent hover:bg-lira-ink text-lira-ground border-2 border-lira-accent hover:border-lira-ink font-mono font-bold transition-colors cursor-pointer ${
            stage ? 'gap-2 px-6 py-2.5 rounded-[12px] text-sm' : 'gap-1.5 px-3 py-1.5 rounded-[8px] text-xs'
          }`}
        >
          <Play className={`fill-current ${stage ? 'w-4 h-4' : 'w-3 h-3'}`} />
          Assistir
        </button>
      )}
    </div>
  )
}
