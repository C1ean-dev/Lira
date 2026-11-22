import { RasterImage } from '../../components/common/RasterImage'
import React from 'react'
import { Scissors, Plus, Trash2 } from 'lucide-react'
import { CroppedClip } from './CropStudio'

interface Props {
  croppedClips: CroppedClip[]
  onAddClipToComposition: (clip: CroppedClip) => void
  onDeleteClip: (clipId: string) => void
}

export const CroppedClipsList: React.FC<Props> = ({
  croppedClips,
  onAddClipToComposition,
  onDeleteClip,
}) => {
  return (
    <div className="bg-lira-panel rounded-[12px] p-4 border border-lira-quiet space-y-3 font-mono text-lira-ink">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scissors className="w-4 h-4 text-lira-online" />
          <span className="text-xs font-display font-bold text-lira-accent">
            Biblioteca de Peças ({croppedClips.length})
          </span>
        </div>
        <span className="text-[10px] font-mono text-lira-muted">Clique para adicionar à mesa</span>
      </div>

      {croppedClips.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-lira-rule/60 rounded-[8px] p-3 space-y-1">
          <Scissors className="w-5 h-5 text-lira-muted mx-auto" />
          <div className="text-xs font-mono text-lira-muted font-semibold">Nenhuma peça criada ainda</div>
          <div className="text-[10px] font-mono text-lira-muted">
            Recorte uma imagem para criar peças e clique nelas para adicioná-las à mesa.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
          {croppedClips.map((clip) => (
            <div
              key={clip.id}
              onClick={() => onAddClipToComposition(clip)}
              className="group relative p-2 bg-lira-ground hover:bg-lira-surface border border-lira-quiet hover:border-lira-online rounded-[8px] cursor-pointer flex flex-col items-center gap-1 transition-colors"
              title={`Adicionar ${clip.name} (${clip.width}x${clip.height}px) ao quadro de composição`}
            >
              <div className="w-full aspect-square flex items-center justify-center overflow-hidden rounded bg-lira-panel">
                <RasterImage
                  src={clip.dataUrl}
                  alt={clip.name}
                  className="max-w-full max-h-full object-contain pixelated"
                />
              </div>
              <div className="text-[10px] font-mono font-bold text-lira-ink truncate w-full text-center">
                {clip.name}
              </div>
              <div className="text-[9px] text-lira-muted font-mono">
                {clip.width}x{clip.height}px
              </div>

              <div className="absolute inset-0 bg-lira-online/90 rounded-[8px] opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-lira-ground font-mono font-bold text-xs gap-1">
                <Plus className="w-4 h-4" />
                <span>Adicionar</span>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteClip(clip.id)
                }}
                className="absolute top-1 right-1 p-1 bg-lira-ground hover:bg-lira-error rounded text-lira-muted hover:text-lira-ground opacity-0 group-hover:opacity-100 transition-opacity z-10"
                title="Excluir este recorte"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
