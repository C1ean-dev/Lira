import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  MessageSquare,
  UserPlus,
  UserCheck,
  Clock,
  Compass,
  Pencil,
  Plus,
  Check,
  MapPin,
  Crown,
  Shield,
  Users,
  Radio,
} from 'lucide-react'
import { ProfileEditorSection, useProfileModalStore } from '../../store/useProfileModalStore'
import { useGameStore } from '../../store/useGameStore'
import { useChatStore } from '../../store/useChatStore'
import { useMapStore } from '../../store/useMapStore'
import { PeerManager } from '../../p2p/PeerManager'
import { FriendsPresenceService } from '../../services/friendsPresenceService'
import { idleManager } from '../../services/idleManager'
import { AvatarConfig, PresenceStatus, STATUS_META } from '../../types/game'
import { MAX_PROFILE_GAMES, PopularGameId, UserProfile } from '../../types/profile'
import { BANNER_PRESETS, BANNER_PRESET_MAP } from '../../data/profileCatalog'
import { formatMemberSince, formatProfileHandle, getNameplateStyle, resolveProfile } from '../../utils/profileUtils'
import { findFriendKey, getPlayerUserId } from '../../utils/userId'
import { resolveUniquePlayerName } from '../../utils/playerName'
import { goToPlayer } from '../../utils/goToPlayer'
import { PlayerAvatar } from '../common/PlayerAvatar'
import { MoonPhaseIcon } from '../common/MoonPhaseIcon'
import { SpotifyIcon } from '../common/SpotifyIcon'
import { MedalBadgeList } from './MedalBadgeList'
import { ProfileMuralSection } from './ProfileMuralSection'
import { NameplateArtwork } from './ProfileBar'
import { InlineEditorKind, ProfileInlineEditorSheet } from './ProfileInlineEditorSheet'

interface Props {
  onOpenAvatarCustomizer?: () => void
}

function mapSectionToInlineKind(section: ProfileEditorSection | null): InlineEditorKind | null {
  if (!section) return null
  if (section === 'appearance') return 'nameplate'
  return section
}

export const UserProfileModal: React.FC<Props> = ({ onOpenAvatarCustomizer }) => {
  const isOpen = useProfileModalStore((s) => s.isOpen)
  if (!isOpen) return null
  return <UserProfileModalInner onOpenAvatarCustomizer={onOpenAvatarCustomizer} />
}

const UserProfileModalInner: React.FC<Props> = ({ onOpenAvatarCustomizer }) => {
  const {
    target,
    editorSection,
    notes,
    closeProfile,
    setEditorSection,
    setNote,
  } = useProfileModalStore()

  const localPlayer = useGameStore((s) => s.localPlayer)
  const remotePlayers = useGameStore((s) => s.remotePlayers)
  const friends = useGameStore((s) => s.friends)
  const friendProfiles = useGameStore((s) => s.friendProfiles)
  const setLocalPlayer = useGameStore((s) => s.setLocalPlayer)
  const setLocalStatus = useGameStore((s) => s.setLocalStatus)
  const removeFriend = useGameStore((s) => s.removeFriend)
  const roomId = useGameStore((s) => s.roomId)
  const roomName = useGameStore((s) => s.roomName)
  const mapZones = useMapStore((s) => s.mapData.zones)

  const openDirectMessage = useChatStore((s) => s.openDirectMessage)
  const sendFriendRequest = useChatStore((s) => s.sendFriendRequest)
  const getFriendRequestStatus = useChatStore((s) => s.getFriendRequestStatus)

  const [activeTab, setActiveTab] = useState<'mural' | 'activity'>('mural')
  const [editingBioInline, setEditingBioInline] = useState(false)
  const [inlineBioDraft, setInlineBioDraft] = useState('')
  const rightScrollRef = useRef<HTMLDivElement | null>(null)

  const isLocal = useMemo(() => {
    if (!target) return false
    if (target.isLocal || target.userId === '__local__') return true
    const localUid = getPlayerUserId(localPlayer)
    return target.userId === localUid || target.userId === localPlayer.id
  }, [target, localPlayer])

  const liveRemote = useMemo(() => {
    if (!target || isLocal) return undefined
    if (target.peerId && remotePlayers[target.peerId]) return remotePlayers[target.peerId]
    return Object.values(remotePlayers).find(
      (p) => p.id === target.userId || p.gameId === target.userId || (target.peerId && p.id === target.peerId)
    )
  }, [target, isLocal, remotePlayers])

  const friendKey = useMemo(() => {
    if (!target || isLocal) return undefined
    return (
      target.friendKey ||
      findFriendKey(friends, friendProfiles, [target.userId, target.peerId, liveRemote?.id, liveRemote?.gameId])
    )
  }, [target, isLocal, friends, friendProfiles, liveRemote])

  const liveFriend = friendKey ? friendProfiles[friendKey] : undefined

  const effectiveUserId = isLocal
    ? getPlayerUserId(localPlayer)
    : liveRemote?.gameId || liveFriend?.actualUserId || target?.userId || ''

  const effectiveName = isLocal
    ? localPlayer.name
    : liveRemote?.name || liveFriend?.name || target?.name || 'Usuário'

  const effectivePic = isLocal
    ? localPlayer.profilePicture || ''
    : liveRemote?.profilePicture ?? liveFriend?.profilePicture ?? target?.profilePicture ?? ''

  const effectiveAvatar: AvatarConfig | undefined = isLocal
    ? localPlayer.avatar
    : liveRemote?.avatar || liveFriend?.avatar || target?.avatar

  const effectiveProfile = useMemo(
    () =>
      resolveProfile(
        isLocal
          ? localPlayer.profile
          : liveRemote?.profile || liveFriend?.profile || target?.profile
      ),
    [isLocal, localPlayer.profile, liveRemote?.profile, liveFriend?.profile, target?.profile]
  )

  const effectiveStatus = isLocal
    ? localPlayer.status
    : liveRemote?.status || (target?.isOnline === false ? 'offline' : liveFriend?.status || target?.status || 'available')

  const effectiveStatusText = isLocal
    ? localPlayer.statusText
    : liveRemote?.statusText || liveFriend?.statusText || target?.statusText

  const effectiveZoneId = isLocal ? localPlayer.currentZoneId : liveRemote?.currentZoneId ?? target?.currentZoneId
  const effectiveSpotify = isLocal ? localPlayer.spotifyActivity : liveRemote?.spotifyActivity ?? target?.spotifyActivity
  const effectiveRole = isLocal ? localPlayer.role : liveRemote?.role ?? target?.role
  const effectiveIsOwner = isLocal ? localPlayer.isOwner : liveRemote?.isOwner ?? target?.isOwner
  const effectiveIsHost = isLocal ? localPlayer.isHost : liveRemote?.isHost ?? target?.isHost

  const activeEditorKind = isLocal ? mapSectionToInlineKind(editorSection) : null

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeEditorKind) {
          setEditorSection(null)
        } else {
          closeProfile()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeEditorKind, setEditorSection, closeProfile])

  if (!target) return null

  const commitLocalChanges = (changes: {
    name?: string
    profilePicture?: string
    status?: PresenceStatus
    profile?: Partial<UserProfile>
  }) => {
    if (!isLocal) return
    const current = useGameStore.getState().localPlayer
    const nextProfile: UserProfile = {
      ...resolveProfile({
        ...current.profile,
        ...changes.profile,
      }),
      memberSince: current.profile?.memberSince || Date.now(),
    }

    let finalName = current.name
    if (changes.name !== undefined && changes.name.trim()) {
      const otherNames = Object.values(useGameStore.getState().remotePlayers).map((p) => p.name)
      finalName = resolveUniquePlayerName(changes.name.trim(), otherNames)
    }

    const nextStatus = changes.status ?? current.status
    const nextStatusText =
      changes.status !== undefined
        ? STATUS_META[changes.status]?.label || 'Disponível'
        : current.statusText
    const nextPic = changes.profilePicture !== undefined ? changes.profilePicture : current.profilePicture

    if (changes.status !== undefined) {
      idleManager.cancelAutoAway()
      setLocalStatus({
        status: nextStatus,
        statusText: nextStatusText,
        statusEmoji: '',
      })
    }

    setLocalPlayer({
      name: finalName,
      profilePicture: nextPic,
      profile: nextProfile,
      status: nextStatus,
      statusText: nextStatusText,
    })

    PeerManager.getInstance().sendPlayerUpdate({
      name: finalName,
      profilePicture: nextPic,
      profile: nextProfile,
      status: nextStatus,
      statusText: nextStatusText,
    })
    FriendsPresenceService.getInstance().broadcastPresence()
  }

  const handleToggleGame = (gameId: PopularGameId) => {
    const currentGames = effectiveProfile.games || []
    if (currentGames.includes(gameId)) {
      commitLocalChanges({ profile: { games: currentGames.filter((id) => id !== gameId) } })
    } else if (currentGames.length < MAX_PROFILE_GAMES) {
      commitLocalChanges({ profile: { games: [...currentGames, gameId] } })
    }
  }

  const themePrimary = effectiveProfile.themePrimary || '#0f1014'
  const themeAccent = effectiveProfile.themeAccent || '#2b2d31'
  const bannerBackground = effectiveProfile.bannerImage
    ? undefined
    : BANNER_PRESET_MAP[effectiveProfile.bannerPreset || 'obsidian']?.background || BANNER_PRESETS[0].background
  const nameplateStyle = getNameplateStyle(effectiveProfile)

  const pendingRequest = !isLocal
    ? getFriendRequestStatus(effectiveUserId) ||
      (liveRemote ? getFriendRequestStatus(liveRemote.id) : undefined) ||
      getFriendRequestStatus(effectiveName)
    : undefined
  const isFriendPending = pendingRequest?.status === 'pending'

  const zoneObj = effectiveZoneId ? mapZones.find((z) => z.id === effectiveZoneId) : null
  const noteValue = notes[effectiveUserId] || ''
  const friendSince = liveFriend?.friendSince ?? target.friendSince

  const statusMeta =
    effectiveStatus === 'offline'
      ? { label: 'Offline', moonPhase: 'Desconectado', bgColor: '#1e293b' }
      : STATUS_META[effectiveStatus as PresenceStatus] || STATUS_META.available

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Perfil de ${effectiveName}`}
      onClick={closeProfile}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4 animate-in fade-in duration-150 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: themePrimary,
          borderColor: `${themeAccent}55`,
          boxShadow: `0 24px 80px rgba(0,0,0,0.75), 0 0 0 1px ${themeAccent}30`,
        }}
        className="relative w-full max-w-4xl overflow-hidden rounded-3xl border flex flex-col max-h-[92vh] transition-all"
      >
        <button
          type="button"
          onClick={closeProfile}
          aria-label="Fechar perfil"
          className="absolute top-3 right-3 z-40 p-2 rounded-xl bg-black/55 hover:bg-black/80 text-slate-300 hover:text-white border border-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-y-auto md:overflow-hidden">
          {/* LEFT COLUMN: Discord Profile Card */}
          <div
            className="w-full md:w-[340px] lg:w-[360px] shrink-0 border-b md:border-b-0 md:border-r border-white/[0.08] flex flex-col md:overflow-y-auto"
            style={{
              background: `linear-gradient(180deg, ${themePrimary} 0%, #0b0c10 100%)`,
            }}
          >
            {/* Banner (Click to edit banner & theme) */}
            <div
              onClick={isLocal ? () => setEditorSection('banner') : undefined}
              className={`group/banner h-28 sm:h-32 w-full relative shrink-0 overflow-hidden ${
                isLocal ? 'cursor-pointer' : ''
              }`}
              style={bannerBackground ? { background: bannerBackground } : undefined}
              title={isLocal ? 'Clique para editar banner e tema' : undefined}
            >
              {effectiveProfile.bannerImage && (
                <img
                  src={effectiveProfile.bannerImage}
                  alt="Banner do perfil"
                  className="w-full h-full object-cover transition-transform duration-300 group-hover/banner:scale-[1.02]"
                />
              )}
              <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/45 to-transparent" />

              {isLocal && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditorSection('banner')
                  }}
                  aria-label="Editar banner"
                  title="Editar banner e tema do perfil"
                  className="absolute top-2.5 right-2.5 z-20 p-2 rounded-xl bg-black/60 hover:bg-black/85 text-white border border-white/15 backdrop-blur-sm shadow-lg transition-all opacity-90 group-hover/banner:opacity-100 group-hover/banner:scale-105"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Avatar overlapping Banner (Click to edit photo, border frame & status) */}
            <div className="px-5 pb-5 -mt-14 relative flex-1 flex flex-col gap-3.5">
              <div className="flex items-end justify-between gap-2">
                <div
                  className="relative group/avatar inline-block p-1.5 rounded-full shadow-2xl"
                  style={{ backgroundColor: themePrimary }}
                >
                  <PlayerAvatar
                    name={effectiveName}
                    profilePicture={effectivePic}
                    avatar={effectiveAvatar}
                    avatarFrame={effectiveProfile.avatarFrame}
                    status={effectiveStatus}
                    showStatus={true}
                    size="3xl"
                    className="rounded-full"
                    onClick={isLocal ? () => setEditorSection('avatar') : undefined}
                  />
                  {isLocal && (
                    <button
                      type="button"
                      onClick={() => setEditorSection('avatar')}
                      aria-label="Editar foto e borda da imagem"
                      title="Alterar foto, borda da imagem e status"
                      className="absolute inset-1.5 z-20 rounded-full bg-black/55 opacity-0 group-hover/avatar:opacity-100 focus-visible:opacity-100 flex items-center justify-center transition-opacity cursor-pointer"
                    >
                      <span className="w-9 h-9 rounded-xl bg-black/65 border border-white/20 flex items-center justify-center text-white shadow-lg">
                        <Pencil className="w-4 h-4" />
                      </span>
                    </button>
                  )}
                </div>

                {isLocal && onOpenAvatarCustomizer && (
                  <button
                    type="button"
                    onClick={() => {
                      closeProfile()
                      onOpenAvatarCustomizer()
                    }}
                    className="mb-1 px-2.5 py-1.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.14] border border-white/10 text-[11px] font-bold text-slate-200 transition-colors"
                    title="Personalizar personagem Pixel Art e Pet"
                  >
                    Personagem Pixel
                  </button>
                )}
              </div>

              {/* Name + Handle + Medals (Click directly to edit each) */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    disabled={!isLocal}
                    onClick={isLocal ? () => setEditorSection('identity') : undefined}
                    className={`group/name inline-flex items-center gap-1.5 text-left ${
                      isLocal ? 'cursor-pointer hover:text-indigo-200' : 'cursor-default'
                    }`}
                    title={isLocal ? 'Clique para editar nome e @handle' : undefined}
                  >
                    <h2 className="text-xl font-extrabold text-white tracking-tight leading-tight">
                      {effectiveName}
                    </h2>
                    {isLocal && (
                      <Pencil className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover/name:opacity-100 transition-opacity" />
                    )}
                  </button>

                  {effectiveIsOwner && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1">
                      <Crown className="w-3 h-3" />
                      Dono
                    </span>
                  )}
                  {!effectiveIsOwner && (effectiveIsHost || effectiveRole === 'admin') && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 inline-flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      {effectiveIsHost ? 'Host' : 'Admin'}
                    </span>
                  )}
                </div>

                <div className="flex items-center flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={!isLocal}
                    onClick={isLocal ? () => setEditorSection('identity') : undefined}
                    className={`text-xs font-medium text-slate-300 ${
                      isLocal ? 'hover:text-white hover:underline cursor-pointer' : 'cursor-default'
                    }`}
                    title={isLocal ? 'Editar @handle' : undefined}
                  >
                    {formatProfileHandle(effectiveName, effectiveProfile.handle)}
                  </button>

                  {effectiveProfile.medals && effectiveProfile.medals.length > 0 ? (
                    <button
                      type="button"
                      disabled={!isLocal}
                      onClick={isLocal ? () => setEditorSection('medals') : undefined}
                      className={`group/medals relative inline-flex items-center ${
                        isLocal ? 'cursor-pointer hover:ring-1 hover:ring-indigo-400/60 rounded-lg transition-all' : 'cursor-default'
                      }`}
                      title={isLocal ? 'Clique para editar medalhas' : undefined}
                    >
                      <MedalBadgeList medals={effectiveProfile.medals} size="sm" />
                      {isLocal && (
                        <span className="ml-1 mr-1 text-slate-400 group-hover/medals:text-white">
                          <Pencil className="w-3 h-3" />
                        </span>
                      )}
                    </button>
                  ) : isLocal ? (
                    <button
                      type="button"
                      onClick={() => setEditorSection('medals')}
                      className="text-[10px] font-bold px-2 py-0.5 rounded-lg border border-dashed border-white/20 text-slate-400 hover:text-white hover:border-white/40 transition-colors inline-flex items-center gap-1"
                      title="Escolher medalhas"
                    >
                      <Plus className="w-2.5 h-2.5" />
                      <span>Medalhas</span>
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Nameplate / Barra de Perfil */}
              {isLocal && (
                <button
                  type="button"
                  onClick={() => setEditorSection('nameplate')}
                  data-nameplate={nameplateStyle.nameplateId}
                  style={
                    nameplateStyle.hasCustomNameplate
                      ? { background: nameplateStyle.background, borderColor: nameplateStyle.borderColor }
                      : undefined
                  }
                  aria-label="Editar barra de perfil"
                  title="Clique para personalizar sua Barra de Perfil (Nameplate)"
                  className={`group/np relative overflow-hidden w-full rounded-xl border px-2.5 py-2 flex items-center justify-between gap-2 transition-all hover:brightness-110 cursor-pointer ${
                    nameplateStyle.hasCustomNameplate
                      ? ''
                      : 'bg-[#202229] border-white/10 hover:border-white/25'
                  }`}
                >
                  <NameplateArtwork
                    nameplateId={nameplateStyle.nameplateId}
                    accentColor={nameplateStyle.accentColor}
                  />
                  <div className="relative z-10 flex items-center gap-2 min-w-0">
                    <PlayerAvatar
                      name={effectiveName}
                      profilePicture={effectivePic}
                      avatar={effectiveAvatar}
                      avatarFrame={effectiveProfile.avatarFrame}
                      status={effectiveStatus}
                      showStatus={true}
                      size="xs"
                      className="rounded-full"
                    />
                    <div className="min-w-0 text-left">
                      <div className="text-[11px] font-bold text-slate-100 truncate leading-tight">
                        {nameplateStyle.hasCustomNameplate ? effectiveName : 'Barra de Perfil'}
                      </div>
                      <div className="text-[9px] text-slate-300/80 truncate leading-tight">
                        {nameplateStyle.hasCustomNameplate ? 'Clique para trocar estilo' : 'Adicionar estilo de barra'}
                      </div>
                    </div>
                  </div>
                  <span className="relative z-10 w-6 h-6 rounded-full bg-slate-200/90 group-hover/np:bg-white text-slate-900 flex items-center justify-center shrink-0 shadow transition-transform group-hover/np:scale-110">
                    {nameplateStyle.hasCustomNameplate ? (
                      <Pencil className="w-3 h-3" />
                    ) : (
                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                    )}
                  </span>
                </button>
              )}

              {/* Other user action buttons */}
              {!isLocal && (
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      openDirectMessage({ id: effectiveUserId, name: effectiveName })
                      closeProfile()
                    }}
                    className="flex-1 py-2 px-3.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-extrabold shadow-md shadow-indigo-600/25 transition-all flex items-center justify-center gap-1.5 active:scale-95"
                  >
                    <MessageSquare className="w-3.5 h-3.5 fill-white/20" />
                    <span>Mensagem</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (friendKey) {
                        removeFriend(friendKey)
                      } else if (!isFriendPending) {
                        sendFriendRequest({
                          id: effectiveUserId,
                          name: effectiveName,
                          avatar: effectiveAvatar,
                        })
                      }
                    }}
                    className={`p-2 rounded-xl border transition-all ${
                      friendKey
                        ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300 hover:bg-rose-500/15 hover:border-rose-500/35 hover:text-rose-300'
                        : isFriendPending
                        ? 'bg-amber-500/15 border-amber-500/35 text-amber-300'
                        : 'bg-white/[0.08] hover:bg-white/[0.14] border-white/10 text-slate-200'
                    }`}
                    title={
                      friendKey
                        ? 'Amigos (clique para remover)'
                        : isFriendPending
                        ? 'Solicitação de amizade pendente'
                        : 'Adicionar aos amigos'
                    }
                  >
                    {friendKey ? (
                      <UserCheck className="w-4 h-4" />
                    ) : isFriendPending ? (
                      <Clock className="w-4 h-4" />
                    ) : (
                      <UserPlus className="w-4 h-4" />
                    )}
                  </button>

                  {liveRemote && (
                    <button
                      type="button"
                      onClick={() => {
                        goToPlayer(liveRemote.id)
                        closeProfile()
                      }}
                      className="p-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-indigo-300 transition-all"
                      title={`Ir até ${effectiveName}`}
                    >
                      <Compass className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              {/* Bio (Inline click-to-edit) */}
              {(effectiveProfile.bio || isLocal) && (
                <div className="pt-2 border-t border-white/[0.08] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                      Sobre mim
                    </span>
                    {isLocal && !editingBioInline && (
                      <button
                        type="button"
                        onClick={() => {
                          setInlineBioDraft(effectiveProfile.bio || '')
                          setEditingBioInline(true)
                        }}
                        className="text-slate-500 hover:text-white transition-colors"
                        title="Editar bio"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {isLocal && editingBioInline ? (
                    <div className="space-y-1.5">
                      <textarea
                        autoFocus
                        value={inlineBioDraft}
                        maxLength={240}
                        rows={3}
                        onChange={(e) => setInlineBioDraft(e.target.value)}
                        onBlur={() => {
                          commitLocalChanges({ profile: { bio: inlineBioDraft.trim() } })
                          setEditingBioInline(false)
                        }}
                        placeholder="Escreva algo sobre você..."
                        className="w-full bg-[#131419] rounded-xl px-2.5 py-2 text-xs text-slate-100 border border-indigo-500/60 focus:outline-none resize-none"
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            commitLocalChanges({ profile: { bio: inlineBioDraft.trim() } })
                            setEditingBioInline(false)
                          }}
                          className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[10px] font-bold inline-flex items-center gap-1"
                        >
                          <Check className="w-3 h-3" />
                          Salvar bio
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p
                      onClick={
                        isLocal
                          ? () => {
                              setInlineBioDraft(effectiveProfile.bio || '')
                              setEditingBioInline(true)
                            }
                          : undefined
                      }
                      className={`text-xs leading-relaxed whitespace-pre-wrap break-words rounded-lg transition-colors ${
                        effectiveProfile.bio ? 'text-slate-200' : 'text-slate-500 italic'
                      } ${isLocal ? 'cursor-pointer hover:bg-white/[0.04] px-1.5 py-1 -mx-1.5' : ''}`}
                    >
                      {effectiveProfile.bio || 'Clique para adicionar uma bio...'}
                    </p>
                  )}
                </div>
              )}

              {/* Dates */}
              <div className="pt-2 border-t border-white/[0.08] space-y-2.5 text-xs">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Membro desde
                  </div>
                  <div className="text-slate-200 font-medium mt-0.5">
                    {formatMemberSince(effectiveProfile.memberSince)}
                  </div>
                </div>

                {friendSince && !isLocal && (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Amigos desde
                    </div>
                    <div className="text-slate-200 font-medium mt-0.5">
                      {formatMemberSince(friendSince)}
                    </div>
                  </div>
                )}
              </div>

              {/* Private Note */}
              <div className="pt-2 border-t border-white/[0.08] space-y-1">
                <label
                  htmlFor="profile-private-note"
                  className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block"
                >
                  Nota (visível apenas para você)
                </label>
                <textarea
                  id="profile-private-note"
                  value={noteValue}
                  onChange={(e) => setNote(effectiveUserId, e.target.value)}
                  placeholder="Clique para adicionar uma nota"
                  rows={2}
                  maxLength={300}
                  className="w-full bg-transparent hover:bg-white/[0.04] focus:bg-[#131419] rounded-xl px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 placeholder:italic border border-transparent focus:border-white/15 focus:outline-none resize-none transition-colors"
                />
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Mural (Jogos que eu jogo) / Activity */}
          <div className="flex-1 min-w-0 flex flex-col bg-[#0b0c10]/90 md:overflow-hidden">
            <div className="px-5 pt-4 border-b border-white/[0.08] flex items-center justify-between gap-4 shrink-0 pr-14">
              <div className="flex items-center gap-5">
                <button
                  type="button"
                  onClick={() => setActiveTab('mural')}
                  className={`pb-3 text-xs font-extrabold border-b-2 transition-colors ${
                    activeTab === 'mural'
                      ? 'border-white text-white'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Mural
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('activity')}
                  className={`pb-3 text-xs font-extrabold border-b-2 transition-colors ${
                    activeTab === 'activity'
                      ? 'border-white text-white'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Atividade
                </button>
              </div>
            </div>

            <div ref={rightScrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
              {activeTab === 'mural' && (
                <ProfileMuralSection
                  games={effectiveProfile.games || []}
                  isLocal={isLocal}
                  scrollRootRef={rightScrollRef}
                  onToggleGame={isLocal ? handleToggleGame : undefined}
                  onClearGames={isLocal ? () => commitLocalChanges({ profile: { games: [] } }) : undefined}
                />
              )}

              {activeTab === 'activity' && (
                <div className="space-y-3.5">
                  <div className="rounded-2xl bg-[#131419] border border-white/[0.08] p-4 space-y-3">
                    <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                      Presença Atual
                    </div>
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full overflow-hidden shrink-0 border border-white/10"
                        style={{ backgroundColor: statusMeta.bgColor }}
                      >
                        <MoonPhaseIcon status={effectiveStatus} className="w-full h-full" withBackground={true} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white">
                          {effectiveStatusText || statusMeta.label}
                        </div>
                        <div className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                          <MapPin className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span className="truncate">
                            {zoneObj
                              ? `Na zona: ${zoneObj.name}`
                              : liveRemote || (isLocal && roomId)
                              ? `No espaço: ${roomName || 'Corredor Geral'}`
                              : target.roomName
                              ? `Em: ${target.roomName}`
                              : 'No Lobby / Fora de sala'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {effectiveSpotify?.isPlaying && (
                    <div className="rounded-2xl bg-[#131419] border border-[#1db954]/30 p-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-[#1db954]/20 text-[#1db954] flex items-center justify-center shrink-0">
                          <SpotifyIcon size={20} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#1db954]">
                            Ouvindo no Spotify
                          </div>
                          <div className="text-sm font-bold text-white truncate">
                            {effectiveSpotify.track}
                          </div>
                          <div className="text-xs text-slate-400 truncate">
                            {effectiveSpotify.artist}
                          </div>
                        </div>
                      </div>
                      <Radio className="w-4 h-4 text-[#1db954] animate-pulse shrink-0" />
                    </div>
                  )}

                  {effectiveAvatar?.pet && effectiveAvatar.pet.type !== 'none' && (
                    <div className="rounded-2xl bg-[#131419] border border-white/[0.08] p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-lg">
                        🐾
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-purple-300">
                          Pet Companheiro
                        </div>
                        <div className="text-sm font-bold text-white truncate">
                          {effectiveAvatar.pet.name || effectiveAvatar.pet.type}
                        </div>
                        {effectiveAvatar.pet.personality && (
                          <div className="text-xs text-slate-400 truncate">
                            {effectiveAvatar.pet.personality}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl bg-[#131419] border border-white/[0.08] p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 text-xs text-slate-300">
                      <Users className="w-4 h-4 text-indigo-400" />
                      <span>
                        {isLocal
                          ? `${friends.length} amigo(s) na sua lista do Lira`
                          : friendKey
                          ? 'Vocês são amigos no Lira'
                          : 'Participante da comunidade Lira'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Focused click-in-place editor popover */}
        {isLocal && activeEditorKind && (
          <ProfileInlineEditorSheet
            kind={activeEditorKind}
            name={localPlayer.name}
            profilePicture={localPlayer.profilePicture || ''}
            avatar={localPlayer.avatar}
            status={localPlayer.status}
            profile={effectiveProfile}
            onCommit={commitLocalChanges}
            onClose={() => setEditorSection(null)}
          />
        )}
      </div>
    </div>
  )
}
