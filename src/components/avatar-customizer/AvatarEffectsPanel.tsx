import React, { useEffect, useRef, useState } from 'react'
import { Ban, Check, Footprints, Palette, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import type {
  AvatarAuraStyle,
  AvatarConfig,
  AvatarStepsStyle,
  CustomAvatarEffectSpec,
} from '../../types/game'
import {
  AURA_OPTIONS,
  AVATAR_EFFECT_COLOR_PRESETS,
  DEFAULT_AVATAR_EFFECT_COLOR,
  MOTION_OPTIONS,
  STEPS_OPTIONS,
  deleteCustomAvatarEffect,
  drawEffectPresetIcon,
  loadCustomAvatarEffects,
  saveCustomAvatarEffect,
  type ParticleShape,
} from '../../engine/avatarEffects'
import { AvatarEffectCreatorModal } from './AvatarEffectCreatorModal'

interface Props {
  kind: 'aura' | 'steps'
  avatar: AvatarConfig
  onChangeAvatar: (avatar: AvatarConfig) => void
}

const EffectPresetThumbnail: React.FC<{
  shapes: readonly ParticleShape[]
  color?: string
  customMatrix?: readonly string[]
}> = ({ shapes, color, customMatrix }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawEffectPresetIcon(ctx, shapes, color, canvas.width, canvas.height, customMatrix)
  }, [shapes, color, customMatrix])

  if (shapes.length === 0 && (!customMatrix || customMatrix.length === 0)) {
    return (
      <div className="w-11 h-11 rounded-[8px] bg-lira-ground border border-lira-quiet flex items-center justify-center text-lira-muted shrink-0">
        <Ban className="w-4 h-4" />
      </div>
    )
  }

  return (
    <div className="w-11 h-11 rounded-[8px] bg-lira-ground border border-lira-quiet flex items-center justify-center overflow-hidden shrink-0">
      <canvas ref={canvasRef} width={44} height={44} className="w-11 h-11 pixelated" />
    </div>
  )
}

export const AvatarEffectsPanel: React.FC<Props> = ({ kind, avatar, onChangeAvatar }) => {
  const isAura = kind === 'aura'
  const currentConfig = isAura ? avatar.aura : avatar.steps
  const currentStyle = currentConfig?.style ?? 'none'
  const currentCustomId = currentStyle === 'custom' ? currentConfig?.custom?.id : undefined
  const currentColor = currentConfig?.color || currentConfig?.custom?.color || DEFAULT_AVATAR_EFFECT_COLOR
  const options = isAura ? AURA_OPTIONS : STEPS_OPTIONS
  const Icon = isAura ? Sparkles : Footprints

  const [customEffects, setCustomEffects] = useState<CustomAvatarEffectSpec[]>(() =>
    loadCustomAvatarEffects(kind)
  )
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [editingSpec, setEditingSpec] = useState<CustomAvatarEffectSpec | null>(null)

  useEffect(() => {
    setCustomEffects(loadCustomAvatarEffects(kind))
  }, [kind])

  const applyEffect = (next: {
    style: AvatarAuraStyle | AvatarStepsStyle
    color: string
    custom?: CustomAvatarEffectSpec
  }) => {
    if (isAura) {
      onChangeAvatar({
        ...avatar,
        aura: {
          style: next.style as AvatarAuraStyle,
          color: next.color,
          custom: next.custom,
        },
      })
    } else {
      onChangeAvatar({
        ...avatar,
        steps: {
          style: next.style as AvatarStepsStyle,
          color: next.color,
          custom: next.custom,
        },
      })
    }
  }

  const handleSelectPreset = (styleId: string, defaultColor: string) => {
    applyEffect({
      style: styleId as AvatarAuraStyle | AvatarStepsStyle,
      color: styleId === 'none' ? currentColor : defaultColor,
      custom: undefined,
    })
  }

  const handleSelectCustom = (spec: CustomAvatarEffectSpec) => {
    applyEffect({
      style: 'custom',
      color: spec.color,
      custom: spec,
    })
  }

  const handleSelectColor = (hex: string) => {
    if (currentStyle === 'custom' && currentConfig?.custom) {
      const updatedSpec: CustomAvatarEffectSpec = { ...currentConfig.custom, color: hex }
      setCustomEffects(saveCustomAvatarEffect(updatedSpec))
      applyEffect({ style: 'custom', color: hex, custom: updatedSpec })
      return
    }
    applyEffect({
      style: currentStyle,
      color: hex,
      custom: currentConfig?.custom,
    })
  }

  const handleSaveCustom = (spec: CustomAvatarEffectSpec) => {
    setCustomEffects(saveCustomAvatarEffect(spec))
    applyEffect({ style: 'custom', color: spec.color, custom: spec })
    setCreatorOpen(false)
    setEditingSpec(null)
  }

  const handleDeleteCustom = (spec: CustomAvatarEffectSpec) => {
    setCustomEffects(deleteCustomAvatarEffect(spec.id, kind))
    if (currentCustomId === spec.id) {
      applyEffect({ style: 'none', color: currentColor, custom: undefined })
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full font-mono text-lira-ink">
      <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-dashed border-lira-rule/60">
        <div>
          <h3 className="text-sm font-display font-bold text-lira-accent flex items-center gap-2">
            <Icon className="w-4 h-4 text-lira-accent" />
            <span>{isAura ? 'Aura do Avatar' : 'Efeito de Passos'}</span>
          </h3>
          <p className="text-xs font-mono text-lira-muted mt-0.5">
            {isAura
              ? 'Partículas e brilhos ao redor do seu personagem e ao entrar na sala.'
              : 'Rastro em pixel art que surge atrás do personagem enquanto você caminha.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingSpec(null)
            setCreatorOpen(true)
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-lira-accent hover:bg-lira-ink text-lira-ground text-xs font-mono font-extrabold border-2 border-lira-accent hover:border-lira-ink transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{isAura ? 'Criar Aura' : 'Criar Passo'}</span>
        </button>
      </div>

      {customEffects.length > 0 && (
        <div>
          <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-lira-muted mb-2">
            {isAura ? 'Minhas Auras Criadas' : 'Meus Passos Criados'}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {customEffects.map((spec) => {
              const isSelected = currentStyle === 'custom' && currentCustomId === spec.id
              const motionLabel = MOTION_OPTIONS.find((m) => m.id === spec.motion)?.label || spec.motion
              return (
                <div
                  key={spec.id}
                  onClick={() => handleSelectCustom(spec)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleSelectCustom(spec)
                    }
                  }}
                  className={`relative group flex items-center gap-2.5 p-2.5 rounded-[8px] border text-left cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-lira-surface border-lira-accent'
                      : 'bg-lira-sidebar border-lira-quiet hover:bg-lira-surface hover:border-lira-rule'
                  }`}
                >
                  <EffectPresetThumbnail
                    shapes={spec.shapes}
                    color={spec.color}
                    customMatrix={spec.pixelMatrix}
                  />
                  <div className="min-w-0 flex-1 pr-6">
                    <div className="text-xs font-mono font-extrabold text-lira-ink truncate">{spec.name}</div>
                    <div className="text-[11px] font-mono text-lira-muted truncate mt-0.5">
                      {spec.pixelMatrix ? 'Pixel art próprio' : `${spec.shapes.length} forma(s)`} • {motionLabel}
                    </div>
                  </div>

                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingSpec(spec)
                        setCreatorOpen(true)
                      }}
                      title="Editar"
                      aria-label={`Editar ${spec.name}`}
                      className="p-1 rounded-[6px] bg-lira-ground text-lira-muted hover:text-lira-ink border border-lira-quiet hover:border-lira-accent"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteCustom(spec)
                      }}
                      title="Excluir"
                      aria-label={`Excluir ${spec.name}`}
                      className="p-1 rounded-[6px] bg-lira-ground text-lira-muted hover:text-lira-error border border-lira-quiet hover:border-lira-error"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-lira-muted mb-2">
          Modelos prontos
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {options.map((opt) => {
            const isSelected = currentStyle === opt.id
            const iconColor = isSelected ? currentColor : opt.defaultColor
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleSelectPreset(opt.id, opt.defaultColor)}
                aria-pressed={isSelected}
                className={`relative flex items-center gap-2.5 p-2.5 rounded-[8px] border text-left transition-colors ${
                  isSelected
                    ? 'bg-lira-surface border-lira-accent'
                    : 'bg-lira-sidebar border-lira-quiet hover:bg-lira-surface hover:border-lira-rule'
                }`}
              >
                <EffectPresetThumbnail shapes={opt.previewShapes} color={iconColor} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-mono font-extrabold text-lira-ink truncate">{opt.label}</div>
                  <div className="text-[11px] font-mono text-lira-muted leading-snug mt-0.5 line-clamp-2">
                    {opt.description}
                  </div>
                </div>
                {isSelected && (
                  <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-lira-accent text-lira-ground flex items-center justify-center">
                    <Check className="w-2.5 h-2.5" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="bg-lira-surface border border-lira-quiet rounded-[12px] p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-mono font-bold text-lira-ink flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-lira-accent" />
            Cor do efeito
          </span>
          <span className="text-[11px] font-mono text-lira-muted uppercase">{currentColor}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {AVATAR_EFFECT_COLOR_PRESETS.map((preset) => {
            const isActive = currentColor.toLowerCase() === preset.hex.toLowerCase()
            return (
              <button
                key={preset.hex}
                type="button"
                onClick={() => handleSelectColor(preset.hex)}
                title={preset.label}
                aria-label={`Cor ${preset.label}`}
                aria-pressed={isActive}
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                  isActive ? 'border-lira-ink' : 'border-lira-ground'
                }`}
                style={{ backgroundColor: preset.hex }}
              >
                {isActive && <Check className="w-3 h-3 text-white" />}
              </button>
            )
          })}

          <label
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-lira-ground hover:bg-lira-panel border border-lira-rule text-[11px] font-mono font-semibold text-lira-ink cursor-pointer transition-colors"
            title="Escolher cor personalizada"
          >
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(currentColor) ? currentColor : DEFAULT_AVATAR_EFFECT_COLOR}
              onChange={(e) => handleSelectColor(e.target.value)}
              className="w-4 h-4 rounded cursor-pointer bg-transparent border-0 p-0"
              aria-label="Cor personalizada"
            />
            <span>Outra cor</span>
          </label>
        </div>

        {currentStyle === 'none' && (
          <p className="text-[11px] font-mono text-lira-muted mt-2">
            Escolha um modelo acima ou clique em &ldquo;{isAura ? 'Criar Aura' : 'Criar Passo'}&rdquo; para ativar no mapa.
          </p>
        )}
      </div>

      <AvatarEffectCreatorModal
        isOpen={creatorOpen}
        kind={kind}
        initial={editingSpec}
        defaultColor={currentColor}
        onClose={() => {
          setCreatorOpen(false)
          setEditingSpec(null)
        }}
        onSave={handleSaveCustom}
      />
    </div>
  )
}
