import React, { useState, useEffect } from 'react'
import {
  X,
  DoorOpen,
  Crown,
  Shield,
  Users,
  Lock,
  Unlock,
  Check,
  Plus,
  Trash2,
  Sparkles,
  MessageSquare,
  Palette,
  BellRing,
} from 'lucide-react'
import { PrivateZone, WallType } from '../types/map'
import { useMapStore, autoSaveCurrentSpace } from '../store/useMapStore'
import { useGameStore } from '../store/useGameStore'
import { PeerManager } from '../p2p/PeerManager'

interface Props {
  zone: PrivateZone
  isOpen: boolean
  onClose: () => void
  initialTab?: 'general' | 'permissions'
}

export const RoomSettingsModal: React.FC<Props> = ({ zone, isOpen, onClose, initialTab }) => {
  const { localPlayer, remotePlayers } = useGameStore()
  const { updateZone, toggleZoneLock } = useMapStore()

  const [activeTab, setActiveTab] = useState<'general' | 'permissions'>(initialTab || 'general')

  // Form State
  const [name, setName] = useState(zone.name || 'Nova Sala')
  const [color, setColor] = useState(zone.color || '#4c6ef5')
  const [welcomeMessage, setWelcomeMessage] = useState(zone.welcomeMessage || '')
  const [description, setDescription] = useState(zone.description || '')
  const [isLocked, setIsLocked] = useState(!!zone.isLocked)
  const [allowKnock, setAllowKnock] = useState(zone.allowKnock !== false)
  const [admins, setAdmins] = useState<string[]>(zone.admins || [localPlayer.name])
  const [members, setMembers] = useState<string[]>(zone.members || [])

  useEffect(() => {
    if (isOpen) {
      if (initialTab) setActiveTab(initialTab)
      setName(zone.name || 'Nova Sala')
      setColor(zone.color || '#4c6ef5')
      setWelcomeMessage(zone.welcomeMessage || '')
      setDescription(zone.description || '')
      setIsLocked(!!zone.isLocked)
      setAllowKnock(zone.allowKnock !== false)
      const rawAdmins = zone.admins && zone.admins.length > 0 ? zone.admins : [localPlayer.name]
      const cleanedAdmins = Array.from(
        new Set(
          rawAdmins
            .map((a) => (a === localPlayer.id || a === localPlayer.gameId ? localPlayer.name : a))
            .filter(Boolean)
        )
      )
      if (!cleanedAdmins.includes(localPlayer.name)) {
        cleanedAdmins.unshift(localPlayer.name)
      }
      setAdmins(cleanedAdmins)
      setMembers(Array.from(new Set(zone.members || [])).filter((m) => !cleanedAdmins.includes(m)))
    }
  }, [zone, isOpen, initialTab])

  // Input fields for adding users
  const [newAdminInput, setNewAdminInput] = useState('')
  const [newMemberInput, setNewMemberInput] = useState('')

  if (!isOpen) return null

  // All online players list for easy quick-add
  const onlinePlayers = [
    localPlayer,
    ...Object.values(remotePlayers),
  ]

  const handleAddAdmin = (userNameToAdd: string) => {
    const trimmed = userNameToAdd.trim()
    if (!trimmed) return
    if (!admins.includes(trimmed)) {
      setAdmins([...admins, trimmed])
      // Remove from members if already there
      setMembers(members.filter((m) => m !== trimmed))
    }
    setNewAdminInput('')
  }

  const handleRemoveAdmin = (adminName: string) => {
    if (
      adminName === localPlayer.name ||
      adminName === localPlayer.id ||
      (localPlayer.gameId && adminName === localPlayer.gameId)
    ) {
      return // Não permite remover a si mesmo como admin da sala
    }
    setAdmins(admins.filter((a) => a !== adminName))
  }

  const handleAddMember = (userNameToAdd: string) => {
    const trimmed = userNameToAdd.trim()
    if (!trimmed) return
    if (!members.includes(trimmed) && !admins.includes(trimmed)) {
      setMembers([...members, trimmed])
    }
    setNewMemberInput('')
  }

  const handleRemoveMember = (memberName: string) => {
    setMembers(members.filter((m) => m !== memberName))
  }

  const handleSave = () => {
    const liveZone = useMapStore.getState().mapData.zones.find((z) => z.id === zone.id)

    const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

    // Curated admins from modal: must include localPlayer.name and purge any raw peer IDs
    const effectiveAdmins = unique(
      admins.filter((a) => a !== localPlayer.id && a !== localPlayer.gameId)
    )
    if (!effectiveAdmins.includes(localPlayer.name)) {
      effectiveAdmins.unshift(localPlayer.name)
    }

    // Curated members from modal: excludes anyone who is in effectiveAdmins
    const effectiveMembers = unique(members).filter(
      (member) => !effectiveAdmins.includes(member)
    )

    // Synchronize authorizedPeers: ONLY keep identifiers that belong to allowed admins or members
    const allKnownPlayers = [localPlayer, ...Object.values(remotePlayers)]
    const allowedNames = new Set([...effectiveAdmins, ...effectiveMembers])

    const allowedIdentifiers = new Set<string>(allowedNames)
    for (const p of allKnownPlayers) {
      if (allowedNames.has(p.name)) {
        if (p.id) allowedIdentifiers.add(p.id)
        if (p.gameId) allowedIdentifiers.add(p.gameId)
      }
    }

    const currentAuthorized = liveZone?.authorizedPeers || zone.authorizedPeers || []
    const updatedAuthorized = currentAuthorized.filter((p) => allowedIdentifiers.has(p))

    const updatedZone: Partial<PrivateZone> = {
      name: name.trim() || 'Sala Privada',
      color,
      welcomeMessage: welcomeMessage.trim() || undefined,
      description: description.trim() || undefined,
      isLocked,
      allowKnock,
      admins: effectiveAdmins,
      members: effectiveMembers,
      authorizedPeers: updatedAuthorized,
    }

    updateZone(zone.id, updatedZone)
    autoSaveCurrentSpace()

    // Broadcast update to all peers in the space via MAP_SYNC and ROOM_LOCK_TOGGLE
    PeerManager.getInstance().broadcast({
      type: 'MAP_SYNC',
      senderId: localPlayer.id,
      payload: { mapData: useMapStore.getState().mapData },
      timestamp: Date.now(),
    })

    PeerManager.getInstance().broadcast({
      type: 'ROOM_LOCK_TOGGLE',
      senderId: localPlayer.id,
      payload: {
        zoneId: zone.id,
        isLocked,
        authorizedPeers: updatedAuthorized,
        members: effectiveMembers,
        admins: effectiveAdmins,
      },
      timestamp: Date.now(),
    })

    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-[#0e121a] border border-[#232c3d] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1c2433] bg-[#121722]/80">
          <div className="flex items-center gap-3">
            <div
              className="w-4 h-4 rounded-full shadow-md shrink-0 border border-white/20"
              style={{ backgroundColor: color }}
            />
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>Configurar Sala Privada</span>
                {isLocked ? (
                  <span className="flex items-center gap-1 text-[10px] bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded-full border border-rose-500/30">
                    <Lock className="w-2.5 h-2.5" /> Restrita
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                    <Unlock className="w-2.5 h-2.5" /> Livre
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-slate-400">
                Gerencie o nome, permissões de ADM e regras de acesso
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-800/80 text-slate-400 hover:text-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#1c2433] bg-[#10141e] px-6">
          <button
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'general'
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>Geral & Identificação</span>
          </button>

          <button
            onClick={() => setActiveTab('permissions')}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'permissions'
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Permissões & Membros</span>
            {(admins.length > 0 || members.length > 0) && (
              <span className="text-[10px] bg-indigo-600/30 text-indigo-300 px-1.5 py-0.2 rounded-full">
                {admins.length + members.length}
              </span>
            )}
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 custom-scrollbar text-xs">
          {activeTab === 'general' ? (
            <>
              {/* Room Name */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-200">
                  Nome da Sala Privada
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Sala de Reunião Alpha / Diretoria"
                  className="w-full bg-[#161c27] border border-[#263145] rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Room Unique Color (Auto-Assigned) */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[#161c27] border border-[#263145]">
                <div className="flex items-center gap-3">
                  <div
                    className="w-5 h-5 rounded-full shadow-md border-2 border-white/20 shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <div>
                    <div className="text-xs font-bold text-slate-200">Cor de Identificação Única</div>
                    <div className="text-[10px] text-slate-400">Gerada e atribuída automaticamente de forma exclusiva</div>
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                  Exclusiva ✨
                </span>
              </div>

              {/* Welcome Greeting Message */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                  <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Mensagem de Boas-Vindas ao Entrar</span>
                </label>
                <input
                  type="text"
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                  placeholder="Ex: Bem-vindo à Sala Executiva! Por favor, mantenha o microfone no mudo."
                  className="w-full bg-[#161c27] border border-[#263145] rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
                <p className="text-[11px] text-slate-400">
                  Exibida em destaque na tela quando qualquer usuário ingressar nesta sala.
                </p>
              </div>

              {/* Room Description / Purpose */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-200">
                  Finalidade / Descrição
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Sala reservada para chamadas de alinhamento e sprint review"
                  className="w-full bg-[#161c27] border border-[#263145] rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none"
                />
              </div>
            </>
          ) : (
            <>
              {/* Access Mode */}
              <div className="p-4 bg-[#141a26] border border-[#242f44] rounded-xl space-y-3">
                <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-indigo-400" />
                  <span>Política de Acesso da Sala</span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsLocked(false)}
                    className={`p-3 rounded-xl border flex flex-col items-start gap-1 text-left transition-all ${
                      !isLocked
                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                        : 'border-[#263145] bg-[#10141e] text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Livre para Todos</span>
                    </div>
                    <span className="text-[10px] text-slate-400">
                      Qualquer integrante do espaço pode circular e conversar livremente.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsLocked(true)}
                    className={`p-3 rounded-xl border flex flex-col items-start gap-1 text-left transition-all ${
                      isLocked
                        ? 'border-rose-500 bg-rose-500/15 text-rose-300'
                        : 'border-[#263145] bg-[#10141e] text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Restrita / Trancada</span>
                    </div>
                    <span className="text-[10px] text-slate-400">
                      Apenas Administradores e Membros cadastrados têm acesso.
                    </span>
                  </button>
                </div>

                {isLocked && (
                  <label className="flex items-center gap-2 cursor-pointer pt-2 border-t border-[#20293b]">
                    <input
                      type="checkbox"
                      checked={allowKnock}
                      onChange={(e) => setAllowKnock(e.target.checked)}
                      className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700 cursor-pointer"
                    />
                    <span className="text-xs text-slate-300 flex items-center gap-1.5">
                      <BellRing className="w-3.5 h-3.5 text-amber-400" />
                      <span>Permitir que outros usuários batam à porta para pedir entrada</span>
                    </span>
                  </label>
                )}
              </div>

              {/* Room Admins */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Crown className="w-3.5 h-3.5 text-amber-400" />
                    <span>Administradores da Sala ({admins.length})</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Controle total desta sala</span>
                </div>

                {/* Add Admin Input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newAdminInput}
                    onChange={(e) => setNewAdminInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddAdmin(newAdminInput)}
                    placeholder="Nome do novo ADM..."
                    className="flex-1 bg-[#161c27] border border-[#263145] rounded-xl px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddAdmin(newAdminInput)}
                    className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-xl font-bold text-xs flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Adicionar</span>
                  </button>
                </div>

                {/* Quick Add from Online Users */}
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] text-slate-500">Atalhos online:</span>
                  {onlinePlayers
                    .filter((p) => !admins.includes(p.name))
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleAddAdmin(p.name)}
                        className="text-[10px] bg-slate-800/80 hover:bg-amber-500/20 hover:text-amber-300 text-slate-300 px-2 py-0.5 rounded-lg border border-slate-700 transition-colors flex items-center gap-1"
                      >
                        <span>+ {p.name}</span>
                      </button>
                    ))}
                </div>

                {/* Admins List */}
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {admins.map((adm) => {
                    const isSelf =
                      adm === localPlayer.name ||
                      adm === localPlayer.id ||
                      (localPlayer.gameId && adm === localPlayer.gameId)
                    return (
                      <div
                        key={adm}
                        className="flex items-center justify-between p-2 rounded-xl bg-[#141a26] border border-[#242f44]"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center text-[10px] font-bold border border-amber-500/40">
                            👑
                          </div>
                          <span className="text-xs font-semibold text-slate-200">
                            {isSelf ? localPlayer.name : adm}
                          </span>
                          {isSelf && (
                            <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.2 rounded-full border border-indigo-500/30">
                              Você
                            </span>
                          )}
                        </div>
                        {isSelf ? (
                          <div
                            className="p-1 text-slate-600 cursor-not-allowed flex items-center"
                            title="Você não pode remover a si mesmo como administrador da sala"
                          >
                            <Lock className="w-3.5 h-3.5 opacity-50" />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRemoveAdmin(adm)}
                            className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                            title="Remover Administrador"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Room Members */}
              <div className="space-y-2.5 pt-2 border-t border-[#1c2433]">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Membros Autorizados ({members.length})</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Acesso garantido mesmo trancada</span>
                </div>

                {/* Add Member Input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMemberInput}
                    onChange={(e) => setNewMemberInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddMember(newMemberInput)}
                    placeholder="Nome do novo Membro..."
                    className="flex-1 bg-[#161c27] border border-[#263145] rounded-xl px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddMember(newMemberInput)}
                    className="px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/40 rounded-xl font-bold text-xs flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Adicionar</span>
                  </button>
                </div>

                {/* Quick Add from Online Users */}
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] text-slate-500">Atalhos online:</span>
                  {onlinePlayers
                    .filter((p) => !members.includes(p.name) && !admins.includes(p.name))
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleAddMember(p.name)}
                        className="text-[10px] bg-slate-800/80 hover:bg-indigo-500/20 hover:text-indigo-300 text-slate-300 px-2 py-0.5 rounded-lg border border-slate-700 transition-colors flex items-center gap-1"
                      >
                        <span>+ {p.name}</span>
                      </button>
                    ))}
                </div>

                {/* Members List */}
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {members.length === 0 ? (
                    <div className="text-[11px] text-slate-500 italic p-2 bg-[#121620]/60 rounded-xl text-center">
                      Nenhum membro extra adicionado.
                    </div>
                  ) : (
                    members.map((mem) => (
                      <div
                        key={mem}
                        className="flex items-center justify-between p-2 rounded-xl bg-[#141a26] border border-[#242f44]"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] font-bold border border-indigo-500/40">
                            👤
                          </div>
                          <span className="text-xs font-medium text-slate-200">{mem}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(mem)}
                          className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                          title="Remover Membro"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#1c2433] bg-[#121722]/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800/80 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 flex items-center gap-1.5 transition-all"
          >
            <Check className="w-4 h-4" />
            <span>Salvar Configurações</span>
          </button>
        </div>
      </div>
    </div>
  )
}
