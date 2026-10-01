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
} from 'lucide-react'
import { useGameStore } from '../store/useGameStore'

interface MapControlsWidgetProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onFitScreen: () => void
}

export const MapControlsWidget: React.FC<MapControlsWidgetProps> = ({
  onZoomIn,
  onZoomOut,
  onFitScreen,
}) => {
  const { mapViewMode, setMapViewMode } = useGameStore()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Close menu on click outside
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
    <div ref={menuRef} className="relative select-none pointer-events-auto">
      {/* Modes Dropdown Popover */}
      {isMenuOpen && (
        <div className="absolute bottom-14 right-0 w-72 bg-[#121622]/95 backdrop-blur-md border border-[#2a354a] rounded-2xl p-3 shadow-2xl space-y-2 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between px-1 pb-1.5 border-b border-[#202838]">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
              <Map className="w-3.5 h-3.5 text-indigo-400" />
              <span>Modo de Visualização</span>
            </div>
            <span className="text-[10px] text-slate-400 font-medium">Layout</span>
          </div>

          <div className="space-y-1.5">
            {/* Option 1: Immersive Pixel Art */}
            <button
              onClick={() => {
                setMapViewMode('immersive')
                setIsMenuOpen(false)
              }}
              className={`w-full p-2.5 rounded-xl border text-left transition-all flex items-start justify-between gap-2.5 ${
                mapViewMode === 'immersive'
                  ? 'bg-indigo-600/20 border-indigo-500/50 text-white shadow-sm'
                  : 'bg-[#181e2e]/60 hover:bg-[#181e2e] border-transparent text-slate-300'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={`p-2 rounded-lg border ${
                    mapViewMode === 'immersive'
                      ? 'bg-indigo-600 text-white border-indigo-400/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  <Gamepad2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                    <span>Imersivo</span>
                    <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.2 rounded font-semibold">
                      Pixel Art
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                    Móveis, avatares pixelados, animações e mapa decorado completo.
                  </p>
                </div>
              </div>
              {mapViewMode === 'immersive' && (
                <Check className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              )}
            </button>

            {/* Option 2: Simplified Vector Map */}
            <button
              onClick={() => {
                setMapViewMode('simplified', true)
                setIsMenuOpen(false)
              }}
              className={`w-full p-2.5 rounded-xl border text-left transition-all flex items-start justify-between gap-2.5 ${
                mapViewMode === 'simplified'
                  ? 'bg-emerald-600/20 border-emerald-500/50 text-white shadow-sm'
                  : 'bg-[#181e2e]/60 hover:bg-[#181e2e] border-transparent text-slate-300'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={`p-2 rounded-lg border ${
                    mapViewMode === 'simplified'
                      ? 'bg-emerald-600 text-white border-emerald-400/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                    <span>Simplificado</span>
                    <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded font-semibold">
                      Leve
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                    Visão esquemática das salas. Ideal para computadores mais simples.
                  </p>
                </div>
              </div>
              {mapViewMode === 'simplified' && (
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Main Small Floating Dock (Bottom-Right) */}
      <div className="bg-[#1b202c]/90 backdrop-blur-md border border-[#2a3142] rounded-2xl p-1.5 shadow-xl flex items-center gap-1.5 text-xs text-slate-300">
        {/* Map Mode Selector Toggle Button */}
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all ${
            mapViewMode === 'simplified'
              ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-600/30'
              : 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40 hover:bg-indigo-600/30'
          }`}
          title="Alternar entre Modo Imersivo e Simplificado"
        >
          {mapViewMode === 'simplified' ? (
            <>
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              <span>Simplificado</span>
            </>
          ) : (
            <>
              <Map className="w-3.5 h-3.5 text-indigo-400" />
              <span>Mapa</span>
            </>
          )}
        </button>

        <div className="h-4 w-px bg-slate-700" />

        {/* Zoom Controls */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={onZoomIn}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Aumentar Zoom (+)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onZoomOut}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Diminuir Zoom (-)"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onFitScreen}
            className="p-1.5 rounded-lg hover:bg-indigo-600/30 text-indigo-400 hover:text-indigo-200 transition-colors"
            title="Enquadrar Mapa na Tela"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
