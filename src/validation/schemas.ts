import { z } from 'zod'
import type { Player, PublicRoomInfo, ReactionItem, RoomKnockRequest } from '../types/game'
import type { UserProfile } from '../types/profile'
import type { ChatMessage, RoomChannel } from '../types/chat'
import type { MapData, StoredMapData, PlacedFurniture, PrivateZone, FloorType, WallType } from '../types/map'
import { MISSING_FURNITURE_DEF_ID } from '../types/map'
import type { CustomAsset } from '../types/customAsset'
import type { PersistedAtlas } from '../assets/atlasFormat'
import type { AtlasChunk } from '../assets/atlasChunks'
import type { LibraryMessage } from '../assets/individualLibrarySync'
import type { ZoneJamSession, SharedSpotifyTrack, SpotifyDjState } from '../types/spotifyJam'
import type { SpotifyPlaybackCommand, SpotifyPlaybackResult } from '../types/spotifyPlayback'
import type { SpotifySearchResult, SpotifySearchTrack } from '../types/spotifySearch'
import type { SpotifyDjRequestResult } from '../types/spotifyDjRequests'
import { whiteboardOperationSchema } from '../collaboration/whiteboard'
import { gstreamerSignalSchema } from '../media/gstreamerProtocol'

const finite = z.number().finite()
const id = z.string().min(1).max(512)
const text = z.string()
const object = z.object({}).passthrough()
// Domain schemas preserve optional fields owned by their existing specialized validators.
const domain = <T>(schema: z.ZodType): z.ZodType<T> => schema as z.ZodType<T>
const optionalFinite = finite.optional()
const optionalBool = z.boolean().optional()

export const graphicsSettingsSchema = z.object({
  targetFps: optionalFinite, showFpsCounter: optionalBool, enableCulling: optionalBool,
  moveSpeed: optionalFinite, showNameTags: optionalBool,
})
export const audioSettingsSchema = z.object({
  selectedAudioInput: text.optional(), selectedAudioOutput: text.optional(), selectedVideoInput: text.optional(),
  inputVolume: optionalFinite, outputVolume: optionalFinite, manualSensitivityThreshold: optionalFinite,
  screenShareAudioVolume: optionalFinite, isNoiseSuppressionEnabled: optionalBool,
  echoCancellation: optionalBool, autoGainControl: optionalBool, duckingEnabled: optionalBool,
  screenShareIsolateCallAudio: optionalBool, hasUserChosenProcessorMode: optionalBool,
}).catchall(z.union([text, finite, z.boolean(), z.null(), z.array(finite), object]))
export const attachmentSchema = z.object({ id, name: text, size: finite.nonnegative(), type: text,
  dataUrl: text.startsWith('data:') }).passthrough()
const chatWireSchema = z.object({ id, senderId: id, senderName: text, channelId: id,
  content: text, timestamp: finite.nonnegative(), attachment: attachmentSchema.optional(),
  recipientId: text.optional(), status: z.enum(['sent', 'delivered', 'read']).optional(),
  mentions: z.array(z.object({ kind: z.enum(['person', 'pet']), id, name: text,
    start: finite.int().nonnegative(), end: finite.int().nonnegative() })).optional(),
}).passthrough()
export const chatMessageSchema = domain<ChatMessage>(chatWireSchema)
export const publicRoomSchema = domain<PublicRoomInfo>(z.object({ id, code: id, name: text,
  hostId: id, hostName: text, playerCount: finite.int().nonnegative(), maxPlayers: finite.int().positive(),
  color: text, createdAt: finite.default(0), lastHeartbeat: finite.default(0),
}).passthrough())
const directionSchema = z.enum(['up', 'down', 'left', 'right'])
const presenceStatusSchema = z.enum(['available', 'busy', 'focusing', 'away'])
const avatarSchema = z.object({
  ...Object.fromEntries(['skinTone', 'skinColor', 'skinDetail', 'eyeType', 'eyeColor', 'hairStyle', 'hairColor', 'facialHair', 'facialHairColor', 'topType', 'shirtType', 'topColor', 'shirtColor', 'jacketType', 'jacketColor', 'bottomType', 'bottomColor', 'pantsColor', 'shoesType', 'shoesColor', 'hatType', 'hatColor', 'glassesType', 'glassesColor', 'accessory', 'accessoryColor', 'otherType', 'otherColor', 'customSkinUrl', 'customAvatarId'].map(key => [key, text.optional()])),
  pet: z.object({ type: z.enum(['none', 'dog', 'cat', 'meowth', 'slime', 'chick', 'custom']), name: text.optional(), personality: text.optional(), color: text.optional(), customAssetId: text.optional(),
    directionalFrames: z.record(directionSchema, z.union([text, z.array(text)]).optional()).optional() }).optional(),
  customComponents: z.record(text, z.union([text, z.record(directionSchema, z.union([text, z.array(text)]).optional())])).optional(),
}).passthrough()
export const userProfileSchema = domain<UserProfile>(z.object({
  handle: text.optional(),
  pronouns: text.optional(),
  bio: text.optional(),
  memberSince: optionalFinite,
  bannerPreset: text.optional(),
  bannerColor: text.optional(),
  bannerImage: text.optional(),
  themePrimary: text.optional(),
  themeAccent: text.optional(),
  avatarFrame: text.optional(),
  nameplate: text.optional(),
  nameplateColor: text.optional(),
  nameplateAccent: text.optional(),
  medals: z.array(text).optional(),
  games: z.array(text).optional(),
}).passthrough())

export const playerSchema = domain<Partial<Player>>(z.object({
  id: id.optional(), gameId: id.optional(), name: text.optional(), profilePicture: text.optional(),
  profile: userProfileSchema.optional(),
  x: optionalFinite, y: optionalFinite, targetX: optionalFinite, targetY: optionalFinite,
  direction: directionSchema.optional(), isMoving: optionalBool, seatedOn: text.nullable().optional(),
  activityAnimation: text.optional(), activityAnimationStartedAt: optionalFinite, activityAnimationManual: optionalBool,
  currentZoneId: text.nullable().optional(), avatar: avatarSchema.optional(),
  status: presenceStatusSchema.optional(), statusText: text.optional(), statusEmoji: text.optional(),
  lastUpdated: optionalFinite, ping: optionalFinite, isOwner: optionalBool, isHost: optionalBool,
  role: z.enum(['owner', 'host', 'admin', 'member', 'guest']).optional(),
  permissions: z.object({ canEditMap: optionalBool, canManageRoles: optionalBool, canMuteOthers: optionalBool, canKick: optionalBool }).optional(),
  isMuted: optionalBool, isMutedByAdmin: optionalBool, isDeafened: optionalBool, isCameraOff: optionalBool,
  isScreenSharing: optionalBool, liveOptIn: optionalBool,
  callState: z.enum(['idle', 'connecting', 'connected', 'reconnecting', 'failed']).optional(),
  spotifyActivity: z.object({ track: text, artist: text, isPlaying: z.boolean(), startedAt: optionalFinite }).optional(),
  isDjBot: optionalBool, djOwnerId: text.optional(), appVersion: text.optional(), minCompatibleVersion: text.optional(), isOutdated: optionalBool,
}).passthrough())
const furnitureWireSchema = z.object({ id, defId: id, x: finite, y: finite, rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(), direction: directionSchema.optional(), tintColor: text.optional(), consumptionStage: finite.int().min(0).max(3).optional() }).passthrough()
const furniture = domain<PlacedFurniture>(furnitureWireSchema)
const zoneWireSchema = z.object({ id, name: text, color: text.optional(), x: finite, y: finite, width: finite.positive(), height: finite.positive(), description: text.optional(), maxCapacity: optionalFinite, hasWalls: optionalBool, wallType: text.optional(), admins: z.array(id).optional(), members: z.array(id).optional(), authorizedPeers: z.array(id).optional(), isLocked: optionalBool, allowKnock: optionalBool, welcomeMessage: text.optional() }).passthrough()
const zone = domain<PrivateZone>(zoneWireSchema)
const mapWireSchema = z.object({ id, name: text, width: finite.positive(), height: finite.positive(),
  tileSize: finite.positive(), defaultFloor: text.optional(), floorRectangles: z.array(z.object({ x: finite, y: finite, width: finite.positive(), height: finite.positive(), floor: text })).optional(), floorOverrides: z.record(text, text).optional(), wallOverrides: z.record(text, text.nullable()).optional(), spawnPoint: z.object({ x: finite, y: finite }),
  furniture: z.array(furniture), zones: z.array(zone), floors: z.array(z.array(text)), walls: z.array(z.array(text.nullable())),
}).passthrough()
export const mapSchema = domain<MapData>(mapWireSchema)
const storedZoneSchema = zoneWireSchema.extend({
  welcomeMessage: text.nullish().transform(message => message ?? undefined),
})
const storedFurnitureSchema = furnitureWireSchema.extend({
  defId: z.preprocess(value => {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return MISSING_FURNITURE_DEF_ID
    return value
  }, id),
})
export const storedMapSchema = domain<StoredMapData>(mapWireSchema.partial().extend({
  id: id.default('custom_map'),
  furniture: z.array(storedFurnitureSchema).optional(),
  zones: z.array(storedZoneSchema).optional(),
}))
export const savedSpaceSchema = z.object({ id: text.optional(), roomCode: text.optional(), name: text.optional(), description: text.optional(), color: text.optional(), createdAt: optionalFinite, updatedAt: optionalFinite, mapData: storedMapSchema.optional(), channels: z.array(z.object({ id, name: text, description: text.optional() })).optional() }).passthrough()
const channel = domain<RoomChannel>(z.object({ id, name: text, description: text.optional() }))
const mapEdit = z.discriminatedUnion('action', [
  z.object({ action: z.literal('consume_furniture'), data: z.object({ mapId: id, id, expected: finite.int() }) }),
  z.object({ action: z.literal('set_floor'), data: z.object({ x: finite, y: finite, floor: domain<FloorType>(text) }) }),
  z.object({ action: z.literal('paint_floor_in_zone'), data: z.object({ zoneId: id, floor: domain<FloorType>(text) }) }),
  z.object({ action: z.literal('set_wall'), data: z.object({ x: finite, y: finite, wall: domain<WallType>(text).nullable() }) }),
  z.object({ action: z.literal('add_furniture'), data: z.object({ furniture }) }),
  z.object({ action: z.literal('remove_furniture'), data: z.object({ id: id.optional(), x: optionalFinite, y: optionalFinite }) }),
  z.object({ action: z.literal('add_zone'), data: z.object({ zone }) }),
  z.object({ action: z.literal('remove_zone'), data: z.object({ id }) }),
  z.object({ action: z.literal('update_zone'), data: z.object({ id, partial: domain<Partial<PrivateZone>>(zoneWireSchema.partial()).optional(), zone: zone.optional() }) }),
])
const atlas = domain<PersistedAtlas>(object)
const asset = domain<CustomAsset>(z.object({ id, name: text, type: text }).passthrough())
const sessionEnvelope = { zoneId: id, ownerId: id, startedAt: finite, requestId: id }
const djPayload = z.object({ ...sessionEnvelope, query: text.optional(), recipientId: id.optional(),
  track: domain<SpotifySearchTrack>(object).optional(), result: domain<SpotifySearchResult & SpotifyDjRequestResult & SpotifyPlaybackResult>(object).optional(),
  command: domain<SpotifyPlaybackCommand>(z.object({ action: z.enum(['shuffle', 'previous', 'playpause', 'next', 'repeat', 'seek']), fraction: optionalFinite })).optional(),
}).passthrough()
const boardBase = { roomId: id, schemaVersion: z.literal(2) }

export const networkPayloadSchemas = {
  PLAYER_JOIN: z.object({ player: playerSchema }),
  PLAYER_UPDATE: z.object({ player: playerSchema }),
  PLAYER_MOVE: z.object({ x: finite, y: finite, direction: z.enum(['up', 'down', 'left', 'right']), isMoving: z.boolean() }),
  PLAYER_LEAVE: z.object({ peerId: id.optional() }),
  VERSION_INCOMPATIBLE: z.object({ minVersion: text.optional(), currentVersion: text.optional(), message: text.optional() }),
  MAP_SYNC: z.object({ mapData: mapSchema }), MAP_EDIT: mapEdit,
  CUSTOM_ASSETS_SYNC: z.object({ atlas: atlas.optional(), digest: text.optional(), chunk: domain<AtlasChunk>(object).optional(), customAssets: z.array(asset).optional(), categories: z.array(text).optional() }),
  CUSTOM_ASSET_ADD_OR_UPDATE: z.object({ atlas: atlas.optional(), digest: text.optional(), asset: asset.optional() }),
  CUSTOM_ASSET_DELETE: z.object({ id }), INDIVIDUAL_LIBRARY: domain<LibraryMessage>(z.object({ kind: z.enum(['hello', 'offer', 'request', 'image']), id }).passthrough()),
  CHAT_MESSAGE: z.object({ message: chatMessageSchema }),
  CHAT_MESSAGE_STATUS: z.object({ senderId: id.optional(), senderName: text.optional(), recipientId: text.optional(), messageId: id.optional(),
    channelId: text.optional(), status: z.enum(['sent', 'delivered', 'read']), upToTimestamp: optionalFinite, timestamp: optionalFinite }),
  CHANNELS_SYNC: z.object({ channels: z.array(channel).max(100) }),
  REACTION: z.object({ reaction: domain<ReactionItem>(z.object({ id, playerId: id, emoji: text, x: finite, y: finite, createdAt: finite }).passthrough()) }), REQUEST_MAP: object,
  HEARTBEAT: object, HEARTBEAT_ACK: z.object({ clientTimestamp: finite }),
  HOST_TRANSFER: z.object({ kind: z.enum(['request', 'prepare', 'release', 'reject', 'confirm', 'ready', 'cancel', 'rejected']), id, targetPeerId: id.optional(),
    targetGameId: text.optional(), message: text.optional(), room: z.object({ roomName: text, roomDescription: text, isPublic: z.boolean(), maxPlayers: finite, color: text }).optional(),
  }).passthrough(),
  PEER_UNREACHABLE_REPORT: z.object({ peerId: id }),
  ROOM_LOCK_TOGGLE: z.object({ zoneId: id, isLocked: z.boolean(), authorizedPeers: z.array(text).optional(), members: z.array(text).optional(), admins: z.array(text).optional() }),
  ROOM_KNOCK_REQUEST: domain<RoomKnockRequest>(z.object({ id, zoneId: id, requesterId: id, timestamp: finite }).passthrough()),
  ROOM_KNOCK_RESPONSE: z.object({ zoneId: id, requesterId: id, approved: z.boolean(), requesterName: text.optional(), approverName: text.optional() }),
  USER_AUDIO_ISOLATION: z.object({ targetUserId: text, sourceUserId: text, sourceUserName: text.optional(), isSilenced: z.boolean() }),
  ADMIN_MUTE_PARTICIPANT: z.object({ targetUserId: text.optional(), targetGameId: text.optional(), targetUserName: text.optional(), mute: z.boolean(), adminName: text.optional() }),
  ADMIN_DEAFEN_PARTICIPANT: z.object({ targetUserId: text.optional(), targetGameId: text.optional(), targetUserName: text.optional(), deafen: z.boolean(), adminName: text.optional() }),
  LIVE_VIEW: z.object({ to: id, watch: z.boolean(), h: finite.nonnegative().nullable() }), LIVE_ALM: z.object({ to: id }).passthrough(),
  LIVE_GSTREAMER: z.object({ to: id, signal: gstreamerSignalSchema }),
  SPOTIFY_JAM_SYNC: z.object({ zoneId: id.optional(), session: domain<ZoneJamSession>(object).nullable() }),
  SPOTIFY_TRACK_SHARE: z.object({ zoneId: id, track: domain<SharedSpotifyTrack>(object) }),
  SPOTIFY_DJ_STATUS: z.object({ zoneId: id, djState: domain<SpotifyDjState>(object).nullable() }),
  SPOTIFY_DJ_STOP: z.object({ zoneId: id, ownerId: id, startedAt: optionalFinite }),
  SPOTIFY_DJ_COMMAND: djPayload.extend({ startedAt: finite.optional() }),
  SPOTIFY_DJ_COMMAND_RESULT: z.object({ requestId: id, result: domain<SpotifyPlaybackResult>(z.object({ ok: z.boolean() }).passthrough()) }),
  SPOTIFY_DJ_REQUEST: djPayload, SPOTIFY_DJ_REQUEST_RESULT: djPayload.extend({ result: domain<SpotifyDjRequestResult>(z.object({ ok: z.boolean(), error: text.optional(), uncertain: optionalBool })).optional() }),
  SPOTIFY_DJ_SEARCH: djPayload, SPOTIFY_DJ_SEARCH_ACK: djPayload, SPOTIFY_DJ_SEARCH_RESULT: djPayload.extend({ result: domain<SpotifySearchResult>(object).optional() }),
  DJ_CALL_REQUEST: z.object({ listenerId: id }), VOICE_RELAY_CONTROL: z.object({ type: z.enum(['VOICE_RELAY_REQUEST', 'VOICE_RELAY_INSTRUCT_START', 'VOICE_RELAY_ACCEPT', 'VOICE_RELAY_STOP', 'VOICE_RELAY_INSTRUCT_STOP']), sourcePeer: id, targetPeer: id }),
  CALL_TTS: z.object({ id, zoneId: id, text: text.trim().min(1).max(2000) }),
  PET_QUESTION: z.object({ id, targetId: id, zoneId: id, question: text.max(4000), channelId: text.optional(), askerId: text.optional() }),
  PET_REPLY: z.object({ id, ownerId: id, askerId: text.optional(), zoneId: id, text: text.min(1).max(4000), channelId: text.optional(), error: optionalBool }),
  BED_INTERACTION: z.object({ action: z.enum(['invite', 'accept', 'decline', 'cancel', 'finish']), furnitureId: text.optional(),
    session: z.object({ id, roomId: id, furnitureId: id, initiatorId: id, targetId: id, createdAt: finite, stage: z.enum(['invited', 'active']).optional(), acceptedAt: optionalFinite }).optional(),
  }).passthrough(),
  WHITEBOARD_OP: z.object({ ...boardBase, operation: whiteboardOperationSchema }),
  WHITEBOARD_REQUEST: z.object({ ...boardBase, fileIds: z.array(id).max(1000).optional() }),
  WHITEBOARD_STATE: z.object({ ...boardBase, to: id, operations: z.array(whiteboardOperationSchema).max(16), complete: optionalBool }),
  WHITEBOARD_POINTER: z.object({ ...boardBase, point: z.object({ x: finite, y: finite }).nullable(), seq: finite.int().nonnegative() }),
} as const

export type ValidatedNetworkMessage = { [K in keyof typeof networkPayloadSchemas]: {
  type: K; senderId: string; timestamp: number; payload: z.output<(typeof networkPayloadSchemas)[K]>
} }[keyof typeof networkPayloadSchemas]

const envelopeSchema = z.object({ type: text, senderId: id, timestamp: finite, payload: z.unknown() })
export function parseNetworkMessage(raw: unknown): ValidatedNetworkMessage | null {
  const envelope = envelopeSchema.safeParse(raw)
  if (!envelope.success || !Object.prototype.hasOwnProperty.call(networkPayloadSchemas, envelope.data.type)) return null
  const type = envelope.data.type as keyof typeof networkPayloadSchemas
  const payload = networkPayloadSchemas[type].safeParse(envelope.data.payload)
  return payload.success ? { ...envelope.data, type, payload: payload.data } as ValidatedNetworkMessage : null
}

export const hubMessageSchema = z.object({ type: z.enum(['ANNOUNCE_ROOM', 'UNREGISTER_ROOM', 'QUERY_ROOMS', 'HEARTBEAT']),
  roomId: id.optional(), roomInfo: publicRoomSchema.optional(), timestamp: finite.default(0) })
const presenceFields = {
  userId: id, gameId: text.optional(), name: text, profilePicture: text.optional(), avatar: avatarSchema.optional(),
  profile: userProfileSchema.optional(),
  status: presenceStatusSchema.optional(), statusText: text.optional(), statusEmoji: text.optional(),
  roomCode: text.nullable().optional(), roomName: text.nullable().optional(), inRoom: z.boolean(), lastHeartbeat: finite,
}
export const userPresenceSchema = z.object(presenceFields)
const receiptSchema = z.object({ receiptId: text.optional(), senderId: id, senderName: text.optional(), recipientId: id,
  recipientName: text.optional(), channelId: text.optional(), messageId: text.optional(), messageIds: z.array(id).optional(),
  status: z.enum(['sent', 'delivered', 'read']), timestamp: finite, upToTimestamp: optionalFinite })
export const presenceMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PRESENCE_HEARTBEAT'), presence: userPresenceSchema, timestamp: finite.default(0) }),
  z.object({ type: z.literal('PRESENCE_OFFLINE'), userId: id, timestamp: finite.default(0) }),
  z.object({ type: z.literal('DIRECT_MESSAGE'), message: chatMessageSchema, timestamp: finite.default(0) }),
  z.object({ type: z.literal('MESSAGE_STATUS'), statusReceipt: receiptSchema, timestamp: finite.default(0) }),
])
export const friendPacketSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('ping') }), z.object({ t: z.literal('bye') }),
  z.object({ t: z.literal('presence'), presence: userPresenceSchema.partial().nullable() }),
  z.object({ t: z.literal('dm'), message: chatWireSchema.partial().required({ id: true }) }),
  z.object({ t: z.literal('receipt'), receipt: receiptSchema.partial().required({ status: true }) }),
])
