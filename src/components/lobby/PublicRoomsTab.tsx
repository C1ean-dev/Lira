import React from 'react'
import { Radio, RefreshCw, Search, X, Globe, Users, Check, Copy, ArrowRight, LogIn } from 'lucide-react'
import { PublicRoomInfo } from '../../types/game'
import { useBrokerStatus } from '../../hooks/useBrokerStatus'

interface Props {
  publicRooms: PublicRoomInfo[]
  filteredPublicRooms: PublicRoomInfo[]
  searchQuery: string
  setSearchQuery: (query: string) => void
  isRefreshing: boolean
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
  isRefreshing,
  handleManualRefresh,
  copiedRoomCode,
  handleCopyCode,
  handleJoinPublicRoom,
  handleJoinByCode,
  loading,
  error,
  setError,
}) => {
  const { status: brokerStatus, isResolving, feedback, resolveConnection } = useBrokerStatus()

  const handleSearchSubmit = () => {
    const raw = searchQuery.trim()
    if (!raw) return

    // 1. Check if matches any active public room by code (case-insensitive)
    const matchByCode = publicRooms.find(
      (r) => r.code.trim().toUpperCase() === raw.toUpperCase()
    )
    if (matchByCode) {
      handleJoinPublicRoom(matchByCode)
      return
    }

    // 2. Check if matches any active public room by name (case-insensitive)
    const matchByName = publicRooms.find(
      (r) => r.name.trim().toUpperCase() === raw.toUpperCase()
    )
    if (matchByName) {
      handleJoinPublicRoom(matchByName)
      return
    }

    // 3. If filtered list currently has exactly 1 room matching the query, enter it
    if (filteredPublicRooms.length === 1) {
      handleJoinPublicRoom(filteredPublicRooms[0])
      return
    }

    // 4. Default: behave like "entrar por código" for direct/private/public room codes
    handleJoinByCode(raw)
  }

  return (
    <div className="p-5 space-y-3.5 overflow-y-auto flex-1 flex flex-col">
      {/* Top Hub Bar: Status, Count, Refresh */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-100 flex items-center gap-2">
                Hub de Salas Públicas
                <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {publicRooms.length} {publicRooms.length === 1 ? 'sala ativa' : 'salas ativas'}
                </span>
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {brokerStatus === 'connected' ? (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold"
                title="Conectado ao broker de salas públicas em tempo real"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Conectado</span>
              </div>
            ) : brokerStatus === 'connecting' || isResolving ? (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-blue-500/10 border border-blue-500/25 text-blue-400 text-xs font-semibold"
              >
                <RefreshCw className="w-3 h-3 animate-spin text-blue-400" />
                <span>Conectando...</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={resolveConnection}
                disabled={isResolving}
                className="flex items-center gap-2 px-3 py-1 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 text-xs font-bold transition-all cursor-pointer animate-pulse"
                title="Broker desconectado. Clique para tentar resolver a conexão."
              >
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                <span>Não conectado — aperte aqui para tentar resolver</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#12151d] hover:bg-slate-800 border border-[#2a3142] text-slate-200 hover:text-white text-xs font-semibold transition-all cursor-pointer"
              title="Atualizar lista de salas públicas"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
              <span>{isRefreshing ? 'Atualizando...' : 'Atualizar'}</span>
            </button>
          </div>
        </div>

        {/* Error message if any */}
        {error && (
          <div className="text-xs p-2.5 rounded-xl border border-rose-500/40 bg-rose-500/15 text-rose-300 flex items-center justify-between gap-2 animate-in fade-in">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
            {setError && (
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-rose-400 hover:text-rose-200 p-0.5 cursor-pointer"
                title="Fechar aviso"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Feedback message if any */}
        {feedback && (
          <div
            className={`text-xs p-2.5 rounded-xl border flex items-center justify-between gap-2 animate-in fade-in ${
              feedback.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${feedback.type === 'success' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              <span>{feedback.text}</span>
            </div>
            {feedback.type === 'error' && (
              <button
                type="button"
                onClick={resolveConnection}
                disabled={isResolving}
                className="text-[11px] font-bold underline hover:text-rose-200 cursor-pointer"
              >
                Tentar Novamente
              </button>
            )}
          </div>
        )}

        {/* Search & Direct Join by Code Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSearchSubmit()
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nome da sala ou digite o código para entrar..."
              className="w-full bg-[#12151d] border border-[#2a3142] rounded-xl pl-8 pr-8 py-2 text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 cursor-pointer"
                title="Limpar pesquisa"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={!searchQuery.trim() || loading}
            className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-indigo-600/20 transition-all active:scale-95 shrink-0 cursor-pointer"
            title="Entrar na sala com este código ou nome"
          >
            {loading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LogIn className="w-3.5 h-3.5" />
            )}
            <span>Entrar</span>
          </button>
        </form>
      </div>

      {/* Public Rooms List */}
      <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1 flex-1">
        {filteredPublicRooms.length === 0 ? (
          <div className="text-center py-9 bg-[#12151d]/70 rounded-2xl border border-[#2a3142] p-6 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mx-auto flex items-center justify-center">
              <Globe className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-200">
                {searchQuery
                  ? 'Nenhuma sala encontrada com esses termos.'
                  : 'Nenhuma sala pública aberta no momento.'}
              </h4>
              <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
                {searchQuery
                  ? 'Pressione Enter ou clique em Entrar para tentar conectar usando este código direto.'
                  : 'Aperte o botão abaixo para atualizar e verificar se novas salas públicas foram abertas.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all active:scale-95 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Atualizando Lista...' : 'Atualizar Lista de Salas'}</span>
            </button>
          </div>
        ) : (
          filteredPublicRooms.map((room) => {
            const isCopied = copiedRoomCode === room.code

            return (
              <div
                key={room.code}
                className="p-3.5 rounded-2xl bg-[#12151d] border border-[#2a3142] hover:border-indigo-500/60 transition-all group flex flex-col gap-2 relative overflow-hidden shadow-sm"
              >
                {/* Left accent color bar */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
                  style={{ backgroundColor: room.color || '#3b82f6' }}
                />

                {/* Header row: Room Name, Live status */}
                <div className="flex items-center justify-between gap-2 pl-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-slate-100 truncate group-hover:text-indigo-300 transition-colors">
                      {room.name}
                    </span>
                  </div>

                  {/* Online count badge */}
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-300 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <Users className="w-3 h-3" />
                    <span>{room.playerCount} online</span>
                  </div>
                </div>

                {/* Description snippet if any */}
                {room.description && (
                  <p className="text-[11px] text-slate-400 pl-1 line-clamp-1">
                    {room.description}
                  </p>
                )}

                {/* Footer row: Host info, Code, Enter Button */}
                <div className="flex items-center justify-between gap-2 pl-1 pt-1 border-t border-[#2a3142]/60 mt-0.5">
                  {/* Host avatar & nickname */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 border border-white/20"
                      style={{ backgroundColor: room.hostColor || '#4c6ef5' }}
                    >
                      {room.hostName.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-[11px] text-slate-300 truncate">
                      Criado por <strong className="text-slate-100">{room.hostName}</strong>
                    </span>
                  </div>

                  {/* Actions: Copy Code & Enter Room */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => handleCopyCode(e, room.code)}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#1b202c] hover:bg-slate-800 border border-[#2a3142] text-[10px] font-mono text-slate-300 transition-colors"
                      title="Copiar código da sala"
                    >
                      <span>{room.code}</span>
                      {isCopied ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-400" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleJoinPublicRoom(room)}
                      disabled={loading}
                      className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-indigo-600/20 transition-all active:scale-95 group/btn"
                    >
                      <span>Entrar</span>
                      <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-0.5 transition-transform" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
