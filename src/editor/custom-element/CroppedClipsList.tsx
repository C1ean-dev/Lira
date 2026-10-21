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
    <div className="bg-[#18191c] rounded-2xl p-4 border border-[#2b2d31] space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scissors className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold text-slate-200">
            Biblioteca de Peças ({croppedClips.length})
          </span>
        </div>
        <span className="text-[10px] text-slate-400">Clique para adicionar à mesa</span>
      </div>

      {croppedClips.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-[#2b2d31] rounded-xl p-3 space-y-1">
          <Scissors className="w-5 h-5 text-slate-500 mx-auto" />
          <div className="text-xs text-slate-400 font-semibold">Nenhuma peça criada ainda</div>
          <div className="text-[10px] text-slate-500">
            Recorte uma imagem para criar peças e clique nelas para adicioná-las à mesa.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
          {croppedClips.map((clip) => (
            <div
              key={clip.id}
              onClick={() => onAddClipToComposition(clip)}
              className="group relative p-2 bg-[#12151d] hover:bg-[#2b2d31] border border-[#2b2d31] hover:border-emerald-500 rounded-xl cursor-pointer flex flex-col items-center gap-1 transition-all shadow-sm"
              title={`Adicionar ${clip.name} (${clip.width}x${clip.height}px) ao quadro de composição`}
            >
              <div className="w-full aspect-square flex items-center justify-center overflow-hidden rounded bg-[#18191c]">
                <RasterImage
                  src={clip.dataUrl}
                  alt={clip.name}
                  className="max-w-full max-h-full object-contain pixelated"
                />
              </div>
              <div className="text-[10px] font-bold text-slate-200 truncate w-full text-center">
                {clip.name}
              </div>
              <div className="text-[9px] text-slate-400 font-mono">
                {clip.width}x{clip.height}px
              </div>

              <div className="absolute inset-0 bg-emerald-600/80 rounded-xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold text-xs gap-1 backdrop-blur-xs">
                <Plus className="w-4 h-4" />
                <span>Adicionar</span>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteClip(clip.id)
                }}
                className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-rose-600 rounded text-slate-300 hover:text-white opacity-0 group-hover:opacity-100 transition-all z-10"
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
