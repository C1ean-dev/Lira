import React, { useMemo, useState } from 'react'
import { AvatarConfig, PresenceStatus, STATUS_META } from '../../types/game'
import { getPlayerAvatarSrc } from '../../utils/avatarUtils'
import { MoonPhaseIcon } from './MoonPhaseIcon'
import { SpotifyIcon } from './SpotifyIcon'
import { useCustomAssetsStore, onCustomAssetsChange } from '../../store/useCustomAssetsStore'
import { getAssetImageRevision } from '../../assets/assetRevision'

export interface PlayerAvatarProps {
  player?: {
    name?: string
    profilePicture?: string
    avatar?: AvatarConfig
    status?: PresenceStatus | 'offline' | string
    spotifyActivity?: {
      track: string
      artist: string
      isPlaying: boolean
      startedAt?: number
    }
  } | null
  name?: string
  profilePicture?: string
  avatar?: AvatarConfig
  status?: PresenceStatus | 'offline' | string
  showStatus?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl'
  customSizeClass?: string
  className?: string
  alt?: string
  onClick?: (e: React.MouseEvent) => void
}

const SIZE_MAP = {
  xs: { container: 'w-5 h-5 rounded-md text-[10px]', dot: 'w-1.5 h-1.5' },
  sm: { container: 'w-7 h-7 rounded-lg text-xs', dot: 'w-2 h-2' },
  md: { container: 'w-9 h-9 rounded-xl text-sm', dot: 'w-2.5 h-2.5' },
  lg: { container: 'w-12 h-12 rounded-2xl text-base', dot: 'w-3 h-3' },
  xl: { container: 'w-16 h-16 rounded-2xl text-xl', dot: 'w-3.5 h-3.5' },
  '2xl': { container: 'w-20 h-20 rounded-full text-2xl', dot: 'w-5 h-5' },
  '3xl': { container: 'w-28 h-28 rounded-full text-3xl', dot: 'w-5 h-5' },
  '4xl': { container: 'w-36 h-36 rounded-full text-4xl', dot: 'w-6 h-6' },
}

export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  player,
  name,
  profilePicture,
  avatar,
  status,
  showStatus = false,
  size = 'md',
  customSizeClass,
  className = '',
  alt,
  onClick,
}) => {
  const [imgError, setImgError] = useState(false)
  const customAssets = useCustomAssetsStore(state => state.customAssets)
  const imageRevision = React.useSyncExternalStore(onCustomAssetsChange, getAssetImageRevision, getAssetImageRevision)

  const effectiveName = name || player?.name || 'Player'
  const effectiveCustomPic = profilePicture !== undefined ? profilePicture : player?.profilePicture
  const effectiveAvatar = avatar || player?.avatar
  const effectiveStatus = status || player?.status || 'available'
  const isDjBot = Boolean((player as any)?.isDjBot || effectiveName === 'Spotify DJ' || effectiveName === 'DJ Spotify')

  const hasCustomPic = !isDjBot && !!(effectiveCustomPic && effectiveCustomPic.trim() !== '')

  const avatarSrc = useMemo(() => {
    const targetSize =
      size === '4xl' ? 144 : size === '3xl' ? 128 : size === '2xl' || size === 'xl' ? 96 : 64
    return getPlayerAvatarSrc(
      {
        name: effectiveName,
        profilePicture: effectiveCustomPic,
        avatar: effectiveAvatar,
      },
      targetSize
    )
  }, [effectiveName, effectiveCustomPic, effectiveAvatar, size, customAssets, imageRevision])

  React.useEffect(() => {
    setImgError(false)
  }, [avatarSrc, effectiveCustomPic])

  const sizeClasses = SIZE_MAP[size] || SIZE_MAP.md
  const statusMeta =
    effectiveStatus === 'offline'
      ? { label: 'Offline', dotColor: 'bg-slate-500', hexColor: '#64748b' }
      : STATUS_META[effectiveStatus as PresenceStatus] || STATUS_META.available

  const bgColor = effectiveAvatar?.shirtColor || effectiveAvatar?.topColor || '#3b82f6'

  const characterPadding =
    size === '4xl' || size === '3xl' ? 'p-1.5' : size === '2xl' || size === 'xl' ? 'p-1' : 'p-0.5'

  if (isDjBot) {
    const iconSize =
      size === '4xl' ? 56 : size === '3xl' ? 44 : size === '2xl' ? 36 : size === 'xl' ? 28 : size === 'lg' ? 22 : 16
    return (
      <div
        onClick={onClick}
        className={`relative shrink-0 flex items-center justify-center overflow-hidden border border-[#1db954]/50 bg-[#0e1117] shadow-md select-none ${
          customSizeClass || sizeClasses.container
        } ${className}`}
        title="DJ"
      >
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1db954]/25 via-[#12151d] to-[#1db954]/10">
          <SpotifyIcon size={iconSize} className="text-[#1db954]" />
        </div>
        {showStatus && (
          <div
            className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-[#12151d] overflow-hidden flex items-center justify-center bg-[#1db954] ${sizeClasses.dot}`}
            title="DJ Ativo"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      onClick={onClick}
      className={`relative shrink-0 flex items-center justify-center overflow-hidden border border-white/15 shadow-sm select-none ${
        customSizeClass || sizeClasses.container
      } ${className}`}
      style={{ backgroundColor: hasCustomPic ? '#12151d' : `${bgColor}25` }}
    >
      {!imgError && avatarSrc ? (
        <img
          src={avatarSrc}
          alt={alt || effectiveName}
          onError={() => setImgError(true)}
          className={`w-full h-full ${
            hasCustomPic
              ? 'object-cover'
              : `object-contain pixelated ${characterPadding} transition-transform duration-150`
          }`}
          loading="lazy"
        />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center font-bold text-white uppercase"
          style={{ backgroundColor: bgColor }}
        >
          {effectiveName.charAt(0)}
        </div>
      )}

      {showStatus && (
        <div
          className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-[#12151d] overflow-hidden flex items-center justify-center bg-[#12151d] ${sizeClasses.dot}`}
          title={`Status: ${statusMeta.label}${(statusMeta as any).moonPhase ? ` (${(statusMeta as any).moonPhase})` : ''}`}
        >
          <MoonPhaseIcon status={effectiveStatus} className="w-full h-full" withBackground={true} />
        </div>
      )}

      {player?.spotifyActivity?.isPlaying && (
        <div
          onClick={(e) => {
            e.stopPropagation()
            const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null
            const query = `${player.spotifyActivity!.artist} ${player.spotifyActivity!.track}`.trim()
            const deepLink = `spotify:search:${encodeURIComponent(query)}`
            if (electronAPI?.openExternal) {
              electronAPI.openExternal(deepLink)
            } else {
              window.open(`https://open.spotify.com/search/${encodeURIComponent(query)}`, '_blank')
            }
          }}
          className={`absolute -top-0.5 -right-0.5 rounded-full ring-2 ring-[#12151d] overflow-hidden flex items-center justify-center bg-[#1db954] text-black shadow-md cursor-pointer hover:scale-125 transition-transform ${sizeClasses.dot}`}
          title={`Ouvindo no Spotify: ${player.spotifyActivity.track}${player.spotifyActivity.artist ? ` - ${player.spotifyActivity.artist}` : ''} (Clique para abrir)`}
        >
          <SpotifyIcon size={10} className="w-full h-full text-black p-0.5" />
        </div>
      )}
    </div>
  )
}
