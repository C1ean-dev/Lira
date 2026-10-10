import React, { useRef, useEffect, useState, useCallback } from 'react'

export interface ColorWheelPickerProps {
  color: string
  onChange: (hexColor: string) => void
  onClose?: () => void
  className?: string
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let c = hex.replace('#', '')
  if (c.length === 3) {
    c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]
  }
  const num = parseInt(c, 16)
  if (isNaN(num)) return { h: 0, s: 100, l: 50 }

  const r = ((num >> 16) & 255) / 255
  const g = ((num >> 8) & 255) / 255
  const b = (num & 255) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  }
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }

  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

export const ColorWheelPicker: React.FC<ColorWheelPickerProps> = ({
  color,
  onChange,
  onClose,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDraggingWheel = useRef(false)

  const initialHsl = hexToHsl(color || '#ffffff')
  const [hue, setHue] = useState(initialHsl.h)
  const [saturation, setSaturation] = useState(initialHsl.s)
  const [lightness, setLightness] = useState(initialHsl.l)
  const [hexInput, setHexInput] = useState(color || '#ffffff')

  useEffect(() => {
    const hsl = hexToHsl(color)
    setHue(hsl.h)
    setSaturation(hsl.s)
    setLightness(hsl.l)
    setHexInput(color)
  }, [color])

  const drawWheel = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const size = canvas.width
    const center = size / 2
    const outerRadius = center - 4
    const innerRadius = outerRadius - 22

    ctx.clearRect(0, 0, size, size)

    for (let angle = 0; angle < 360; angle += 1) {
      const startAngle = ((angle - 1) * Math.PI) / 180
      const endAngle = ((angle + 1) * Math.PI) / 180

      ctx.beginPath()
      ctx.arc(center, center, outerRadius, startAngle, endAngle, false)
      ctx.arc(center, center, innerRadius, endAngle, startAngle, true)
      ctx.closePath()

      ctx.fillStyle = `hsl(${angle}, 100%, 50%)`
      ctx.fill()
    }

    ctx.beginPath()
    ctx.arc(center, center, innerRadius - 8, 0, Math.PI * 2)
    ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.stroke()

    const rad = (hue * Math.PI) / 180
    const ringMidRadius = (outerRadius + innerRadius) / 2
    const indicatorX = center + ringMidRadius * Math.cos(rad)
    const indicatorY = center + ringMidRadius * Math.sin(rad)

    ctx.beginPath()
    ctx.arc(indicatorX, indicatorY, 6, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 2
    ctx.stroke()
  }, [hue, saturation, lightness])

  useEffect(() => {
    drawWheel()
  }, [drawWheel])

  const handleWheelInteraction = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = clientX - (rect.left + rect.width / 2)
    const y = clientY - (rect.top + rect.height / 2)

    let angle = Math.atan2(y, x) * (180 / Math.PI)
    if (angle < 0) angle += 360
    const newHue = Math.round(angle)

    setHue(newHue)
    const newHex = hslToHex(newHue, saturation, lightness)
    setHexInput(newHex)
    onChange(newHex)
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingWheel.current = true
    handleWheelInteraction(e.clientX, e.clientY)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingWheel.current) return
    handleWheelInteraction(e.clientX, e.clientY)
  }

  const handleMouseUp = () => {
    isDraggingWheel.current = false
  }

  useEffect(() => {
    const onGlobalMouseUp = () => {
      isDraggingWheel.current = false
    }
    window.addEventListener('mouseup', onGlobalMouseUp)
    return () => window.removeEventListener('mouseup', onGlobalMouseUp)
  }, [])

  const handleSaturationChange = (val: number) => {
    setSaturation(val)
    const newHex = hslToHex(hue, val, lightness)
    setHexInput(newHex)
    onChange(newHex)
  }

  const handleLightnessChange = (val: number) => {
    setLightness(val)
    const newHex = hslToHex(hue, saturation, val)
    setHexInput(newHex)
    onChange(newHex)
  }

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setHexInput(val)
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      onChange(val)
      const hsl = hexToHsl(val)
      setHue(hsl.h)
      setSaturation(hsl.s)
      setLightness(hsl.l)
    }
  }

  return (
    <div
      className={`bg-[#1e1f22] border border-[#383a40] rounded-2xl p-4 shadow-2xl flex flex-col items-center gap-3 w-64 select-none ${className}`}
    >
      <div className="flex items-center justify-between w-full">
        <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
          <span>🎨</span> Roda de Cores
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5 rounded-md hover:bg-[#2b2d31] transition-colors cursor-pointer"
          >
            ✕
          </button>
        )}
      </div>

      <div className="relative cursor-pointer">
        <canvas
          ref={canvasRef}
          width={180}
          height={180}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="rounded-full touch-none shadow-md"
        />
      </div>

      <div className="w-full flex flex-col gap-2.5">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>Saturação</span>
            <span className="font-mono text-slate-300">{saturation}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={saturation}
            onChange={(e) => handleSaturationChange(parseInt(e.target.value))}
            className="w-full h-1.5 bg-[#2b2d31] rounded-lg appearance-none cursor-pointer accent-[#3b82f6]"
            style={{
              background: `linear-gradient(to right, hsl(${hue}, 0%, ${lightness}%), hsl(${hue}, 100%, ${lightness}%))`,
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>Brilho / Luz</span>
            <span className="font-mono text-slate-300">{lightness}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={lightness}
            onChange={(e) => handleLightnessChange(parseInt(e.target.value))}
            className="w-full h-1.5 bg-[#2b2d31] rounded-lg appearance-none cursor-pointer accent-[#3b82f6]"
            style={{
              background: `linear-gradient(to right, #000000, hsl(${hue}, ${saturation}%, 50%), #ffffff)`,
            }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 w-full pt-2 border-t border-[#383a40]/60">
        <div
          className="w-8 h-8 rounded-lg border border-white/20 shadow-inner shrink-0"
          style={{ backgroundColor: hexInput }}
        />
        <input
          type="text"
          value={hexInput}
          onChange={handleHexChange}
          placeholder="#ffffff"
          className="flex-1 bg-[#141517] border border-[#383a40] focus:border-[#3b82f6] rounded-lg px-2.5 py-1 text-xs text-white font-mono uppercase outline-none"
        />
      </div>
    </div>
  )
}
