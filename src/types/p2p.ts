import { Player } from './game'
import { MapData, PlacedFurniture, PrivateZone } from './map'
import { ChatMessage } from './chat'

export type NetworkMessageType =
  | 'PLAYER_JOIN'
  | 'PLAYER_LEAVE'
  | 'PLAYER_MOVE'
  | 'PLAYER_UPDATE'
  | 'MAP_SYNC'
  | 'MAP_EDIT'
  | 'CUSTOM_ASSETS_SYNC'
  | 'CUSTOM_ASSET_ADD_OR_UPDATE'
  | 'CUSTOM_ASSET_DELETE'
  | 'CHAT_MESSAGE'
  | 'CHAT_MESSAGE_STATUS'
  | 'CHANNELS_SYNC'
  | 'REACTION'
  | 'REQUEST_MAP'
  | 'HEARTBEAT'
  | 'HEARTBEAT_ACK'
  | 'ROOM_LOCK_TOGGLE'
  | 'ROOM_KNOCK_REQUEST'
  | 'ROOM_KNOCK_RESPONSE'
  | 'USER_AUDIO_ISOLATION'
  | 'ADMIN_MUTE_PARTICIPANT'
  | 'ADMIN_DEAFEN_PARTICIPANT'
  | 'LIVE_VIEW'

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
  action: 'set_floor' | 'set_wall' | 'add_furniture' | 'remove_furniture' | 'add_zone' | 'remove_zone' | 'update_zone'
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

/**
 * A viewer to who is live: whether it watches the live, and how tall the
 * picture is on its screen. It is for one peer (`to`); the room carries it
 * like any other message, and everybody else ignores it.
 */
export interface LiveViewPayload {
  to: string
  watch: boolean
  /** Device pixels; 0 while the window of the viewer shows nothing; null when not known (everything). */
  h: number | null
}

export interface AdminDeafenPayload {
  targetUserId: string
  targetGameId?: string
  targetUserName?: string
  deafen: boolean
  adminName: string
}
