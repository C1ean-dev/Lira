import { Player } from './game'
import { MapData, PlacedFurniture, PrivateZone } from './map'
import { ChatMessage } from './chat'

export type SignalingTier = 'render' | 'public' | 'local'

export type NetworkMessageType =
  | 'PLAYER_JOIN'
  | 'PLAYER_LEAVE'
  | 'PLAYER_MOVE'
  | 'PLAYER_UPDATE'
  | 'BED_INTERACTION'
  | 'MAP_SYNC'
  | 'MAP_EDIT'
  | 'CUSTOM_ASSETS_SYNC'
  | 'CUSTOM_ASSET_ADD_OR_UPDATE'
  | 'CUSTOM_ASSET_DELETE'
  | 'INDIVIDUAL_LIBRARY'
  | 'CHAT_MESSAGE'
  | 'CHAT_MESSAGE_STATUS'
  | 'CHANNELS_SYNC'
  | 'REACTION'
  | 'REQUEST_MAP'
  | 'HEARTBEAT'
  | 'HEARTBEAT_ACK'
  | 'HOST_TRANSFER'
  | 'ROOM_LOCK_TOGGLE'
  | 'ROOM_KNOCK_REQUEST'
  | 'ROOM_KNOCK_RESPONSE'
  | 'USER_AUDIO_ISOLATION'
  | 'ADMIN_MUTE_PARTICIPANT'
  | 'ADMIN_DEAFEN_PARTICIPANT'
  | 'LIVE_VIEW'
  | 'SPOTIFY_JAM_SYNC'
  | 'SPOTIFY_TRACK_SHARE'
  | 'SPOTIFY_DJ_STATUS'
  | 'SPOTIFY_DJ_STOP'
  | 'SPOTIFY_DJ_COMMAND'
  | 'SPOTIFY_DJ_COMMAND_RESULT'
  | 'SPOTIFY_DJ_REQUEST'
  | 'SPOTIFY_DJ_REQUEST_RESULT'
  | 'SPOTIFY_DJ_SEARCH'
  | 'SPOTIFY_DJ_SEARCH_ACK'
  | 'SPOTIFY_DJ_SEARCH_RESULT'
  | 'DJ_CALL_REQUEST'

export interface NetworkMessage {
  type: NetworkMessageType
  senderId: string
  payload: any
  timestamp: number
}

export interface PlayerMovePayload {
  x: number
  y: number
  direction: 'up' | 'down' | 'left' | 'right'
  isMoving: boolean
}

export interface PlayerUpdatePayload {
  player: Partial<Player>
}

export interface MapEditPayload {
  action: 'consume_furniture' | 'set_floor' | 'set_wall' | 'add_furniture' | 'remove_furniture' | 'add_zone' | 'remove_zone' | 'update_zone'
  data: any
}

export interface PeerConnectionState {
  peerId: string
  isConnected: boolean
  isHost: boolean
  latency?: number
}

export interface UserAudioIsolationPayload {
  targetUserId: string
  sourceUserId: string
  sourceUserName?: string
  isSilenced: boolean
}

export interface AdminMutePayload {
  targetUserId: string
  targetGameId?: string
  targetUserName?: string
  mute: boolean
  adminName: string
}

export interface LiveViewPayload {
  to: string
  watch: boolean
  h: number | null
}

export interface AdminDeafenPayload {
  targetUserId: string
  targetGameId?: string
  targetUserName?: string
  deafen: boolean
  adminName: string
}
