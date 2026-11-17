import React, { useEffect, useState } from 'react'
import { LOCAL_BOARD_POINTER, POINTER_TRAIL_MS, pointerTrail, useBoardPointerStore } from '../../store/useBoardPointerStore'

export function BoardPointerOverlay({ zoom }: { zoom: number }) {
  const pointers = useBoardPointerStore(s => s.pointers)
  const [now, setNow] = useState(Date.now())
  const time = Math.max(now, Date.now())
  const animate = Object.values(pointers).some(p => time - p.updated < POINTER_TRAIL_MS && p.points.length)
  useEffect(() => {
    if (!animate) return
    const timer = setInterval(() => setNow(Date.now()), 30)
    return () => clearInterval(timer)
  }, [animate])
  return <g className="board-pointer-overlay" pointerEvents="none" aria-hidden="true">
    {Object.entries(pointers).map(([actor, pointer]) => {
      const points = pointerTrail(pointer, time), last = pointer.points.at(-1)
      if (!last || (!points.length && pointer.kind === 'laser')) return null
      const eraser = pointer.kind === 'eraser', color = eraser ? '#a78bfa' : '#ff4b55'
      const opacity = eraser ? 1 : Math.max(0, 1 - (time - last.at) / POINTER_TRAIL_MS)
      return <g key={actor} data-pointer-kind={pointer.kind}>
        {points.map((point, i) => i > 0 && <line key={`${point.at}:${i}`} x1={points[i - 1].x} y1={points[i - 1].y} x2={point.x} y2={point.y}
          stroke={color} strokeWidth={(eraser ? 7 : 4) / zoom} strokeLinecap="round" opacity={Math.max(0, 1 - (time - point.at) / POINTER_TRAIL_MS) * (eraser ? .35 : .8)} />)}
        <circle className={eraser ? 'board-eraser-cursor' : 'board-laser-cursor'} cx={last.x} cy={last.y} r={(eraser ? 10 : 4) / zoom}
          fill={eraser ? '#a78bfa22' : '#ff4b55'} stroke={eraser ? '#a78bfa' : '#fff'} strokeWidth={1.5 / zoom} opacity={opacity} />
        {actor !== LOCAL_BOARD_POINTER && pointer.name && <text x={last.x + 12 / zoom} y={last.y - 12 / zoom} fontSize={11 / zoom} fill={color} opacity={opacity}>{pointer.name}</text>}
      </g>
    })}
  </g>
}
