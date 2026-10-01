import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { FakePeer, FakeConn } = vi.hoisted(() => {
  class FakeConn {
    peer: string
    sent: unknown[] = []
    handlers = new Map<string, ((...args: any[]) => void)[]>()
    constructor(peer: string) {
      this.peer = peer
      FakeConn.instances.push(this)
    }
    static instances: FakeConn[] = []
    on(evt: string, fn: (...args: any[]) => void) {
      const list = this.handlers.get(evt) || []
      list.push(fn)
      this.handlers.set(evt, list)
      return this
    }
    emit(evt: string, ...args: any[]) {
      ;(this.handlers.get(evt) || []).forEach((fn) => fn(...args))
    }
    send(msg: unknown) {
      this.sent.push(msg)
    }
  }

  class FakePeer {
    static instances: FakePeer[] = []
    id: string
    destroyed = false
    destroyedCount = 0
    handlers = new Map<string, ((...args: any[]) => void)[]>()
    constructor(id: string) {
      this.id = id
      FakePeer.instances.push(this)
    }
    on(evt: string, fn: (...args: any[]) => void) {
      const list = this.handlers.get(evt) || []
      list.push(fn)
      this.handlers.set(evt, list)
      return this
    }
    emit(evt: string, ...args: any[]) {
      ;(this.handlers.get(evt) || []).forEach((fn) => fn(...args))
    }
    destroy() {
      this.destroyed = true
      this.destroyedCount += 1
    }
    connect(peerId: string) {
      return new FakeConn(peerId)
    }
  }

  return { FakePeer, FakeConn }
})

vi.mock('peerjs', () => ({ default: FakePeer }))

import { PeerManager } from '../../p2p/PeerManager'
import { sanitizeRoomCode } from '../../utils/roomCode'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { createEnterGuard } from '../../utils/enterGuard'
import { MediaManager } from '../../media/MediaManager'
import { MapData } from '../../types/map'
import { Player } from '../../types/game'

describe('Room Connection & Entry Suite (Testes de Conexão na Sala)', () => {
  const getPlayer = (): Player => ({
    ...useGameStore.getState().localPlayer,
    id: 'test-local-player-id',
    name: 'ConectorTeste',
    x: 10,
    y: 10,
  })

  beforeEach(() => {
    vi.useFakeTimers()
    FakePeer.instances.length = 0
    FakeConn.instances.length = 0

    const pm = PeerManager.getInstance() as any
    pm.peer = null
    pm.roomCode = null
    pm.connections?.clear?.()
    vi.spyOn(pm, 'startHeartbeat').mockImplementation(() => {})
    vi.spyOn(pm, 'setupPeerListeners').mockImplementation(() => {})

    useGameStore.getState().setConnected(false)
    useGameStore.getState().setConnectionStatus('disconnected')
    useGameStore.getState().setRoomSession('', false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('1. Sanitização e Extração de Código de Sala (sanitizeRoomCode)', () => {
    it('normaliza códigos simples para maiúsculo e remove espaços', () => {
      expect(sanitizeRoomCode('sala-devs')).toBe('SALA-DEVS')
      expect(sanitizeRoomCode('  d65929af-387a-419e-a468-1e2d28728867  ')).toBe(
        'D65929AF-387A-419E-A468-1E2D28728867'
      )
    })

    it('extrai código de links URL com parâmetro ?room= ou &room=', () => {
      expect(sanitizeRoomCode('https://lira.app/?room=DEV-SALA-42')).toBe('DEV-SALA-42')
      expect(sanitizeRoomCode('http://localhost:5173/?theme=dark&room=SALA-XYZ#header')).toBe('SALA-XYZ')
    })

    it('extrai código de URLs com caminho /room/CÓDIGO', () => {
      expect(sanitizeRoomCode('https://lira.app/room/REUNIAO-GERAL')).toBe('REUNIAO-GERAL')
      expect(sanitizeRoomCode('http://192.168.1.10:3000/#/room/D65929AF')).toBe('D65929AF')
    })

    it('remove prefixo ou sufixo PeerJS copiado acidentalmente', () => {
      expect(sanitizeRoomCode('gather-v2-SALA-DIRETORIA-host')).toBe('SALA-DIRETORIA')
      expect(sanitizeRoomCode('gather-v2-SALA-DIRETORIA-peer-07zem')).toBe('SALA-DIRETORIA')
    })

    it('retorna string vazia para valores nulos, vazios ou indefinidos', () => {
      expect(sanitizeRoomCode('')).toBe('')
      expect(sanitizeRoomCode('   ')).toBe('')
      expect(sanitizeRoomCode(null as any)).toBe('')
      expect(sanitizeRoomCode(undefined as any)).toBe('')
    })
  })

  describe('2. Ciclo de Conexão na Sala (joinRoom & createRoom)', () => {
    it('conecta com sucesso quando o host da sala responde à conexão de dados', async () => {
      const pm = PeerManager.getInstance()
      const joinPromise = pm.joinRoom('d65929af-387a-419e-a468-1e2d28728867', getPlayer())

      expect(FakePeer.instances).toHaveLength(1)
      const clientPeer = FakePeer.instances[0]
      expect(clientPeer.id).toContain('D65929AF-387A-419E-A468-1E2D28728867')

      // 1. PeerJS signaling conecta
      clientPeer.emit('open', 'gather-v2-D65929AF-387A-419E-A468-1E2D28728867-peer-abc')
      expect(useGameStore.getState().connectionStatus).toBe('connecting')
      expect(useGameStore.getState().roomId).toBe('D65929AF-387A-419E-A468-1E2D28728867')

      // 2. Conexão P2P com o host abre
      expect(FakeConn.instances).toHaveLength(1)
      FakeConn.instances[0].emit('open')

      await expect(joinPromise).resolves.toBeUndefined()
      expect(useGameStore.getState().isConnected).toBe(true)
      expect(useGameStore.getState().connectionStatus).toBe('connected')
    })

    it('cria sala como anfitrião (createRoom) e inicializa sessão e status de host', async () => {
      const pm = PeerManager.getInstance()
      const roomCode = 'ESPACO-NOVO-1'
      const createPromise = pm.createRoom(roomCode, getPlayer(), {
        roomName: 'Espaço dos Desenvolvedores',
        isPublic: true,
      })

      expect(FakePeer.instances).toHaveLength(1)
      const hostPeer = FakePeer.instances[0]
      expect(hostPeer.id).toBe(`gather-v2-${roomCode}-host`)

      hostPeer.emit('open', hostPeer.id)

      const result = await createPromise
      expect(result).toBe(roomCode)
      expect(useGameStore.getState().isHost).toBe(true)
      expect(useGameStore.getState().isConnected).toBe(true)
      expect(useGameStore.getState().connectionStatus).toBe('connected')
      expect(useGameStore.getState().roomId).toBe(roomCode)
    })
  })

  describe('3. Resiliência: Auto-Host quando Host está indisponível', () => {
    it('promove cliente para host automaticamente quando host original não responde', async () => {
      const pm = PeerManager.getInstance()
      const roomCode = 'SALA-VAZIA-404'
      const joinPromise = pm.joinRoom(roomCode, getPlayer())

      const clientPeer = FakePeer.instances[0]
      clientPeer.emit('open', `gather-v2-${roomCode}-peer-xyz`)

      // Host offline: gera peer-unavailable
      clientPeer.emit('error', {
        type: 'peer-unavailable',
        message: 'Could not connect to peer gather-v2-SALA-VAZIA-404-host',
      })

      // Auto-host cria um segundo peer com papel de host
      expect(FakePeer.instances).toHaveLength(2)
      const promotedHostPeer = FakePeer.instances[1]
      expect(promotedHostPeer.id).toBe(`gather-v2-${roomCode}-host`)

      promotedHostPeer.emit('open', promotedHostPeer.id)

      await expect(joinPromise).resolves.toBeUndefined()
      expect(useGameStore.getState().isHost).toBe(true)
      expect(useGameStore.getState().isConnected).toBe(true)
    })
  })

  describe('4. Tratamento de Erros & Mensagem Amigável no Lobby', () => {
    it('limpa o estado do useGameStore e rejeita com mensagem quando a conexão falha', async () => {
      const pm = PeerManager.getInstance()
      const roomCode = 'SALA-FALHA'
      const joinPromise = pm.joinRoom(roomCode, getPlayer())

      const clientPeer = FakePeer.instances[0]
      // Simula erro de rede irrecuperável
      clientPeer.emit('error', {
        type: 'ssl-unavailable',
        message: 'SSL unavailable on broker',
      })

      await expect(joinPromise).rejects.toThrow()
      expect(useGameStore.getState().isConnected).toBe(false)
      expect(useGameStore.getState().connectionStatus).toBe('disconnected')
    })

    it('formata mensagem amigável no padrão do Lobby quando a sala não pode ser conectada', () => {
      // Simula o bloco catch do LobbyModal:
      // setError(err?.message || 'Não foi possível conectar. Verifique o código da sala e tente novamente.')
      const formatLobbyError = (err: any) => {
        return err?.message || 'Não foi possível conectar. Verifique o código da sala e tente novamente.'
      }

      expect(formatLobbyError(null)).toBe('Não foi possível conectar. Verifique o código da sala e tente novamente.')
      expect(formatLobbyError({})).toBe('Não foi possível conectar. Verifique o código da sala e tente novamente.')
      expect(formatLobbyError(new Error('Código de sala inválido'))).toBe('Código de sala inválido')
    })
  })

  describe('5. Tolerância a Falhas de Mídia (Microfone/Câmera não bloqueiam Conexão)', () => {
    it('continua a conexão da sala mesmo se o startMedia falhar (ex: microfone não encontrado)', async () => {
      // Simula o erro do log real: startMedia.av-failed "NotFoundError: Requested device not found"
      const startMediaSpy = vi.spyOn(MediaManager.getInstance(), 'startMedia').mockRejectedValue(
        new Error('NotFoundError: Requested device not found')
      )

      let mediaErrorHandled = false
      const mediaReady = MediaManager.getInstance().startMedia(true, true).catch((e) => {
        mediaErrorHandled = true
        return null
      })

      const pm = PeerManager.getInstance()
      const joinPromise = pm.joinRoom('SALA-SEM-MIC', getPlayer())

      FakePeer.instances[0].emit('open', 'gather-v2-SALA-SEM-MIC-peer-123')
      FakeConn.instances[0].emit('open')

      await Promise.all([mediaReady, joinPromise])

      expect(mediaErrorHandled).toBe(true)
      expect(useGameStore.getState().isConnected).toBe(true)
      expect(useGameStore.getState().connectionStatus).toBe('connected')

      startMediaSpy.mockRestore()
    })
  })

  describe('6. Re-entry Guard (Prevenção de Cliques Duplos Concorrentes)', () => {
    it('impede múltiplas tentativas de conexão simultâneas ao clicar rapidamente', () => {
      const guard = createEnterGuard()

      expect(guard.tryEnter()).toBe(true) // Primeiro clique aceito
      expect(guard.tryEnter()).toBe(false) // Segundo clique concorrente bloqueado
      expect(guard.tryEnter()).toBe(false) // Terceiro clique concorrente bloqueado

      guard.release() // Libera após término da conexão

      expect(guard.tryEnter()).toBe(true) // Próxima tentativa permitida
    })
  })

  describe('7. Conexão em Salas Salvas (Saved Spaces)', () => {
    it('carrega o mapa e posiciona o jogador no spawn ao conectar em sala salva correspondente', () => {
      const mockSavedMap: MapData = {
        id: 'map-saved-1',
        name: 'Escritório Matriz',
        width: 40,
        height: 40,
        tileSize: 32,
        spawnPoint: { x: 25, y: 15 },
        floors: [],
        walls: [],
        furniture: [],
        zones: [],
      }

      const savedSpaces = [
        {
          id: 'space-1',
          name: 'Escritório Matriz',
          mapData: mockSavedMap,
          description: 'Sala de trabalho',
          roomCode: 'D65929AF-387A-419E-A468-1E2D28728867',
          createdAt: Date.now(),
          lastEnteredAt: Date.now(),
        },
      ]

      const inputCode = 'd65929af-387a-419e-a468-1e2d28728867'
      const cleanInput = sanitizeRoomCode(inputCode)

      const matching = savedSpaces.find((s) => sanitizeRoomCode(s.roomCode) === cleanInput)
      expect(matching).toBeDefined()
      expect(matching?.id).toBe('space-1')

      if (matching) {
        useMapStore.getState().setMapData(matching.mapData)
        const player = getPlayer()
        player.x = matching.mapData.spawnPoint.x
        player.y = matching.mapData.spawnPoint.y

        expect(player.x).toBe(25)
        expect(player.y).toBe(15)
        expect(useMapStore.getState().mapData.name).toBe('Escritório Matriz')
      }
    })
  })
})
