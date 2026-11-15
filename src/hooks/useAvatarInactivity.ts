import { useEffect } from 'react'
import { AvatarInactivity } from '../engine/avatar/avatarInactivity'
import { useGameStore } from '../store/useGameStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { PeerManager } from '../p2p/PeerManager'
import { avatarActivityAsset, avatarAnimationOptions } from '../utils/avatarAnimationOptions'
import { activitySequence } from '../utils/avatarActivityAnimations'

export function useAvatarInactivity() {
  useEffect(() => {
    const inactivity = new AvatarInactivity(Date.now())
    const update = () => {
      const { localPlayer, setLocalPlayer } = useGameStore.getState()
      const assets = useCustomAssetsStore.getState().customAssets
      if (localPlayer.activityAnimationManual) {
        if (!localPlayer.isMoving && avatarAnimationOptions(localPlayer.avatar, assets).some(option => option.id === localPlayer.activityAnimation)) return
        // Walking or changing to a character without this sequence ends the choice.
        inactivity.interact(Date.now())
        setLocalPlayer({ activityAnimationManual: false })
      }
      const asset = avatarActivityAsset(localPlayer.avatar, assets)
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
        useGameStore.getState().setLocalPlayer({ ...change, activityAnimationManual: false })
        PeerManager.getInstance().sendPlayerUpdate(change)
      }
    }
  }, [])
}
