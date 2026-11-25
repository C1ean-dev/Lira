import React, { useRef, useState } from 'react'
import {
  X,
  Upload,
  Crop,
  Trash2,
  Check,
  Palette,
  Sparkles,
  Image as ImageIcon,
  Award,
  User,
} from 'lucide-react'
import { AvatarConfig, PresenceStatus, STATUS_OPTIONS } from '../../types/game'
import {
  MAX_PROFILE_MEDALS,
  ProfileMedalId,
  UserProfile,
} from '../../types/profile'
import {
  AVATAR_FRAMES,
  BANNER_PRESETS,
  NAMEPLATES,
  PROFILE_MEDALS,
  PROFILE_THEME_PRESETS,
} from '../../data/profileCatalog'
import { compressProfileImageFile, formatProfileHandle, resolveProfile } from '../../utils/profileUtils'
import { PlayerAvatar } from '../common/PlayerAvatar'
import { ImageCropModal } from '../common/ImageCropModal'
import { MoonPhaseIcon } from '../common/MoonPhaseIcon'
import { ProfileBar } from './ProfileBar'
import { MedalIcon } from './MedalBadgeList'

export type InlineEditorKind =
  | 'avatar'
  | 'banner'
  | 'nameplate'
  | 'identity'
  | 'medals'

interface Props {
  kind: InlineEditorKind
  name: string
  profilePicture: string
  avatar: AvatarConfig
  status: PresenceStatus
  profile: UserProfile
  onCommit: (changes: {
    name?: string
    profilePicture?: string
    status?: PresenceStatus
    profile?: Partial<UserProfile>
  }) => void
  onClose: () => void
}

const SHEET_HEADER: Record<
  InlineEditorKind,
  { title: string; subtitle: string; icon: React.ComponentType<{ className?: string }> }
> = {
  avatar: {
    title: 'Foto, Borda & Status',
    subtitle: 'Altere sua imagem, escolha uma borda decorativa ou mude seu status.',
    icon: Sparkles,
  },
  banner: {
    title: 'Banner & Tema do Cartão',
    subtitle: 'Personalize a capa superior e as cores do seu perfil.',
    icon: ImageIcon,
  },
  nameplate: {
    title: 'Barra de Perfil (Nameplate)',
    subtitle: 'Escolha o visual da sua barra exibida nas listas de pessoas e amigos.',
    icon: Palette,
  },
  identity: {
    title: 'Nome, @handle & Bio',
    subtitle: 'Edite como você é identificado no perfil.',
    icon: User,
  },
  medals: {
    title: 'Medalhas do Perfil',
    subtitle: `Selecione até ${MAX_PROFILE_MEDALS} medalhas para destacar.`,
    icon: Award,
  },
}

export const ProfileInlineEditorSheet: React.FC<Props> = ({
  kind,
  name,
  profilePicture,
  avatar,
  status,
  profile,
  onCommit,
  onClose,
}) => {
  const resolved = resolveProfile(profile)
  const avatarFileRef = useRef<HTMLInputElement | null>(null)
  const bannerFileRef = useRef<HTMLInputElement | null>(null)

  const [cropOpen, setCropOpen] = useState(false)
  const [rawCropSrc, setRawCropSrc] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [draftName, setDraftName] = useState(name)
  const [draftHandle, setDraftHandle] = useState(resolved.handle || '')
  const [draftBio, setDraftBio] = useState(resolved.bio || '')

  const header = SHEET_HEADER[kind]
  const HeaderIcon = header.icon
  const hasCustomPicture = !!(profilePicture && profilePicture.trim() !== '')

  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Selecione uma imagem válida.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setRawCropSrc(reader.result)
        setCropOpen(true)
        setErrorMsg(null)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleBannerFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setErrorMsg(null)
      const dataUrl = await compressProfileImageFile(file, 720, 260, 0.82)
      onCommit({ profile: { bannerImage: dataUrl } })
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao carregar banner.')
    }
  }

  const toggleMedal = (medalId: ProfileMedalId) => {
    const current = resolved.medals || []
    if (current.includes(medalId)) {
      onCommit({ profile: { medals: current.filter((m) => m !== medalId) } })
    } else if (current.length < MAX_PROFILE_MEDALS) {
      onCommit({ profile: { medals: [...current, medalId] } })
    }
  }

  const handleDone = () => {
    if (kind === 'identity') {
      onCommit({
        name: draftName.trim() || name,
        profile: {
          handle: draftHandle.trim(),
          bio: draftBio.trim(),
        },
      })
    }
    onClose()
  }

  return (
    <div
      onClick={handleDone}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-5 animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[84vh] bg-[#14151b] border border-white/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
      >
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3 bg-[#181920] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 flex items-center justify-center shrink-0">
              <HeaderIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-extrabold text-white truncate">{header.title}</h3>
              <p className="text-[11px] text-slate-400 truncate">{header.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDone}
            aria-label="Fechar editor"
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {errorMsg && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
              {errorMsg}
            </div>
          )}

          {kind === 'avatar' && (
            <>
              <div className="rounded-2xl bg-[#1b1d25] border border-white/10 p-3.5 flex flex-col sm:flex-row items-center gap-4">
                <div className="shrink-0 p-1">
                  <PlayerAvatar
                    name={name}
                    profilePicture={profilePicture}
                    avatar={avatar}
                    avatarFrame={resolved.avatarFrame}
                    status={status}
                    showStatus={true}
                    size="2xl"
                    className="rounded-full"
                  />
                </div>
                <div className="flex-1 min-w-0 space-y-2 text-center sm:text-left">
                  <div className="text-xs font-extrabold text-white">Foto de Perfil</div>
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                    <input
                      ref={avatarFileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={handleAvatarFile}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => avatarFileRef.current?.click()}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{hasCustomPicture ? 'Trocar Foto' : 'Enviar Foto'}</span>
                    </button>
                    {hasCustomPicture && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setRawCropSrc(profilePicture)
                            setCropOpen(true)
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-100 text-xs font-bold inline-flex items-center gap-1"
                        >
                          <Crop className="w-3.5 h-3.5 text-sky-400" />
                          <span>Recortar</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onCommit({ profilePicture: '' })}
                          className="px-2.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-bold inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Usar Personagem</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-extrabold text-white">Borda na Imagem</div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {AVATAR_FRAMES.map((frame) => {
                    const selected = (resolved.avatarFrame || 'none') === frame.id
                    return (
                      <button
                        key={frame.id}
                        type="button"
                        onClick={() => onCommit({ profile: { avatarFrame: frame.id } })}
                        className={`relative p-2.5 rounded-2xl border flex flex-col items-center gap-1.5 transition-all text-center ${
                          selected
                            ? 'bg-indigo-600/25 border-indigo-400 ring-1 ring-indigo-400/50'
                            : 'bg-[#1b1d25] border-white/10 hover:border-white/25'
                        }`}
                      >
                        {selected && (
                          <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-indigo-500 text-white flex items-center justify-center">
                            <Check className="w-2.5 h-2.5" />
                          </span>
                        )}
                        <div className="py-1">
                          <PlayerAvatar
                            name={name}
                            profilePicture={profilePicture}
                            avatar={avatar}
                            avatarFrame={frame.id}
                            size="lg"
                            className="rounded-full"
                          />
                        </div>
                        <span className="text-[11px] font-bold text-slate-100 truncate w-full">{frame.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="text-xs font-extrabold text-white">Status</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {STATUS_OPTIONS.map((opt) => {
                    const selected = status === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => onCommit({ status: opt.value })}
                        className={`p-2 rounded-xl border flex items-center gap-2 transition-all ${
                          selected
                            ? 'bg-indigo-600/20 border-indigo-400 text-white'
                            : 'bg-[#1b1d25] border-white/10 text-slate-300 hover:border-white/25'
                        }`}
                      >
                        <div className="w-6 h-6 rounded-full overflow-hidden shrink-0" style={{ backgroundColor: opt.bgColor }}>
                          <MoonPhaseIcon status={opt.value} className="w-full h-full" withBackground={true} />
                        </div>
                        <span className="text-xs font-bold truncate">{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {kind === 'banner' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#1b1d25] border border-white/10 p-3">
                <div>
                  <div className="text-xs font-extrabold text-white">Imagem de Banner Personalizada</div>
                  <div className="text-[11px] text-slate-400">Envie uma imagem ou escolha um gradiente abaixo.</div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={bannerFileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleBannerFile}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => bannerFileRef.current?.click()}
                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{resolved.bannerImage ? 'Trocar Imagem' : 'Enviar Imagem'}</span>
                  </button>
                  {resolved.bannerImage && (
                    <button
                      type="button"
                      onClick={() => onCommit({ profile: { bannerImage: undefined } })}
                      className="px-2.5 py-1.5 rounded-xl bg-rose-500/15 text-rose-300 text-xs font-bold"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-extrabold text-white">Estilos de Banner</div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {BANNER_PRESETS.map((preset) => {
                    const selected = !resolved.bannerImage && resolved.bannerPreset === preset.id
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => onCommit({ profile: { bannerPreset: preset.id, bannerImage: undefined } })}
                        className={`h-14 rounded-xl border-2 p-2 flex items-end transition-all ${
                          selected ? 'border-white scale-[1.02]' : 'border-white/10 hover:border-white/40'
                        }`}
                        style={{ background: preset.background }}
                      >
                        <span className="text-[10px] font-bold text-white drop-shadow">{preset.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="text-xs font-extrabold text-white">Tema de Cor do Cartão</div>
                <div className="flex flex-wrap gap-2">
                  {PROFILE_THEME_PRESETS.map((theme) => {
                    const selected = resolved.themePrimary === theme.primary && resolved.themeAccent === theme.accent
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() =>
                          onCommit({ profile: { themePrimary: theme.primary, themeAccent: theme.accent } })
                        }
                        className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all ${
                          selected
                            ? 'border-white bg-white/10 text-white'
                            : 'border-white/10 bg-[#1b1d25] text-slate-300 hover:border-white/30'
                        }`}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-white/30"
                          style={{ background: `linear-gradient(135deg, ${theme.primary}, ${theme.accent})` }}
                        />
                        <span>{theme.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {kind === 'nameplate' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {NAMEPLATES.map((np) => {
                  const selected = (resolved.nameplate || 'none') === np.id
                  return (
                    <button
                      key={np.id}
                      type="button"
                      onClick={() => onCommit({ profile: { nameplate: np.id } })}
                      className={`text-left rounded-2xl p-1 transition-all border ${
                        selected
                          ? 'border-indigo-400 bg-indigo-500/15 ring-1 ring-indigo-400/40'
                          : 'border-transparent hover:border-white/20'
                      }`}
                    >
                      <ProfileBar
                        name={name || 'Você'}
                        profilePicture={profilePicture}
                        avatar={avatar}
                        profile={{ ...resolved, nameplate: np.id }}
                        status={status}
                        avatarSize="sm"
                        compact={true}
                        subtitle={np.name}
                      />
                    </button>
                  )
                })}
              </div>

              {resolved.nameplate === 'custom' && (
                <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-white/10 text-xs">
                  <label className="flex items-center gap-2 text-slate-200 font-bold">
                    <span>Cor base:</span>
                    <input
                      type="color"
                      value={resolved.nameplateColor || '#15202b'}
                      onChange={(e) => onCommit({ profile: { nameplateColor: e.target.value } })}
                      className="w-8 h-6 rounded border-0 bg-transparent cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-slate-200 font-bold">
                    <span>Cor de destaque:</span>
                    <input
                      type="color"
                      value={resolved.nameplateAccent || '#38bdf8'}
                      onChange={(e) => onCommit({ profile: { nameplateAccent: e.target.value } })}
                      className="w-8 h-6 rounded border-0 bg-transparent cursor-pointer"
                    />
                  </label>
                </div>
              )}
            </>
          )}

          {kind === 'identity' && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">Nome de Exibição</label>
                  <input
                    type="text"
                    value={draftName}
                    maxLength={32}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="Seu nome"
                    className="w-full bg-[#1b1d25] border border-white/10 rounded-xl px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">Usuário (@handle)</label>
                  <input
                    type="text"
                    value={draftHandle}
                    maxLength={28}
                    onChange={(e) => setDraftHandle(e.target.value)}
                    placeholder={formatProfileHandle(draftName)}
                    className="w-full bg-[#1b1d25] border border-white/10 rounded-xl px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-slate-300">Sobre mim (Bio)</label>
                  <span className="text-[10px] text-slate-500">{draftBio.length}/240</span>
                </div>
                <textarea
                  value={draftBio}
                  maxLength={240}
                  rows={3}
                  onChange={(e) => setDraftBio(e.target.value)}
                  placeholder="Escreva uma bio curta sobre você..."
                  className="w-full bg-[#1b1d25] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>
            </div>
          )}

          {kind === 'medals' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  Equipadas: <strong className="text-white">{(resolved.medals || []).length}/{MAX_PROFILE_MEDALS}</strong>
                </span>
                {(resolved.medals || []).length > 0 && (
                  <button
                    type="button"
                    onClick={() => onCommit({ profile: { medals: [] } })}
                    className="text-rose-300 hover:underline font-semibold"
                  >
                    Limpar todas
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PROFILE_MEDALS.map((medal) => {
                  const equipped = (resolved.medals || []).includes(medal.id)
                  const atLimit = !equipped && (resolved.medals || []).length >= MAX_PROFILE_MEDALS
                  return (
                    <button
                      key={medal.id}
                      type="button"
                      disabled={atLimit}
                      onClick={() => toggleMedal(medal.id)}
                      className={`p-2.5 rounded-xl border text-left flex items-start gap-2.5 transition-all disabled:opacity-45 ${
                        equipped
                          ? 'bg-indigo-600/20 border-indigo-400/70'
                          : 'bg-[#1b1d25] border-white/10 hover:border-white/25'
                      }`}
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-white/10"
                        style={{ backgroundColor: medal.bgColor, color: medal.color }}
                      >
                        <MedalIcon medalId={medal.id} className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-white truncate">{medal.name}</span>
                          <span
                            className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-white/10"
                            style={{ color: medal.color, backgroundColor: medal.bgColor }}
                          >
                            {medal.rarity}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{medal.description}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-white/10 bg-[#181920] flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDone}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-md shadow-indigo-600/25 transition-all active:scale-95"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Concluir</span>
          </button>
        </div>
      </div>

      <ImageCropModal
        isOpen={cropOpen}
        imageSrc={rawCropSrc}
        onCropComplete={(cropped) => {
          setCropOpen(false)
          setRawCropSrc(null)
          onCommit({ profilePicture: cropped })
        }}
        onCancel={() => {
          setCropOpen(false)
          setRawCropSrc(null)
        }}
      />
    </div>
  )
}
