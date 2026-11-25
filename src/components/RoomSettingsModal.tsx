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

  const [newAdminInput, setNewAdminInput] = useState('')
  const [newMemberInput, setNewMemberInput] = useState('')

  if (!isOpen) return null

  const onlinePlayers = [
    localPlayer,
    ...Object.values(remotePlayers),
  ]

  const handleAddAdmin = (userNameToAdd: string) => {
    const trimmed = userNameToAdd.trim()
    if (!trimmed) return
    if (!admins.includes(trimmed)) {
      setAdmins([...admins, trimmed])
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
      return
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

    const effectiveAdmins = unique(
      admins.filter((a) => a !== localPlayer.id && a !== localPlayer.gameId)
    )
    if (!effectiveAdmins.includes(localPlayer.name)) {
      effectiveAdmins.unshift(localPlayer.name)
    }

    const effectiveMembers = unique(members).filter(
      (member) => !effectiveAdmins.includes(member)
    )

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
    <div className="fixed inset-0 z-[105] flex items-center justify-center p-4 bg-lira-ground/80 font-mono">
      <div className="relative w-full max-w-lg bg-lira-panel border border-dashed border-lira-rule rounded-xl overflow-hidden flex flex-col max-h-[90vh] text-lira-ink">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dashed border-lira-rule/60 bg-lira-sidebar">
          <div className="flex items-center gap-3">
            <div
              className="w-4 h-4 rounded-full shrink-0 border border-lira-rule"
              style={{ backgroundColor: color }}
            />
            <div>
              <h2 className="text-base font-display font-bold text-lira-accent flex items-center gap-2">
                <span>Configurar Sala Privada</span>
                {isLocked ? (
                  <span className="flex items-center gap-1 text-[10px] font-mono bg-lira-error/15 text-lira-error px-2 py-0.5 rounded border border-lira-error/40">
                    <Lock className="w-2.5 h-2.5" /> Restrita
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-mono bg-lira-online/15 text-lira-online px-2 py-0.5 rounded border border-lira-online/40">
                    <Unlock className="w-2.5 h-2.5" /> Livre
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-lira-muted">
                Gerencie o nome, permissões de ADM e regras de acesso
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-lira-surface text-lira-muted hover:text-lira-ink transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex border-b border-dashed border-lira-rule/60 bg-lira-ground px-6">
          <button
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-mono font-semibold border-b-2 transition-colors ${
              activeTab === 'general'
                ? 'border-lira-accent text-lira-accent bg-lira-surface'
                : 'border-transparent text-lira-muted hover:text-lira-ink'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>Geral & Identificação</span>
          </button>

          <button
            onClick={() => setActiveTab('permissions')}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-mono font-semibold border-b-2 transition-colors ${
              activeTab === 'permissions'
                ? 'border-lira-accent text-lira-accent bg-lira-surface'
                : 'border-transparent text-lira-muted hover:text-lira-ink'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Permissões & Membros</span>
            {(admins.length > 0 || members.length > 0) && (
              <span className="text-[10px] bg-lira-accent/20 text-lira-accent px-1.5 py-0.2 rounded">
                {admins.length + members.length}
              </span>
            )}
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 flex-1 custom-scrollbar text-xs">
          {activeTab === 'general' ? (
            <>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-lira-ink">
                  Nome da Sala Privada
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Sala de Reunião Alpha / Diretoria"
                  className="w-full bg-lira-ground border border-lira-rule rounded-lg px-3.5 py-2.5 text-xs text-lira-ink placeholder-lira-muted/60 focus:outline-none focus:border-lira-accent"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-lira-surface border border-lira-quiet">
                <div className="flex items-center gap-3">
                  <div
                    className="w-5 h-5 rounded-full border-2 border-lira-rule shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <div>
                    <div className="text-xs font-bold text-lira-ink">Cor de Identificação Única</div>
                    <div className="text-[10px] text-lira-muted">Gerada e atribuída automaticamente de forma exclusiva</div>
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-lira-online bg-lira-online/15 px-2.5 py-1 rounded border border-lira-online/30">
                  Exclusiva ✨
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-bold text-lira-ink">
                  <MessageSquare className="w-3.5 h-3.5 text-lira-accent" />
                  <span>Mensagem de Boas-Vindas ao Entrar</span>
                </label>
                <input
                  type="text"
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                  placeholder="Ex: Bem-vindo à Sala Executiva! Por favor, mantenha o microfone no mudo."
                  className="w-full bg-lira-ground border border-lira-rule rounded-lg px-3.5 py-2.5 text-xs text-lira-ink placeholder-lira-muted/60 focus:outline-none focus:border-lira-accent"
                />
                <p className="text-[11px] text-lira-muted">
                  Exibida em destaque na tela quando qualquer usuário ingressar nesta sala.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-lira-ink">
                  Finalidade / Descrição
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Sala reservada para chamadas de alinhamento e sprint review"
                  className="w-full bg-lira-ground border border-lira-rule rounded-lg px-3.5 py-2 text-xs text-lira-ink placeholder-lira-muted/60 focus:outline-none focus:border-lira-accent resize-none"
                />
              </div>
            </>
          ) : (
            <>
              <div className="p-4 bg-lira-surface border border-lira-quiet rounded-lg space-y-3">
                <div className="text-xs font-bold text-lira-ink flex items-center gap-2">
                  <Lock className="w-4 h-4 text-lira-accent" />
                  <span>Política de Acesso da Sala</span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsLocked(false)}
                    className={`p-3 rounded-lg border flex flex-col items-start gap-1 text-left transition-colors ${
                      !isLocked
                        ? 'border-lira-online bg-lira-online/15 text-lira-online'
                        : 'border-lira-quiet bg-lira-ground text-lira-muted hover:border-lira-rule'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Livre para Todos</span>
                    </div>
                    <span className="text-[10px] text-lira-muted">
                      Qualquer integrante do espaço pode circular e conversar livremente.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsLocked(true)}
                    className={`p-3 rounded-lg border flex flex-col items-start gap-1 text-left transition-colors ${
                      isLocked
                        ? 'border-lira-error bg-lira-error/15 text-lira-error'
                        : 'border-lira-quiet bg-lira-ground text-lira-muted hover:border-lira-rule'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Restrita / Trancada</span>
                    </div>
                    <span className="text-[10px] text-lira-muted">
                      Apenas Administradores e Membros cadastrados têm acesso.
                    </span>
                  </button>
                </div>

                {isLocked && (
                  <label className="flex items-center gap-2 cursor-pointer pt-2 border-t border-dashed border-lira-rule/60">
                    <input
                      type="checkbox"
                      checked={allowKnock}
                      onChange={(e) => setAllowKnock(e.target.checked)}
                      className="w-4 h-4 rounded accent-[var(--accent)] bg-lira-ground border-lira-rule cursor-pointer"
                    />
                    <span className="text-xs text-lira-ink flex items-center gap-1.5">
                      <BellRing className="w-3.5 h-3.5 text-lira-amber" />
                      <span>Permitir que outros usuários batam à porta para pedir entrada</span>
                    </span>
                  </label>
                )}
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-lira-ink flex items-center gap-1.5">
                    <Crown className="w-3.5 h-3.5 text-lira-amber" />
                    <span>Administradores da Sala ({admins.length})</span>
                  </div>
                  <span className="text-[10px] text-lira-muted">Controle total desta sala</span>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newAdminInput}
                    onChange={(e) => setNewAdminInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddAdmin(newAdminInput)}
                    placeholder="Nome do novo ADM..."
                    className="flex-1 bg-lira-ground border border-lira-rule rounded-lg px-3 py-1.5 text-xs text-lira-ink placeholder-lira-muted/60 focus:outline-none focus:border-lira-accent"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddAdmin(newAdminInput)}
                    className="px-3 py-1.5 bg-lira-amber/15 hover:bg-lira-amber/25 text-lira-amber border border-lira-amber/40 rounded-lg font-bold text-xs flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Adicionar</span>
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] text-lira-muted">Atalhos online:</span>
                  {onlinePlayers
                    .filter((p) => !admins.includes(p.name))
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleAddAdmin(p.name)}
                        className="text-[10px] bg-lira-surface hover:bg-lira-amber/15 hover:text-lira-amber text-lira-ink px-2 py-0.5 rounded border border-lira-quiet transition-colors flex items-center gap-1"
                      >
                        <span>+ {p.name}</span>
                      </button>
                    ))}
                </div>

                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {admins.map((adm) => {
                    const isSelf =
                      adm === localPlayer.name ||
                      adm === localPlayer.id ||
                      (localPlayer.gameId && adm === localPlayer.gameId)
                    return (
                      <div
                        key={adm}
                        className="flex items-center justify-between p-2 rounded-lg bg-lira-surface border border-lira-quiet"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded bg-lira-amber/15 text-lira-amber flex items-center justify-center text-[10px] font-bold border border-lira-amber/40">
                            👑
                          </div>
                          <span className="text-xs font-semibold text-lira-ink">
                            {isSelf ? localPlayer.name : adm}
                          </span>
                          {isSelf && (
                            <span className="text-[9px] bg-lira-accent/20 text-lira-accent px-1.5 py-0.2 rounded border border-lira-accent/40">
                              Você
                            </span>
                          )}
                        </div>
                        {isSelf ? (
                          <div
                            className="p-1 text-lira-muted/50 cursor-not-allowed flex items-center"
                            title="Você não pode remover a si mesmo como administrador da sala"
                          >
                            <Lock className="w-3.5 h-3.5 opacity-50" />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRemoveAdmin(adm)}
                            className="p-1 text-lira-muted hover:text-lira-error transition-colors"
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

              <div className="space-y-2.5 pt-2 border-t border-dashed border-lira-rule/60">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-lira-ink flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-lira-accent" />
                    <span>Membros Autorizados ({members.length})</span>
                  </div>
                  <span className="text-[10px] text-lira-muted">Acesso garantido mesmo trancada</span>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMemberInput}
                    onChange={(e) => setNewMemberInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddMember(newMemberInput)}
                    placeholder="Nome do novo Membro..."
                    className="flex-1 bg-lira-ground border border-lira-rule rounded-lg px-3 py-1.5 text-xs text-lira-ink placeholder-lira-muted/60 focus:outline-none focus:border-lira-accent"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddMember(newMemberInput)}
                    className="px-3 py-1.5 bg-lira-surface hover:border-lira-accent text-lira-accent border border-lira-rule rounded-lg font-bold text-xs flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Adicionar</span>
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] text-lira-muted">Atalhos online:</span>
                  {onlinePlayers
                    .filter((p) => !members.includes(p.name) && !admins.includes(p.name))
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleAddMember(p.name)}
                        className="text-[10px] bg-lira-surface hover:border-lira-accent hover:text-lira-accent text-lira-ink px-2 py-0.5 rounded border border-lira-quiet transition-colors flex items-center gap-1"
                      >
                        <span>+ {p.name}</span>
                      </button>
                    ))}
                </div>

                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {members.length === 0 ? (
                    <div className="text-[11px] text-lira-muted italic p-2 bg-lira-ground border border-dashed border-lira-rule/60 rounded-lg text-center">
                      Nenhum membro extra adicionado.
                    </div>
                  ) : (
                    members.map((mem) => (
                      <div
                        key={mem}
                        className="flex items-center justify-between p-2 rounded-lg bg-lira-surface border border-lira-quiet"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded bg-lira-accent/20 text-lira-accent flex items-center justify-center text-[10px] font-bold border border-lira-accent/40">
                            👤
                          </div>
                          <span className="text-xs font-medium text-lira-ink">{mem}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(mem)}
                          className="p-1 text-lira-muted hover:text-lira-error transition-colors"
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

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-dashed border-lira-rule/60 bg-lira-sidebar">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-lira-ink border border-lira-rule hover:bg-lira-surface hover:text-lira-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 rounded-lg text-xs font-bold bg-lira-accent hover:bg-lira-ink text-lira-ground border-2 border-lira-accent hover:border-lira-ink flex items-center gap-1.5 transition-colors"
          >
            <Check className="w-4 h-4" />
            <span>Salvar Configurações</span>
          </button>
        </div>
      </div>
    </div>
  )
}
