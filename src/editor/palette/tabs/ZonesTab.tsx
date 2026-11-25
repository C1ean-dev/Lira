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
      {selectedZoneForConfig && (
        <RoomSettingsModal
          zone={selectedZoneForConfig}
          isOpen={true}
          onClose={() => {
            setSelectedZoneForConfig(null)
          }}
        />
      )}

      <div className="p-3.5 bg-lira-ground rounded-[12px] border border-dashed border-lira-rule space-y-3.5 font-mono text-lira-ink">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-display font-bold text-lira-accent">
            <MousePointerClick className="w-4 h-4 text-lira-accent" />
            <span>Demarcar Nova Sala / Zona</span>
          </div>
          {activeTool === 'draw_zone' && (
            <span className="px-2 py-0.5 rounded-[6px] bg-lira-online/15 text-lira-online border border-lira-online/40 text-[10px] font-mono font-bold flex items-center gap-1">
              <Check className="w-3 h-3" /> Ativo
            </span>
          )}
        </div>

        <div>
          <label className="block text-[10px] font-mono font-semibold text-lira-muted mb-1">Nome da Sala / Zona</label>
          <input
            type="text"
            value={zoneDraft.name}
            onChange={(e) => setZoneDraft({ ...zoneDraft, name: e.target.value })}
            placeholder="Ex: Sala de Reunião / Forja Medieval"
            className="w-full bg-lira-panel border border-lira-rule rounded-[8px] px-3 py-1.5 text-xs font-mono text-lira-ink focus:outline-none focus:border-lira-accent"
          />
        </div>

        <div className="pt-2 border-t border-dashed border-lira-rule/60 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-mono font-bold text-lira-ink">
              <input
                type="checkbox"
                checked={zoneDraft.hasWalls !== false}
                onChange={(e) => setZoneDraft({ ...zoneDraft, hasWalls: e.target.checked })}
                className="w-4 h-4 rounded text-lira-accent focus:ring-0 bg-lira-panel border-lira-rule cursor-pointer"
              />
              <span>🧱 Construir Paredes nesta Zona</span>
            </label>
          </div>

          {zoneDraft.hasWalls !== false && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono font-semibold text-lira-muted">Textura das Paredes da Sala:</div>
              </div>

              <div className="grid grid-cols-4 gap-1 p-1 bg-lira-panel border border-lira-quiet rounded-[8px]">
                <button
                  type="button"
                  onClick={onOpenStudioCreate}
                  className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-[6px] bg-lira-surface hover:bg-lira-accent text-lira-accent hover:text-lira-ground text-[10px] font-mono font-bold border border-lira-rule transition-colors"
                  title="Desenhar parede no estúdio de elementos"
                >
                  <Pencil className="w-3 h-3" />
                  <span>Criar elemento</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenSlicer?.()}
                  className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-[6px] bg-lira-surface hover:border-lira-amber text-lira-amber text-[10px] font-mono font-bold border border-lira-rule transition-colors"
                  title="Fatiar spritesheet ou imagem para parede"
                >
                  <Scissors className="w-3 h-3 text-lira-amber" />
                  <span>Fatiar</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenAtlasImport}
                  className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-[6px] bg-lira-surface hover:border-lira-online text-lira-online text-[10px] font-mono font-bold border border-lira-rule transition-colors"
                  title="Importar pacote / Atlas ZIP de paredes"
                >
                  <FolderInput className="w-3 h-3 text-lira-online" />
                  <span>Importar</span>
                </button>
                <button
                  type="button"
                  onClick={onExportAtlas}
                  className="flex items-center justify-center gap-1 py-1.5 px-1 rounded-[6px] bg-lira-surface hover:border-lira-accent text-lira-muted hover:text-lira-ink text-[10px] font-mono font-bold border border-lira-rule transition-colors"
                  title="Selecionar e exportar paredes como Atlas (.png e .xml)"
                >
                  <Download className="w-3 h-3 text-lira-muted" />
                  <span>Exportar</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto p-0.5 bg-lira-panel rounded-[8px] border border-lira-quiet">
                {walls.map((wall) => {
                  const isSelected = (zoneDraft.wallType || 'drywall_white') === wall.id
                  const isCustom = wall.isCustom
                  return (
                    <div
                      key={wall.id}
                      onClick={() => setZoneDraft({ ...zoneDraft, wallType: wall.id as any })}
                      className={`group relative aspect-square rounded-[8px] border flex flex-col items-center justify-between p-1.5 transition-colors select-none cursor-pointer ${
                        isSelected
                          ? 'border-lira-accent bg-lira-surface ring-1 ring-lira-accent'
                          : 'border-lira-quiet bg-lira-ground hover:border-lira-rule hover:bg-lira-surface'
                      }`}
                      title={wall.name}
                    >
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
                                className="p-1 rounded-[4px] bg-lira-surface hover:bg-lira-accent text-lira-accent hover:text-lira-ground border border-lira-rule opacity-0 group-hover:opacity-100 transition-opacity"
                                title={`Editar no estúdio: "${wall.name}"`}
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
                                className="p-1 rounded-[4px] bg-lira-surface hover:bg-lira-amber text-lira-amber hover:text-lira-ground border border-lira-rule opacity-0 group-hover:opacity-100 transition-opacity"
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
                              className="p-1 rounded-[4px] bg-lira-error/20 hover:bg-lira-error text-lira-error hover:text-lira-ground border border-lira-error/40 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Excluir parede customizada"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 flex items-center justify-center w-full min-h-0 overflow-hidden py-0.5">
                        <PixelArtThumbnail
                          key={`${wall.id}_${(wall as any).updatedAt || ''}`}
                          type="wall"
                          id={wall.id}
                          size={48}
                        />
                      </div>

                      <div className="w-full text-center px-0.5">
                        <div className="text-[11px] font-mono font-semibold text-lira-ink truncate leading-tight">
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

        <button
          type="button"
          onClick={() => setActiveTool('draw_zone')}
          className={`w-full py-2.5 rounded-[8px] text-xs font-mono font-bold flex items-center justify-center gap-2 transition-colors ${
            activeTool === 'draw_zone'
              ? 'bg-lira-online text-lira-ground'
              : 'bg-lira-accent hover:bg-lira-ink text-lira-ground'
          }`}
        >
          <MousePointerClick className="w-4 h-4" />
          <span>{activeTool === 'draw_zone' ? 'Pronto! Arraste no mapa agora' : 'Ativar Desenho no Mouse'}</span>
        </button>

        <div className="text-[11px] font-mono text-lira-muted text-center leading-relaxed">
          Clique no mapa e <strong className="text-lira-ink">arraste</strong> para criar a sala com as paredes selecionadas.
        </div>
      </div>

      <div className="space-y-2 font-mono text-lira-ink">
        <div className="text-[11px] font-mono font-bold text-lira-muted">Salas & Zonas Ativas ({mapData.zones.length})</div>
        {mapData.zones.length === 0 ? (
          <div className="text-xs font-mono text-lira-muted text-center py-4 bg-lira-ground rounded-[8px] border border-dashed border-lira-rule/60">
            Nenhuma zona criada. Arraste no mapa para criar uma sala!
          </div>
        ) : (
          mapData.zones.map((zone: PrivateZone) => (
            <div
              key={zone.id}
              className="p-3 rounded-[8px] bg-lira-ground border border-lira-quiet space-y-2.5 group hover:border-lira-rule transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: zone.color }} />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono font-semibold text-lira-ink">{zone.name}</span>
                      {zone.isLocked && (
                        <span className="text-[9px] font-mono bg-lira-error/15 text-lira-error px-1.5 py-0.2 rounded-full border border-lira-error/40 flex items-center gap-0.5">
                          <Lock className="w-2.5 h-2.5" /> Trancada
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-lira-muted flex items-center gap-1.5 mt-0.5">
                      <span>{zone.width}x{zone.height} tiles</span>
                      <span>•</span>
                      {zone.admins && zone.admins.length > 0 ? (
                        <span className="text-lira-amber flex items-center gap-0.5">
                          <Crown className="w-2.5 h-2.5" /> {zone.admins.length} ADMs
                        </span>
                      ) : (
                        <span>Sem ADM</span>
                      )}
                      {zone.members && zone.members.length > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-lira-accent">{zone.members.length} membros</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedZoneForConfig(zone)}
                    className="p-1.5 rounded-[6px] bg-lira-surface hover:border-lira-accent text-lira-muted hover:text-lira-ink border border-lira-rule transition-colors flex items-center gap-1 text-[10px] font-mono font-semibold"
                    title="Configurar Sala & Permissões"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>Configurar</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteZone(zone.id)}
                    className="p-1.5 rounded-[6px] hover:bg-lira-error/15 text-lira-muted hover:text-lira-error transition-colors"
                    title="Excluir Zona"
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {zone.welcomeMessage && (
                <div className="text-[10px] font-mono text-lira-muted bg-lira-panel p-1.5 rounded-[6px] border border-lira-quiet italic truncate">
                  💬 "{zone.welcomeMessage}"
                </div>
              )}

              <div className="pt-2 border-t border-dashed border-lira-rule/60 flex items-center justify-between text-xs">
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
                  className={`px-2 py-1 rounded-[6px] text-[10px] font-mono font-bold border transition-colors ${
                    zone.hasWalls !== false
                      ? 'bg-lira-surface text-lira-accent border-lira-accent'
                      : 'bg-lira-panel text-lira-muted border-lira-quiet'
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
                    className="bg-lira-panel border border-lira-rule rounded-[6px] px-2 py-0.5 text-[10px] font-mono text-lira-ink focus:outline-none focus:border-lira-accent max-w-[130px]"
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
