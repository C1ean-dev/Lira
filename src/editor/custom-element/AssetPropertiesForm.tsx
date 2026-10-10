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
    <div className="bg-[#18191c] rounded-2xl p-4 border border-[#2b2d31] space-y-3.5">
      <div className="flex items-center gap-2">
        <Package className="w-4 h-4 text-indigo-400" />
        <span className="text-xs font-bold text-slate-200">Propriedades do Elemento</span>
      </div>

      <div className="space-y-1">
        <label className="block text-[11px] font-semibold text-slate-300">Nome do Objeto</label>
        <input
          type="text"
          value={elementName}
          onChange={(e) => setElementName(e.target.value)}
          placeholder="Ex: Forja de Armas, Trono de Ouro, Parede Rústica..."
          className="w-full bg-[#12151d] border border-[#2b2d31] rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
          maxLength={30}
        />
      </div>

      <div className="space-y-1">
        <label className="block text-[11px] font-semibold text-slate-300">Tipo de Elemento</label>
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
              className={`py-1.5 px-1 rounded-xl text-[11px] font-bold border transition-all ${
                elementType === item.type
                  ? 'bg-indigo-600 border-indigo-500 text-white shadow-md'
                  : 'bg-[#12151d] border-[#2b2d31] text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t border-[#2b2d31]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
            <label className="block text-[11px] font-bold text-slate-200">
              Tamanho Final do Elemento
            </label>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 font-bold">
            {pixelWidth}×{pixelHeight}px
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 bg-[#12151d] p-2 rounded-xl border border-[#2b2d31]">
          <div>
            <span className="block text-[10px] font-semibold text-slate-400 mb-1">Tiles no Mapa:</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={32}
                value={tileWidth}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val)) onSetBoardSizeInTiles(Math.max(1, val), tileHeight)
                }}
                className="w-full bg-[#18191c] border border-[#2b2d31] rounded-lg px-2 py-1 text-xs font-bold text-center text-white focus:outline-none focus:border-indigo-500"
                title="Largura em tiles no mapa"
              />
              <span className="text-slate-500 text-xs font-bold">×</span>
              <input
                type="number"
                min={1}
                max={32}
                value={tileHeight}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val)) onSetBoardSizeInTiles(tileWidth, Math.max(1, val))
                }}
                className="w-full bg-[#18191c] border border-[#2b2d31] rounded-lg px-2 py-1 text-xs font-bold text-center text-white focus:outline-none focus:border-indigo-500"
                title="Altura em tiles no mapa"
              />
            </div>
          </div>

          <div>
            <span className="block text-[10px] font-semibold text-slate-400 mb-1">Tamanho em Pixels:</span>
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
                className="w-full bg-[#18191c] border border-[#2b2d31] rounded-lg px-2 py-1 text-xs font-mono font-bold text-center text-emerald-400 focus:outline-none focus:border-indigo-500"
                title="Largura em pixels (livre de 1px até o limite da imagem)"
              />
              <span className="text-slate-500 text-xs font-bold">×</span>
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
                className="w-full bg-[#18191c] border border-[#2b2d31] rounded-lg px-2 py-1 text-xs font-mono font-bold text-center text-emerald-400 focus:outline-none focus:border-indigo-500"
                title="Altura em pixels (livre de 1px até o limite da imagem)"
              />
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-[10px] font-semibold text-slate-400">Ajuste do Recorte para o Tamanho Final:</label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setScaleFitMode('fit')}
              className={`py-1 px-2 rounded-xl text-[10px] font-bold border transition-all ${
                scaleFitMode === 'fit'
                  ? 'bg-indigo-600 border-indigo-500 text-white shadow'
                  : 'bg-[#12151d] border-[#2b2d31] text-slate-400 hover:text-slate-200'
              }`}
              title="Ajusta o sprite mantendo as proporções originais (alinhado à base do chão)"
            >
              Ajustar Proporcional
            </button>
            <button
              type="button"
              onClick={() => setScaleFitMode('stretch')}
              className={`py-1 px-2 rounded-xl text-[10px] font-bold border transition-all ${
                scaleFitMode === 'stretch'
                  ? 'bg-indigo-600 border-indigo-500 text-white shadow'
                  : 'bg-[#12151d] border-[#2b2d31] text-slate-400 hover:text-slate-200'
              }`}
              title="Preenche exatamente toda a largura e altura final"
            >
              Preencher (Esticar)
            </button>
          </div>
        </div>

        {selection && selection.w > 0 && selection.h > 0 && (
          <div className="p-2 rounded-xl bg-slate-800/60 border border-slate-700/60 text-[10px] flex items-center justify-between text-slate-300">
            <span>
              Recorte: <strong className="font-mono text-white">{selection.w}×{selection.h}px</strong>
            </span>
            <span className="text-slate-500">➔</span>
            <span>
              Final:{' '}
              <strong className="font-mono text-emerald-400">
                {pixelWidth}×{pixelHeight}px
              </strong>{' '}
              <span className="text-slate-400">({tileWidth}×{tileHeight}t)</span>
            </span>
          </div>
        )}
      </div>

      <div className="space-y-1 pt-1 border-t border-[#2b2d31]">
        <div className="flex items-center justify-between">
          <label className="block text-[11px] font-semibold text-slate-300">Categoria no Menu</label>
          <button
            type="button"
            onClick={() => setIsCreatingNewCategory(!isCreatingNewCategory)}
            className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
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
              className="flex-1 bg-[#12151d] border border-[#2a3142] rounded-xl px-3 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              maxLength={20}
            />
            <button
              type="button"
              onClick={onAddNewCategory}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow transition-colors"
            >
              Salvar
            </button>
          </div>
        ) : (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full bg-[#12151d] border border-[#2b2d31] rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
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
