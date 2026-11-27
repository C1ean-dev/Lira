import React, { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Copy,
  KeyRound,
  Lock,
  Radio,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  resolvePeerSecurity,
  useSecurityStore,
  type PeerSecurityStatus,
} from '../../store/useSecurityStore'
import { useGameStore } from '../../store/useGameStore'
import { formatShortFingerprint } from '../../crypto/primitives'
import { getLocalIdentity } from '../../crypto/identityStore'
import { acceptChangedPeerKey, markPeerVerified, unverifyPeer } from '../../crypto/trustActions'
import { findFriendKey } from '../../utils/userId'

function statusBannerInfo(status: PeerSecurityStatus): {
  title: string
  description: string
  containerClass: string
  Icon: React.ComponentType<{ className?: string }>
} {
  switch (status) {
    case 'verified':
      return {
        title: 'Identidade Verificada',
        description: 'Você confirmou os números de segurança com este contato. Ataques MITM são bloqueados.',
        containerClass: 'bg-lira-online/10 border-lira-online/40 text-lira-online',
        Icon: ShieldCheck,
      }
    case 'encrypted':
      return {
        title: 'Criptografado Ponta a Ponta (TOFU)',
        description: 'As chaves desta sessão estão autenticadas. Compare o número abaixo por voz ou presencialmente para marcar como verificado.',
        containerClass: 'bg-lira-surface border-lira-online/30 text-lira-ink',
        Icon: Lock,
      }
    case 'key_changed':
      return {
        title: 'Chave de Identidade Alterada!',
        description: 'A chave pública deste contato mudou desde a última sessão. Isso pode indicar reinstalação/troca de dispositivo ou um ataque MITM.',
        containerClass: 'bg-lira-amber/15 border-lira-amber/50 text-lira-amber',
        Icon: ShieldAlert,
      }
    case 'mitm_blocked':
      return {
        title: 'Conexão Bloqueada (Proteção Anti-MITM)',
        description: 'Uma discrepância criptográfica impediu a sessão de ser considerada segura.',
        containerClass: 'bg-lira-error/15 border-lira-error/50 text-lira-error',
        Icon: ShieldAlert,
      }
    case 'legacy':
    case 'pending':
    default:
      return {
        title: 'Aguardando Handshake E2EE',
        description: 'Conecte-se ou troque uma mensagem com este participante para gerar o código de segurança da sessão.',
        containerClass: 'bg-lira-ground border-lira-quiet text-lira-muted',
        Icon: KeyRound,
      }
  }
}

export const SafetyNumberModal: React.FC = () => {
  const inspectionTarget = useSecurityStore((s) => s.inspectionTarget)
  const localFingerprint = useSecurityStore((s) => s.localFingerprint)
  const peers = useSecurityStore((s) => s.peers)
  const closeInspection = useSecurityStore((s) => s.closeInspection)
  const openInspection = useSecurityStore((s) => s.openInspection)

  const { remotePlayers, friends, friendProfiles } = useGameStore()
  const [copiedField, setCopiedField] = useState<'local' | 'remote' | null>(null)

  useEffect(() => {
    if (!inspectionTarget) return
    if (!localFingerprint) {
      void getLocalIdentity().catch(() => {})
    }
  }, [inspectionTarget, localFingerprint])

  useEffect(() => {
    if (!inspectionTarget) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeInspection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inspectionTarget, closeInspection])

  const allKnownIds = useMemo(() => {
    if (!inspectionTarget) return []
    const ids = new Set<string>([inspectionTarget.peerId, ...(inspectionTarget.candidateIds || [])])
    return Array.from(ids).filter(Boolean)
  }, [inspectionTarget])

  if (!inspectionTarget) return null

  const peerState = resolvePeerSecurity(peers, allKnownIds)
  const friendKey = findFriendKey(friends, friendProfiles, allKnownIds)
  const friendProfile = friendKey ? friendProfiles[friendKey] : undefined
  const remotePlayer =
    remotePlayers[inspectionTarget.peerId] ||
    Object.values(remotePlayers).find(
      (p) => allKnownIds.includes(p.id) || (p.gameId && allKnownIds.includes(p.gameId))
    )

  const displayName =
    inspectionTarget.displayName ||
    remotePlayer?.name ||
    friendProfile?.name ||
    peerState?.peerId ||
    inspectionTarget.peerId

  const remoteFingerprint = peerState?.fingerprint || friendProfile?.identityKeyFingerprint || null
  const remotePublicKey = peerState?.publicKey || friendProfile?.identityKey || null

  const effectiveStatus: PeerSecurityStatus = peerState
    ? peerState.status === 'encrypted' && friendProfile?.identityKeyVerified
      ? 'verified'
      : peerState.status
    : friendProfile?.identityKeyVerified
    ? 'verified'
    : friendProfile?.identityKey
    ? 'encrypted'
    : 'pending'

  const banner = statusBannerInfo(effectiveStatus)
  const BannerIcon = banner.Icon
  const peerList = Object.values(peers)
  const hasRemoteKeyMaterial = Boolean(remoteFingerprint && remotePublicKey)

  const handleCopy = async (field: 'local' | 'remote', rawHex: string) => {
    const formatted = formatShortFingerprint(rawHex)
    try {
      await navigator.clipboard?.writeText(formatted)
      setCopiedField(field)
      setTimeout(() => setCopiedField((prev) => (prev === field ? null : prev)), 1800)
    } catch {}
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 font-mono"
      role="dialog"
      aria-modal="true"
      aria-label="Verificação de Segurança E2EE"
      onClick={closeInspection}
    >
      <div
        className="w-full max-w-lg bg-lira-panel border border-dashed border-lira-rule rounded-[16px] shadow-2xl overflow-hidden text-lira-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 bg-lira-sidebar border-b border-dashed border-lira-rule/70">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="w-4 h-4 text-lira-online shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-display font-bold text-lira-ink truncate">
                Verificação de Segurança (E2EE)
              </h2>
              <p className="text-[11px] text-lira-muted truncate">
                Contato: <span className="text-lira-ink font-semibold">{displayName}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeInspection}
            aria-label="Fechar verificação de segurança"
            className="p-1.5 rounded-[8px] text-lira-muted hover:text-lira-ink hover:bg-lira-surface transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[80vh] overflow-y-auto">
          {peerList.length > 1 && (
            <div className="flex flex-wrap gap-1.5 pb-1">
              {peerList.map((entry) => {
                const rp =
                  remotePlayers[entry.peerId] ||
                  Object.values(remotePlayers).find((p) => p.gameId === entry.peerId)
                const fKey = findFriendKey(friends, friendProfiles, [entry.peerId])
                const fName = fKey ? friendProfiles[fKey]?.name : undefined
                const label = rp?.name || fName || entry.peerId.slice(0, 12)
                const active = peerState?.peerId === entry.peerId
                return (
                  <button
                    key={entry.peerId}
                    type="button"
                    onClick={() => openInspection({ peerId: entry.peerId, displayName: label })}
                    className={`px-2 py-1 rounded-[6px] text-[10px] border transition-colors ${
                      active
                        ? 'bg-lira-accent text-lira-ground border-lira-accent font-bold'
                        : 'bg-lira-surface text-lira-muted border-lira-quiet hover:text-lira-ink'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}

          <div className={`p-3 rounded-[10px] border ${banner.containerClass} space-y-1`}>
            <div className="flex items-center gap-2 text-xs font-bold">
              <BannerIcon className="w-4 h-4 shrink-0" />
              <span>{banner.title}</span>
            </div>
            <p className="text-[11px] opacity-90 leading-relaxed">{banner.description}</p>
            {peerState?.reason && (
              <p className="text-[10px] pt-1 font-semibold">Detalhe técnico: {peerState.reason}</p>
            )}
          </div>

          {peerState?.sas && (
            <div className="p-3 rounded-[10px] bg-lira-ground border border-lira-quiet space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider font-bold text-lira-muted">
                  Número de Segurança da Sessão (SAS)
                </span>
                <div className="flex items-center gap-1 text-base" aria-label="Emojis de verificação">
                  {peerState.sas.emojis.map((emoji, idx) => (
                    <span
                      key={`${emoji}-${idx}`}
                      className="px-1.5 py-0.5 rounded-[6px] bg-lira-surface border border-lira-quiet"
                    >
                      {emoji}
                    </span>
                  ))}
                </div>
              </div>
              <div
                data-testid="sas-code"
                className="text-center text-sm sm:text-base tracking-widest font-bold text-lira-accent bg-lira-surface px-3 py-2 rounded-[8px] border border-lira-rule select-all"
              >
                {peerState.sas.code}
              </div>
              <p className="text-[10px] text-lira-muted">
                Se os 6 blocos numéricos e os 4 emojis forem idênticos na tela de {displayName}, ninguém intercepta a chamada ou DM.
              </p>
            </div>
          )}

          <div className="p-3 rounded-[10px] bg-lira-ground border border-lira-quiet space-y-2.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider font-bold text-lira-muted">
                  Sua impressão digital (P-256)
                </span>
                {localFingerprint && (
                  <button
                    type="button"
                    onClick={() => handleCopy('local', localFingerprint)}
                    className="inline-flex items-center gap-1 text-[10px] text-lira-accent hover:underline"
                  >
                    {copiedField === 'local' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedField === 'local' ? 'Copiado' : 'Copiar'}
                  </button>
                )}
              </div>
              <div
                data-testid="local-fingerprint"
                className="text-[11px] leading-relaxed text-lira-ink bg-lira-surface px-2.5 py-1.5 rounded-[6px] border border-lira-quiet break-all select-all"
              >
                {localFingerprint ? formatShortFingerprint(localFingerprint) : 'Inicializando identidade local...'}
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider font-bold text-lira-muted">
                  Impressão digital de {displayName}
                </span>
                {remoteFingerprint && (
                  <button
                    type="button"
                    onClick={() => handleCopy('remote', remoteFingerprint)}
                    className="inline-flex items-center gap-1 text-[10px] text-lira-accent hover:underline"
                  >
                    {copiedField === 'remote' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedField === 'remote' ? 'Copiado' : 'Copiar'}
                  </button>
                )}
              </div>
              <div
                data-testid="remote-fingerprint"
                className="text-[11px] leading-relaxed text-lira-ink bg-lira-surface px-2.5 py-1.5 rounded-[6px] border border-lira-quiet break-all select-all"
              >
                {remoteFingerprint
                  ? formatShortFingerprint(remoteFingerprint)
                  : 'Aguardando handshake do contato...'}
              </div>
            </div>
          </div>

          {peerState && (
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <span
                className={`px-2 py-0.5 rounded-[6px] border flex items-center gap-1 ${
                  peerState.dtlsBound
                    ? 'bg-lira-online/10 text-lira-online border-lira-online/30'
                    : 'bg-lira-surface text-lira-muted border-lira-quiet'
                }`}
              >
                <Lock className="w-2.5 h-2.5" />
                {peerState.dtlsBound ? 'DTLS autenticado' : 'DTLS padrão'}
              </span>
              <span
                className={`px-2 py-0.5 rounded-[6px] border flex items-center gap-1 ${
                  peerState.mediaEncrypted
                    ? 'bg-lira-online/10 text-lira-online border-lira-online/30'
                    : 'bg-lira-surface text-lira-muted border-lira-quiet'
                }`}
              >
                <Radio className="w-2.5 h-2.5" />
                {peerState.mediaEncrypted ? 'Mídia SFrame E2EE' : 'Mídia sem SFrame'}
              </span>
              {peerState.callDtlsVerified && (
                <span className="px-2 py-0.5 rounded-[6px] border bg-lira-online/10 text-lira-online border-lira-online/30 flex items-center gap-1">
                  <ShieldCheck className="w-2.5 h-2.5" />
                  Chamada DTLS verificada
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 bg-lira-sidebar border-t border-dashed border-lira-rule/70">
          {effectiveStatus === 'key_changed' && hasRemoteKeyMaterial && (
            <button
              type="button"
              onClick={() => acceptChangedPeerKey(peerState?.peerId || inspectionTarget.peerId, allKnownIds)}
              className="px-3 py-1.5 rounded-[8px] bg-lira-amber text-lira-ground font-bold text-xs hover:opacity-90 transition-opacity"
            >
              Aceitar nova chave
            </button>
          )}

          {effectiveStatus === 'encrypted' && hasRemoteKeyMaterial && (
            <button
              type="button"
              onClick={() => markPeerVerified(peerState?.peerId || inspectionTarget.peerId, allKnownIds)}
              className="px-3 py-1.5 rounded-[8px] bg-lira-online text-lira-ground font-bold text-xs hover:opacity-90 transition-opacity flex items-center gap-1.5"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Marcar como Verificado
            </button>
          )}

          {effectiveStatus === 'verified' && (
            <button
              type="button"
              onClick={() => unverifyPeer(peerState?.peerId || inspectionTarget.peerId, allKnownIds)}
              className="px-3 py-1.5 rounded-[8px] bg-lira-surface border border-lira-rule text-lira-muted hover:text-lira-ink text-xs font-semibold transition-colors"
            >
              Remover verificação
            </button>
          )}

          <button
            type="button"
            onClick={closeInspection}
            className="px-3 py-1.5 rounded-[8px] bg-lira-surface border border-lira-rule text-lira-ink hover:border-lira-accent text-xs font-semibold transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
