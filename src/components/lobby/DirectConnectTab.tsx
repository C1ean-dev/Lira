import React from 'react'
import { User, PlusCircle, LogIn, Globe, Shield, Sparkles } from 'lucide-react'
import { useMediaStore } from '../../store/useMediaStore'

interface Props {
  userName: string
  setUserName: (name: string) => void
  onOpenAvatarCustomizer: () => void
  mode: 'create' | 'join'
  setMode: (mode: 'create' | 'join') => void
  createRoomName: string
  setCreateRoomName: (name: string) => void
  createIsPublic: boolean
  setCreateIsPublic: (isPublic: boolean) => void
  roomInput: string
  setRoomInput: (code: string) => void
  error: string | null
  loading: boolean
  onSubmit: (e: React.FormEvent) => void
}

export const DirectConnectTab: React.FC<Props> = ({
  userName,
  setUserName,
  onOpenAvatarCustomizer,
  mode,
  setMode,
  createRoomName,
  setCreateRoomName,
  createIsPublic,
  setCreateIsPublic,
  roomInput,
  setRoomInput,
  error,
  loading,
  onSubmit,
}) => {
  return (
    <form onSubmit={onSubmit} className="p-6 space-y-4 overflow-y-auto">
      {/* User Nickname & Avatar Button */}
      <div>
        <label className="block text-xs font-semibold text-slate-300 mb-1.5">Seu Nickname</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Ex: Lucas, Carol..."
            className="flex-1 bg-[#12151d] border border-[#2a3142] rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
            maxLength={18}
            required
          />
          <button
            type="button"
            onClick={onOpenAvatarCustomizer}
            className="px-3.5 py-2 bg-[#12151d] hover:bg-slate-800 border border-[#2a3142] rounded-xl text-xs font-semibold text-indigo-400 flex items-center gap-1.5 transition-colors"
            title="Personalizar Avatar Pixel Art"
          >
            <User className="w-4 h-4" />
            <span>Avatar</span>
          </button>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-[#12151d] rounded-2xl border border-[#2a3142]">
        <button
          type="button"
          onClick={() => setMode('create')}
          className={`py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            mode === 'create'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <PlusCircle className="w-4 h-4" />
          Criar Espaço
        </button>
        <button
          type="button"
          onClick={() => setMode('join')}
          className={`py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            mode === 'join'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <LogIn className="w-4 h-4" />
          Entrar por Código
        </button>
      </div>

      {/* Create Mode Options */}
      {mode === 'create' && (
        <div className="space-y-3 p-3.5 bg-[#12151d]/60 rounded-2xl border border-[#2a3142]/60 animate-in fade-in duration-150">
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Nome da Sala / Espaço
            </label>
            <input
              type="text"
              value={createRoomName}
              onChange={(e) => setCreateRoomName(e.target.value)}
              placeholder="Ex: Devs Hub, Reunião de Equipe..."
              className="w-full bg-[#12151d] border border-[#2a3142] rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              maxLength={35}
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">Visibilidade da Sala</label>
            <button
              type="button"
              onClick={() => setCreateIsPublic(!createIsPublic)}
              className={`w-full py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-between transition-colors ${
                createIsPublic
                  ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                  : 'bg-[#12151d] border-[#2a3142] text-slate-400'
              }`}
            >
              <span className="flex items-center gap-2">
                {createIsPublic ? (
                  <Globe className="w-4 h-4 text-blue-400" />
                ) : (
                  <Shield className="w-4 h-4 text-slate-400" />
                )}
                <span>{createIsPublic ? 'Pública (visível no Hub)' : 'Privada (somente com código)'}</span>
              </span>
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                  createIsPublic ? 'bg-blue-500 text-white' : 'bg-slate-700 text-slate-400'
                }`}
              >
                {createIsPublic ? '✓' : ''}
              </span>
            </button>
          </div>

          {createIsPublic && (
            <p className="text-[10px] text-indigo-300/80 bg-indigo-500/10 p-2 rounded-xl border border-indigo-500/20">
              🌐 <strong>Sala Pública:</strong> outros usuários do app verão sua sala no Hub de Salas Disponíveis e poderão entrar facilmente!
            </p>
          )}
        </div>
      )}

      {/* Join Code Input */}
      {mode === 'join' && (
        <div className="space-y-1.5 animate-in fade-in duration-150">
          <label className="block text-xs font-semibold text-slate-300">Código da Sala</label>
          <input
            type="text"
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
            placeholder="Ex: GATHER-A9K3F"
            className="w-full bg-[#12151d] border border-[#2a3142] rounded-xl px-3.5 py-2 text-sm font-mono text-indigo-300 tracking-wider uppercase focus:outline-none focus:border-indigo-500"
          />
        </div>
      )}

      {/* Features highlight & Audio Quick Config */}
      <div className="bg-[#12151d]/60 rounded-2xl p-3 border border-[#2a3142]/60 space-y-2 text-[11px] text-slate-400">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Supressor de Ruído DSP & Anti-Eco ativados</span>
          </div>
          <button
            type="button"
            onClick={() => useMediaStore.getState().setSettingsModalOpen(true)}
            className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 underline"
          >
            Configurar Áudio
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="text-xs text-rose-400 bg-rose-500/10 p-2.5 rounded-xl border border-rose-500/30">
          {error}
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-sm shadow-xl shadow-indigo-600/30 transition-all active:scale-98 flex items-center justify-center gap-2"
      >
        {loading ? (
          <span>Conectando ao Espaço...</span>
        ) : mode === 'create' ? (
          <span>Criar e Entrar no Espaço</span>
        ) : (
          <span>Entrar na Sala</span>
        )}
      </button>
    </form>
  )
}
