import React from 'react'
import { Radio, RefreshCw, Search, X, Globe, Users, Check, Copy, ArrowRight, LogIn } from 'lucide-react'
import { PublicRoomInfo } from '../../types/game'
import { useBrokerStatus } from '../../hooks/useBrokerStatus'
import { isAndroid } from '../../utils/platform'
import { Button, Input, Badge, Card } from '../ui'

interface Props {
  publicRooms: PublicRoomInfo[]
  filteredPublicRooms: PublicRoomInfo[]
  searchQuery: string
  setSearchQuery: (query: string) => void
  handleManualRefresh: () => void
  copiedRoomCode: string | null
  handleCopyCode: (e: React.MouseEvent, code: string) => void
  handleJoinPublicRoom: (room: PublicRoomInfo) => void
  handleJoinByCode: (code: string) => void
  loading: boolean
  error?: string | null
  setError?: (err: string | null) => void
  onOpenCreateMode?: () => void
}

export const PublicRoomsTab: React.FC<Props> = ({
  publicRooms,
  filteredPublicRooms,
  searchQuery,
  setSearchQuery,
  handleManualRefresh,
  copiedRoomCode,
  handleCopyCode,
  handleJoinPublicRoom,
  handleJoinByCode,
  loading,
  error,
  setError,
}) => {
  const { status: brokerStatus, servers, isResolving, feedback, resolveConnection } = useBrokerStatus()

  const handleSearchSubmit = () => {
    const raw = searchQuery.trim()
    if (!raw) return

    const matchByCode = publicRooms.find(
      (r) => r.code.trim().toUpperCase() === raw.toUpperCase()
    )
    if (matchByCode) {
      handleJoinPublicRoom(matchByCode)
      return
    }

    const matchByName = publicRooms.find(
      (r) => r.name.trim().toUpperCase() === raw.toUpperCase()
    )
    if (matchByName) {
      handleJoinPublicRoom(matchByName)
      return
    }

    if (filteredPublicRooms.length === 1) {
      handleJoinPublicRoom(filteredPublicRooms[0])
      return
    }

    handleJoinByCode(raw)
  }

  return (
    <div className="p-5 space-y-3.5 overflow-y-auto flex-1 flex flex-col font-mono text-lira-ink bg-lira-panel">
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Radio className="w-4 h-4 text-lira-online" />
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-lira-online" />
            </div>
            <div>
              <h3 className="font-display text-sm font-bold text-lira-accent flex items-center gap-2">
                Hub de Salas Públicas
                <Badge variant="online">
                  {publicRooms.length} {publicRooms.length === 1 ? 'sala ativa' : 'salas ativas'}
                </Badge>
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {brokerStatus === 'disconnected' && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={resolveConnection}
                disabled={isResolving}
                className="cursor-pointer"
                title="Broker desconectado. Clique para tentar resolver a conexão."
              >
                <span className="w-2 h-2 rounded-full bg-lira-error" />
                <span>Não conectado — aperte aqui para tentar resolver</span>
              </Button>
            )}

            <Button
              type="button"
              variant="quiet"
              size="sm"
              onClick={handleManualRefresh}
              className="cursor-pointer"
              title="Atualizar lista de salas públicas"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Atualizar</span>
            </Button>
          </div>
        </div>

        <div role="group" aria-label="Servidores de salas" className="flex flex-wrap gap-2">
          {servers.map((server) => {
            const connected = server.status === 'connected'
            const connecting = server.status === 'connecting'
            const label = connected ? 'Conectado' : connecting ? 'Conectando...' : 'Não conectado'
            return (
              <div
                key={server.host}
                role="status"
                aria-label={`${server.name}: ${label}`}
                title={server.host}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] border text-xs font-mono ${
                  connected
                    ? 'bg-lira-online/15 border-lira-online/40 text-lira-online'
                    : connecting
                      ? 'bg-lira-surface border-lira-rule text-lira-accent'
                      : 'bg-lira-ground border-lira-quiet text-lira-muted'
                }`}
              >
                {connecting ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <span className={`w-2 h-2 rounded-full ${connected ? 'bg-lira-online' : 'bg-lira-muted'}`} />
                )}
                <span className="font-semibold">{server.name}</span>
                <span>{label}</span>
              </div>
            )
          })}
        </div>

        {error && (
          <div className="text-xs p-2.5 rounded-[8px] border border-lira-error/40 bg-lira-error/15 text-lira-error flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-lira-error shrink-0" />
              <span>{error}</span>
            </div>
            {setError && (
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-lira-error hover:text-lira-ink p-0.5 cursor-pointer"
                title="Fechar aviso"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {feedback && (
          <div
            className={`text-xs p-2.5 rounded-[8px] border flex items-center justify-between gap-2 ${
              feedback.type === 'success'
                ? 'bg-lira-online/15 border-lira-online/40 text-lira-online'
                : 'bg-lira-error/15 border-lira-error/40 text-lira-error'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${feedback.type === 'success' ? 'bg-lira-online' : 'bg-lira-error'}`} />
              <span>{feedback.text}</span>
            </div>
            {feedback.type === 'error' && (
              <button
                type="button"
                onClick={resolveConnection}
                disabled={isResolving}
                className="text-[11px] font-bold underline hover:text-lira-ink cursor-pointer"
              >
                Tentar Novamente
              </button>
            )}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSearchSubmit()
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-lira-muted" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nome da sala ou digite o código para entrar..."
              className="pl-8 pr-8"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-lira-muted hover:text-lira-ink p-0.5 cursor-pointer"
                title="Limpar pesquisa"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!searchQuery.trim() || loading}
            className="h-9 cursor-pointer"
            title="Entrar na sala com este código ou nome"
          >
            {loading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LogIn className="w-3.5 h-3.5" />
            )}
            <span>Entrar</span>
          </Button>
        </form>
      </div>

      <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1 flex-1">
        {filteredPublicRooms.length === 0 ? (
          <Card variant="dashed" className="text-center py-9 bg-lira-ground p-6 space-y-3">
            <div className="w-12 h-12 rounded-[12px] bg-lira-surface border border-lira-rule text-lira-accent mx-auto flex items-center justify-center">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-display text-sm font-bold text-lira-accent">
                {searchQuery
                  ? 'Nenhuma sala encontrada com esses termos.'
                  : 'Nenhuma sala pública aberta no momento.'}
              </h4>
              <p className="text-[11px] font-mono text-lira-muted mt-1 max-w-sm mx-auto">
                {searchQuery
                  ? 'Pressione Enter ou clique em Entrar para tentar conectar usando este código direto.'
                  : 'Aperte o botão abaixo para atualizar e verificar se novas salas públicas foram abertas.'}
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleManualRefresh}
              className="cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Atualizar Lista de Salas</span>
            </Button>
          </Card>
        ) : (
          filteredPublicRooms.map((room) => {
            const isCopied = copiedRoomCode === room.code

            return (
              <Card
                key={room.code}
                variant="ground"
                className="p-3.5 hover:border-lira-accent transition-colors group flex flex-col gap-2 relative overflow-hidden"
              >
                <div
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-[12px]"
                  style={{ backgroundColor: room.color || '#d1b5ff' }}
                />

                <div className="flex items-center justify-between gap-2 pl-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-display text-sm font-bold text-lira-ink truncate group-hover:text-lira-accent transition-colors">
                      {room.name}
                    </span>
                  </div>

                  <Badge variant="online">
                    <span className="w-1.5 h-1.5 rounded-full bg-lira-online" />
                    <Users className="w-3 h-3" />
                    <span>{room.playerCount} online</span>
                  </Badge>
                </div>

                {room.description && (
                  <p className="text-[11px] font-mono text-lira-muted pl-1 line-clamp-1">
                    {room.description}
                  </p>
                )}

                <div className="flex items-center justify-between gap-2 pl-1 pt-1 border-t border-dashed border-lira-rule/60 mt-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div
                      className="w-5 h-5 rounded-[6px] flex items-center justify-center text-[10px] font-mono font-bold text-lira-ground shrink-0 border border-lira-rule"
                      style={{ backgroundColor: room.hostColor || '#d1b5ff' }}
                    >
                      {room.hostName.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-[11px] font-mono text-lira-muted truncate">
                      Criado por <strong className="text-lira-ink">{room.hostName}</strong>
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="quiet"
                      size="xs"
                      onClick={(e) => handleCopyCode(e, room.code)}
                      className="font-mono text-[10px] gap-1"
                      title="Copiar código da sala"
                    >
                      <span>{isAndroid() && room.code ? room.code.slice(0, 8) : room.code}</span>
                      {isCopied ? (
                        <Check className="w-3 h-3 text-lira-online" />
                      ) : (
                        <Copy className="w-3 h-3 text-lira-muted" />
                      )}
                    </Button>

                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => handleJoinPublicRoom(room)}
                      disabled={loading}
                      className="group/btn"
                    >
                      <span>Entrar</span>
                      <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-0.5 transition-transform" />
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
