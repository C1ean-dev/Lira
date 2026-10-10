import React from 'react'
import { Loader2, Play, Radio } from 'lucide-react'

interface LiveWatchPromptProps {
  /** tile: the small call tiles; card: the mini player; stage: the grid and the full screen. */
  size: 'tile' | 'card' | 'stage'
  /** Who is live. */
  name: string
  /** The click was made and the first frame has not arrived yet. */
  connecting?: boolean
  onWatch?: () => void
}

/**
 * What takes the place of a live until this user clicks to watch it. A live
 * does not start on its own: until the click, who is live sends this user no
 * video and only the microphone. After the click it says that the picture is
 * on its way, over the still empty video.
 */
export const LiveWatchPrompt: React.FC<LiveWatchPromptProps> = ({ size, name, connecting = false, onWatch }) => {
  const watch = (e: React.MouseEvent) => {
    // The tile under it opens the grid on a click.
    e.stopPropagation()
    onWatch?.()
  }

  if (size === 'tile') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/55 pointer-events-none">
        {connecting ? (
          <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-black/70 text-[9px] font-bold text-slate-200">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            Conectando…
          </span>
        ) : (
          <button
            type="button"
            onClick={watch}
            onDoubleClick={(e) => e.stopPropagation()}
            className="pointer-events-auto flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold shadow-lg transition-colors active:scale-95 cursor-pointer"
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
      className={`absolute inset-0 flex flex-col items-center justify-center text-center bg-[#0c0e14]/95 pointer-events-none ${
        stage ? 'gap-4 p-6' : 'gap-2 p-3'
      }`}
    >
      <div
        className={`flex items-center font-bold text-rose-400 uppercase tracking-wider ${
          stage ? 'gap-2 text-sm' : 'gap-1.5 text-[10px]'
        }`}
      >
        <Radio className={stage ? 'w-5 h-5' : 'w-3.5 h-3.5'} />
        <span>Ao vivo</span>
      </div>
      <div className={`font-bold text-slate-100 ${stage ? 'text-2xl' : 'text-xs'}`}>Tela de {name}</div>
      {stage && !connecting && (
        <p className="max-w-sm text-sm text-slate-400">
          O vídeo e o som da transmissão começam quando você clicar. Até lá você ouve só o microfone.
        </p>
      )}
      {connecting ? (
        <span className={`flex items-center font-bold text-slate-300 ${stage ? 'gap-2 text-sm' : 'gap-1.5 text-[11px]'}`}>
          <Loader2 className={`animate-spin ${stage ? 'w-4 h-4' : 'w-3 h-3'}`} />
          Conectando…
        </span>
      ) : (
        <button
          type="button"
          onClick={watch}
          onDoubleClick={(e) => e.stopPropagation()}
          className={`pointer-events-auto flex items-center bg-rose-600 hover:bg-rose-500 text-white font-bold shadow-lg transition-colors active:scale-95 cursor-pointer ${
            stage ? 'gap-2 px-6 py-3 rounded-2xl text-base' : 'gap-1.5 px-3 py-1.5 rounded-xl text-xs'
          }`}
        >
          <Play className={`fill-current ${stage ? 'w-4 h-4' : 'w-3 h-3'}`} />
          Assistir
        </button>
      )}
    </div>
  )
}
