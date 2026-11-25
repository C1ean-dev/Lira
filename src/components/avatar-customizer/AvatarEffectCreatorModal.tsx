import React, { useEffect, useRef, useState } from 'react'
import { Check, Eraser, Grid3X3, Paintbrush, Sparkles, Trash2, X } from 'lucide-react'
import type {
  AvatarEffectDensity,
  AvatarEffectMotion,
  AvatarEffectShape,
  CustomAvatarEffectSpec,
} from '../../types/game'
import {
  AVATAR_EFFECT_COLOR_PRESETS,
  DEFAULT_AVATAR_EFFECT_COLOR,
  DENSITY_OPTIONS,
  MOTION_OPTIONS,
  SHAPE_MATRICES,
  SHAPE_OPTIONS,
  deriveEffectPalette,
  drawEffectPresetIcon,
  hasNonEmptyPixelMatrix,
} from '../../engine/avatarEffects'

const GRID_SIZE = 9

type BrushCell = '0' | '1' | '2' | '3'

function emptyMatrix(): string[] {
  return Array.from({ length: GRID_SIZE }, () => '0'.repeat(GRID_SIZE))
}

function normalizeToGrid(source?: readonly string[]): string[] {
  if (!source || source.length === 0) return emptyMatrix()
  const grid = Array.from({ length: GRID_SIZE }, () => Array<string>(GRID_SIZE).fill('0'))
  const srcH = source.length
  const srcW = source[0]?.length || 0
  const offsetY = Math.floor((GRID_SIZE - srcH) / 2)
  const offsetX = Math.floor((GRID_SIZE - srcW) / 2)

  for (let r = 0; r < srcH; r++) {
    const line = source[r]
    for (let c = 0; c < line.length; c++) {
      const targetR = r + offsetY
      const targetC = c + offsetX
      if (targetR >= 0 && targetR < GRID_SIZE && targetC >= 0 && targetC < GRID_SIZE) {
        const ch = line[c]
        if (ch === '1' || ch === '2' || ch === '3') {
          grid[targetR][targetC] = ch
        }
      }
    }
  }
  return grid.map((row) => row.join(''))
}

const ShapeMiniIcon: React.FC<{ shape: AvatarEffectShape; color: string }> = ({ shape, color }) => {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawEffectPresetIcon(ctx, [shape], color, canvas.width, canvas.height)
  }, [shape, color])

  return <canvas ref={ref} width={32} height={32} className="w-8 h-8 pixelated shrink-0" />
}

interface Props {
  isOpen: boolean
  kind: 'aura' | 'steps'
  initial?: CustomAvatarEffectSpec | null
  defaultColor?: string
  onClose: () => void
  onSave: (spec: CustomAvatarEffectSpec) => void
}

export const AvatarEffectCreatorModal: React.FC<Props> = ({
  isOpen,
  kind,
  initial,
  defaultColor,
  onClose,
  onSave,
}) => {
  const isAura = kind === 'aura'
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'shapes' | 'draw'>('shapes')
  const [shapes, setShapes] = useState<AvatarEffectShape[]>(['star', 'sparkle'])
  const [matrix, setMatrix] = useState<string[]>(emptyMatrix)
  const [brush, setBrush] = useState<BrushCell>('1')
  const [isPainting, setIsPainting] = useState(false)
  const [color, setColor] = useState(defaultColor || DEFAULT_AVATAR_EFFECT_COLOR)
  const [motion, setMotion] = useState<AvatarEffectMotion>('float')
  const [density, setDensity] = useState<AvatarEffectDensity>('normal')

  const previewRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    if (initial) {
      setName(initial.name)
      const hasCustomDrawing = hasNonEmptyPixelMatrix(initial.pixelMatrix)
      setMode(hasCustomDrawing ? 'draw' : 'shapes')
      setShapes(initial.shapes.length > 0 ? [...initial.shapes] : ['sparkle'])
      setMatrix(hasCustomDrawing ? normalizeToGrid(initial.pixelMatrix) : emptyMatrix())
      setColor(initial.color || defaultColor || DEFAULT_AVATAR_EFFECT_COLOR)
      setMotion(initial.motion || 'float')
      setDensity(initial.density || 'normal')
    } else {
      setName('')
      setMode('shapes')
      setShapes(isAura ? ['flame', 'star'] : ['star', 'sparkle'])
      setMatrix(normalizeToGrid(SHAPE_MATRICES.star))
      setColor(defaultColor || DEFAULT_AVATAR_EFFECT_COLOR)
      setMotion(isAura ? 'float' : 'rise')
      setDensity('normal')
    }
    setBrush('1')
  }, [isOpen, initial, defaultColor, isAura])

  useEffect(() => {
    if (!isOpen) return
    const stopPainting = () => setIsPainting(false)
    window.addEventListener('mouseup', stopPainting)
    return () => window.removeEventListener('mouseup', stopPainting)
  }, [isOpen])

  useEffect(() => {
    const canvas = previewRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawEffectPresetIcon(
      ctx,
      shapes,
      color,
      canvas.width,
      canvas.height,
      mode === 'draw' ? matrix : undefined
    )
  }, [shapes, color, mode, matrix, isOpen])

  if (!isOpen) return null

  const palette = deriveEffectPalette(color)

  const toggleShape = (shapeId: AvatarEffectShape) => {
    setShapes((prev) => {
      if (prev.includes(shapeId)) {
        return prev.length > 1 ? prev.filter((s) => s !== shapeId) : prev
      }
      return [...prev, shapeId]
    })
  }

  const paintCell = (row: number, col: number, value: BrushCell) => {
    setMatrix((prev) =>
      prev.map((line, r) =>
        r !== row ? line : line.slice(0, col) + value + line.slice(col + 1)
      )
    )
  }

  const canSave =
    mode === 'draw' ? hasNonEmptyPixelMatrix(matrix) : shapes.length > 0

  const handleConfirm = () => {
    if (!canSave) return
    const spec: CustomAvatarEffectSpec = {
      id: initial?.id || `custom_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || (isAura ? 'Minha Aura' : 'Meus Passos'),
      kind,
      shapes: shapes.length > 0 ? shapes : ['sparkle'],
      pixelMatrix: mode === 'draw' && hasNonEmptyPixelMatrix(matrix) ? matrix : undefined,
      color,
      motion,
      density,
    }
    onSave(spec)
  }

  const cellColorFor = (cell: string): string => {
    if (cell === '1') return palette.flowerPrimary
    if (cell === '2') return palette.highlight
    if (cell === '3') return palette.outline
    return 'transparent'
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-lira-ground/80 p-3 select-none font-mono text-lira-ink">
      <div className="bg-lira-panel border border-dashed border-lira-rule rounded-[12px] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-dashed border-lira-rule/60 bg-lira-sidebar">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[8px] bg-lira-ground border border-lira-quiet flex items-center justify-center overflow-hidden">
              <canvas ref={previewRef} width={40} height={40} className="w-10 h-10 pixelated" />
            </div>
            <div>
              <h3 className="text-sm font-display font-bold text-lira-accent">
                {initial
                  ? isAura ? 'Editar Aura Personalizada' : 'Editar Passos Personalizados'
                  : isAura ? 'Criar Nova Aura' : 'Criar Novo Efeito de Passos'}
              </h3>
              <p className="text-[11px] font-mono text-lira-muted">
                Misture partículas prontas ou desenhe seu próprio sprite em pixel art (9×9).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-[8px] border border-transparent text-lira-muted hover:text-lira-ink hover:bg-lira-surface hover:border-lira-rule"
            aria-label="Fechar criador"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex flex-col gap-4 bg-lira-panel">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="block text-[11px] font-mono font-bold text-lira-ink mb-1">Nome</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={32}
                placeholder={isAura ? 'Ex.: Chama Roxa, Raio Solar...' : 'Ex.: Passos de Fogo...'}
                className="w-full px-3 py-2 rounded-[8px] bg-lira-ground border border-lira-rule text-xs font-mono font-semibold text-lira-ink placeholder:text-lira-muted focus:outline-none focus:border-lira-accent"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono font-bold text-lira-ink mb-1">Modo</label>
              <div className="flex rounded-[8px] bg-lira-ground border border-lira-quiet p-0.5">
                <button
                  type="button"
                  onClick={() => setMode('shapes')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-xs font-mono font-bold transition-colors ${
                    mode === 'shapes' ? 'bg-lira-accent text-lira-ground' : 'text-lira-muted hover:text-lira-ink'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Formas</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('draw')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-xs font-mono font-bold transition-colors ${
                    mode === 'draw' ? 'bg-lira-accent text-lira-ground' : 'text-lira-muted hover:text-lira-ink'
                  }`}
                >
                  <Grid3X3 className="w-3.5 h-3.5" />
                  <span>Desenhar 9×9</span>
                </button>
              </div>
            </div>
          </div>

          {mode === 'shapes' ? (
            <div>
              <div className="text-[11px] font-mono font-bold text-lira-ink mb-1.5">
                Escolha 1 ou mais formas para combinar
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {SHAPE_OPTIONS.map((opt) => {
                  const active = shapes.includes(opt.id)
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggleShape(opt.id)}
                      aria-pressed={active}
                      className={`flex flex-col items-center gap-1 p-2 rounded-[8px] border transition-colors ${
                        active
                          ? 'bg-lira-surface border-lira-accent text-lira-ink'
                          : 'bg-lira-ground border-lira-quiet text-lira-muted hover:text-lira-ink hover:border-lira-rule'
                      }`}
                    >
                      <ShapeMiniIcon shape={opt.id} color={color} />
                      <span className="text-[11px] font-mono font-bold truncate max-w-full">{opt.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start bg-lira-surface border border-lira-quiet rounded-[12px] p-3.5">
              <div
                className="grid grid-cols-9 gap-0.5 p-2 rounded-[8px] bg-lira-ground border border-lira-quiet shrink-0"
                onMouseLeave={() => setIsPainting(false)}
              >
                {matrix.map((line, r) =>
                  line.split('').map((cell, c) => (
                    <button
                      key={`${r}-${c}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setIsPainting(true)
                        paintCell(r, c, brush)
                      }}
                      onMouseEnter={() => {
                        if (isPainting) paintCell(r, c, brush)
                      }}
                      aria-label={`Pixel ${r + 1},${c + 1}`}
                      className="w-6 h-6 rounded-[3px] border border-lira-quiet/40"
                      style={{
                        backgroundColor:
                          cell === '0' ? 'rgba(255,255,255,0.03)' : cellColorFor(cell),
                      }}
                    />
                  ))
                )}
              </div>

              <div className="flex-1 flex flex-col gap-3 w-full">
                <div>
                  <div className="text-[11px] font-mono font-bold text-lira-ink mb-1.5">Pincel</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { id: '1' as const, label: 'Cor principal', swatch: palette.flowerPrimary },
                        { id: '2' as const, label: 'Brilho', swatch: palette.highlight },
                        { id: '3' as const, label: 'Contorno', swatch: palette.outline },
                      ] as const
                    ).map((tool) => (
                      <button
                        key={tool.id}
                        type="button"
                        onClick={() => setBrush(tool.id)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-[11px] font-mono font-bold border transition-colors ${
                          brush === tool.id
                            ? 'bg-lira-panel border-lira-accent text-lira-ink'
                            : 'bg-lira-ground border-lira-quiet text-lira-muted hover:text-lira-ink'
                        }`}
                      >
                        <Paintbrush className="w-3 h-3" />
                        <span
                          className="w-3 h-3 rounded-full border border-lira-rule"
                          style={{ backgroundColor: tool.swatch }}
                        />
                        <span>{tool.label}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setBrush('0')}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-[11px] font-mono font-bold border transition-colors ${
                        brush === '0'
                          ? 'bg-lira-panel border-lira-accent text-lira-ink'
                          : 'bg-lira-ground border-lira-quiet text-lira-muted hover:text-lira-ink'
                      }`}
                    >
                      <Eraser className="w-3 h-3" />
                      <span>Borracha</span>
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-mono font-bold text-lira-ink mb-1.5">
                    Carregar molde base
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(['flame', 'sunray', 'star', 'flower', 'heart', 'lightning', 'snowflake'] as const).map(
                      (tpl) => (
                        <button
                          key={tpl}
                          type="button"
                          onClick={() => setMatrix(normalizeToGrid(SHAPE_MATRICES[tpl]))}
                          className="px-2 py-1 rounded-[6px] bg-lira-ground hover:bg-lira-panel border border-lira-quiet hover:border-lira-rule text-[11px] font-mono font-semibold text-lira-muted hover:text-lira-ink"
                        >
                          {SHAPE_OPTIONS.find((s) => s.id === tpl)?.label}
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => setMatrix(emptyMatrix())}
                      className="px-2 py-1 rounded-[6px] bg-lira-error/15 hover:bg-lira-error/25 border border-lira-error/40 text-[11px] font-mono font-semibold text-lira-error flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Limpar</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-lira-surface border border-lira-quiet rounded-[8px] p-3">
              <div className="text-[11px] font-mono font-bold text-lira-ink mb-1.5">Movimento</div>
              <div className="flex flex-wrap gap-1.5">
                {MOTION_OPTIONS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMotion(m.id)}
                    title={m.description}
                    className={`px-2.5 py-1 rounded-[6px] text-[11px] font-mono font-bold border transition-colors ${
                      motion === m.id
                        ? 'bg-lira-accent border-lira-accent text-lira-ground'
                        : 'bg-lira-ground border-lira-quiet text-lira-muted hover:text-lira-ink'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-lira-surface border border-lira-quiet rounded-[8px] p-3">
              <div className="text-[11px] font-mono font-bold text-lira-ink mb-1.5">Intensidade</div>
              <div className="flex gap-1.5">
                {DENSITY_OPTIONS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDensity(d.id)}
                    className={`flex-1 py-1.5 rounded-[6px] text-[11px] font-mono font-bold border transition-colors ${
                      density === d.id
                        ? 'bg-lira-accent border-lira-accent text-lira-ground'
                        : 'bg-lira-ground border-lira-quiet text-lira-muted hover:text-lira-ink'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-lira-surface border border-lira-quiet rounded-[8px] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono font-bold text-lira-ink">Cor</span>
              <span className="text-[11px] font-mono text-lira-muted uppercase">{color}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {AVATAR_EFFECT_COLOR_PRESETS.map((preset) => {
                const active = color.toLowerCase() === preset.hex.toLowerCase()
                return (
                  <button
                    key={preset.hex}
                    type="button"
                    onClick={() => setColor(preset.hex)}
                    title={preset.label}
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                      active ? 'border-lira-ink' : 'border-lira-ground'
                    }`}
                    style={{ backgroundColor: preset.hex }}
                  >
                    {active && <Check className="w-3 h-3 text-white" />}
                  </button>
                )
              })}
              <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-lira-ground hover:bg-lira-panel border border-lira-rule text-[11px] font-mono font-semibold text-lira-ink cursor-pointer">
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_AVATAR_EFFECT_COLOR}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-4 h-4 rounded bg-transparent border-0 p-0 cursor-pointer"
                />
                <span>Outra</span>
              </label>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-dashed border-lira-rule/60 bg-lira-sidebar flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-[8px] text-xs font-mono font-bold text-lira-muted hover:text-lira-ink bg-lira-surface border border-lira-rule hover:border-lira-accent"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSave}
            className="px-5 py-1.5 rounded-[8px] text-xs font-mono font-extrabold bg-lira-accent hover:bg-lira-ink disabled:opacity-40 disabled:cursor-not-allowed text-lira-ground border-2 border-lira-accent hover:border-lira-ink flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{initial ? 'Salvar alterações' : 'Criar e aplicar'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
