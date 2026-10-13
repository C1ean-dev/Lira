import React, { useEffect, useRef } from 'react'

// Keep the media subtree mounted and laid out while hiding only its visible area.
export const CallPanelBody: React.FC<React.PropsWithChildren<{ collapsed: boolean }>> = ({ collapsed, children }) => {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current) ref.current.inert = collapsed }, [collapsed])
  return <div ref={ref} aria-hidden={collapsed}
    style={collapsed ? { height: 0, overflow: 'hidden', pointerEvents: 'none' } : undefined}>
    {children}
  </div>
}
