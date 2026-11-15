import { useGameStore } from '../../store/useGameStore'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { PeerManager } from '../../p2p/PeerManager'
import { avatarAnimationOptions } from '../../utils/avatarAnimationOptions'
import type { AvatarActivityAnimation } from '../../types/game'

export function playAvatarAnimation(animation: AvatarActivityAnimation | 'none'): boolean {
  const { localPlayer, setLocalPlayer } = useGameStore.getState()
  if (animation !== 'none' && !avatarAnimationOptions(localPlayer.avatar, useCustomAssetsStore.getState().customAssets).some(option => option.id === animation)) return false
  const change = { activityAnimation: animation, activityAnimationStartedAt: animation === 'none' ? 0 : Date.now() }
  setLocalPlayer({ ...change, activityAnimationManual: animation !== 'none' })
  PeerManager.getInstance().sendPlayerUpdate(change)
  return true
}
