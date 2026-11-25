import React from 'react'
import { Pipette, Wand2, Sliders } from 'lucide-react'
import { RGBColor } from '../../utils/imageTransparency'

interface Props {
  enableBgRemoval: boolean
  setEnableBgRemoval: (val: boolean) => void
  targetColor: RGBColor
  setTargetColor: (color: RGBColor) => void
  tolerance: number
  setTolerance: (tol: number) => void
  removeWhiteFringe: boolean
  setRemoveWhiteFringe: (val: boolean) => void
  isEyedropperActive: boolean
  setIsEyedropperActive: (active: boolean) => void
}

export const TransparencyControls: React.FC<Props> = ({
  enableBgRemoval,
  setEnableBgRemoval,
  targetColor,
  setTargetColor,
  tolerance,
  setTolerance,
  removeWhiteFringe,
  setRemoveWhiteFringe,
  isEyedropperActive,
  setIsEyedropperActive,
}) => {
  return (
    <div className="bg-lira-panel rounded-[12px] p-4 border border-lira-quiet space-y-3.5 font-mono text-lira-ink">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-lira-amber" />
          <span className="text-xs font-display font-bold text-lira-accent">Filtro de Transparência Automática</span>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enableBgRemoval}
            onChange={(e) => setEnableBgRemoval(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-lira-ground border border-lira-rule peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-lira-ground after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-lira-ink peer-checked:after:bg-lira-ground after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-lira-amber"></div>
        </label>
      </div>

      {enableBgRemoval && (
        <div className="space-y-3 pt-1 border-t border-dashed border-lira-rule/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-lira-muted">Cor de Fundo Alvo:</span>
              <div className="relative flex items-center">
                <input
                  type="color"
                  value={`#${((1 << 24) + (targetColor.r << 16) + (targetColor.g << 8) + targetColor.b).toString(16).slice(1)}`}
                  onChange={(e) => {
                    const hex = e.target.value
                    const r = parseInt(hex.slice(1, 3), 16)
                    const g = parseInt(hex.slice(3, 5), 16)
                    const b = parseInt(hex.slice(5, 7), 16)
                    setTargetColor({ r, g, b })
                  }}
                  className="w-7 h-7 rounded-[6px] border border-lira-rule cursor-pointer p-0 bg-transparent overflow-hidden"
                  title="Clique para escolher a cor ou use o Conta-gotas"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsEyedropperActive(!isEyedropperActive)}
              className={`px-3 py-1 rounded-[8px] text-xs font-mono font-bold border transition-colors flex items-center gap-1.5 ${
                isEyedropperActive
                  ? 'bg-lira-amber text-lira-ground border-lira-amber'
                  : 'bg-lira-surface hover:border-lira-accent text-lira-ink border-lira-rule'
              }`}
            >
              <Pipette className="w-3.5 h-3.5" />
              <span>{isEyedropperActive ? 'Clique na imagem...' : 'Conta-gotas'}</span>
            </button>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-mono text-lira-muted">
              <span className="flex items-center gap-1">
                <Sliders className="w-3.5 h-3.5 text-lira-muted" />
                <span>Tolerância de Cor</span>
              </span>
              <span className="font-mono font-bold text-lira-amber tabular-nums">{tolerance}</span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
              className="w-full h-1.5 bg-lira-ground rounded-lg appearance-none cursor-pointer accent-[#f5cc85]"
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-mono text-lira-muted">Suavizar Bordas e Halos</span>
            <input
              type="checkbox"
              checked={removeWhiteFringe}
              onChange={(e) => setRemoveWhiteFringe(e.target.checked)}
              className="w-4 h-4 rounded text-lira-amber focus:ring-0 bg-lira-ground border-lira-rule cursor-pointer"
            />
          </div>
        </div>
      )}
    </div>
  )
}
