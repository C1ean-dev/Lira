import { NetworkMessage, PlayerMovePayload } from '../types/p2p'
import { Player } from '../types/game'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useChatStore } from '../store/useChatStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { useMediaStore } from '../store/useMediaStore'
import { PublicRoomsService } from '../services/publicRoomsService'
import { resolveUniquePlayerName } from '../utils/playerName'

export function processNetworkMessage(
  msg: NetworkMessage,
  peerId: string,
  isHost: boolean,
  broadcast: (msg: NetworkMessage, excludePeerId?: string) => void,
  removePeer: (peerId: string) => void,
  checkZoneCallEligibility: (remotePlayer: Player) => void,
  myPeerId?: string | null
) {
  switch (msg.type) {
    case 'HEARTBEAT': {
      // Respond with HEARTBEAT_ACK so sender computes round-trip latency
      broadcast({
        type: 'HEARTBEAT_ACK',
        senderId: useGameStore.getState().localPlayer.id,
        payload: { clientTimestamp: msg.timestamp },
        timestamp: Date.now(),
      })
      break
    }

    case 'HEARTBEAT_ACK': {
      if (msg.payload?.clientTimestamp) {
        const rtt = Math.max(1, Math.round(Date.now() - msg.payload.clientTimestamp))
        const sender = msg.senderId || peerId
        useGameStore.getState().updatePlayerPing(sender, rtt)
      }
      break
    }

    case 'PLAYER_JOIN': {
      // In star-mesh relay topology, peerId is the transport connection (Host on clients).
      // The true sender and unique peer identity of the joining player is msg.senderId
      // (falling back to msg.payload.player?.id, and finally peerId).
      const remotePeerId = msg.senderId || msg.payload.player?.id || peerId
      const isPeerHost = remotePeerId.endsWith('-host')
      const incomingGameId: string | undefined =
        msg.payload.player?.gameId ?? msg.payload.player?.id
      const localPlayer = useGameStore.getState().localPlayer
      const localId = localPlayer.id
      const localGameId = localPlayer.gameId

      // 1. Never register our own echo as a remote player — it would render
      // as a frozen copy of ourselves stuck at the join position (ghost).
      if (
        remotePeerId === localId ||
        (localGameId && remotePeerId === localGameId) ||
        (incomingGameId && (incomingGameId === localId || (localGameId && incomingGameId === localGameId))) ||
        (myPeerId && (remotePeerId === myPeerId || incomingGameId === myPeerId))
      ) {
        break
      }

      // 2. Same human reconnected with a new connection id (ICE churn, flap):
      // drop the stale entry so the old frozen clone disappears instead of
      // lingering next to the live one.
      if (incomingGameId) {
        const st = useGameStore.getState()
        for (const [key, p] of Object.entries(st.remotePlayers)) {
          if (key !== remotePeerId && (p.gameId ?? p.id) === incomingGameId) {
            st.removeRemotePlayer(key)
          }
        }
      }

      // 3. Duplicate name resolution:
      // If we are Host, any incoming remote player is a newcomer, so ensure their name is unique.
      // If we are Client, incoming players are already established in the room, so we keep their name
      // and instead adjust our own local name if there's a collision with them.
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

      const player: Player = {
        ...msg.payload.player,
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

      // If we are a non-host client and our own name conflicts with an existing player in the room:
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
      const localPlayer = useGameStore.getState().localPlayer
      const localId = localPlayer.id
      const localGameId = localPlayer.gameId
      // Defensive: movement allegedly from ourselves must never create or
      // move a remote entry (would mirror/freeze a clone of the local avatar).
      if (
        sender === localId ||
        (localGameId && sender === localGameId) ||
        (myPeerId && sender === myPeerId)
      ) {
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

      // If this is a name reconciliation directed at ourselves from the host:
      if (
        (targetPayloadPlayer?.id === localId || (localGameId && targetPayloadPlayer?.gameId === localGameId)) &&
        targetPayloadPlayer?.name &&
        targetPayloadPlayer.name !== localPlayer.name
      ) {
        useGameStore.getState().setLocalPlayer({ name: targetPayloadPlayer.name })
        break
      }

      if (
        peerId === localId ||
        msg.senderId === localId ||
        (localGameId && (peerId === localGameId || msg.senderId === localGameId)) ||
        (myPeerId && (peerId === myPeerId || msg.senderId === myPeerId))
      ) {
        break
      }
      const updated = msg.payload.player
      const remotePlayers = useGameStore.getState().remotePlayers
      const targetSender = msg.senderId || updated?.id
      // Target the sender specifically; never default to peerId if peerId is the relay host!
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
          id: existingKey,
          isHost: isPeerHost,
          role: isPeerHost ? 'host' : updated?.role || existing.role || 'member',
        }
        useGameStore.getState().setRemotePlayer(nextPlayer)
        checkZoneCallEligibility(nextPlayer)
        if (updated?.currentZoneId !== undefined) {
          useMapStore.getState().checkAndUnlockEmptyZones()
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

        // Verify local player authorization for all locked zones
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
      if (msg.payload.customAssets) {
        useCustomAssetsStore.getState().syncRemoteCustomAssets(
          msg.payload.customAssets,
          msg.payload.categories
        )
      }
      break
    }

    case 'CUSTOM_ASSET_ADD_OR_UPDATE': {
      if (msg.payload.asset) {
        useCustomAssetsStore.getState().syncRemoteAssetAddOrUpdate(msg.payload.asset)
      }
      break
    }

    case 'CUSTOM_ASSET_DELETE': {
      if (msg.payload.id) {
        useCustomAssetsStore.getState().syncRemoteAssetDelete(msg.payload.id)
      }
      break
    }

    case 'MAP_EDIT': {
      const { action, data } = msg.payload
      if (action === 'set_floor') {
        useMapStore.getState().setFloorTile(data.x, data.y, data.floor)
      } else if (action === 'paint_floor_in_zone') {
        // A remote peer clicked inside a zone with paint_floor
        // selected; replicate the same "fill the whole zone" effect
        // locally so both sides stay in sync.
        useMapStore.getState().paintFloorInZone(data.zoneId, data.floor)
      } else if (action === 'set_wall') {
        useMapStore.getState().setWallTile(data.x, data.y, data.wall)
      } else if (action === 'add_furniture') {
        useMapStore.getState().addFurniture(data.furniture)
      } else if (action === 'remove_furniture') {
        useMapStore.getState().removeFurnitureAt(data.x, data.y)
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
      // If this is a DM, only process if addressed to me or sent by me
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

      // If room is locked and local player is not authorized:
      if (isLocked && !isAuth) {
        // Reset any stale knock status so they cannot enter
        useGameStore.getState().setMyKnockStatus(zoneId, 'idle')

        // If local player was physically inside the room when permission was revoked, eject to outside the doorway
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

      // Sender is the admin who triggered this; never apply it to self
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
          import('../media/MediaManager').then(({ MediaManager }) => {
            MediaManager.getInstance().syncMuteState(mute, mute)
          }).catch(() => {})
        } catch {}
        useMediaStore.getState().setAdminNotice({
          message: mute
            ? `Você foi mutado pelo administrador ${adminName || 'da sala'}.`
            : `Seu microfone foi reativado pelo administrador ${adminName || 'da sala'}.`,
          type: 'mute',
        })
      }
      // Update remote player state for everyone in the room
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

      // Sender is the admin who triggered this; never apply it to self
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
      // Update remote player state for everyone in the room
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
  }

  // If host, forward to other peers in mesh
  if (isHost && msg.type !== 'MAP_SYNC' && msg.type !== 'CUSTOM_ASSETS_SYNC' && msg.type !== 'HEARTBEAT') {
    broadcast(msg, peerId)
  }
}
