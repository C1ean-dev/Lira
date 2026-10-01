import Peer, { DataConnection, MediaConnection } from 'peerjs'
import { NetworkMessage } from '../types/p2p'
import { Player, RoomKnockRequest } from '../types/game'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useMediaStore } from '../store/useMediaStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { CustomAsset } from '../types/customAsset'
import { PublicRoomsService } from '../services/publicRoomsService'
import { processNetworkMessage } from './messageHandlers'
import { MediaCallHandler, ICE_CONNECT_TIMEOUT_MS, SHARED_RTC_CONFIG, resolveCallGlare } from './mediaCalls'
import { prioritizeH264HardwareCodec } from '../media/hardwareCodec'
import { DynamicBufferManager } from '../services/DynamicBufferManager'
import { diagLog, summarizeStream } from '../utils/diagnosticLogger'

export class PeerManager {
  private static instance: PeerManager
  private peer: Peer | null = null
  private connections: Map<string, DataConnection> = new Map()
  private mediaCalls: Map<string, MediaConnection> = new Map()
  private peerLastSeen: Map<string, number> = new Map()
  private heartbeatInterval: any = null
  private staleCheckInterval: any = null
  private roomCode: string | null = null
  private isHost: boolean = false
  private isIntentionalDisconnect = false
  private signalingReconnectTimer: any = null
  private signalingReconnectAttempts = 0

  private constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('gather:live-buffer-changed', (e: any) => {
        const ms = e.detail || MediaCallHandler.DEFAULT_LIVE_BUFFER_MS
        // Legacy single-number slider event: apply ONLY to video; audio
        // stays at its dynamic value. The DynamicBufferManager writes to
        // liveBufferDelay frequently (every 1.5s) so this rarely fires
        // unless the user touches the slider.
        MediaCallHandler.applyJitterBuffer(this.mediaCalls, ms)
      })
    }
  }

  public static getInstance(): PeerManager {
    if (!PeerManager.instance) {
      PeerManager.instance = new PeerManager()
    }
    return PeerManager.instance
  }

  public getMediaCalls(): Map<string, MediaConnection> {
    return this.mediaCalls
  }

  public getPeerId(): string | null {
    return this.peer ? this.peer.id : null
  }

  /**
   * Host a new Room
   */
  public async createRoom(
    roomCode: string,
    localPlayer: Player,
    options?: {
      roomName?: string
      roomDescription?: string
      isPublic?: boolean
      maxPlayers?: number
      color?: string
    },
    retryCount: number = 0
  ): Promise<string> {
    this.roomCode = roomCode.trim().toUpperCase()
    this.isHost = true
    this.isIntentionalDisconnect = false
    const hostPeerId = `gather-v2-${this.roomCode}-host`

    // Clean up any stale peer connection first
    if (this.peer) {
      try {
        this.peer.destroy()
      } catch (e) {}
      this.peer = null
    }

    return new Promise((resolve, reject) => {
      let resolved = false
      let hostTimeout: any = null

      diagLog('room', 'create-begin', { roomCode: this.roomCode, hostPeerId })

      hostTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          console.warn(`[P2P Host] Host registration timeout (${hostPeerId})`)
          diagLog('room', 'create-timeout', { roomCode: this.roomCode, hostPeerId })
          // Never destroy a NEWER run's peer: a stale timeout must not kill
          // a session that already replaced this one (fast room switching).
          if (this.peer !== myPeer) return
          try {
            if (this.peer) {
              this.peer.destroy()
              this.peer = null
            }
          } catch (e) {}
          if (retryCount === 0) {
            console.log('[P2P Host] Host registration timed out, attempting to join as client...')
            this.joinRoom(this.roomCode!, localPlayer, retryCount + 1)
              .then(() => resolve(this.roomCode!))
              .catch((err) => reject(err))
          } else {
            useGameStore.getState().setConnected(false)
            useGameStore.getState().setConnectionStatus('disconnected')
            reject(new Error('Tempo limite de conexão excedido ao registrar o espaço no servidor P2P.'))
          }
        }
      }, 7000)

      const myPeer = new Peer(hostPeerId, {
        // STUN + TURN fallback (see SHARED_RTC_CONFIG): without the TURN
        // leg, symmetric-NAT users spin ICE for 10-20s ("delay").
        config: SHARED_RTC_CONFIG,
      })
      this.peer = myPeer
      this.setupSignalingListeners(myPeer)

      this.peer.on('open', (id) => {
        if (resolved) {
          // Re-opened after signaling disconnect/reconnect
          if (this.peer === myPeer) {
            this.signalingReconnectAttempts = 0
            if (this.signalingReconnectTimer) {
              clearTimeout(this.signalingReconnectTimer)
              this.signalingReconnectTimer = null
            }
            useGameStore.getState().setConnected(true)
            useGameStore.getState().setConnectionStatus('connected')
            this.recheckZoneCalls()
          }
          return
        }
        // Stale open (a newer run replaced this peer): quietly drop it.
        if (this.peer !== myPeer) {
          try {
            myPeer.destroy()
          } catch {}
          return
        }
        resolved = true
        this.signalingReconnectAttempts = 0
        if (this.signalingReconnectTimer) {
          clearTimeout(this.signalingReconnectTimer)
          this.signalingReconnectTimer = null
        }
        if (hostTimeout) clearTimeout(hostTimeout)
        console.log('[P2P] Room created with Host ID:', id)
        diagLog('room', 'create-open', { roomCode: this.roomCode, hostPeerId: id })
        const currentLocal = useGameStore.getState().localPlayer
        useGameStore.getState().setLocalPlayer({
          id,
          gameId: currentLocal.gameId || currentLocal.id,
          isHost: true,
          isOwner: true,
          role: 'host',
        })
        useGameStore.getState().setRoomSession(this.roomCode!, true, options)
        useGameStore.getState().setConnected(true)
        useGameStore.getState().setConnectionStatus('connected')
        this.setupPeerListeners()
        this.startHeartbeat()
        resolve(this.roomCode!)
      })

      this.peer.on('error', async (err: any) => {
        if (resolved) {
          if (this.peer !== myPeer) return
          console.warn('[P2P] Runtime error on host peer:', err)
          const errType = err?.type || ''
          if (errType === 'network' || errType === 'server-error' || errType === 'socket-error' || errType === 'socket-closed') {
            useGameStore.getState().setConnectionStatus('reconnecting')
            this.scheduleSignalingReconnect()
          }
          return
        }
        // Stale error from a replaced peer: ignore entirely.
        if (this.peer !== myPeer) return
        if (hostTimeout) clearTimeout(hostTimeout)
        console.warn('[P2P] Error hosting room, checking fallback:', err)
        diagLog('room', 'create-error', {
          roomCode: this.roomCode,
          type: err?.type || null,
          message: String(err?.message || err || '').slice(0, 160),
        })

        // If ID is already taken or unavailable (e.g. active room already hosted or lingering session)
        if (
          (err?.type === 'unavailable-id' || err?.message?.includes('is taken') || err?.type === 'server-error') &&
          retryCount === 0
        ) {
          resolved = true
          console.log('[P2P] Host ID already registered. Joining as client to active room...')
          try {
            if (this.peer) {
              try {
                this.peer.destroy()
              } catch (e) {}
              this.peer = null
            }
            await this.joinRoom(this.roomCode!, localPlayer, retryCount + 1)
            resolve(this.roomCode!)
          } catch (joinErr) {
            reject(joinErr)
          }
        } else {
          resolved = true
          try {
            if (this.peer) {
              this.peer.destroy()
              this.peer = null
            }
          } catch (e) {}
          reject(err)
        }
      })
    })
  }

  /**
   * Join an existing Room (with Smart Auto-Host Fallback if unhosted)
   */
  public async joinRoom(roomCode: string, localPlayer: Player, retryCount: number = 0): Promise<void> {
    this.roomCode = roomCode.trim().toUpperCase()
    this.isHost = false
    this.isIntentionalDisconnect = false
    const clientPeerId = `gather-v2-${this.roomCode}-peer-${Math.random().toString(36).substring(2, 7)}`
    const hostPeerId = `gather-v2-${this.roomCode}-host`

    // Clean up any stale peer connection first
    if (this.peer) {
      try {
        this.peer.destroy()
      } catch (e) {}
      this.peer = null
    }

    return new Promise((resolve, reject) => {
      let isResolved = false
      let fallbackTimer: any = null
      let joinTimeout: any = null

      diagLog('room', 'join-begin', { roomCode: this.roomCode, clientPeerId })

      const triggerAutoHost = async () => {
        if (isResolved) return
        // Stale run (a newer session replaced this peer): stay out of the way.
        if (this.peer !== myPeer) return
        isResolved = true
        if (fallbackTimer) clearTimeout(fallbackTimer)
        if (joinTimeout) clearTimeout(joinTimeout)
        console.log(`[P2P Join] Host ${hostPeerId} is offline or unavailable. Auto-hosting space ${this.roomCode}...`)
        diagLog('room', 'join-autohost', { roomCode: this.roomCode })

        try {
          if (this.peer) {
            try {
              this.peer.destroy()
            } catch (e) {}
            this.peer = null
          }
          if (retryCount === 0) {
            await this.createRoom(
              this.roomCode!,
              localPlayer,
              {
                roomName: `Espaço ${this.roomCode}`,
                isPublic: false,
              },
              retryCount + 1
            )
            resolve()
          } else {
            useGameStore.getState().setConnected(false)
            useGameStore.getState().setConnectionStatus('disconnected')
            reject(new Error(`O anfitrião da sala ${this.roomCode} não respondeu. A sessão P2P anterior pode ainda estar ativa no servidor.`))
          }
        } catch (err) {
          console.error('[P2P AutoHost] Error promoting to host:', err)
          useGameStore.getState().setConnected(false)
          useGameStore.getState().setConnectionStatus('disconnected')
          reject(err)
        }
      }

      joinTimeout = setTimeout(() => {
        if (!isResolved) {
          console.warn(`[P2P Join] Overall connection timeout for room ${this.roomCode}`)
          diagLog('room', 'join-timeout-autohost', { roomCode: this.roomCode })
          triggerAutoHost()
        }
      }, 7500)

      const myPeer = new Peer(clientPeerId, {
        // STUN + TURN fallback (see SHARED_RTC_CONFIG).
        config: SHARED_RTC_CONFIG,
      })
      this.peer = myPeer
      this.setupSignalingListeners(myPeer)

      this.peer.on('open', (id) => {
        console.log('[P2P] Joined peer network with ID:', id)
        if (isResolved) {
          // Re-opened after signaling reconnect
          if (this.peer === myPeer) {
            this.signalingReconnectAttempts = 0
            if (this.signalingReconnectTimer) {
              clearTimeout(this.signalingReconnectTimer)
              this.signalingReconnectTimer = null
            }
            useGameStore.getState().setConnected(true)
            useGameStore.getState().setConnectionStatus('connected')
            this.recheckZoneCalls()
          }
          return
        }
        if (this.peer !== myPeer) return
        diagLog('room', 'join-open', { roomCode: this.roomCode, clientPeerId: id })
        const currentLocal = useGameStore.getState().localPlayer
        useGameStore.getState().setLocalPlayer({
          id,
          gameId: currentLocal.gameId || currentLocal.id,
          isHost: false,
          isOwner: false,
        })
        useGameStore.getState().setRoomSession(this.roomCode!, false)
        useGameStore.getState().setConnected(true)
        useGameStore.getState().setConnectionStatus('connecting')
        this.setupPeerListeners()
        this.startHeartbeat()

        // Connect to Host
        const conn = this.peer!.connect(hostPeerId, {
          metadata: { player: useGameStore.getState().localPlayer },
          reliable: true,
        })

        // Wait up to 3.5s for host connection confirmation before auto-hosting
        fallbackTimer = setTimeout(() => {
          if (!isResolved && this.connections.size === 0) {
            triggerAutoHost()
          }
        }, 3500)

        conn.on('open', () => {
          if (!isResolved) {
            if (fallbackTimer) clearTimeout(fallbackTimer)
            if (joinTimeout) clearTimeout(joinTimeout)
            isResolved = true
            this.signalingReconnectAttempts = 0
            if (this.signalingReconnectTimer) {
              clearTimeout(this.signalingReconnectTimer)
              this.signalingReconnectTimer = null
            }
            diagLog('room', 'join-host-open', { roomCode: this.roomCode })
            useGameStore.getState().setConnectionStatus('connected')
            resolve()
          }
        })

        conn.on('error', (connErr) => {
          console.warn('[P2P Data] Failed to connect to host:', connErr)
          if (!isResolved) {
            triggerAutoHost()
          }
        })

        conn.on('close', () => {
          if (!isResolved) {
            console.warn('[P2P Data] Host connection closed before open')
            triggerAutoHost()
          }
        })

        this.setupDataConnection(conn)
      })

      this.peer.on('error', (err: any) => {
        console.warn('[P2P] Peer network warning/error:', err)
        if (isResolved) {
          if (this.peer !== myPeer) return
          const errType = err?.type || ''
          if (errType === 'network' || errType === 'server-error' || errType === 'socket-error' || errType === 'socket-closed') {
            useGameStore.getState().setConnectionStatus('reconnecting')
            this.scheduleSignalingReconnect()
          }
          return
        }

        // Stale error from a replaced peer: ignore entirely.
        if (this.peer !== myPeer) return
        diagLog('room', 'join-error', {
          roomCode: this.roomCode,
          type: err?.type || null,
          message: String(err?.message || err || '').slice(0, 160),
        })
        if (
          err?.type === 'peer-unavailable' ||
          err?.message?.includes('Could not connect to peer') ||
          err?.type === 'unavailable-id' ||
          err?.type === 'server-error'
        ) {
          triggerAutoHost()
        } else {
          isResolved = true
          if (fallbackTimer) clearTimeout(fallbackTimer)
          if (joinTimeout) clearTimeout(joinTimeout)
          try {
            if (this.peer) {
              this.peer.destroy()
              this.peer = null
            }
          } catch (e) {}
          useGameStore.getState().setConnected(false)
          useGameStore.getState().setConnectionStatus('disconnected')
          useGameStore.getState().setRoomSession('', false)
          reject(new Error(`Falha de conexão P2P: ${err?.type || err?.message || 'erro de rede'}`))
        }
      })
    })
  }

  private setupSignalingListeners(myPeer: Peer) {
    myPeer.on('disconnected', () => {
      console.warn(`[P2P Signaling] Disconnected from server (Peer ID: ${myPeer.id})`)
      diagLog('room', 'peer-disconnected', { roomCode: this.roomCode, peerId: myPeer.id })

      if (this.isIntentionalDisconnect || !this.roomCode || this.peer !== myPeer) return

      useGameStore.getState().setConnectionStatus('reconnecting')
      this.scheduleSignalingReconnect()
    })

    myPeer.on('close', () => {
      console.log(`[P2P Signaling] Peer connection closed (Peer ID: ${myPeer.id})`)
      diagLog('room', 'peer-closed', { roomCode: this.roomCode, peerId: myPeer.id })
      if (!this.isIntentionalDisconnect && this.roomCode && this.peer === myPeer) {
        useGameStore.getState().setConnectionStatus('disconnected')
      }
    })
  }

  public scheduleSignalingReconnect() {
    if (this.signalingReconnectTimer || this.isIntentionalDisconnect || !this.roomCode) return

    this.signalingReconnectAttempts++
    const delay = Math.min(8000, 1000 * Math.pow(1.5, Math.min(5, this.signalingReconnectAttempts - 1)))
    console.log(`[P2P Signaling] Scheduling reconnect attempt #${this.signalingReconnectAttempts} in ${delay}ms...`)

    this.signalingReconnectTimer = setTimeout(() => {
      this.signalingReconnectTimer = null
      if (!this.peer || this.isIntentionalDisconnect || !this.roomCode) return

      if (!this.peer.destroyed) {
        console.log('[P2P Signaling] Calling this.peer.reconnect()...')
        try {
          this.peer.reconnect()
        } catch (err) {
          console.warn('[P2P Signaling] peer.reconnect() error:', err)
          this.scheduleSignalingReconnect()
        }
      } else {
        console.log('[P2P Signaling] Peer destroyed, attempting full re-join...')
        const localPlayer = useGameStore.getState().localPlayer
        if (this.isHost) {
          this.createRoom(this.roomCode!, localPlayer).catch(() => {})
        } else {
          this.joinRoom(this.roomCode!, localPlayer).catch(() => {})
        }
      }
    }, delay)
  }

  private setupPeerListeners() {
    if (!this.peer) return

    // Incoming Data Connection
    this.peer.on('connection', (conn) => {
      this.setupDataConnection(conn)
    })

    // Incoming Media Call (WebRTC Audio/Video)
    this.peer.on('call', (call) => {
      MediaCallHandler.handleIncomingCall({
        call,
        myId: this.peer ? this.peer.id : '',
        mediaCalls: this.mediaCalls,
        endMediaCallWithPeer: (pid) => this.endMediaCallWithPeer(pid),
        onCallConnected: () => {},
        attemptRedialIfEligible: () => {
          const remotePlayer = useGameStore.getState().remotePlayers[call.peer]
          if (remotePlayer) {
            this.checkZoneCallEligibility(remotePlayer)
          }
        },
      })
    })
  }

  private setupDataConnection(conn: DataConnection) {
    conn.on('open', () => {
      console.log('[P2P Data] Connected to peer:', conn.peer)
      useGameStore.getState().setConnectionStatus('connected')
      this.connections.set(conn.peer, conn)
      this.peerLastSeen.set(conn.peer, Date.now())

      // Send our local player join message
      const localPlayer = useGameStore.getState().localPlayer
      this.sendToPeer(conn, {
        type: 'PLAYER_JOIN',
        senderId: this.peer!.id,
        payload: {
          player: {
            ...localPlayer,
            id: this.peer!.id,
            gameId: localPlayer.gameId || localPlayer.id,
          },
        },
        timestamp: Date.now(),
      })

      // If we are Host, send current map, custom assets, and all existing players to the newcomer
      if (this.isHost) {
        const currentMap = useMapStore.getState().mapData
        this.sendToPeer(conn, {
          type: 'MAP_SYNC',
          senderId: this.peer!.id,
          payload: { mapData: currentMap },
          timestamp: Date.now(),
        })

        const customAssets = useCustomAssetsStore.getState().customAssets
        const customCategories = useCustomAssetsStore.getState().customCategories
        if (customAssets && customAssets.length > 0) {
          // Chunked delivery: one giant CUSTOM_ASSETS_SYNC (MBs of dataURL
          // pixel-art frames) saturates the host uplink for seconds and the
          // resulting router bufferbloat delays LIVE audio/video for everyone
          // mid-call. Batches of 8 assets every 120ms leave headroom for
          // media. syncRemoteCustomAssets MERGES by id, so batches are
          // protocol-compatible with receivers expecting a single message.
          const ASSET_BATCH_SIZE = 8
          const ASSET_BATCH_GAP_MS = 120
          for (let i = 0; i < customAssets.length; i += ASSET_BATCH_SIZE) {
            const batch = customAssets.slice(i, i + ASSET_BATCH_SIZE)
            const isFirst = i === 0
            const sendBatch = () => {
              this.sendToPeer(conn, {
                type: 'CUSTOM_ASSETS_SYNC',
                senderId: this.peer!.id,
                payload: { customAssets: batch, categories: isFirst ? customCategories : undefined },
                timestamp: Date.now(),
              })
            }
            if (isFirst) {
              sendBatch()
            } else {
              setTimeout(() => {
                // sendToPeer already no-ops on closed connections.
                sendBatch()
              }, (i / ASSET_BATCH_SIZE) * ASSET_BATCH_GAP_MS)
            }
          }
        }

        // Also broadcast newcomer to other peers
        const remotePlayers = useGameStore.getState().remotePlayers
        Object.values(remotePlayers).forEach((p) => {
          this.sendToPeer(conn, {
            type: 'PLAYER_JOIN',
            senderId: p.id,
            payload: { player: p },
            timestamp: Date.now(),
          })
        })
      }
    })

    conn.on('data', (data: any) => {
      this.peerLastSeen.set(conn.peer, Date.now())
      this.handleNetworkMessage(data as NetworkMessage, conn.peer)
    })

    conn.on('close', () => {
      console.log('[P2P Data] Peer disconnected cleanly:', conn.peer)
      this.removePeer(conn.peer)
    })

    conn.on('error', (err) => {
      console.warn('[P2P Data] Peer connection error:', conn.peer, err)
    })

    // Monitor underlying RTCPeerConnection states with a grace period for transient disconnections
    const pc = (conn as any).peerConnection as RTCPeerConnection
    if (pc) {
      let dataConnDisconnectTimer: any = null

      const clearDisconnectTimer = () => {
        if (dataConnDisconnectTimer) {
          clearTimeout(dataConnDisconnectTimer)
          dataConnDisconnectTimer = null
        }
      }

      pc.addEventListener('connectionstatechange', () => {
        const state = pc.connectionState
        if (state === 'connected') {
          clearDisconnectTimer()
        } else if (state === 'closed' || state === 'failed') {
          clearDisconnectTimer()
          console.log(`[P2P WebRTC] Terminal connection state ${state} for ${conn.peer}`)
          this.removePeer(conn.peer)
        } else if (state === 'disconnected') {
          console.log(`[P2P WebRTC] Transient disconnected state for ${conn.peer}, starting 8s grace period...`)
          if (!dataConnDisconnectTimer) {
            dataConnDisconnectTimer = setTimeout(() => {
              dataConnDisconnectTimer = null
              if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
                console.log(`[P2P WebRTC] Disconnect grace period expired for ${conn.peer}. Removing peer.`)
                this.removePeer(conn.peer)
              }
            }, 8000)
          }
        }
      })

      pc.addEventListener('iceconnectionstatechange', () => {
        const ice = pc.iceConnectionState
        if (ice === 'connected' || ice === 'completed') {
          clearDisconnectTimer()
        } else if (ice === 'failed' || ice === 'closed') {
          clearDisconnectTimer()
          console.log(`[P2P ICE] Terminal ICE state ${ice} for ${conn.peer}`)
          this.removePeer(conn.peer)
        } else if (ice === 'disconnected') {
          console.log(`[P2P ICE] Transient ICE disconnected for ${conn.peer}, starting 8s grace period...`)
          if (!dataConnDisconnectTimer) {
            dataConnDisconnectTimer = setTimeout(() => {
              dataConnDisconnectTimer = null
              if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
                console.log(`[P2P ICE] Disconnect grace period expired for ${conn.peer}. Removing peer.`)
                this.removePeer(conn.peer)
              }
            }, 8000)
          }
        }
      })
    }
  }

  /**
   * Centralized Peer Removal & Cleanup
   */
  private removePeer(peerId: string) {
    this.peerLastSeen.delete(peerId)
    const conn = this.connections.get(peerId)
    if (conn) {
      try {
        conn.close()
      } catch (e) {}
      this.connections.delete(peerId)
    }

    const wasHost = peerId.endsWith('-host') || (this.roomCode && peerId === `gather-v2-${this.roomCode}-host`)

    useGameStore.getState().removeRemotePlayer(peerId)
    this.endMediaCallWithPeer(peerId)
    useMapStore.getState().checkAndUnlockEmptyZones()

    if (this.isHost) {
      if (useGameStore.getState().isRoomPublic) {
        const totalPlayers = Object.keys(useGameStore.getState().remotePlayers).length + 1
        PublicRoomsService.getInstance().updateHosting({ playerCount: totalPlayers })
      }
      // Broadcast player leave to other peers
      this.broadcast(
        {
          type: 'PLAYER_LEAVE',
          senderId: this.peer ? this.peer.id : 'system',
          payload: { peerId },
          timestamp: Date.now(),
        },
        peerId
      )
    } else if (wasHost && this.roomCode) {
      this.handleHostDisconnected(peerId)
    }
  }

  /**
   * Automatic Host Migration & Failover Election
   */
  private handleHostDisconnected(hostPeerId: string) {
    console.log('[P2P Failover] Host disconnected from room:', this.roomCode)
    if (!this.roomCode) return
    useGameStore.getState().setConnectionStatus('reconnecting')

    // Identify remaining candidates
    const remainingPeers = Array.from(this.connections.keys()).filter((pid) => pid !== hostPeerId)
    const myId = this.peer ? this.peer.id : ''
    const candidateList = [myId, ...remainingPeers].filter(Boolean).sort()

    console.log('[P2P Failover] Candidates for host election:', candidateList)

    if (candidateList.length > 0 && candidateList[0] === myId) {
      console.log('[P2P Failover] This client was ELECTED as the NEW ROOM HOST!')
      this.promoteToHost()
    } else {
      console.log(`[P2P Failover] Peer ${candidateList[0]} elected. Reconnecting in 2.5s...`)
      setTimeout(() => {
        if (!this.isHost && this.roomCode) {
          this.reconnectToHost(`gather-v2-${this.roomCode}-host`)
        }
      }, 2500)
    }
  }

  private async promoteToHost() {
    if (!this.roomCode) return
    this.isHost = true
    const localPlayer = useGameStore.getState().localPlayer

    // Update store state
    useGameStore.getState().setConnectionHostId(localPlayer.id)
    useGameStore.getState().updatePlayerRole(localPlayer.id, 'host', {
      canEditMap: true,
      canManageRoles: true,
      canMuteOthers: true,
      canKick: true,
    })

    // Clean up old client peer instance
    this.stopHeartbeat()
    if (this.peer) {
      try {
        this.peer.destroy()
      } catch (e) {}
      this.peer = null
    }
    this.connections.clear()

    const hostPeerId = `gather-v2-${this.roomCode}-host`
    this.peer = new Peer(hostPeerId, {
      // STUN + TURN fallback (see SHARED_RTC_CONFIG).
      config: SHARED_RTC_CONFIG,
    })

    this.peer.on('open', (id) => {
      console.log('[P2P Failover] Successfully claimed Host ID:', id)
      const currentLocal = useGameStore.getState().localPlayer
      useGameStore.getState().setLocalPlayer({
        id,
        gameId: currentLocal.gameId || currentLocal.id,
        isHost: true,
        role: 'host',
      })
      useGameStore.getState().setConnected(true)
      useGameStore.getState().setConnectionStatus('connected')
      this.setupPeerListeners()
      this.startHeartbeat()

      if (useGameStore.getState().isRoomPublic) {
        PublicRoomsService.getInstance().startHosting({
          id: 'room-' + this.roomCode,
          code: this.roomCode!,
          name: useGameStore.getState().roomName,
          description: useGameStore.getState().roomDescription,
          hostId: localPlayer.id,
          hostName: localPlayer.name,
          hostAvatar: localPlayer.avatar,
          hostColor: localPlayer.avatar?.shirtColor || '#4c6ef5',
          playerCount: Object.keys(useGameStore.getState().remotePlayers).length + 1,
          maxPlayers: useGameStore.getState().maxPlayers,
          color: useGameStore.getState().roomColor,
        })
      }
    })

    this.peer.on('error', (err) => {
      console.error('[P2P Failover] Error claiming host:', err)
    })
  }

  private reconnectToHost(hostPeerId: string) {
    if (!this.peer || this.peer.destroyed) return
    console.log('[P2P Failover] Attempting to reconnect to new host endpoint:', hostPeerId)
    useGameStore.getState().setConnectionStatus('reconnecting')
    const localPlayer = useGameStore.getState().localPlayer
    const conn = this.peer.connect(hostPeerId, {
      metadata: { player: localPlayer },
      reliable: true,
    })
    this.setupDataConnection(conn)
  }

  private handleNetworkMessage(msg: NetworkMessage, peerId: string) {
    this.peerLastSeen.set(peerId, Date.now())
    processNetworkMessage(
      msg,
      peerId,
      this.isHost,
      (m, exclude) => this.broadcast(m, exclude),
      (pid) => this.removePeer(pid),
      (remotePlayer) => this.checkZoneCallEligibility(remotePlayer),
      this.peer ? this.peer.id : null
    )

    if (msg.type === 'PLAYER_UPDATE' && msg.payload?.player?.isScreenSharing !== undefined) {
      if (useMediaStore.getState().isScreenSharing) {
        import('../media/MediaManager').then(({ MediaManager }) => {
          const { targetBitrate } = MediaManager.resolveOptimalScreenQuality()
          this.updateScreenShareBitrate(targetBitrate)
        }).catch(() => {})
      }
    }
  }

  /**
   * Heartbeat System to Detect Stale/Disconnected Peers Automatically
   */
  private startHeartbeat() {
    this.stopHeartbeat()

    // 1. Send heartbeat packet every 3s
    this.heartbeatInterval = setInterval(() => {
      if (!this.peer || this.connections.size === 0) return
      const pingMsg: NetworkMessage = {
        type: 'HEARTBEAT',
        senderId: this.peer.id,
        payload: {},
        timestamp: Date.now(),
      }
      this.broadcast(pingMsg)
    }, 3000)

    // 2. Prune silent peers (no message for >18s, or 25s if actively engaged in a media call)
    this.staleCheckInterval = setInterval(() => {
      const now = Date.now()

      this.peerLastSeen.forEach((lastSeen, peerId) => {
        const hasActiveMedia = this.mediaCalls.has(peerId)
        const timeoutMs = hasActiveMedia ? 25000 : 18000
        if (now - lastSeen > timeoutMs) {
          console.log(`[P2P] Peer ${peerId} timed out (${now - lastSeen}ms silent). Pruning.`)
          this.removePeer(peerId)
        }
      })
    }, 4000)
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval)
      this.staleCheckInterval = null
    }
  }

  /**
   * Broadcast message to all connected peers
   */
  public broadcast(msg: NetworkMessage, excludePeerId?: string) {
    this.connections.forEach((conn, pid) => {
      if (pid !== excludePeerId && conn.open) {
        this.sendToPeer(conn, msg)
      }
    })
  }

  private sendToPeer(conn: DataConnection, msg: NetworkMessage) {
    if (conn.open) {
      try {
        conn.send(msg)
      } catch (err) {
        console.warn('Failed to send data to peer:', err)
      }
    }
  }

  /**
   * Check if local player and remote peer are in the same Private Zone and manage MediaCall
   */
  public checkZoneCallEligibility(remotePlayer: Player) {
    MediaCallHandler.checkZoneCallEligibility(
      remotePlayer,
      this.peer,
      this.mediaCalls,
      (pid) => this.endMediaCallWithPeer(pid)
    )
  }

  /**
   * Re-evaluate zone calls against every known remote player. Called when
   * the local media stream becomes ready AFTER the data channel already
   * delivered PLAYER_JOIN messages (parallel room-join path) — without this,
   * calls that "should" exist are silently missed until someone moves zones.
   */
  public recheckZoneCalls() {
    const remotePlayers = useGameStore.getState().remotePlayers
    Object.values(remotePlayers).forEach((p) => {
      this.checkZoneCallEligibility(p)
    })
  }

  public endMediaCallWithPeer(peerId: string) {
    MediaCallHandler.endMediaCall(this.mediaCalls, peerId)
  }

  /**
   * Manually retry zone call with peer (clears fail state and dials again)
   */
  public retryZoneCall(peerId: string) {
    const remotePlayer = useGameStore.getState().remotePlayers[peerId]
    if (remotePlayer) {
      MediaCallHandler.retryCall(
        remotePlayer,
        this.peer,
        this.mediaCalls,
        (pid) => this.endMediaCallWithPeer(pid)
      )
    }
  }

  /**
   * Log what this side is actually SENDING on every live call (sender track
   * state + outbound-rtp counters). Called on media transitions (mute,
   * camera, screenshare) so the next diagnostic log shows whether a black
   * tile is a sender problem (bytesSent flat) or a receiver/tile problem.
   */
  public logSenderSnapshot(reason: string) {
    MediaCallHandler.logSenderSnapshot(this.mediaCalls, reason)
  }

  public endAllZoneMediaCalls() {
    MediaCallHandler.endAllMediaCalls(this.mediaCalls)
  }

  /**
   * Replace active video track (Switching between Camera & Screen Share with High Bitrate)
   */
  public replaceVideoTrack(
    newTrack: MediaStreamTrack | null,
    isScreenShare: boolean = false,
    maxBitrate: number = 8_000_000,
    maxFramerate: number = 60
  ) {
    MediaCallHandler.replaceVideoTrack(this.mediaCalls, newTrack, isScreenShare, maxBitrate, maxFramerate)
  }

  /**
   * Dynamically adjust active video encoding bitrate on all active calls
   */
  public updateScreenShareBitrate(maxBitrate: number) {
    MediaCallHandler.updateScreenShareBitrate(this.mediaCalls, maxBitrate)
  }

  /**
   * Replace active audio track (When mixing system audio with microphone)
   */
  public replaceAudioTrack(newTrack: MediaStreamTrack | null) {
    MediaCallHandler.replaceAudioTrack(this.mediaCalls, newTrack)
  }

  /**
   * Broadcast Local Movement
   */
  public sendPlayerMove(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', isMoving: boolean) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'PLAYER_MOVE',
      senderId: this.peer.id,
      payload: { x, y, direction, isMoving },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendMovement(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', isMoving: boolean) {
    this.sendPlayerMove(x, y, direction, isMoving)
  }

  /**
   * Broadcast Local Player Status / Presence / Zone changes
   */
  public sendPlayerUpdate(player: Partial<Player>) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'PLAYER_UPDATE',
      senderId: this.peer.id,
      payload: { player },
      timestamp: Date.now(),
    }
    this.broadcast(msg)

    // Re-check zone call status for all peers
    const remotePlayers = useGameStore.getState().remotePlayers
    Object.values(remotePlayers).forEach((p) => {
      this.checkZoneCallEligibility(p)
    })
  }

  /**
   * Broadcast Custom Asset Creation or Update across P2P Mesh
   */
  public sendCustomAssetAddOrUpdate(asset: CustomAsset) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'CUSTOM_ASSET_ADD_OR_UPDATE',
      senderId: this.peer.id,
      payload: { asset },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  /**
   * Broadcast Custom Asset Deletion across P2P Mesh
   */
  public sendCustomAssetDelete(id: string) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'CUSTOM_ASSET_DELETE',
      senderId: this.peer.id,
      payload: { id },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  /**
   * Broadcast Full Custom Assets List
   */
  public sendCustomAssetsSync(customAssets: CustomAsset[], categories?: string[]) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'CUSTOM_ASSETS_SYNC',
      senderId: this.peer.id,
      payload: { customAssets, categories },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  /**
   * Broadcast Map Edit
   */
  public sendMapEdit(action: string, data: any) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'MAP_EDIT',
      senderId: this.peer.id,
      payload: { action, data },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  /**
   * Broadcast Chat Message
   */
  public sendChatMessage(message: any) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'CHAT_MESSAGE',
      senderId: this.peer.id,
      payload: { message },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  /**
   * Broadcast Reaction
   */
  public sendReaction(reaction: any) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'REACTION',
      senderId: this.peer.id,
      payload: { reaction },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  /**
   * Broadcast Room Lock Toggle
   */
  public sendRoomLockToggle(zoneId: string, isLocked: boolean) {
    const senderId = this.peer ? this.peer.id : useGameStore.getState().localPlayer.id
    const zone = useMapStore.getState().mapData.zones.find((candidate) => candidate.id === zoneId)
    const msg: NetworkMessage = {
      type: 'ROOM_LOCK_TOGGLE',
      senderId,
      payload: {
        zoneId,
        isLocked,
        // Send the permission snapshot with the lock state so peers cannot
        // see the room as locked while missing the members who were inside.
        authorizedPeers: zone?.authorizedPeers || [],
        members: zone?.members || [],
        admins: zone?.admins || [],
      },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  /**
   * Broadcast Door Knock Request to room occupants
   */
  public sendRoomKnockRequest(request: RoomKnockRequest) {
    const senderId = this.peer ? this.peer.id : useGameStore.getState().localPlayer.id
    const msg: NetworkMessage = {
      type: 'ROOM_KNOCK_REQUEST',
      senderId,
      payload: request,
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  /**
   * Broadcast Door Knock Response (permit/deny)
   */
  public sendRoomKnockResponse(
    zoneId: string,
    requesterId: string,
    approved: boolean,
    approverName: string,
    requesterName?: string
  ) {
    const senderId = this.peer ? this.peer.id : useGameStore.getState().localPlayer.id
    const msg: NetworkMessage = {
      type: 'ROOM_KNOCK_RESPONSE',
      senderId,
      payload: { zoneId, requesterId, approved, approverName, requesterName },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  /**
   * Send mutual audio isolation signal (bidirectional silence)
   */
  public sendUserAudioIsolation(targetUserId: string, isSilenced: boolean) {
    const localPlayer = useGameStore.getState().localPlayer
    const senderId = this.peer ? this.peer.id : localPlayer.id
    const msg: NetworkMessage = {
      type: 'USER_AUDIO_ISOLATION',
      senderId,
      payload: {
        targetUserId,
        sourceUserId: localPlayer.id,
        sourceUserName: localPlayer.name,
        isSilenced,
      },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  /**
   * Broadcast Admin Mute Participant command
   */
  public sendAdminMuteParticipant(targetUserId: string, mute: boolean, targetUserName?: string, targetGameId?: string) {
    const localPlayer = useGameStore.getState().localPlayer
    const senderId = this.peer ? this.peer.id : localPlayer.id
    // Update local perception immediately for the admin
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
    const msg: NetworkMessage = {
      type: 'ADMIN_MUTE_PARTICIPANT',
      senderId,
      payload: {
        targetUserId,
        targetGameId,
        targetUserName,
        mute,
        adminName: localPlayer.name,
      },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  /**
   * Broadcast Admin Deafen Participant command
   */
  public sendAdminDeafenParticipant(targetUserId: string, deafen: boolean, targetUserName?: string, targetGameId?: string) {
    const localPlayer = useGameStore.getState().localPlayer
    const senderId = this.peer ? this.peer.id : localPlayer.id
    // Update local perception immediately for the admin
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
    const msg: NetworkMessage = {
      type: 'ADMIN_DEAFEN_PARTICIPANT',
      senderId,
      payload: {
        targetUserId,
        targetGameId,
        targetUserName,
        deafen,
        adminName: localPlayer.name,
      },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public disconnect() {
    this.isIntentionalDisconnect = true
    if (this.signalingReconnectTimer) {
      clearTimeout(this.signalingReconnectTimer)
      this.signalingReconnectTimer = null
    }
    this.signalingReconnectAttempts = 0
    this.stopHeartbeat()
    PublicRoomsService.getInstance().stopHosting()

    // Send immediate PLAYER_LEAVE broadcast so peers remove us instantly
    if (this.peer && this.connections.size > 0) {
      const leaveMsg: NetworkMessage = {
        type: 'PLAYER_LEAVE',
        senderId: this.peer.id,
        payload: { peerId: this.peer.id },
        timestamp: Date.now(),
      }
      this.broadcast(leaveMsg)
    }

    this.peerLastSeen.clear()

    this.mediaCalls.forEach((call) => {
      try {
        call.close()
      } catch (e) {}
    })
    this.mediaCalls.clear()

    this.connections.forEach((conn) => {
      try {
        conn.close()
      } catch (e) {}
    })
    this.connections.clear()

    if (this.peer) {
      try {
        this.peer.destroy()
      } catch (e) {}
      this.peer = null
    }

    // Reset adaptive buffer state so a future room join starts fresh.
    DynamicBufferManager.getInstance().resetForNewCall()

    this.roomCode = null
    this.isHost = false

    const currentLocal = useGameStore.getState().localPlayer
    if (currentLocal.gameId) {
      useGameStore.getState().setLocalPlayer({ id: currentLocal.gameId })
    }

    useGameStore.getState().setConnected(false)
    useGameStore.getState().setConnectionStatus('disconnected')
    useGameStore.getState().setRoomSession('', false)
    useGameStore.getState().clearRemotePlayers()
    // clearRemotePlayers already clears callStates (defined in same set()).
    useMediaStore.getState().clearAllPeerStreams()
  }
}
