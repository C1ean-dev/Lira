import React from 'react'
import { Package, Plus, Maximize2 } from 'lucide-react'
import { CustomAssetType } from '../../types/customAsset'

interface Props {
  elementName: string
  setElementName: (name: string) => void
  elementType: CustomAssetType
  onSelectElementType: (type: CustomAssetType) => void
  category: string
  setCategory: (cat: string) => void
  allCategories: string[]
  isCreatingNewCategory: boolean
  setIsCreatingNewCategory: (creating: boolean) => void
  newCategoryName: string
  setNewCategoryName: (name: string) => void
  onAddNewCategory: () => void
  canvasWidth: number
  canvasHeight: number
  onSetCanvasSize: (w: number, h: number) => void | Promise<void>
  tileWidth: number
  tileHeight: number
  onSetBoardSizeInTiles: (w: number, h: number) => void
  pixelWidth: number
  pixelHeight: number
  onSetPixelSize: (w: number, h: number) => void
  scaleFitMode: 'fit' | 'stretch'
  setScaleFitMode: (mode: 'fit' | 'stretch') => void
  selection?: { w: number; h: number }
}

export const AssetPropertiesForm: React.FC<Props> = ({
  elementName,
  setElementName,
  elementType,
  onSelectElementType,
  category,
  setCategory,
  allCategories,
  isCreatingNewCategory,
  setIsCreatingNewCategory,
  newCategoryName,
  setNewCategoryName,
  onAddNewCategory,
  canvasWidth,
  canvasHeight,
  onSetCanvasSize,
  tileWidth,
  tileHeight,
  onSetBoardSizeInTiles,
  pixelWidth,
  pixelHeight,
  onSetPixelSize,
  scaleFitMode,
  setScaleFitMode,
  selection,
}) => {
  return (
    <div className="bg-lira-panel rounded-[12px] p-4 border border-lira-quiet space-y-3.5 font-mono text-lira-ink">
      <div className="flex items-center gap-2">
        <Package className="w-4 h-4 text-lira-accent" />
        <span className="text-xs font-display font-bold text-lira-accent">Propriedades do Elemento</span>
      </div>

      <div className="space-y-1">
        <label className="block text-[11px] font-mono font-semibold text-lira-muted">Nome do Objeto</label>
        <input
          type="text"
          value={elementName}
          onChange={(e) => setElementName(e.target.value)}
          placeholder="Ex: Forja de Armas, Trono de Ouro, Parede Rústica..."
          className="w-full bg-lira-ground border border-lira-rule rounded-[8px] px-3 py-1.5 text-xs font-mono text-lira-ink focus:outline-none focus:border-lira-accent"
          maxLength={30}
        />
      </div>

      <div className="space-y-1">
        <label className="block text-[11px] font-mono font-semibold text-lira-muted">Tipo de Elemento</label>
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { type: 'avatar', label: '👤 Avatar' },
            { type: 'furniture', label: '🪑 Mobília' },
            { type: 'floor', label: '🟩 Piso' },
            { type: 'wall', label: '🧱 Parede' },
          ].map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => onSelectElementType(item.type as CustomAssetType)}
              className={`py-1.5 px-1 rounded-[8px] text-[11px] font-mono font-bold border transition-colors ${
                elementType === item.type
                  ? 'bg-lira-accent border-lira-accent text-lira-ground'
                  : 'bg-lira-ground border-lira-quiet text-lira-muted hover:text-lira-ink'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t border-dashed border-lira-rule/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Maximize2 className="w-3.5 h-3.5 text-lira-accent" />
            <label className="block text-[11px] font-mono font-bold text-lira-ink">
              Dimensões do elemento
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 bg-lira-ground p-2 rounded-[8px] border border-lira-quiet">
          <div>
            <span className="block text-[10px] font-mono font-semibold text-lira-muted mb-1">Tamanho da tela (px)</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={4096}
                step={1}
                value={canvasWidth}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  if (!isNaN(val)) void onSetCanvasSize(Math.max(1, val), canvasHeight)
                }}
                className="w-full bg-lira-panel border border-lira-rule rounded-[6px] px-2 py-1 text-xs font-mono font-bold text-center text-lira-ink focus:outline-none focus:border-lira-accent"
                aria-label="Largura da tela em pixels" title="Largura da área de desenho da camada"
              />
              <span className="text-lira-muted text-xs font-bold">×</span>
              <input
                type="number"
                min={1}
                max={4096}
                step={1}
                value={canvasHeight}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  if (!isNaN(val)) void onSetCanvasSize(canvasWidth, Math.max(1, val))
                }}
                className="w-full bg-lira-panel border border-lira-rule rounded-[6px] px-2 py-1 text-xs font-mono font-bold text-center text-lira-ink focus:outline-none focus:border-lira-accent"
                aria-label="Altura da tela em pixels" title="Altura da área de desenho da camada"
              />
            </div>
          </div>

          <div>
            <span className="block text-[10px] font-mono font-semibold text-lira-muted mb-1">Tamanho final no mapa (px)</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={4096}
                step={1}
                value={pixelWidth}
                onChange={(e) => {
                  const px = parseInt(e.target.value, 10)
                  if (!isNaN(px)) {
                    onSetPixelSize(Math.max(1, px), pixelHeight)
                  }
                }}
                className="w-full bg-lira-panel border border-lira-rule rounded-[6px] px-2 py-1 text-xs font-mono font-bold text-center text-lira-online focus:outline-none focus:border-lira-accent"
                aria-label="Largura final no mapa em pixels" title="Largura de exibição no mapa"
              />
              <span className="text-lira-muted text-xs font-bold">×</span>
              <input
                type="number"
                min={1}
                max={4096}
                step={1}
                value={pixelHeight}
                onChange={(e) => {
                  const px = parseInt(e.target.value, 10)
                  if (!isNaN(px)) {
                    onSetPixelSize(pixelWidth, Math.max(1, px))
                  }
                }}
                className="w-full bg-lira-panel border border-lira-rule rounded-[6px] px-2 py-1 text-xs font-mono font-bold text-center text-lira-online focus:outline-none focus:border-lira-accent"
                aria-label="Altura final no mapa em pixels" title="Altura de exibição no mapa"
              />
            </div>
          </div>
        </div>

        <p className="text-[10px] font-mono text-lira-muted">Tela: resolução da camada em edição. Final: tamanho de exibição do elemento.</p>

        <div className="space-y-1">
          <label className="block text-[10px] font-mono font-semibold text-lira-muted">Ajuste do Recorte para o Tamanho Final:</label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setScaleFitMode('fit')}
              className={`py-1 px-2 rounded-[8px] text-[10px] font-mono font-bold border transition-colors ${
                scaleFitMode === 'fit'
                  ? 'bg-lira-accent border-lira-accent text-lira-ground'
                  : 'bg-lira-ground border-lira-quiet text-lira-muted hover:text-lira-ink'
              }`}
              title="Ajusta o sprite mantendo as proporções originais (alinhado à base do chão)"
            >
              Ajustar Proporcional
            </button>
            <button
              type="button"
              onClick={() => setScaleFitMode('stretch')}
              className={`py-1 px-2 rounded-[8px] text-[10px] font-mono font-bold border transition-colors ${
                scaleFitMode === 'stretch'
                  ? 'bg-lira-accent border-lira-accent text-lira-ground'
                  : 'bg-lira-ground border-lira-quiet text-lira-muted hover:text-lira-ink'
              }`}
              title="Preenche exatamente toda a largura e altura final"
            >
              Preencher (Esticar)
            </button>
          </div>
        </div>

        {selection && selection.w > 0 && selection.h > 0 && (
          <div className="p-2 rounded-[8px] bg-lira-surface border border-lira-quiet text-[10px] font-mono flex items-center justify-between text-lira-muted">
            <span>
              Recorte: <strong className="font-mono text-lira-ink">{selection.w}×{selection.h}px</strong>
            </span>
            <span className="text-lira-muted">➔</span>
            <span>
              Final:{' '}
              <strong className="font-mono text-lira-online">
                {pixelWidth}×{pixelHeight}px
              </strong>{' '}

            </span>
          </div>
        )}
      </div>

      <div className="space-y-1 pt-1 border-t border-dashed border-lira-rule/60">
        <div className="flex items-center justify-between">
          <label className="block text-[11px] font-mono font-semibold text-lira-muted">Categoria no Menu</label>
          <button
            type="button"
            onClick={() => setIsCreatingNewCategory(!isCreatingNewCategory)}
            className="text-[10px] font-mono text-lira-accent hover:text-lira-ink flex items-center gap-0.5"
          >
            <Plus className="w-3 h-3" />
            <span>{isCreatingNewCategory ? 'Usar Existente' : 'Nova Categoria'}</span>
          </button>
        </div>

        {isCreatingNewCategory ? (
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="Nome da categoria..."
              className="flex-1 bg-lira-ground border border-lira-rule rounded-[8px] px-3 py-1 text-xs font-mono text-lira-ink focus:outline-none focus:border-lira-accent"
              maxLength={20}
            />
            <button
              type="button"
              onClick={onAddNewCategory}
              className="px-3 py-1 bg-lira-accent hover:bg-lira-ink text-lira-ground rounded-[8px] text-xs font-mono font-bold transition-colors"
            >
              Salvar
            </button>
          </div>
        ) : (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full bg-lira-ground border border-lira-rule rounded-[8px] px-3 py-1.5 text-xs font-mono text-lira-ink focus:outline-none focus:border-lira-accent"
          >
            {allCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}
