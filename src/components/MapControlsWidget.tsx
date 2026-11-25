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
} from 'lucide-react'
import { useGameStore } from '../store/useGameStore'

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
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

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
