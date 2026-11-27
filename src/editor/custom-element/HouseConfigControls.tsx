import React, { useEffect, useState } from 'react'
import { Home } from 'lucide-react'
import { DEFAULT_HOUSE_SHELL, type HouseShellConfig } from '../../types/customAsset'
import type { WallType } from '../../types/map'
import { MAX_HOUSE_INTERIOR_HEIGHT, MAX_HOUSE_INTERIOR_WIDTH, MIN_HOUSE_INTERIOR_HEIGHT, MIN_HOUSE_INTERIOR_WIDTH } from '../../engine/houseInterior'

const WALL_OPTIONS: Array<{ value: WallType | ''; label: string }> = [
  { value: '', label: 'Sem parede' },
  { value: 'wood_panel', label: 'Painel Madeira' },
  { value: 'drywall_white', label: 'Alvenaria Branca' },
  { value: 'brick_red', label: 'Tijolo Vermelho' },
  { value: 'stone_dark', label: 'Pedra Escura' },
  { value: 'glass_modern', label: 'Vidro Moderno' },
  { value: 'forge_stone_wall', label: 'Pedra Rústica' },
  { value: 'forge_dark_brick', label: 'Tijolo Escuro' },
]

interface Props {
  isHouse: boolean
  onToggleHouse?: (enabled: boolean) => void
  houseShell: HouseShellConfig
  onChange: (next: HouseShellConfig) => void
  houseName?: string
  onChangeHouseName?: (name: string) => void
  compact?: boolean
  showDoorPaintingHint?: boolean
}

export const HouseConfigControls: React.FC<Props> = ({
  isHouse,
  onToggleHouse,
  houseShell,
  onChange,
  houseName,
  onChangeHouseName,
  compact = false,
  showDoorPaintingHint = false,
}) => {
  const width = houseShell.defaultInteriorWidth ?? DEFAULT_HOUSE_SHELL.defaultInteriorWidth
  const height = houseShell.defaultInteriorHeight ?? DEFAULT_HOUSE_SHELL.defaultInteriorHeight
  const wall =
    houseShell.defaultInteriorWall === null
      ? ''
      : (houseShell.defaultInteriorWall ?? DEFAULT_HOUSE_SHELL.defaultInteriorWall ?? 'wood_panel')

  const [widthText, setWidthText] = useState(String(width))
  const [heightText, setHeightText] = useState(String(height))

  useEffect(() => {
    setWidthText(String(width))
  }, [width])

  useEffect(() => {
    setHeightText(String(height))
  }, [height])

  const handleDimensionChange = (
    raw: string,
    min: number,
    max: number,
    setText: (v: string) => void,
    field: 'defaultInteriorWidth' | 'defaultInteriorHeight'
  ) => {
    const digitsOnly = raw.replace(/\D/g, '')
    setText(digitsOnly)
    if (!digitsOnly) return
    const parsed = parseInt(digitsOnly, 10)
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
      onChange({ ...houseShell, [field]: parsed })
    }
  }

  const commitDimension = (
    draft: string,
    currentVal: number,
    min: number,
    max: number,
    setText: (v: string) => void,
    field: 'defaultInteriorWidth' | 'defaultInteriorHeight'
  ) => {
    if (!draft) {
      setText(String(currentVal))
      return
    }
    const parsed = parseInt(draft, 10)
    if (!Number.isFinite(parsed)) {
      setText(String(currentVal))
      return
    }
    const clamped = Math.max(min, Math.min(max, parsed))
    setText(String(clamped))
    if (clamped !== currentVal) {
      onChange({ ...houseShell, [field]: clamped })
    }
  }

  return (
    <div className={`flex flex-col gap-2.5 font-mono text-lira-ink ${compact ? '' : 'p-3 rounded-[10px] border border-dashed border-lira-amber/60 bg-lira-surface/70'}`}>
      {onToggleHouse && (
        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="flex items-center gap-2 text-xs font-bold text-lira-amber">
            <Home className="w-4 h-4" />
            <span>É uma Casa / Portal com Interior</span>
          </span>
          <input
            type="checkbox"
            checked={isHouse}
            onChange={(e) => onToggleHouse(e.target.checked)}
            className="w-4 h-4 accent-lira-amber"
          />
        </label>
      )}

      {isHouse && (
        <div className="flex flex-col gap-2 pt-1">
          {onChangeHouseName && (
            <label className="flex flex-col gap-1 text-[11px]">
              <span className="text-lira-muted font-semibold">Nome da Casa / Interior</span>
              <input
                type="text"
                value={houseName ?? ''}
                onChange={(e) => onChangeHouseName(e.target.value)}
                placeholder="Ex: Casa do Lago"
                className="px-2.5 py-1.5 rounded-[8px] bg-lira-ground border border-lira-rule text-xs text-lira-ink focus:outline-none focus:border-lira-amber"
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px]">
              <span className="text-lira-muted font-semibold">
                Largura ({MIN_HOUSE_INTERIOR_WIDTH}-{MAX_HOUSE_INTERIOR_WIDTH})
              </span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                value={widthText}
                onChange={(e) =>
                  handleDimensionChange(
                    e.target.value,
                    MIN_HOUSE_INTERIOR_WIDTH,
                    MAX_HOUSE_INTERIOR_WIDTH,
                    setWidthText,
                    'defaultInteriorWidth'
                  )
                }
                onBlur={() =>
                  commitDimension(
                    widthText,
                    width,
                    MIN_HOUSE_INTERIOR_WIDTH,
                    MAX_HOUSE_INTERIOR_WIDTH,
                    setWidthText,
                    'defaultInteriorWidth'
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitDimension(
                      widthText,
                      width,
                      MIN_HOUSE_INTERIOR_WIDTH,
                      MAX_HOUSE_INTERIOR_WIDTH,
                      setWidthText,
                      'defaultInteriorWidth'
                    )
                    e.currentTarget.blur()
                  }
                }}
                className="px-2.5 py-1 rounded-[8px] bg-lira-ground border border-lira-rule text-xs text-lira-ink focus:outline-none focus:border-lira-amber"
              />
            </label>

            <label className="flex flex-col gap-1 text-[11px]">
              <span className="text-lira-muted font-semibold">
                Altura ({MIN_HOUSE_INTERIOR_HEIGHT}-{MAX_HOUSE_INTERIOR_HEIGHT})
              </span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                value={heightText}
                onChange={(e) =>
                  handleDimensionChange(
                    e.target.value,
                    MIN_HOUSE_INTERIOR_HEIGHT,
                    MAX_HOUSE_INTERIOR_HEIGHT,
                    setHeightText,
                    'defaultInteriorHeight'
                  )
                }
                onBlur={() =>
                  commitDimension(
                    heightText,
                    height,
                    MIN_HOUSE_INTERIOR_HEIGHT,
                    MAX_HOUSE_INTERIOR_HEIGHT,
                    setHeightText,
                    'defaultInteriorHeight'
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitDimension(
                      heightText,
                      height,
                      MIN_HOUSE_INTERIOR_HEIGHT,
                      MAX_HOUSE_INTERIOR_HEIGHT,
                      setHeightText,
                      'defaultInteriorHeight'
                    )
                    e.currentTarget.blur()
                  }
                }}
                className="px-2.5 py-1 rounded-[8px] bg-lira-ground border border-lira-rule text-xs text-lira-ink focus:outline-none focus:border-lira-amber"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-lira-muted font-semibold">Parede</span>
            <select
              value={wall}
              onChange={(e) =>
                onChange({
                  ...houseShell,
                  defaultInteriorWall: e.target.value ? (e.target.value as WallType) : null,
                })
              }
              className="px-2 py-1 rounded-[8px] bg-lira-ground border border-lira-rule text-xs text-lira-ink focus:outline-none focus:border-lira-amber"
            >
              {WALL_OPTIONS.map((opt) => (
                <option key={opt.value || 'none'} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>

          <div className="flex items-center justify-between gap-2 text-[10px] text-lira-muted">
            <span>Para mudar o chão, entre na casa e use a aba Pisos.</span>
            <span className="shrink-0 font-semibold text-lira-ink">{width}×{height}</span>
          </div>

          {showDoorPaintingHint && (
            <p className="text-[10px] text-lira-amber/90 leading-snug">
              Use a ferramenta <strong className="underline">Pintar Porta (Portal)</strong> no estúdio de composição para marcar em qual tile o jogador entra nesta casa.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
