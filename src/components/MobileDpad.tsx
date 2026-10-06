import React, { useRef, useState, useEffect } from 'react'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { CanvasEngine } from '../engine/CanvasEngine'

interface MobileDpadProps {
  engineRef: React.MutableRefObject<CanvasEngine | null>
}

export const MobileDpad: React.FC<MobileDpadProps> = ({ engineRef }) => {
  const [activeDirections, setActiveDirections] = useState<Set<string>>(new Set())
  const activeKeysRef = useRef<Set<string>>(new Set())

  const setDir = (key: string, pressed: boolean) => {
    const engine = engineRef.current
    if (!engine) return

    if (pressed) {
      activeKeysRef.current.add(key)
      engine.input.simulateKey(key, true)
    } else {
      activeKeysRef.current.delete(key)
      engine.input.simulateKey(key, false)
    }
    setActiveDirections(new Set(activeKeysRef.current))
  }

  const releaseAll = () => {
    const engine = engineRef.current
    if (!engine) return
    activeKeysRef.current.forEach((k) => engine.input.simulateKey(k, false))
    activeKeysRef.current.clear()
    setActiveDirections(new Set())
  }

  useEffect(() => {
    return () => {
      releaseAll()
    }
  }, [])

  const handleTouchStart = (key: string) => (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    setDir(key, true)
  }

  const handleTouchEnd = (key: string) => (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    setDir(key, false)
  }

  const isPressed = (key: string) => activeDirections.has(key)

  return (
    <div
      className="relative w-36 h-36 select-none touch-none pointer-events-auto"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Background circle / cross */}
      <div className="absolute inset-0 rounded-full bg-slate-900/60 backdrop-blur-md border border-slate-700/60 shadow-xl" />

      {/* Center decor circle */}
      <div className="absolute inset-[38%] rounded-full bg-slate-800/80 border border-slate-600/50 flex items-center justify-center pointer-events-none">
        <div className="w-2.5 h-2.5 rounded-full bg-indigo-400/80 shadow-sm shadow-indigo-400" />
      </div>

      {/* Up Button */}
      <button
        type="button"
        onTouchStart={handleTouchStart('w')}
        onTouchEnd={handleTouchEnd('w')}
        onTouchCancel={handleTouchEnd('w')}
        onMouseDown={handleTouchStart('w')}
        onMouseUp={handleTouchEnd('w')}
        onMouseLeave={handleTouchEnd('w')}
        className={`absolute top-1 left-1/2 -translate-x-1/2 w-12 h-12 rounded-t-2xl flex items-start justify-center pt-1.5 transition-colors active:scale-95 ${
          isPressed('w')
            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/50'
            : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
        }`}
        aria-label="Mover para cima"
      >
        <ChevronUp className="w-6 h-6" />
      </button>

      {/* Down Button */}
      <button
        type="button"
        onTouchStart={handleTouchStart('s')}
        onTouchEnd={handleTouchEnd('s')}
        onTouchCancel={handleTouchEnd('s')}
        onMouseDown={handleTouchStart('s')}
        onMouseUp={handleTouchEnd('s')}
        onMouseLeave={handleTouchEnd('s')}
        className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-12 h-12 rounded-b-2xl flex items-end justify-center pb-1.5 transition-colors active:scale-95 ${
          isPressed('s')
            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/50'
            : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
        }`}
        aria-label="Mover para baixo"
      >
        <ChevronDown className="w-6 h-6" />
      </button>

      {/* Left Button */}
      <button
        type="button"
        onTouchStart={handleTouchStart('a')}
        onTouchEnd={handleTouchEnd('a')}
        onTouchCancel={handleTouchEnd('a')}
        onMouseDown={handleTouchStart('a')}
        onMouseUp={handleTouchEnd('a')}
        onMouseLeave={handleTouchEnd('a')}
        className={`absolute left-1 top-1/2 -translate-y-1/2 w-12 h-12 rounded-l-2xl flex items-center justify-start pl-1.5 transition-colors active:scale-95 ${
          isPressed('a')
            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/50'
            : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
        }`}
        aria-label="Mover para a esquerda"
      >
        <ChevronLeft className="w-6 h-6" />
      </button>

      {/* Right Button */}
      <button
        type="button"
        onTouchStart={handleTouchStart('d')}
        onTouchEnd={handleTouchEnd('d')}
        onTouchCancel={handleTouchEnd('d')}
        onMouseDown={handleTouchStart('d')}
        onMouseUp={handleTouchEnd('d')}
        onMouseLeave={handleTouchEnd('d')}
        className={`absolute right-1 top-1/2 -translate-y-1/2 w-12 h-12 rounded-r-2xl flex items-center justify-end pr-1.5 transition-colors active:scale-95 ${
          isPressed('d')
            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/50'
            : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
        }`}
        aria-label="Mover para a direita"
      >
        <ChevronRight className="w-6 h-6" />
      </button>
    </div>
  )
}
