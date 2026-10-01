import React, { useState } from 'react'
import { Plus, LayoutGrid, Check, X, Shield, Copy, ArrowRight, Edit2, Trash2, RefreshCw } from 'lucide-react'
import { SavedSpace } from '../../store/useSavedSpacesStore'
import { ConfirmModal } from '../ConfirmModal'

interface Props {
  savedSpaces: SavedSpace[]
  selectedSpaceId: string
  setSelectedSpaceId: (id: string) => void
  editingSpaceId: string | null
  editingSpaceName: string
  setEditingSpaceName: (name: string) => void
  handleStartEditingSpace: (space: SavedSpace) => void
  handleSaveEditingSpace: (spaceId: string) => void
  setEditingSpaceId: (id: string | null) => void
  handleEnterSavedSpace: (targetSpaceId?: string) => void
  handleCreateNewSpace: () => void
  duplicateSavedSpace: (spaceId: string) => void
  deleteSavedSpace: (spaceId: string) => void
  copiedRoomCode: string | null
  handleCopyCode: (e: React.MouseEvent, code: string) => void
  loading: boolean
  error?: string | null
  handleRegenerateCode?: (spaceId: string) => void
}

export const SavedSpacesTab: React.FC<Props> = ({
  savedSpaces,
  selectedSpaceId,
  setSelectedSpaceId,
  editingSpaceId,
  editingSpaceName,
  setEditingSpaceName,
  handleStartEditingSpace,
  handleSaveEditingSpace,
  setEditingSpaceId,
  handleEnterSavedSpace,
  handleCreateNewSpace,
  duplicateSavedSpace,
  deleteSavedSpace,
  copiedRoomCode,
  handleCopyCode,
  loading,
  error,
  handleRegenerateCode,
}) => {
  const [spaceToDelete, setSpaceToDelete] = useState<{ id: string; name: string } | null>(null)
  return (
    <div className="p-6 space-y-4 overflow-y-auto flex-1">
      {error && (
        <div className="text-xs text-rose-400 bg-rose-500/10 p-3 rounded-xl border border-rose-500/30 flex items-center justify-between animate-in fade-in duration-150">
          <span>{error}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold text-slate-200">Meus Espaços & Salas Salvas</h3>
          <p className="text-[11px] text-slate-400">Mapas completos com pisos, paredes, móveis e zonas</p>
        </div>
        <button
          type="button"
          onClick={handleCreateNewSpace}
          className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-indigo-600/20 transition-all active:scale-95"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Novo Espaço</span>
        </button>
      </div>

      {/* List of Saved Spaces */}
      <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-1">
        {savedSpaces.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-xs bg-[#12151d]/70 rounded-2xl border border-[#2a3142] p-6 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mx-auto flex items-center justify-center">
              <LayoutGrid className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-200">Nenhum ambiente salvo</h4>
              <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
                Crie um novo ambiente na aba Conectar ou clique no botão abaixo para começar um espaço do zero!
              </p>
            </div>
            <button
              type="button"
              onClick={handleCreateNewSpace}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-lg shadow-indigo-600/20 transition-all active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Criar Novo Espaço</span>
            </button>
          </div>
        ) : (
          savedSpaces.map((space) => {
            const isEditing = editingSpaceId === space.id
            const totalZones = space.mapData.zones?.length || 0
            const totalFurniture = space.mapData.furniture?.length || 0

            return (
              <div
                key={space.id}
                onDoubleClick={() => !isEditing && handleEnterSavedSpace(space.id)}
                className="flex items-center justify-between p-3.5 rounded-2xl border border-[#2a3142] bg-[#12151d] hover:border-indigo-500/60 hover:bg-[#161a24] transition-all group"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                  {/* Space Color / Icon Indicator */}
                  <div
                    className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: space.color || '#4c6ef5' }}
                  />

                  {/* Name or Inline Editor */}
                  {isEditing ? (
                    <div className="flex items-center gap-1.5 flex-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingSpaceName}
                        onChange={(e) => setEditingSpaceName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEditingSpace(space.id)
                          if (e.key === 'Escape') setEditingSpaceId(null)
                        }}
                        autoFocus
                        className="bg-[#1b202c] border border-indigo-500 rounded-lg px-2.5 py-1 text-xs font-bold text-white focus:outline-none flex-1"
                        maxLength={35}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveEditingSpace(space.id)}
                        className="p-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500"
                        title="Salvar Nome"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingSpaceId(null)}
                        className="p-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600"
                        title="Cancelar"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold truncate text-slate-200 group-hover:text-white transition-colors">
                          {space.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-slate-400">
                          {totalZones} {totalZones === 1 ? 'zona privada' : 'zonas privadas'} • {totalFurniture} {totalFurniture === 1 ? 'móvel' : 'móveis'}
                        </span>
                        {space.roomCode && (
                          <div className="flex items-center gap-1">
                            <span
                              onClick={(e) => handleCopyCode(e, space.roomCode)}
                              className="text-[10px] font-mono text-slate-400 hover:text-white bg-slate-900/90 hover:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-800 flex items-center gap-1 cursor-pointer transition-colors"
                              title="Clique para copiar o ID Fixo desta sala para seus amigos"
                            >
                              <Shield className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
                              <span className="truncate max-w-[110px] sm:max-w-[160px]">{space.roomCode}</span>
                              {copiedRoomCode === space.roomCode ? (
                                <Check className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                              ) : (
                                <Copy className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                              )}
                            </span>
                            {handleRegenerateCode && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleRegenerateCode(space.id)
                                }}
                                className="p-0.5 rounded text-slate-400 hover:text-indigo-300 hover:bg-slate-800 transition-colors"
                                title="Gerar novo código para esta sala (caso a conexão anterior esteja presa no servidor P2P)"
                              >
                                <RefreshCw className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                {!isEditing && (
                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => handleEnterSavedSpace(space.id)}
                      disabled={loading}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-indigo-600/20 transition-all active:scale-95 cursor-pointer"
                      title="Entrar neste Espaço"
                    >
                      <span>Entrar</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStartEditingSpace(space)}
                      className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                      title="Editar Nome do Espaço"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => duplicateSavedSpace(space.id)}
                      className="p-1.5 rounded-xl text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                      title="Duplicar Espaço"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSpaceToDelete({ id: space.id, name: space.name })}
                      className="p-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      title="Excluir Espaço"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Custom Styled Confirmation Modal for Delete Space */}
      <ConfirmModal
        isOpen={!!spaceToDelete}
        title="Excluir Espaço Salvo"
        message={`Tem certeza que deseja excluir o espaço "${spaceToDelete?.name}"? Esta ação removerá o mapa salvo e não poderá ser desfeita.`}
        confirmText="Excluir Espaço"
        confirmVariant="danger"
        onConfirm={() => {
          if (spaceToDelete) {
            deleteSavedSpace(spaceToDelete.id)
            setSpaceToDelete(null)
          }
        }}
        onCancel={() => setSpaceToDelete(null)}
      />
    </div>
  )
}
