import React, { useState, useRef, useEffect } from 'react'
import {
  Plus,
  Minus,
  Maximize2,
  Map,
  Layers,
  Gamepad2,
  Check,
  Zap,
  Sparkles,
  Laptop,
  LocateFixed,
  Sun,
  Moon,
  Sunset,
  Clock,
} from 'lucide-react'
import { useGameStore } from '../store/useGameStore'
import { useSettingsStore, type LightingMode } from '../store/useSettingsStore'

interface MapControlsWidgetProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onFitScreen: () => void
  onRecenter?: () => void
  isPanned?: boolean
  isMobile?: boolean
}

export const MapControlsWidget: React.FC<MapControlsWidgetProps> = ({
  onZoomIn,
  onZoomOut,
  onFitScreen,
  onRecenter,
  isPanned,
  isMobile,
}) => {
  const mapViewMode = useGameStore((s) => s.mapViewMode)
  const setMapViewMode = useGameStore((s) => s.setMapViewMode)
  const lightingEnabled = useSettingsStore((s) => s.lightingEnabled)
  const lightingMode = useSettingsStore((s) => s.lightingMode)
  const setLightingEnabled = useSettingsStore((s) => s.setLightingEnabled)
  const setLightingMode = useSettingsStore((s) => s.setLightingMode)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const cycleLightingMode = () => {
    const order: LightingMode[] = ['day', 'sunset', 'night', 'auto']
    const next = order[(order.indexOf(lightingMode) + 1) % order.length]
    setLightingMode(next)
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false)
      }
    }
    if (isMenuOpen) {
      window.addEventListener('mousedown', handleClickOutside)
    }
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [isMenuOpen])

  return (
    <div ref={menuRef} className="relative select-none pointer-events-auto font-mono">
      {isMenuOpen && (
        <div className="absolute bottom-14 right-0 w-72 bg-lira-panel border border-dashed border-lira-rule rounded-[12px] p-3 space-y-2 z-50">
          <div className="flex items-center justify-between px-1 pb-2 border-b border-dashed border-lira-rule/60">
            <div className="flex items-center gap-1.5 font-display text-sm font-bold text-lira-accent">
              <Map className="w-3.5 h-3.5 text-lira-accent" />
              <span>Modo de Visualização</span>
            </div>
            <span className="text-[10px] font-mono text-lira-muted font-medium">Layout</span>
          </div>

          <div className="space-y-1.5">
            <button
              onClick={() => {
                setMapViewMode('immersive')
                setIsMenuOpen(false)
              }}
              className={`w-full p-2.5 rounded-[8px] border text-left transition-colors flex items-start justify-between gap-2.5 ${
                mapViewMode === 'immersive'
                  ? 'bg-lira-surface border-lira-accent text-lira-ink'
                  : 'bg-lira-ground hover:bg-lira-surface border-lira-quiet text-lira-muted hover:text-lira-ink'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={`p-2 rounded-[6px] border ${
                    mapViewMode === 'immersive'
                      ? 'bg-lira-accent text-lira-ground border-lira-accent'
                      : 'bg-lira-panel text-lira-muted border-lira-quiet'
                  }`}
                >
                  <Gamepad2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-lira-ink flex items-center gap-1.5">
                    <span>Imersivo</span>
                    <span className="text-[9px] bg-lira-surface text-lira-accent border border-lira-rule px-1.5 py-0.2 rounded-[4px] font-semibold">
                      Pixel Art
                    </span>
                  </div>
                  <p className="text-[10px] text-lira-muted mt-0.5 leading-tight">
                    Móveis, avatares pixelados, animações e mapa decorado completo.
                  </p>
                </div>
              </div>
              {mapViewMode === 'immersive' && (
                <Check className="w-4 h-4 text-lira-accent shrink-0 mt-0.5" />
              )}
            </button>

            <button
              onClick={() => {
                setMapViewMode('simplified', true)
                setIsMenuOpen(false)
              }}
              className={`w-full p-2.5 rounded-[8px] border text-left transition-colors flex items-start justify-between gap-2.5 ${
                mapViewMode === 'simplified'
                  ? 'bg-lira-surface border-lira-online text-lira-ink'
                  : 'bg-lira-ground hover:bg-lira-surface border-lira-quiet text-lira-muted hover:text-lira-ink'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={`p-2 rounded-[6px] border ${
                    mapViewMode === 'simplified'
                      ? 'bg-lira-online text-lira-ground border-lira-online'
                      : 'bg-lira-panel text-lira-muted border-lira-quiet'
                  }`}
                >
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-lira-ink flex items-center gap-1.5">
                    <span>Simplificado</span>
                    <span className="text-[9px] bg-lira-online/15 text-lira-online border border-lira-online/40 px-1.5 py-0.2 rounded-[4px] font-semibold">
                      Leve
                    </span>
                  </div>
                  <p className="text-[10px] text-lira-muted mt-0.5 leading-tight">
                    Visão esquemática das salas. Ideal para computadores mais simples.
                  </p>
                </div>
              </div>
              {mapViewMode === 'simplified' && (
                <Check className="w-4 h-4 text-lira-online shrink-0 mt-0.5" />
              )}
            </button>
          </div>

          <div className="pt-2 border-t border-dashed border-lira-rule/60 space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-bold text-lira-ink flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-lira-amber" />
                <span>Iluminação 2D (PixiJS)</span>
              </span>
              <button
                type="button"
                onClick={() => setLightingEnabled(!lightingEnabled)}
                className={`px-2 py-0.5 rounded-[5px] text-[10px] font-bold border transition-colors ${
                  lightingEnabled
                    ? 'bg-lira-online/15 text-lira-online border-lira-online/40'
                    : 'bg-lira-ground text-lira-muted border-lira-quiet'
                }`}
              >
                {lightingEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: 'day', label: 'Dia', icon: Sun },
                  { id: 'sunset', label: 'Pôr do Sol', icon: Sunset },
                  { id: 'night', label: 'Noite', icon: Moon },
                  { id: 'auto', label: 'Ciclo Auto', icon: Clock },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    if (!lightingEnabled) setLightingEnabled(true)
                    setLightingMode(id)
                  }}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-[6px] border text-[10px] font-bold transition-colors ${
                    lightingEnabled && lightingMode === id
                      ? 'bg-lira-surface border-lira-accent text-lira-ink'
                      : 'bg-lira-ground border-lira-quiet text-lira-muted hover:text-lira-ink'
                  }`}
                >
                  <Icon className="w-3 h-3 text-lira-amber shrink-0" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="bg-lira-panel border border-lira-quiet rounded-[12px] p-1.5 flex items-center gap-1.5 text-xs text-lira-ink">
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border text-xs font-bold transition-colors ${
            mapViewMode === 'simplified'
              ? 'bg-lira-online/15 text-lira-online border-lira-online/40 hover:border-lira-online'
              : 'bg-lira-surface text-lira-accent border-lira-rule hover:border-lira-accent hover:text-lira-ink'
          }`}
          title="Alternar entre Modo Imersivo e Simplificado"
        >
          {mapViewMode === 'simplified' ? (
            <>
              <Layers className="w-3.5 h-3.5 text-lira-online" />
              <span>Simplificado</span>
            </>
          ) : (
            <>
              <Map className="w-3.5 h-3.5 text-lira-accent" />
              <span>Mapa</span>
            </>
          )}
        </button>

        <div className="h-4 w-px border-l border-dashed border-lira-rule/60" />

        {mapViewMode !== 'simplified' && (
          <>
            <button
              type="button"
              onClick={cycleLightingMode}
              className="p-1.5 rounded-[6px] hover:bg-lira-surface text-lira-amber hover:text-lira-ink transition-colors"
              title={`Iluminação 2D: ${lightingEnabled ? lightingMode : 'desligada'} (clique para alternar)`}
            >
              {lightingMode === 'night' ? (
                <Moon className="w-3.5 h-3.5" />
              ) : lightingMode === 'sunset' ? (
                <Sunset className="w-3.5 h-3.5" />
              ) : lightingMode === 'auto' ? (
                <Clock className="w-3.5 h-3.5" />
              ) : (
                <Sun className="w-3.5 h-3.5" />
              )}
            </button>
            <div className="h-4 w-px border-l border-dashed border-lira-rule/60" />
          </>
        )}

        <div className="flex items-center gap-0.5">
          <button
            onClick={onZoomIn}
            className="p-1.5 rounded-[6px] hover:bg-lira-surface text-lira-muted hover:text-lira-ink transition-colors"
            title="Aumentar Zoom (+)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onZoomOut}
            className="p-1.5 rounded-[6px] hover:bg-lira-surface text-lira-muted hover:text-lira-ink transition-colors"
            title="Diminuir Zoom (-)"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onFitScreen}
            className="p-1.5 rounded-[6px] hover:bg-lira-surface text-lira-accent hover:text-lira-ink transition-colors"
            title="Enquadrar Mapa na Tela"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {isPanned && onRecenter && (
          <>
            <div className="h-4 w-px border-l border-dashed border-lira-rule/60" />
            <button
              onClick={onRecenter}
              className="p-1.5 rounded-[6px] bg-lira-accent text-lira-ground hover:bg-lira-ink transition-colors"
              title="Recentralizar no Jogador"
            >
              <LocateFixed className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
