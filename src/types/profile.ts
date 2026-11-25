export type AvatarFrameId =
  | 'none'
  | 'spirit-flame'
  | 'neon-cyber'
  | 'cosmic-orbit'
  | 'golden-crown'
  | 'sakura-bloom'
  | 'crimson-eclipse'
  | 'pixel-arcade'
  | 'emerald-pulse'
  | 'aurora-prism'
  | 'cat-ears'
  | 'frost-crystal'

export type NameplateId =
  | 'none'
  | 'spirit-mist'
  | 'cyber-grid'
  | 'sakura-breeze'
  | 'solar-flare'
  | 'aurora-boreal'
  | 'midnight-stars'
  | 'pixel-wave'
  | 'royal-gold'
  | 'custom'

export type BannerPresetId =
  | 'obsidian'
  | 'midnight'
  | 'spirit-cyan'
  | 'aurora'
  | 'crimson-moon'
  | 'sunset-lofi'
  | 'sakura-dusk'
  | 'emerald-matrix'
  | 'gold-royal'
  | 'cyber-magenta'

export type ProfileMedalId =
  | 'pioneer'
  | 'gamer'
  | 'architect'
  | 'dj'
  | 'dev'
  | 'artist'
  | 'night-owl'
  | 'friendly'
  | 'explorer'
  | 'host'
  | 'vip'
  | 'supporter'

export type PopularGameId =
  | 'zzz'
  | 'genshin-impact'
  | 'honkai-star-rail'
  | 'wuthering-waves'
  | 'league-of-legends'
  | 'valorant'
  | 'cs2'
  | 'minecraft'
  | 'stardew-valley'
  | 'dead-by-daylight'
  | 'fortnite'
  | 'gta-v'
  | 'elden-ring'
  | 'hollow-knight'
  | 'terraria'
  | 'roblox'
  | 'apex-legends'
  | 'overwatch-2'
  | 'rocket-league'
  | 'ea-fc'
  | 'baldurs-gate-3'
  | 'cyberpunk-2077'
  | 'rdr2'
  | 'the-sims-4'
  | 'palworld'
  | 'warzone'
  | 'dota-2'
  | 'phasmophobia'
  | 'marvel-rivals'
  | 'pubg'
  | 'rainbow-six-siege'
  | 'rust'
  | 'helldivers-2'
  | 'lethal-company'
  | 'the-witcher-3'
  | 'skyrim'
  | 'warframe'
  | 'destiny-2'
  | 'team-fortress-2'
  | 'left-4-dead-2'
  | 'sea-of-thieves'
  | 'among-us'
  | 'subnautica'
  | 'no-mans-sky'
  | 'ets2'
  | 'forza-horizon-5'
  | 'street-fighter-6'
  | 'tekken-8'
  | 'persona-5-royal'
  | 'hades'
  | 'cuphead'
  | 'celeste'
  | 'valheim'
  | 'project-zomboid'
  | 'deep-rock-galactic'
  | 'dayz'
  | 'monster-hunter-world'
  | 'path-of-exile-2'
  | 'fallout-4'
  | 'rimworld'
  | 'factorio'
  | 'civ-6'
  | 'ffxiv'
  | 'black-myth-wukong'

export interface UserProfile {
  handle?: string
  pronouns?: string
  bio?: string
  memberSince?: number
  bannerPreset?: BannerPresetId
  bannerColor?: string
  bannerImage?: string
  themePrimary?: string
  themeAccent?: string
  avatarFrame?: AvatarFrameId
  nameplate?: NameplateId
  nameplateColor?: string
  nameplateAccent?: string
  medals?: ProfileMedalId[]
  games?: PopularGameId[]
}

export const MAX_PROFILE_MEDALS = 8
export const MAX_PROFILE_GAMES = 16
