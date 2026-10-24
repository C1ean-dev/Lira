import React, { useEffect } from 'react'
import { Heart } from 'lucide-react'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { useBedStore } from '../store/useBedStore'
import { cancelBedInteraction, getLocalBed, handleBedInteractionKey, respondToBedInvitation, startBedInteractionLifecycle } from '../services/bedInteraction'

export function BedInteractionPrompt() {
  const player = useGameStore(state => state.localPlayer)
  const remotes = useGameStore(state => state.remotePlayers)
  const connected = useGameStore(state => state.isConnected)
  useMapStore(state => state.mapData)
  useMapStore(state => state.isEditorOpen)
  useCustomAssetsStore(state => state.customAssets)
  const sessions = useBedStore(state => state.sessions)
  useEffect(startBedInteractionLifecycle, [])
  const bed = getLocalBed()
  if (!bed) return null
  const session = sessions[bed.furniture.id]
  const isTarget = session?.targetId === player.id || (!!player.gameId && session?.targetId === player.gameId)
  const incoming = session?.stage === 'invited' && isTarget
  const active = session?.stage === 'active'
  const inviterPlayer = session && (remotes[session.initiatorId] || Object.values(remotes).find(r => r.gameId === session.initiatorId))
  const inviter = inviterPlayer?.name || 'Seu par'
  const buttonClass = 'rounded-xl px-4 py-2 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 font-semibold'
  return <aside aria-label="Interação da cama" aria-live="polite"
    className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[55] max-w-[calc(100vw-2rem)] rounded-2xl border border-rose-400/30 bg-[#12151d]/95 shadow-xl p-4 text-sm text-slate-100 flex flex-col gap-3">
    <div className="flex items-center gap-2 font-semibold"><Heart className="w-4 h-4 text-rose-400" />Cama do Amor</div>
    {incoming ? <>
      <p>{inviter} convidou você para um momento a dois. A animação só começa se você aceitar.</p>
      <div className="flex gap-2">
        <button type="button" className={buttonClass} onClick={() => respondToBedInvitation(true)}>Aceitar (E)</button>
        <button type="button" className={buttonClass} onClick={() => respondToBedInvitation(false)}>Recusar</button>
      </div>
    </> : active ? <>
      <p>Um momento a dois. Você pode encerrar ou levantar a qualquer momento.</p>
      <button type="button" className={buttonClass} onClick={cancelBedInteraction}>Encerrar (E)</button>
    </> : session ? <>
      <p>Aguardando a resposta do seu par…</p>
      <button type="button" className={buttonClass} onClick={cancelBedInteraction}>Cancelar convite</button>
    </> : <>
      <p>Com os dois sentados, pressione E para convidar seu par para um momento a dois.</p>
      <button type="button" className={buttonClass} disabled={!connected} onClick={handleBedInteractionKey}>Convidar (E)</button>
    </>}
  </aside>
}
