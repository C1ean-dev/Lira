import React, { useCallback, useEffect, useRef, useState } from 'react'
import { PeerManager } from '../../p2p/PeerManager'
import { MediaManager } from '../../media/MediaManager'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'
import { decodeLanInvite, isGlobalIpv6InviteAddress } from '../../p2p/directInvite'

interface Props {
  role: 'host' | 'guest'
  invite?: string
  guestName?: string
  onJoined?: () => void
  beginJoin?: () => boolean
  endJoin?: () => void
}
const fieldClass = 'block w-full min-h-16 resize-y rounded-xl border border-slate-600 bg-[#12151d] p-3 font-mono text-xs text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300'
const buttonClass = 'min-h-10 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white enabled:hover:bg-indigo-500 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300'

export function DirectConnectionPanel({ role, invite, guestName, onJoined, beginJoin, endJoin }: Props) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedbackTarget, setFeedbackTarget] = useState('')
  const [lan, setLan] = useState<string[]>([])
  const alive = useRef(true)
  const joining = useRef(false)
  const attemptedInvite = useRef('')
  const guestHasName = useGameStore(state => role === 'guest' && !!(guestName ?? state.localPlayer.name).trim())
  const manager = PeerManager.getInstance()
  const canHostLan = role === 'host' && typeof window !== 'undefined' && !!window.electronAPI?.getSignalingConfig
  const finishJoin = useCallback(() => {
    if (!joining.current) return
    joining.current = false
    endJoin?.()
  }, [endJoin])

  useEffect(() => {
    alive.current = true
    if (role === 'host') manager.getLanInvites().then(value => { if (alive.current) setLan(value) }).catch(() => {})
    return () => {
      alive.current = false
      if (role === 'host') manager.cancelDirectInvite()
      else if (joining.current) {
        manager.disconnect()
        finishJoin()
      }
    }
  }, [role, manager, finishJoin])

  const perform = useCallback(async (target: string, action: () => Promise<void>) => {
    setFeedbackTarget(target)
    setBusy(true)
    setError('')
    setStatus('')
    try { await action() }
    catch (error) { if (alive.current) setError(error instanceof Error ? error.message : 'Não foi possível conectar. Tente um novo convite.') }
    finally { if (alive.current) setBusy(false) }
  }, [])
  const generate = () => perform('invite', async () => {
    const invite = await manager.createDirectInvite()
    if (!alive.current) { manager.cancelDirectInvite(); return }
    setOutput(invite)
    setStatus('Convite pronto. Copie e envie o texto completo ao jogador.')
  })
  const expire = () => perform('invite', async () => {
    const expired = manager.expirePendingDirectInvites()
    setOutput('')
    setInput('')
    setStatus(expired ? 'Convites diretos pendentes expirados.' : 'Nenhum convite direto pendente.')
  })
  const answer = useCallback(async (code: string) => {
    if (joining.current || attemptedInvite.current === code) return
    const player = useGameStore.getState().localPlayer
    const name = (guestName ?? player.name).trim()
    if (!name || (beginJoin && !beginJoin())) return
    attemptedInvite.current = code
    joining.current = true
    await perform('response', async () => {
      useMediaStore.getState().setMuted(true)
      useMediaStore.getState().setCameraOff(true)
      try {
        useGameStore.getState().setLocalPlayer({ name })
        const result = await manager.prepareDirectJoin(code, { ...player, name, isMuted: true, isCameraOff: true })
        if (!alive.current) return
        setOutput(result.answer)
        setStatus('Envie esta resposta ao anfitrião e mantenha esta tela aberta até conectar.')
        void result.connected.then(async () => {
          if (!alive.current) return
          await MediaManager.getInstance().startMedia(false, true)
          finishJoin()
          if (alive.current) onJoined?.()
        }).catch(error => {
          if (alive.current) { setError(error.message); setStatus(''); setOutput('') }
          finishJoin()
        })
      } catch (error) { finishJoin(); throw error }
    })
  }, [beginJoin, finishJoin, guestName, manager, onJoined, perform])

  const guestInvite = role === 'guest' ? (invite ?? input).trim() : ''
  useEffect(() => {
    if (!guestInvite || !guestHasName) return
    const timer = setTimeout(() => { void answer(guestInvite) }, 200)
    return () => clearTimeout(timer)
  }, [answer, guestHasName, guestInvite])
  const accept = () => perform('response', async () => {
    await manager.acceptDirectAnswer(input.trim())
    setStatus('Resposta recebida. Tentando conectar pelas rotas disponíveis…')
  })
  const enableLan = () => perform('lan', async () => {
    const invites = await manager.enableLanHosting()
    if (alive.current) setLan(invites)
  })
  const copy = (text: string, target: string) => perform(target, async () => {
    await navigator.clipboard.writeText(text)
    setStatus(role === 'host' ? 'Convite copiado. Envie ao jogador.' : 'Resposta copiada. Envie ao anfitrião e mantenha esta tela aberta.')
  })

  const feedback = (target: string) => feedbackTarget === target && (
    error ? <p role="alert" className="text-sm text-rose-300">{error}</p> :
    (busy || status) && <p role="status" className="text-sm text-indigo-300">{busy ? 'Preparando conexão…' : status}</p>
  )

  const outputField = output && (
    <div className="space-y-2">
      <button type="button" className={buttonClass} disabled={busy} onClick={() => copy(output, role === 'host' ? 'invite' : 'response')}>
        Copiar {role === 'host' ? 'convite' : 'resposta'}
      </button>
      {role === 'host' && <textarea aria-label="Convite direto gerado" className={fieldClass} readOnly value={output} />}
    </div>
  )

  const lanInvites = lan.map(invite => {
    const { host, port } = decodeLanInvite(invite)
    const ipv6 = host.startsWith('[')
    const globalIpv6 = isGlobalIpv6InviteAddress(host)
    return { invite, host, port, ipv6, globalIpv6 }
  }).sort((a, b) => Number(b.globalIpv6) - Number(a.globalIpv6) || Number(b.ipv6) - Number(a.ipv6))
  const hasGlobalIpv6 = lanInvites.some(invite => invite.globalIpv6)
  const hasLocalIpv6 = lanInvites.some(invite => invite.ipv6)

  return <section className="space-y-4 text-sm text-slate-300" aria-label="Conexão sem servidor de sinalização">
    {role === 'host' && <div className="space-y-2">
      <h3 className="font-semibold text-slate-100">1. Envie um convite</h3>
      <p>Gere um convite para um jogador. Ele vale por 10 minutos. Mantenha esta janela aberta até conectar.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={busy} onClick={generate}>Gerar convite direto</button>
        <button type="button" disabled={busy} onClick={expire}
          className="min-h-10 rounded-xl border border-slate-600 px-2 py-2 text-xs font-semibold text-slate-200 enabled:hover:bg-slate-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 sm:px-3 sm:text-sm">
          Expirar convites diretos
        </button>
      </div>
      {feedback('invite')}
      {outputField}
    </div>}
    <div className={role === 'host' ? 'space-y-2 border-t border-slate-700 pt-4' : 'space-y-2'}>
      {role === 'host' ? <h3 className="font-semibold text-slate-100">2. Aplique a resposta</h3> :
        guestInvite && !guestHasName && !output && <p>Informe seu nickname para gerar a resposta automaticamente.</p>}
      {role === 'host' && <p className="text-xs text-slate-400">Se o jogador usou um convite completo, cole aqui a resposta que ele enviou.</p>}
      {invite === undefined && <label className="block space-y-1">
        <span>{role === 'host' ? 'Resposta do jogador' : 'Convite do anfitrião'}</span>
        <textarea aria-label={role === 'host' ? 'Resposta do jogador' : 'Convite do anfitrião'} className={fieldClass}
          value={input} onChange={event => setInput(event.target.value)} spellCheck={false} autoCapitalize="off" maxLength={160000} />
      </label>}
      {role === 'host' && <button type="button" className={buttonClass} disabled={busy || !input.trim()} onClick={accept}>Aplicar resposta</button>}
      {feedback('response')}
      {role === 'guest' && outputField}
    </div>
    {canHostLan && lan.length === 0 && <div className="space-y-2 border-t border-slate-700 pt-4">
      <h3 className="font-semibold text-slate-100">Rede local / IPv6</h3>
      <p>Ative enquanto estiver sozinho. O espaço sai do Hub e os jogadores entram pelo convite gerado aqui.</p>
      <button type="button" className={buttonClass} disabled={busy} onClick={enableLan}>Ativar rede local / IPv6</button>
      {feedback('lan')}
    </div>}
    {lanInvites.length > 0 && !hasGlobalIpv6 && (
      <p role="status" className="border-t border-slate-700 pt-4 text-sm text-slate-300">
        {hasLocalIpv6 ? 'O IPv6 disponível é apenas para a rede local.' : 'Apenas IPv4 está disponível para convites na rede local.'}
        {' '}Para convidar por IPv6 pela internet, o anfitrião precisa de um endereço IPv6 global e uma porta acessível.
      </p>
    )}
    {lanInvites.map(({ invite, host, port, ipv6, globalIpv6 }, index) => {
      const label = globalIpv6 ? 'Convite por IPv6' : ipv6 ? 'Convite IPv6 da rede local' : 'Convite IPv4 da rede local'
      const copyLabel = globalIpv6 ? 'Copiar convite IPv6' : ipv6 ? 'Copiar convite IPv6 local' : 'Copiar convite da rede local'
      return <div key={invite} className="space-y-2 border-t border-slate-700 pt-4">
        <h3 className="font-semibold text-slate-100">{label}</h3>
        <p>{globalIpv6
          ? 'Com IPv6 nos dois computadores e a porta acessível, este convite permite entrar pela internet sem trocar uma resposta. Cole em Código da Sala.'
          : 'Na mesma rede, envie este convite para entrar sem trocar uma resposta. Cole em Código da Sala.'}</p>
        <p className="text-xs font-mono break-all text-slate-400">{host}:{port}</p>
        <textarea aria-label={`${label} ${index + 1}`} className={fieldClass} readOnly value={invite} />
        <button type="button" className={buttonClass} disabled={busy} onClick={() => copy(invite, invite)}>{copyLabel}</button>
        {feedback(invite)}
      </div>
    })}
  </section>
}
