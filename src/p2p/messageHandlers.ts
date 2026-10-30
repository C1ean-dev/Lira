import { applyConsumptionChange } from '../services/tabletopConsumption'
import { AtlasChunkReceiver } from '../assets/atlasChunks'
import { readAtlas, atlasDigest, decodeTransferredAtlas } from '../assets/atlasService'
import type { AtlasDocument, PersistedAtlas } from '../assets/atlasFormat'
import { NetworkMessage, PlayerMovePayload } from '../types/p2p'
import { Player } from '../types/game'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useChatStore } from '../store/useChatStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { useMediaStore } from '../store/useMediaStore'
import { PublicRoomsService } from '../services/publicRoomsService'
import { MediaManager } from '../media/MediaManager'
import { resolveUniquePlayerName } from '../utils/playerName'
import { sanitizeRoomChannels } from '../utils/roomChannels'
import { useSpotifyJamStore } from '../store/useSpotifyJamStore'
import { receiveDjPlaybackMessage } from '../services/spotifyDjPlayback'
import { receiveDjRequestMessage } from '../services/spotifyDjRequests'
import { receiveDjSearchMessage } from '../services/spotifyDjSearch'
import { validDjRequestSnapshot } from '../types/spotifyDjRequests'
import { isStoppedDjSession, receiveDjStopMessage } from '../services/stopDjForEveryone'
import { DEFAULT_AVATAR } from '../engine/Constants'
import { receiveBedInteraction } from '../services/bedInteraction'
import { receivePetNetworkMessage } from '../services/petNetwork'
import { receiveCallTts } from '../services/callTts'

const receivedAtlases = new Map<string, AtlasDocument>()
const atlasChunks = new AtlasChunkReceiver()
let assetReceiveQueue: Promise<void> = Promise.resolve()
function receiveAtlas(pair: PersistedAtlas, digest: string) {
  assetReceiveQueue = assetReceiveQueue.then(async () => {
    if (typeof digest !== 'string' || await atlasDigest(pair) !== digest) throw new Error('Atlas recebido com assinatura inválida')
    let doc = receivedAtlases.get(digest)
    if (!doc) {
      doc = await readAtlas(pair)
      receivedAtlases.set(digest, doc)
      if (receivedAtlases.size > 16) receivedAtlases.delete(receivedAtlases.keys().next().value!)
    }
    await useCustomAssetsStore.getState().syncRemoteAtlas(pair, doc)
  }).catch(error => console.error('[Assets] Invalid incoming atlas:', error))
}

function isLocalPlayerMessage(senderId: string, player?: Partial<Player>, myPeerId?: string | null) {
  const state = useGameStore.getState()
  const local = state.localPlayer
  if (senderId === local.id || (myPeerId && senderId === myPeerId)) return true
  if (!player?.gameId && (player?.id === local.id || (!!myPeerId && player?.id === myPeerId))) return true
  // The canonical host ID can change hands while the former host keeps it as
  // its stable game identity. Prefer the sender's actual game identity then.
  const identity = player?.gameId || state.remotePlayers[senderId]?.gameId || player?.id || senderId
  return identity === (local.gameId || local.id)
}

function isDjMessageSource(msg: NetworkMessage, peerId: string, isHost: boolean): boolean {
  return msg.senderId === peerId || (!isHost && peerId === useGameStore.getState().connectionHostId)
}

export function processNetworkMessage(
  msg: NetworkMessage,
  peerId: string,
  isHost: boolean,
  broadcast: (msg: NetworkMessage, excludePeerId?: string) => void,
  removePeer: (peerId: string) => void,
  checkZoneCallEligibility: (remotePlayer: Player) => void,
  myPeerId?: string | null,
  onDjCallRequest?: (listenerId: string) => void
) {
  switch (msg.type) {
    case 'CALL_TTS': {
      if (!isDjMessageSource(msg, peerId, isHost)) return
      receiveCallTts(msg.senderId, msg.payload)
      break
    }
    case 'PET_QUESTION':
    case 'PET_REPLY': {
      if (!isDjMessageSource(msg, peerId, isHost)) return
      receivePetNetworkMessage(msg)
      break
    }
    case 'BED_INTERACTION': {
      const remote = useGameStore.getState().remotePlayers[peerId]
      const isAllowedSender = !isHost || msg.senderId === peerId ||
        remote?.gameId === msg.senderId || remote?.id === msg.senderId
      if (!isAllowedSender || !receiveBedInteraction(msg)) return
      break
    }
    // PeerManager handles these on the originating data connection.
    case 'HEARTBEAT':
    case 'HEARTBEAT_ACK':
    case 'HOST_TRANSFER':
      return

    case 'PLAYER_JOIN': {
      const remotePeerId = msg.senderId || msg.payload.player?.id || peerId
      const isPeerHost = remotePeerId.endsWith('-host')
      const incomingGameId: string | undefined =
        msg.payload.player?.gameId ?? msg.payload.player?.id
      const localPlayer = useGameStore.getState().localPlayer
      const localId = localPlayer.id
      if (isLocalPlayerMessage(remotePeerId, msg.payload.player, myPeerId)) {
        break
      }

      if (incomingGameId) {
        const st = useGameStore.getState()
        for (const [key, p] of Object.entries(st.remotePlayers)) {
          if (key !== remotePeerId && (p.gameId ?? p.id) === incomingGameId) {
            st.removeRemotePlayer(key)
          }
        }
      }

      const incomingName = msg.payload.player?.name || 'Player'
      const state = useGameStore.getState()
      const existingNames = [
        state.localPlayer.name,
        ...Object.values(state.remotePlayers)
          .filter((p) => p.id !== remotePeerId && (incomingGameId ? (p.gameId ?? p.id) !== incomingGameId : true))
          .map((p) => p.name),
      ]
      const resolvedName = isHost
        ? resolveUniquePlayerName(incomingName, existingNames)
        : incomingName

      const incomingPlayer = msg.payload.player || {}
      const player: Player = {
        ...incomingPlayer,
        isCameraOff: incomingPlayer.isCameraOff !== undefined ? incomingPlayer.isCameraOff : true,
        name: resolvedName,
        id: remotePeerId,
        gameId: incomingGameId,
        isHost: isPeerHost,
        role: isPeerHost ? 'host' : msg.payload.player?.role === 'admin' ? 'admin' : msg.payload.player?.role === 'guest' ? 'guest' : 'member',
      }
      useGameStore.getState().setRemotePlayer(player)

      if (isHost && resolvedName !== incomingName) {
        broadcast({
          type: 'PLAYER_UPDATE',
          senderId: remotePeerId,
          payload: {
            player: {
              ...player,
              name: resolvedName,
            },
          },
          timestamp: Date.now(),
        })
      }

      if (!isHost && incomingName.trim().toLowerCase() === state.localPlayer.name.trim().toLowerCase()) {
        const roomNames = [
          incomingName,
          ...Object.values(useGameStore.getState().remotePlayers).map((p) => p.name),
        ]
        const uniqueLocalName = resolveUniquePlayerName(state.localPlayer.name, roomNames)
        if (uniqueLocalName !== state.localPlayer.name) {
          useGameStore.getState().setLocalPlayer({ name: uniqueLocalName })
          broadcast({
            type: 'PLAYER_UPDATE',
            senderId: localId,
            payload: {
              player: {
                ...state.localPlayer,
                name: uniqueLocalName,
              },
            },
            timestamp: Date.now(),
          })
        }
      }

      if (isHost && useGameStore.getState().isRoomPublic) {
        const totalPlayers = Object.keys(useGameStore.getState().remotePlayers).length + 1
        PublicRoomsService.getInstance().updateHosting({ playerCount: totalPlayers })
      }
      checkZoneCallEligibility(player)
      break
    }

    case 'PLAYER_MOVE': {
      const sender = msg.senderId || peerId
      if (isLocalPlayerMessage(sender, undefined, myPeerId)) {
        break
      }
      const payload: PlayerMovePayload = msg.payload
      const state = useGameStore.getState()
      let targetKey = state.remotePlayers[sender] ? sender : undefined
      if (!targetKey) {
        targetKey = Object.keys(state.remotePlayers).find(
          (k) => state.remotePlayers[k].id === sender || state.remotePlayers[k].gameId === sender
        )
      }
      if (targetKey) {
        state.updateRemotePlayerPosition(targetKey, payload.x, payload.y, payload.direction, payload.isMoving)
      }
      break
    }

    case 'PLAYER_UPDATE': {
      const localPlayer = useGameStore.getState().localPlayer
      const localId = localPlayer.id
      const localGameId = localPlayer.gameId
      const targetPayloadPlayer = msg.payload?.player

      if (
        (targetPayloadPlayer?.id === localId || (localGameId && targetPayloadPlayer?.gameId === localGameId)) &&
        targetPayloadPlayer?.name &&
        targetPayloadPlayer.name !== localPlayer.name
      ) {
        useGameStore.getState().setLocalPlayer({ name: targetPayloadPlayer.name })
        break
      }

      if (isLocalPlayerMessage(msg.senderId || targetPayloadPlayer?.id || peerId, targetPayloadPlayer, myPeerId)) {
        break
      }
      const updated = msg.payload.player
      const remotePlayers = useGameStore.getState().remotePlayers
      const targetSender = msg.senderId || updated?.id
      let existingKey = targetSender && remotePlayers[targetSender] ? targetSender : undefined
      if (!existingKey) {
        existingKey = Object.keys(remotePlayers).find(
          (k) =>
            (targetSender && (k === targetSender || remotePlayers[k].id === targetSender || remotePlayers[k].gameId === targetSender)) ||
            (updated?.id && (remotePlayers[k].id === updated.id || remotePlayers[k].gameId === updated.id)) ||
            (updated?.gameId && (remotePlayers[k].id === updated.gameId || remotePlayers[k].gameId === updated.gameId)) ||
            (!msg.senderId && k === peerId)
        )
      }
      const existing = existingKey ? remotePlayers[existingKey] : undefined
      if (existing && existingKey) {
        const isPeerHost = existingKey.endsWith('-host')
        const nextPlayer: Player = {
          ...existing,
          ...updated,
          isCameraOff: updated?.isCameraOff !== undefined ? updated.isCameraOff : (existing.isCameraOff ?? true),
          id: existingKey,
          isHost: isPeerHost,
          role: isPeerHost ? 'host' : updated?.role || existing.role || 'member',
        }
        useGameStore.getState().setRemotePlayer(nextPlayer)
        checkZoneCallEligibility(nextPlayer)
        if (updated?.currentZoneId !== undefined) {
          useMapStore.getState().checkAndUnlockEmptyZones()
        }
      } else if (updated) {
        const fallbackKey = targetSender || peerId
        if (fallbackKey) {
          const isPeerHost = fallbackKey.endsWith('-host')
          const nextPlayer: Player = {
            id: fallbackKey,
            gameId: updated.gameId || fallbackKey,
            name: updated.name || (isPeerHost ? 'Host' : 'Guest'),
            x: updated.x ?? 0,
            y: updated.y ?? 0,
            direction: updated.direction ?? 'down',
            isMoving: updated.isMoving ?? false,
            avatar: updated.avatar ? { ...DEFAULT_AVATAR, ...updated.avatar } : { ...DEFAULT_AVATAR },
            status: updated.status || 'available',
            lastUpdated: Date.now(),
            role: isPeerHost ? 'host' : updated.role || 'member',
            ...updated,
            isCameraOff: updated.isCameraOff !== undefined ? updated.isCameraOff : true,
            isHost: isPeerHost,
          }
          useGameStore.getState().setRemotePlayer(nextPlayer)
          checkZoneCallEligibility(nextPlayer)
          if (updated.currentZoneId !== undefined) {
            useMapStore.getState().checkAndUnlockEmptyZones()
          }
        }
      }
      break
    }

    case 'PLAYER_LEAVE': {
      const targetId = msg.payload?.peerId || msg.senderId || peerId
      removePeer(targetId)
      break
    }

    case 'MAP_SYNC': {
      if (msg.payload.mapData) {
        useMapStore.getState().setMapData(msg.payload.mapData)

        const local = useGameStore.getState().localPlayer
        for (const zone of msg.payload.mapData.zones || []) {
          if (zone.isLocked) {
            const isAuth = useMapStore.getState().isPeerAuthorizedForZone(zone.id, local.id, local.name)
            if (!isAuth) {
              if (useGameStore.getState().myKnockStatus[zone.id] === 'approved') {
                useGameStore.getState().setMyKnockStatus(zone.id, 'idle')
              }
              if (local.currentZoneId === zone.id) {
                const mapWidth = msg.payload.mapData.width || 32
                const mapHeight = msg.payload.mapData.height || 24
                const doorW = Math.min(zone.width * 0.38, 2.0)
                const doorStartX = zone.x + (zone.width - doorW) / 2
                const doorCenterX = Math.round(doorStartX + doorW / 2)
                const doorX = Math.max(1, Math.min(mapWidth - 1, doorCenterX))
                const doorY = Math.min(mapHeight - 1.2, Number((zone.y + zone.height + 0.8).toFixed(1)))

                useMediaStore.getState().setGridCallOpen(false)
                useGameStore.getState().setLocalPlayer({
                  x: doorX,
                  y: doorY,
                  currentZoneId: null,
                })
                broadcast({
                  type: 'PLAYER_UPDATE',
                  senderId: local.id,
                  payload: {
                    player: {
                      ...useGameStore.getState().localPlayer,
                      x: doorX,
                      y: doorY,
                      currentZoneId: null,
                    },
                  },
                  timestamp: Date.now(),
                })
              }
            }
          }
        }

        if (isHost) {
          broadcast(msg, peerId)
        }
      }
      break
    }

    case 'CUSTOM_ASSETS_SYNC': {
      if (msg.payload.chunk) {
        const complete = atlasChunks.accept(peerId, msg.payload.chunk)
        if (complete) {
          assetReceiveQueue = assetReceiveQueue.then(async () => {
            const { atlas, document } = await decodeTransferredAtlas(complete)
            await useCustomAssetsStore.getState().syncRemoteAtlas(atlas, document)
          }).catch(error => console.error('[Assets] Invalid incoming atlas:', error))
        }
        break
      }
      if (msg.payload.atlas) { receiveAtlas(msg.payload.atlas, msg.payload.digest); break }
      if (msg.payload.customAssets) {
        useCustomAssetsStore.getState().syncRemoteCustomAssets(
          msg.payload.customAssets,
          msg.payload.categories
        )
      }
      break
    }

    case 'CUSTOM_ASSET_ADD_OR_UPDATE': {
      if (msg.payload.atlas) { receiveAtlas(msg.payload.atlas, msg.payload.digest); break }
      if (msg.payload.asset) {
        useCustomAssetsStore.getState().syncRemoteAssetAddOrUpdate(msg.payload.asset)
      }
      break
    }

    case 'CUSTOM_ASSET_DELETE': {
      if (msg.payload.id) {
        assetReceiveQueue = assetReceiveQueue.then(() => useCustomAssetsStore.getState().syncRemoteAssetDelete(msg.payload.id)).catch(error => console.error('[Assets] Delete failed:', error))
      }
      break
    }

    case 'MAP_EDIT': {
      const { action, data } = msg.payload
      if (action === 'consume_furniture') {
        if (!data || !applyConsumptionChange(data.mapId, data.id, data.expected)) return
      } else if (action === 'set_floor') {
        useMapStore.getState().setFloorTile(data.x, data.y, data.floor)
      } else if (action === 'paint_floor_in_zone') {
        useMapStore.getState().paintFloorInZone(data.zoneId, data.floor)
      } else if (action === 'set_wall') {
        useMapStore.getState().setWallTile(data.x, data.y, data.wall)
      } else if (action === 'add_furniture') {
        useMapStore.getState().addFurniture(data.furniture)
      } else if (action === 'remove_furniture') {
        if (typeof data.id === 'string') useMapStore.getState().removeFurnitureById(data.id)
        else useMapStore.getState().removeFurnitureAt(data.x, data.y)
      } else if (action === 'add_zone') {
        useMapStore.getState().addOrUpdateZone(data.zone)
      } else if (action === 'remove_zone') {
        useMapStore.getState().removeZone(data.id)
      } else if (action === 'update_zone') {
        useMapStore.getState().updateZone(data.id, data.partial || data.zone)
      }
      break
    }

    case 'CHAT_MESSAGE': {
      const chatMsg = msg.payload.message
      const local = useGameStore.getState().localPlayer
      if (chatMsg?.recipientId) {
        const isForMe =
          chatMsg.recipientId === local.id ||
          (local.gameId && chatMsg.recipientId === local.gameId) ||
          (myPeerId && chatMsg.recipientId === myPeerId)
        const isFromMe =
          chatMsg.senderId === local.id ||
          (local.gameId && chatMsg.senderId === local.gameId) ||
          (myPeerId && chatMsg.senderId === myPeerId)
        if (!isForMe && !isFromMe) {
          break
        }
      } else if (chatMsg?.channelId?.startsWith('dm-')) {
        const matchesMe =
          chatMsg.channelId.includes(local.id) ||
          (local.gameId && chatMsg.channelId.includes(local.gameId)) ||
          (myPeerId && chatMsg.channelId.includes(myPeerId))
        if (!matchesMe) {
          break
        }
      }
      useChatStore.getState().addMessage(chatMsg)
      break
    }

    case 'CHANNELS_SYNC': {
      if (isHost || !peerId.endsWith('-host') || msg.senderId !== peerId) break
      const channels = sanitizeRoomChannels(msg.payload?.channels)
      if (channels) useChatStore.getState().setRoomChannels(channels)
      break
    }

    case 'CHAT_MESSAGE_STATUS': {
      const {
        senderId,
        senderName,
        recipientId,
        messageId,
        channelId,
        status,
        upToTimestamp,
      } = msg.payload || {}
      const local = useGameStore.getState().localPlayer

      const isForMe =
        !recipientId ||
        recipientId === local.id ||
        (local.gameId && recipientId === local.gameId) ||
        (myPeerId && recipientId === myPeerId) ||
        (channelId && (channelId.includes(local.id) || (local.gameId && channelId.includes(local.gameId))))

      if (isForMe && status) {
        const chatStore = useChatStore.getState()
        if (messageId) {
          chatStore.updateMessageStatus(messageId, status)
        }
        if (senderId) {
          chatStore.updateMessagesStatusForPeer(senderId, status, upToTimestamp)
        }
        if (senderName) {
          chatStore.updateMessagesStatusForPeer(senderName, status, upToTimestamp)
        }
      }
      break
    }

    case 'REACTION': {
      useGameStore.getState().addReaction(msg.payload.reaction)
      break
    }

    case 'ROOM_LOCK_TOGGLE': {
      const { zoneId, isLocked, authorizedPeers, members, admins } = msg.payload
      useMapStore.getState().updateZone(zoneId, {
        isLocked,
        ...(Array.isArray(authorizedPeers) ? { authorizedPeers } : {}),
        ...(Array.isArray(members) ? { members } : {}),
        ...(Array.isArray(admins) ? { admins } : {}),
      })

      const local = useGameStore.getState().localPlayer
      const isAuth = useMapStore.getState().isPeerAuthorizedForZone(zoneId, local.id, local.name)

      if (isLocked && !isAuth) {
        useGameStore.getState().setMyKnockStatus(zoneId, 'idle')

        if (local.currentZoneId === zoneId) {
          const zoneObj = useMapStore.getState().mapData.zones.find((z) => z.id === zoneId)
          if (zoneObj) {
            const mapWidth = useMapStore.getState().mapData.width || 32
            const mapHeight = useMapStore.getState().mapData.height || 24
            const doorW = Math.min(zoneObj.width * 0.38, 2.0)
            const doorStartX = zoneObj.x + (zoneObj.width - doorW) / 2
            const doorCenterX = Math.round(doorStartX + doorW / 2)
            const doorX = Math.max(1, Math.min(mapWidth - 1, doorCenterX))
            const doorY = Math.min(mapHeight - 1.2, Number((zoneObj.y + zoneObj.height + 0.8).toFixed(1)))

            useMediaStore.getState().setGridCallOpen(false)
            useGameStore.getState().setLocalPlayer({
              x: doorX,
              y: doorY,
              currentZoneId: null,
            })
            broadcast({
              type: 'PLAYER_UPDATE',
              senderId: local.id,
              payload: {
                player: {
                  ...useGameStore.getState().localPlayer,
                  x: doorX,
                  y: doorY,
                  currentZoneId: null,
                },
              },
              timestamp: Date.now(),
            })
          }
        }
      }

      if (isHost) {
        broadcast(msg, peerId)
      }
      break
    }

    case 'ROOM_KNOCK_REQUEST': {
      const knockReq = msg.payload
      const local = useGameStore.getState().localPlayer
      if (local.currentZoneId === knockReq.zoneId) {
        useGameStore.getState().addKnockRequest(knockReq)
      }
      break
    }

    case 'ROOM_KNOCK_RESPONSE': {
      const { zoneId, requesterId, approved, requesterName } = msg.payload
      if (approved) {
        useMapStore.getState().authorizePeerInZone(zoneId, requesterId, requesterName)
      }
      const local = useGameStore.getState().localPlayer
      if (local.id === requesterId) {
        useGameStore.getState().setMyKnockStatus(zoneId, approved ? 'approved' : 'denied')
      }
      useGameStore.getState().removeKnockRequest(requesterId)
      break
    }

    case 'USER_AUDIO_ISOLATION': {
      const { targetUserId, sourceUserId, isSilenced } = msg.payload
      const local = useGameStore.getState().localPlayer
      if (
        (myPeerId && myPeerId === targetUserId) ||
        local.id === targetUserId ||
        (local.gameId && local.gameId === targetUserId)
      ) {
        useMediaStore.getState().setMutuallySilencedBy(sourceUserId, isSilenced)
      }
      break
    }

    case 'ADMIN_MUTE_PARTICIPANT': {
      const { targetUserId, targetGameId, mute, adminName } = msg.payload
      const local = useGameStore.getState().localPlayer

      if (msg.senderId === local.id || (myPeerId && msg.senderId === myPeerId)) {
        break
      }

      const isTarget =
        (myPeerId && myPeerId === targetUserId) ||
        local.id === targetUserId ||
        (local.gameId && local.gameId === targetUserId) ||
        (targetGameId && (local.id === targetGameId || local.gameId === targetGameId))

      if (isTarget) {
        useMediaStore.getState().setMuted(mute)
        useGameStore.getState().setLocalPlayer({ isMuted: mute, isMutedByAdmin: mute })
        try {
          MediaManager.getInstance().syncMuteState(mute, mute)
        } catch {}
        useMediaStore.getState().setAdminNotice({
          message: mute
            ? `Você foi mutado pelo administrador ${adminName || 'da sala'}.`
            : `Seu microfone foi reativado pelo administrador ${adminName || 'da sala'}.`,
          type: 'mute',
        })
      }
      const remotePlayers = useGameStore.getState().remotePlayers
      for (const [rId, rPlayer] of Object.entries(remotePlayers)) {
        if (
          rId === targetUserId ||
          rPlayer.id === targetUserId ||
          rPlayer.gameId === targetUserId ||
          (targetGameId && (rPlayer.id === targetGameId || rPlayer.gameId === targetGameId))
        ) {
          useGameStore.getState().setRemotePlayer({
            ...rPlayer,
            isMuted: mute,
            isMutedByAdmin: mute,
          })
        }
      }
      break
    }

    case 'ADMIN_DEAFEN_PARTICIPANT': {
      const { targetUserId, targetGameId, deafen, adminName } = msg.payload
      const local = useGameStore.getState().localPlayer

      if (msg.senderId === local.id || (myPeerId && msg.senderId === myPeerId)) {
        break
      }

      const isTarget =
        (myPeerId && myPeerId === targetUserId) ||
        local.id === targetUserId ||
        (local.gameId && local.gameId === targetUserId) ||
        (targetGameId && (local.id === targetGameId || local.gameId === targetGameId))

      if (isTarget) {
        useMediaStore.getState().setDeafened(deafen)
        useGameStore.getState().setLocalPlayer({ isDeafened: deafen })
        useMediaStore.getState().setAdminNotice({
          message: deafen
            ? `Seu áudio foi silenciado pelo administrador ${adminName || 'da sala'}.`
            : `Seu áudio foi reativado pelo administrador ${adminName || 'da sala'}.`,
          type: 'deafen',
        })
      }
      const remotePlayers = useGameStore.getState().remotePlayers
      for (const [rId, rPlayer] of Object.entries(remotePlayers)) {
        if (
          rId === targetUserId ||
          rPlayer.id === targetUserId ||
          rPlayer.gameId === targetUserId ||
          (targetGameId && (rPlayer.id === targetGameId || rPlayer.gameId === targetGameId))
        ) {
          useGameStore.getState().setRemotePlayer({
            ...rPlayer,
            isDeafened: deafen,
          })
        }
      }
      break
    }

    case 'SPOTIFY_JAM_SYNC': {
      const { zoneId, session } = msg.payload || {}
      if (zoneId) {
        useSpotifyJamStore.getState().syncZoneJamFromPeer(zoneId, session)
      } else if (session?.zoneId) {
        useSpotifyJamStore.getState().syncZoneJamFromPeer(session.zoneId, session)
      }
      break
    }

    case 'SPOTIFY_TRACK_SHARE': {
      const { zoneId, track } = msg.payload || {}
      if (zoneId && track) {
        useSpotifyJamStore.getState().syncTrackShareFromPeer(zoneId, track)
      }
      break
    }

    case 'SPOTIFY_DJ_STOP': {
      if ((isHost && msg.senderId !== peerId) || !receiveDjStopMessage(msg)) return
      break
    }

    case 'SPOTIFY_DJ_STATUS': {
      const { zoneId, djState } = msg.payload || {}
      if (djState && (djState.requests !== undefined || djState.requestsRevision !== undefined)) {
        if (msg.senderId !== djState.djPeerId || !validDjRequestSnapshot(djState) || djState.zoneId !== zoneId
          || !isDjMessageSource(msg, peerId, isHost)) return
      }
      if (zoneId && djState?.isDjActive && isStoppedDjSession(zoneId, djState)) return
      if (zoneId) {
        useSpotifyJamStore.getState().syncDjStateFromPeer(zoneId, djState)
      }
      break
    }

    case 'SPOTIFY_DJ_COMMAND':
    case 'SPOTIFY_DJ_COMMAND_RESULT': {
      receiveDjPlaybackMessage(msg)
      break
    }

    case 'SPOTIFY_DJ_REQUEST':
    case 'SPOTIFY_DJ_REQUEST_RESULT': {
      if (!isDjMessageSource(msg, peerId, isHost) || !receiveDjRequestMessage(msg)) return
      break
    }

    case 'SPOTIFY_DJ_SEARCH':
    case 'SPOTIFY_DJ_SEARCH_ACK':
    case 'SPOTIFY_DJ_SEARCH_RESULT': {
      if (!isDjMessageSource(msg, peerId, isHost) || !receiveDjSearchMessage(msg)) return
      break
    }

    case 'DJ_CALL_REQUEST': {
      const listenerId = msg.payload?.listenerId || msg.senderId || peerId
      if (listenerId && onDjCallRequest) {
        onDjCallRequest(listenerId)
      }
      break
    }
  }

  if (
    isHost &&
    msg.type !== 'MAP_SYNC' &&
    msg.type !== 'CHANNELS_SYNC'
  ) {
    broadcast(msg, peerId)
  }
}
