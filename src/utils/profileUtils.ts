import {
  AVATAR_FRAME_MAP,
  BANNER_PRESET_MAP,
  DEFAULT_USER_PROFILE,
  NAMEPLATE_MAP,
  POPULAR_GAME_MAP,
  PROFILE_MEDAL_MAP,
} from '../data/profileCatalog'
import {
  AvatarFrameId,
  BannerPresetId,
  MAX_PROFILE_GAMES,
  MAX_PROFILE_MEDALS,
  NameplateId,
  PopularGameId,
  ProfileMedalId,
  UserProfile,
} from '../types/profile'

const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i
const SAFE_HEX_COLOR_RE = /^#[0-9a-f]{3,8}$/i

export function isSafeProfileImage(value: unknown, maxLength = 750_000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && SAFE_DATA_IMAGE_RE.test(value)
}

export function sanitizeHexColor(value: unknown, fallback?: string): string | undefined {
  if (typeof value === 'string' && SAFE_HEX_COLOR_RE.test(value.trim())) {
    return value.trim()
  }
  return fallback
}

export function formatProfileHandle(name: string, handle?: string): string {
  const custom = (handle || '').trim()
  if (custom) return custom.startsWith('@') || custom.startsWith('.') ? custom : `@${custom}`
  const slug = (name || 'player')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 24)
  return `@${slug || 'player'}`
}

export function formatMemberSince(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) return 'Membro recente'
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(timestamp))
  } catch {
    return new Date(timestamp).toLocaleDateString()
  }
}

export function resolveProfile(profile?: UserProfile | null): UserProfile {
  if (!profile) return { ...DEFAULT_USER_PROFILE }
  return {
    ...DEFAULT_USER_PROFILE,
    ...profile,
    avatarFrame: profile.avatarFrame && AVATAR_FRAME_MAP[profile.avatarFrame] ? profile.avatarFrame : 'none',
    nameplate: profile.nameplate && NAMEPLATE_MAP[profile.nameplate] ? profile.nameplate : 'none',
    bannerPreset: profile.bannerPreset && BANNER_PRESET_MAP[profile.bannerPreset] ? profile.bannerPreset : 'obsidian',
    medals: Array.isArray(profile.medals)
      ? profile.medals.filter((m): m is ProfileMedalId => !!PROFILE_MEDAL_MAP[m]).slice(0, MAX_PROFILE_MEDALS)
      : DEFAULT_USER_PROFILE.medals,
    games: Array.isArray(profile.games)
      ? Array.from(new Set(profile.games.filter((g): g is PopularGameId => !!POPULAR_GAME_MAP[g]))).slice(
          0,
          MAX_PROFILE_GAMES
        )
      : [],
  }
}

export function sanitizeIncomingProfile(raw: unknown): UserProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>

  const avatarFrame: AvatarFrameId =
    typeof src.avatarFrame === 'string' && src.avatarFrame in AVATAR_FRAME_MAP
      ? (src.avatarFrame as AvatarFrameId)
      : 'none'
  const nameplate: NameplateId =
    typeof src.nameplate === 'string' && src.nameplate in NAMEPLATE_MAP
      ? (src.nameplate as NameplateId)
      : 'none'
  const bannerPreset: BannerPresetId =
    typeof src.bannerPreset === 'string' && src.bannerPreset in BANNER_PRESET_MAP
      ? (src.bannerPreset as BannerPresetId)
      : 'obsidian'

  const medals: ProfileMedalId[] = Array.isArray(src.medals)
    ? Array.from(
        new Set(
          src.medals.filter((id): id is ProfileMedalId => typeof id === 'string' && id in PROFILE_MEDAL_MAP)
        )
      ).slice(0, MAX_PROFILE_MEDALS)
    : []

  const games: PopularGameId[] = Array.isArray(src.games)
    ? Array.from(
        new Set(
          src.games.filter((id): id is PopularGameId => typeof id === 'string' && id in POPULAR_GAME_MAP)
        )
      ).slice(0, MAX_PROFILE_GAMES)
    : []

  return {
    handle: typeof src.handle === 'string' ? src.handle.trim().slice(0, 28) : undefined,
    pronouns: typeof src.pronouns === 'string' ? src.pronouns.trim().slice(0, 28) : undefined,
    bio: typeof src.bio === 'string' ? src.bio.trim().slice(0, 240) : undefined,
    memberSince: typeof src.memberSince === 'number' && Number.isFinite(src.memberSince) ? src.memberSince : undefined,
    bannerPreset,
    bannerColor: sanitizeHexColor(src.bannerColor),
    bannerImage: isSafeProfileImage(src.bannerImage, 600_000) ? src.bannerImage : undefined,
    themePrimary: sanitizeHexColor(src.themePrimary, '#0f1014'),
    themeAccent: sanitizeHexColor(src.themeAccent, '#2b2d31'),
    avatarFrame,
    nameplate,
    nameplateColor: sanitizeHexColor(src.nameplateColor),
    nameplateAccent: sanitizeHexColor(src.nameplateAccent),
    medals,
    games,
  }
}

export function stripProfileMedia(profile?: UserProfile): UserProfile | undefined {
  if (!profile) return undefined
  return {
    ...profile,
    bannerImage: undefined,
  }
}

export function compressProfileImageFile(
  file: File,
  maxWidth: number,
  maxHeight: number,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('O arquivo selecionado não é uma imagem válida.'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Erro ao ler a imagem selecionada.'))
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl) {
        reject(new Error('Imagem vazia.'))
        return
      }
      const img = new Image()
      img.onerror = () => reject(new Error('Não foi possível decodificar a imagem.'))
      img.onload = () => {
        try {
          const ratio = Math.min(1, maxWidth / Math.max(1, img.naturalWidth), maxHeight / Math.max(1, img.naturalHeight))
          const w = Math.max(1, Math.round(img.naturalWidth * ratio))
          const h = Math.max(1, Math.round(img.naturalHeight * ratio))
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            resolve(dataUrl)
            return
          }
          ctx.drawImage(img, 0, 0, w, h)
          const mime = file.type === 'image/png' ? 'image/webp' : 'image/jpeg'
          const out = canvas.toDataURL(mime, quality)
          resolve(out.startsWith('data:image/') ? out : canvas.toDataURL('image/jpeg', quality))
        } catch {
          resolve(dataUrl)
        }
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

export function getNameplateStyle(profile?: UserProfile | null): {
  hasCustomNameplate: boolean
  nameplateId: NameplateId
  background: string
  borderColor: string
  accentColor: string
} {
  const resolved = resolveProfile(profile)
  const id = resolved.nameplate || 'none'
  if (id === 'none') {
    return {
      hasCustomNameplate: false,
      nameplateId: 'none',
      background: NAMEPLATE_MAP.none.gradient,
      borderColor: NAMEPLATE_MAP.none.borderColor,
      accentColor: NAMEPLATE_MAP.none.accentColor,
    }
  }
  if (id === 'custom') {
    const primary = resolved.nameplateColor || '#151926'
    const accent = resolved.nameplateAccent || '#38bdf8'
    return {
      hasCustomNameplate: true,
      nameplateId: 'custom',
      background: `linear-gradient(90deg, #14161b 0%, ${primary} 48%, ${accent} 100%)`,
      borderColor: `${accent}66`,
      accentColor: accent,
    }
  }
  const meta = NAMEPLATE_MAP[id] || NAMEPLATE_MAP.none
  return {
    hasCustomNameplate: true,
    nameplateId: id,
    background: meta.gradient,
    borderColor: meta.borderColor,
    accentColor: meta.accentColor,
  }
}
