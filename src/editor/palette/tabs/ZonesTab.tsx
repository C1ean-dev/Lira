import React, { useState } from 'react'
import { MousePointerClick, Check, Pencil, Trash2, Trash, Settings, Shield, Crown, Lock, Unlock, Scissors, FolderInput, Download } from 'lucide-react'
import { PixelArtThumbnail } from '../../PixelArtThumbnail'
import { WallType, PrivateZone, MapData } from '../../../types/map'
import { useMapStore } from '../../../store/useMapStore'
import { PeerManager } from '../../../p2p/PeerManager'
import { RoomSettingsModal } from '../../../components/RoomSettingsModal'
import { ConfirmModal } from '../../../components/ConfirmModal'

interface Props {
  activeTool: string
  setActiveTool: (tool: any) => void
  zoneDraft: { name: string; color: string; hasWalls?: boolean; wallType?: WallType | string }
  setZoneDraft: (draft: any) => void
  walls: { id: string | WallType; name: string; isCustom?: boolean }[]
  mapData: MapData
  handleDeleteZone: (id: string) => void
  openEditModal: (id: string) => void
  deleteCustomAsset: (id: string) => void
  onOpenStudioCreate?: () => void
  onOpenStudioEdit?: (id: string) => void
  onOpenSlicer?: (id?: string) => void
  onOpenAtlasImport?: () => void
  onExportAtlas?: () => void
}

export const ZonesTab: React.FC<Props> = ({
  activeTool,
  setActiveTool,
  zoneDraft,
  setZoneDraft,
  walls,
  mapData,
  handleDeleteZone,
  openEditModal,
  deleteCustomAsset,
  onOpenStudioCreate,
  onOpenStudioEdit,
  onOpenSlicer,
  onOpenAtlasImport,
  onExportAtlas,
}) => {
  const [selectedZoneForConfig, setSelectedZoneForConfig] = useState<PrivateZone | null>(null)
  const [assetToDelete, setAssetToDelete] = useState<{ id: string; name: string } | null>(null)

  return (
    <div className="space-y-4">
      {/* Modal for Configuring Selected Private Zone */}
      {selectedZoneForConfig && (
        <RoomSettingsModal
          zone={selectedZoneForConfig}
          isOpen={true}
          onClose={() => {
            // Refresh with updated zone if still exists
            setSelectedZoneForConfig(null)
          }}
        />
      )}

      {/* Draw with Mouse Hero Box */}
      <div className="p-3.5 bg-[#12151d]/85 rounded-2xl border-2 border-indigo-500/40 space-y-3.5 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
            <MousePointerClick className="w-4 h-4 text-indigo-400" />
            <span>Demarcar Nova Sala / Zona</span>
          </div>
          {activeTool === 'draw_zone' && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold flex items-center gap-1">
              <Check className="w-3 h-3" /> Ativo
            </span>
          )}
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-slate-400 mb-1">Nome da Sala / Zona</label>
          <input
            type="text"
            value={zoneDraft.name}
            onChange={(e) => setZoneDraft({ ...zoneDraft, name: e.target.value })}
            placeholder="Ex: Sala de Reunião / Forja Medieval"
            className="w-full bg-[#1b202c] border border-[#2a3142] rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Auto-Generated Unique Identification Color Badge */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <div className="flex items-center gap-2.5">
            <div
              className="w-4 h-4 rounded-full shadow-md border-2 border-white/20 shrink-0"
              style={{ backgroundColor: zoneDraft.color || '#4c6ef5' }}
            />
            <span className="text-[11px] font-semibold text-slate-300">Cor de Identificação</span>
          </div>
          <span className="text-[10px] text-indigo-300 font-semibold bg-indigo-500/15 px-2 py-0.5 rounded-full border border-indigo-500/25">
            Gerada Automaticamente ✨
          </span>
        </div>

        {/* Zone Walls & Texture Config */}
        <div className="pt-2 border-t border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-200">
              <input
                type="checkbox"
                checked={zoneDraft.hasWalls !== false}
                onChange={(e) => setZoneDraft({ ...zoneDraft, hasWalls: e.target.checked })}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700 cursor-pointer"
              />
              <span>🧱 Construir Paredes nesta Zona</span>
            </label>
          </div>

          {zoneDraft.hasWalls !== false && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-semibold text-slate-400">Textura das Paredes da Sala:</div>
              </div>

              {/* Creator Suite Actions Bar for Walls */}
              <div className="grid grid-cols-4 gap-1 p-1 bg-slate-900/80 border border-slate-800 rounded-xl">
                <button
                  type="button"
                  onClick={onOpenStudioCreate}
                  className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white text-[10px] font-bold border border-indigo-500/30 transition-all shadow-xs"
                  title="Desenhar parede no Estúdio Pixel Art"
                >
                  <Pencil className="w-3 h-3 text-indigo-400" />
                  <span>Estúdio</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenSlicer?.()}
                  className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg bg-amber-600/30 hover:bg-amber-600 text-amber-200 hover:text-white text-[10px] font-bold border border-amber-500/30 transition-all shadow-xs"
                  title="Fatiar spritesheet ou imagem para parede"
                >
                  <Scissors className="w-3 h-3 text-amber-400" />
                  <span>Fatiar</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenAtlasImport}
                  className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 hover:text-white text-[10px] font-bold border border-emerald-500/30 transition-all shadow-xs"
                  title="Importar pacote / Atlas ZIP de paredes"
                >
                  <FolderInput className="w-3 h-3 text-emerald-400" />
                  <span>Importar</span>
                </button>
                <button
                  type="button"
                  onClick={onExportAtlas}
                  className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-bold border border-slate-700 transition-all shadow-xs"
                  title="Exportar paredes como Atlas ZIP"
                >
                  <Download className="w-3 h-3 text-slate-400" />
                  <span>Exportar</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto p-0.5 bg-slate-950/40 rounded-xl border border-slate-800/80">
                {walls.map((wall) => {
                  const isSelected = (zoneDraft.wallType || 'drywall_white') === wall.id
                  const isCustom = wall.isCustom
                  return (
                    <div
                      key={wall.id}
                      onClick={() => setZoneDraft({ ...zoneDraft, wallType: wall.id as any })}
                      className={`group relative aspect-square rounded-xl border flex flex-col items-center justify-between p-1.5 transition-all select-none cursor-pointer ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-500/20 shadow-md shadow-indigo-500/20 ring-2 ring-indigo-500/40'
                          : 'border-[#2a3142] bg-[#12151d]/60 hover:border-slate-500 hover:bg-[#181d28]'
                      }`}
                      title={wall.name}
                    >
                      {/* Top Actions */}
                      <div className="w-full flex items-center justify-end z-10 pointer-events-none">
                        {isCustom && (
                          <div className="flex items-center gap-0.5 pointer-events-auto">
                            {onOpenStudioEdit && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onOpenStudioEdit(wall.id as string)
                                }}
                                className="p-1 rounded-md bg-indigo-500/30 hover:bg-indigo-500/60 text-indigo-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                                title={`Editar pixels no Estúdio: "${wall.name}"`}
                              >
                                <Pencil className="w-2.5 h-2.5" />
                              </button>
                            )}
                            {onOpenSlicer && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onOpenSlicer(wall.id as string)
                                }}
                                className="p-1 rounded-md bg-amber-500/30 hover:bg-amber-500/60 text-amber-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                                title={`Fatiar imagem desta parede: "${wall.name}"`}
                              >
                                <Scissors className="w-2.5 h-2.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setAssetToDelete({ id: wall.id as string, name: wall.name })
                              }}
                              className="p-1 rounded-md bg-rose-500/30 hover:bg-rose-500/60 text-rose-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                              title="Excluir parede customizada"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Center Wall Thumbnail */}
                      <div className="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden py-0.5">
                        <PixelArtThumbnail type="wall" id={wall.id} size={48} />
                      </div>

                      {/* Bottom Label */}
                      <div className="w-full text-center px-0.5">
                        <div className="text-[11px] font-semibold text-slate-200 truncate leading-tight">
                          {wall.name.replace(/^✨\s*/, '')}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Drag Tool Activation Button */}
        <button
          type="button"
          onClick={() => setActiveTool('draw_zone')}
          className={`w-full py-2.5 rounded-xl text-xs font-bold shadow-lg flex items-center justify-center gap-2 transition-all ${
            activeTool === 'draw_zone'
              ? 'bg-emerald-600 text-white shadow-emerald-600/30'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
          }`}
        >
          <MousePointerClick className="w-4 h-4" />
          <span>{activeTool === 'draw_zone' ? 'Pronto! Arraste no mapa agora' : 'Ativar Desenho no Mouse'}</span>
        </button>

        <div className="text-[11px] text-slate-400 text-center leading-relaxed">
          👉 Clique no mapa e <strong className="text-slate-200">arraste</strong> para criar a sala com as paredes selecionadas.
        </div>
      </div>

      {/* List of Existing Zones */}
      <div className="space-y-2">
        <div className="text-[11px] font-bold text-slate-400">Salas & Zonas Ativas ({mapData.zones.length})</div>
        {mapData.zones.length === 0 ? (
          <div className="text-xs text-slate-500 text-center py-4 bg-[#12151d]/40 rounded-xl border border-[#2a3142]">
            Nenhuma zona criada. Arraste no mapa para criar uma sala!
          </div>
        ) : (
          mapData.zones.map((zone: PrivateZone) => (
            <div
              key={zone.id}
              className="p-3 rounded-xl bg-[#12151d]/60 border border-[#2a3142] space-y-2.5 group hover:border-[#38435c] transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: zone.color }} />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-200">{zone.name}</span>
                      {zone.isLocked && (
                        <span className="text-[9px] bg-rose-500/20 text-rose-300 px-1.5 py-0.2 rounded-full border border-rose-500/30 flex items-center gap-0.5">
                          <Lock className="w-2.5 h-2.5" /> Trancada
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                      <span>{zone.width}x{zone.height} tiles</span>
                      <span>•</span>
                      {zone.admins && zone.admins.length > 0 ? (
                        <span className="text-amber-400 flex items-center gap-0.5">
                          <Crown className="w-2.5 h-2.5" /> {zone.admins.length} ADMs
                        </span>
                      ) : (
                        <span>Sem ADM</span>
                      )}
                      {zone.members && zone.members.length > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-indigo-400">{zone.members.length} membros</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedZoneForConfig(zone)}
                    className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-indigo-600/30 text-slate-300 hover:text-indigo-300 border border-slate-700 transition-colors flex items-center gap-1 text-[10px] font-semibold"
                    title="Configurar Sala & Permissões"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>Configurar</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteZone(zone.id)}
                    className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                    title="Excluir Zona"
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Welcome Message Preview if set */}
              {zone.welcomeMessage && (
                <div className="text-[10px] text-slate-400 bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/60 italic truncate">
                  💬 "{zone.welcomeMessage}"
                </div>
              )}

              {/* Zone Wall Configuration Switcher */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => {
                    const nextHasWalls = !(zone.hasWalls !== false)
                    useMapStore.getState().updateZone(zone.id, { hasWalls: nextHasWalls })
                    PeerManager.getInstance().broadcast({
                      type: 'MAP_SYNC',
                      senderId: 'host',
                      payload: { mapData: useMapStore.getState().mapData },
                      timestamp: Date.now(),
                    })
                  }}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                    zone.hasWalls !== false
                      ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                      : 'bg-slate-800/60 text-slate-400 border-slate-700'
                  }`}
                >
                  {zone.hasWalls !== false ? '🧱 Com Paredes' : 'Área Aberta (Sem Paredes)'}
                </button>

                {zone.hasWalls !== false && (
                  <select
                    value={zone.wallType || 'drywall_white'}
                    onChange={(e) => {
                      const newWall = e.target.value as WallType
                      useMapStore.getState().updateZone(zone.id, { wallType: newWall })
                      PeerManager.getInstance().broadcast({
                        type: 'MAP_SYNC',
                        senderId: 'host',
                        payload: { mapData: useMapStore.getState().mapData },
                        timestamp: Date.now(),
                      })
                    }}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-[10px] text-slate-200 focus:outline-none focus:border-indigo-500 max-w-[130px]"
                  >
                    {walls.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      {/* Confirm Delete Custom Wall Modal */}
      <ConfirmModal
        isOpen={!!assetToDelete}
        title="Excluir Parede Customizada"
        message={`Deseja realmente excluir a parede "${assetToDelete?.name}"? Esta ação não pode ser desfeita.`}
        confirmText="Excluir Parede"
        confirmVariant="danger"
        onConfirm={() => {
          if (assetToDelete) {
            deleteCustomAsset(assetToDelete.id)
            setAssetToDelete(null)
          }
        }}
        onCancel={() => setAssetToDelete(null)}
      />
    </div>
  )
}
