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
    <div className="bg-lira-panel rounded-[12px] p-4 border border-lira-quiet space-y-3 font-mono text-lira-ink">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-lira-accent" />
          <span className="text-xs font-display font-bold text-lira-accent">
            Camadas do Quadro ({compositeLayers.length})
          </span>
        </div>
        {compositeLayers.length > 0 && onFitLayersToBoard && (
          <button
            type="button"
            onClick={onFitLayersToBoard}
            className="text-[10px] font-mono font-bold text-lira-accent hover:text-lira-ink px-2 py-0.5 rounded-[6px] bg-lira-surface border border-lira-rule hover:border-lira-accent flex items-center gap-1 transition-colors"
            title="Ajustar todas as camadas proporcionalmente ao tamanho atual da mesa"
          >
            <Maximize2 className="w-3 h-3" />
            <span>Ajustar à Mesa</span>
          </button>
        )}
      </div>

      {compositeLayers.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-lira-rule/60 rounded-[8px] p-3 space-y-1">
          <Layers className="w-5 h-5 text-lira-muted mx-auto" />
          <div className="text-xs font-mono text-lira-muted font-semibold">Nenhuma camada adicionada</div>
          <div className="text-[10px] font-mono text-lira-muted">
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
                className={`p-2 rounded-[8px] border flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-lira-surface border-lira-accent'
                    : 'bg-lira-ground border-lira-quiet hover:border-lira-rule'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-[6px] overflow-hidden bg-lira-panel border border-lira-quiet flex items-center justify-center shrink-0">
                    <RasterImage
                      src={layer.dataUrl}
                      alt={layer.name}
                      className="max-w-full max-h-full object-contain pixelated"
                      style={{ transform: layer.flipH ? 'scaleX(-1)' : 'none' }}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-mono font-semibold text-lira-ink truncate">{layer.name}</div>
                    <div className="text-[10px] text-lira-muted font-mono">
                      ({layer.x}, {layer.y}) • {layer.width}x{layer.height}px
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => onFlipLayer(layer.id)}
                    className={`p-1 rounded-[6px] border transition-colors ${
                      layer.flipH
                        ? 'bg-lira-accent border-lira-accent text-lira-ground'
                        : 'bg-lira-panel border-lira-quiet text-lira-muted hover:text-lira-ink hover:bg-lira-surface'
                    }`}
                    title="Espelhar Horizontalmente"
                  >
                    <FlipHorizontal className="w-3 h-3" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onMoveLayerOrder(idx, 'up')}
                    disabled={idx === compositeLayers.length - 1}
                    className="p-1 rounded-[6px] bg-lira-panel hover:bg-lira-surface border border-lira-quiet text-lira-muted hover:text-lira-ink disabled:opacity-30"
                    title="Mover para Cima (Frente)"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onMoveLayerOrder(idx, 'down')}
                    disabled={idx === 0}
                    className="p-1 rounded-[6px] bg-lira-panel hover:bg-lira-surface border border-lira-quiet text-lira-muted hover:text-lira-ink disabled:opacity-30"
                    title="Mover para Baixo (Trás)"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onDuplicateLayer(layer.id)}
                    className="p-1 rounded-[6px] bg-lira-panel hover:bg-lira-surface border border-lira-quiet text-lira-muted hover:text-lira-accent"
                    title="Duplicar Camada"
                  >
                    <Copy className="w-3 h-3" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeleteLayer(layer.id)}
                    className="p-1 rounded-[6px] bg-lira-panel hover:bg-lira-error/15 border border-lira-quiet text-lira-muted hover:text-lira-error"
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
