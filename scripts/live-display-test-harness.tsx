import React, { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { FullScreenLiveOverlay } from '../src/components/grid/FullScreenLiveOverlay'
import { GridParticipantTile, type ParticipantData } from '../src/components/grid/GridParticipantTile'
import { useLiveViewBox } from '../src/hooks/useLiveViewBox'
import '../src/index.css'

const container = document.createElement('div')
document.body.append(container)
const root = createRoot(container)

function MiniDisplay({ user }: { user: ParticipantData }) {
  const video = useRef<HTMLVideoElement>(null)
  useLiveViewBox(user.id, video, 'contain', true)
  useEffect(() => {
    const element = video.current!
    element.srcObject = user.screenStream || user.stream
    void element.play().catch(() => {})
    return () => { element.srcObject = null }
  }, [user.screenStream, user.stream])
  return <video ref={video} style={{ width: 160, height: 90 }} muted
    onLoadedMetadata={() => { void video.current?.play() }} />
}

export function showLive(mode: 'presentation' | 'full' | 'mini', user: ParticipantData) {
  root.render(<>
    {mode === 'mini' ? <MiniDisplay user={user} />
      : <div style={{ width: 960, height: 540 }}><GridParticipantTile user={user} mediaKind="live" /></div>}
    {mode === 'full' && <FullScreenLiveOverlay user={user} onClose={() => showLive('presentation', user)} />}
  </>)
}

export function dispose() { root.unmount(); container.remove() }
