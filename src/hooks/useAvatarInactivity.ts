import { useEffect } from 'react'
import { AvatarInactivity } from '../engine/avatar/avatarInactivity'
import { useGameStore } from '../store/useGameStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { PeerManager } from '../p2p/PeerManager'
import { activitySequence } from '../utils/avatarActivityAnimations'

export function useAvatarInactivity() {
  useEffect(() => {
    const inactivity = new AvatarInactivity(Date.now())
    const update = () => {
      const { localPlayer, setLocalPlayer } = useGameStore.getState()
      const component = localPlayer.avatar.customComponents?.other || localPlayer.avatar.customAvatarId || localPlayer.avatar.otherType
      const asset = useCustomAssetsStore.getState().customAssets.find(a => a.id === component)
      const length = activitySequence(asset?.activityAnimations?.yawn).length
      const next = inactivity.update(Date.now(), localPlayer.isMoving, Math.max(2000, length * (asset?.frameRateMs || 160)))
      if ((localPlayer.activityAnimation || 'none') === next.animation && (localPlayer.activityAnimationStartedAt || 0) === next.startedAt) return
      const change = { activityAnimation: next.animation, activityAnimationStartedAt: next.startedAt }
      setLocalPlayer(change)
      PeerManager.getInstance().sendPlayerUpdate(change)
    }
    const interact = () => { inactivity.interact(Date.now()); update() }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'input'] as const
    for (const event of events) window.addEventListener(event, interact, { capture: true, passive: true })
    const unsubscribe = useGameStore.subscribe((state, previous) => {
      if (state.localPlayer.isMoving && (state.localPlayer.x !== previous.localPlayer.x || state.localPlayer.y !== previous.localPlayer.y || !previous.localPlayer.isMoving)) interact()
    })
    update()
    const timer = setInterval(update, 250)
    return () => {
      clearInterval(timer)
      unsubscribe()
      for (const event of events) window.removeEventListener(event, interact, true)
      const player = useGameStore.getState().localPlayer
      if (player.activityAnimation && player.activityAnimation !== 'none') {
        const change = { activityAnimation: 'none' as const, activityAnimationStartedAt: 0 }
        useGameStore.getState().setLocalPlayer(change)
        PeerManager.getInstance().sendPlayerUpdate(change)
      }
    }
  }, [])
}
