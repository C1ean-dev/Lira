import React from 'react'
import { Lightbulb, Flame, RotateCcw } from 'lucide-react'
import type { FurnitureLightConfig } from '../../types/customAsset'

const LIGHT_SWATCHES = [
  { name: 'Quente', color: '#ffd580' },
  { name: 'Fogo', color: '#ff8a36' },
  { name: 'Mágica', color: '#c084fc' },
  { name: 'Verde', color: '#4ade80' },
  { name: 'Ciano', color: '#38bdf8' },
  { name: 'Rosa', color: '#f472b6' },
  { name: 'Vermelha', color: '#f87171' },
  { name: 'Branca', color: '#ffffff' },
]

interface Props {
  light: FurnitureLightConfig
  onChange: (next: FurnitureLightConfig) => void
  compact?: boolean
  onResetToDefault?: () => void
}

export const FurnitureLightControls: React.FC<Props> = ({
  light,
  onChange,
  compact = false,
  onResetToDefault,
}) => {
  return (
    <div
      className={`rounded-[8px] border border-lira-quiet bg-lira-ground font-mono text-lira-ink ${
        compact ? 'p-2.5 space-y-2.5 w-72' : 'p-3 space-y-2.5'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs font-bold cursor-pointer select-none">
          <input
            type="checkbox"
            checked={light.enabled}
            onChange={(e) => onChange({ ...light, enabled: e.target.checked })}
          />
          <Lightbulb className={`w-3.5 h-3.5 ${light.enabled ? 'text-lira-amber' : 'text-lira-muted'}`} />
          <span>Emitir Luz 2D</span>
        </label>

        {onResetToDefault && (
          <button
            type="button"
            onClick={onResetToDefault}
            className="px-1.5 py-0.5 rounded-[5px] bg-lira-surface border border-lira-rule text-[10px] text-lira-muted hover:text-lira-ink flex items-center gap-1"
            title="Restaurar iluminação padrão do catálogo"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Padrão</span>
          </button>
        )}
      </div>

      {light.enabled && (
        <div className="space-y-2.5 pt-2 border-t border-dashed border-lira-rule/60">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-lira-muted">
              <span>Cor da Luz</span>
              <span className="text-lira-ink font-semibold uppercase">{light.color}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {LIGHT_SWATCHES.map((swatch) => {
                const active = light.color.toLowerCase() === swatch.color.toLowerCase()
                return (
                  <button
                    key={swatch.name}
                    type="button"
                    onClick={() => onChange({ ...light, color: swatch.color })}
                    className={`w-5 h-5 rounded-[5px] border transition-transform ${
                      active ? 'border-white ring-2 ring-lira-amber scale-105' : 'border-lira-rule hover:scale-105'
                    }`}
                    style={{ backgroundColor: swatch.color }}
                    title={swatch.name}
                    aria-label={`Cor de luz ${swatch.name}`}
                  />
                )
              })}
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(light.color) ? light.color : '#ffd580'}
                onChange={(e) => onChange({ ...light, color: e.target.value })}
                className="w-6 h-5 rounded-[5px] border border-lira-rule bg-transparent cursor-pointer p-0"
                title="Cor personalizada"
                aria-label="Cor personalizada da luz"
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-lira-muted">
              <span>Alcance (Raio)</span>
              <span className="text-lira-amber font-bold">{Math.round(light.radius)}px</span>
            </div>
            <input
              type="range"
              min={50}
              max={320}
              step={5}
              value={Math.round(light.radius)}
              onChange={(e) => onChange({ ...light, radius: Number(e.target.value) })}
              className="w-full accent-lira-amber cursor-pointer"
              aria-label="Alcance da luz em pixels"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-lira-muted">
              <span>Intensidade</span>
              <span className="text-lira-amber font-bold">{Math.round(light.intensity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.15}
              max={1.0}
              step={0.05}
              value={Number(light.intensity.toFixed(2))}
              onChange={(e) => onChange({ ...light, intensity: Number(e.target.value) })}
              className="w-full accent-lira-amber cursor-pointer"
              aria-label="Intensidade da luz"
            />
          </div>

          <label className="flex items-center gap-2 text-[11px] font-semibold cursor-pointer select-none">
            <input
              type="checkbox"
              checked={Boolean(light.flicker)}
              onChange={(e) => onChange({ ...light, flicker: e.target.checked })}
            />
            <Flame className={`w-3.5 h-3.5 ${light.flicker ? 'text-orange-400' : 'text-lira-muted'}`} />
            <span>Efeito de Chama (Cintilar)</span>
          </label>
        </div>
      )}
    </div>
  )
}
