import { RasterImage } from '../../components/common/RasterImage'
import {
  Layers,
  FlipHorizontal,
  Copy,
  Trash2,
  ArrowUp,
  ArrowDown,
  Maximize2,
} from 'lucide-react'
import { CompositeLayer } from './CompositionStudio'

interface Props {
  compositeLayers: CompositeLayer[]
  selectedLayerId: string | null
  setSelectedLayerId: (id: string | null) => void
  onFlipLayer: (id: string) => void
  onDuplicateLayer: (id: string) => void
  onDeleteLayer: (id: string) => void
  onMoveLayerOrder: (idx: number, direction: 'up' | 'down') => void
  onChangeLayerOpacity: (id: string, opacity: number) => void
  onFitLayersToBoard?: () => void
}

export const LayerManager: React.FC<Props> = ({
  compositeLayers,
  selectedLayerId,
  setSelectedLayerId,
  onFlipLayer,
  onDuplicateLayer,
  onDeleteLayer,
  onMoveLayerOrder,
  onChangeLayerOpacity,
  onFitLayersToBoard,
}) => {
  return (
    <div className="bg-[#18191c] rounded-2xl p-4 border border-[#2b2d31] space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-slate-200">
            Camadas do Quadro ({compositeLayers.length})
          </span>
        </div>
        {compositeLayers.length > 0 && onFitLayersToBoard && (
          <button
            type="button"
            onClick={onFitLayersToBoard}
            className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 px-2 py-0.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center gap-1 transition-colors"
            title="Ajustar todas as camadas proporcionalmente ao tamanho atual da mesa"
          >
            <Maximize2 className="w-3 h-3" />
            <span>Ajustar à Mesa</span>
          </button>
        )}
      </div>

      {compositeLayers.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-[#2b2d31] rounded-xl p-3 space-y-1">
          <Layers className="w-5 h-5 text-slate-500 mx-auto" />
          <div className="text-xs text-slate-400 font-semibold">Nenhuma camada adicionada</div>
          <div className="text-[10px] text-slate-500">
            Clique em uma peça da biblioteca para colocá-la neste quadro
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {compositeLayers.map((layer, idx) => {
            const isSelected = selectedLayerId === layer.id
            return (
              <div
                key={layer.id}
                onClick={() => setSelectedLayerId(layer.id)}
                className={`p-2 rounded-xl border flex items-center justify-between gap-2 transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-600/20 border-indigo-500 shadow-md ring-1 ring-indigo-500/40'
                    : 'bg-[#12151d] border-[#2b2d31] hover:border-slate-600'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg overflow-hidden bg-[#18191c] border border-white/10 flex items-center justify-center shrink-0">
                    <RasterImage
                      src={layer.dataUrl}
                      alt={layer.name}
                      className="max-w-full max-h-full object-contain pixelated"
                      style={{ transform: layer.flipH ? 'scaleX(-1)' : 'none' }}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-200 truncate">{layer.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      ({layer.x}, {layer.y}) • {layer.width}x{layer.height}px
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => onFlipLayer(layer.id)}
                    className={`p-1 rounded-lg border text-slate-300 hover:text-white transition-colors ${
                      layer.flipH
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-[#18191c] border-[#2b2d31] hover:bg-slate-800'
                    }`}
                    title="Espelhar Horizontalmente"
                  >
                    <FlipHorizontal className="w-3 h-3" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onMoveLayerOrder(idx, 'up')}
                    disabled={idx === compositeLayers.length - 1}
                    className="p-1 rounded-lg bg-[#18191c] hover:bg-slate-800 border border-[#2b2d31] text-slate-300 hover:text-white disabled:opacity-30"
                    title="Mover para Cima (Frente)"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onMoveLayerOrder(idx, 'down')}
                    disabled={idx === 0}
                    className="p-1 rounded-lg bg-[#18191c] hover:bg-slate-800 border border-[#2b2d31] text-slate-300 hover:text-white disabled:opacity-30"
                    title="Mover para Baixo (Trás)"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onDuplicateLayer(layer.id)}
                    className="p-1 rounded-lg bg-[#18191c] hover:bg-indigo-600/30 border border-[#2a3142] text-slate-300 hover:text-indigo-300"
                    title="Duplicar Camada"
                  >
                    <Copy className="w-3 h-3" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeleteLayer(layer.id)}
                    className="p-1 rounded-lg bg-[#18191c] hover:bg-rose-600/30 border border-[#2a3142] text-slate-300 hover:text-rose-400"
                    title="Excluir Camada"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
