import React, { useState } from 'react'
import { ArrowLeft, DoorOpen, Download, FolderInput, Home, Pencil, Settings, Sparkles, Trash2 } from 'lucide-react'
import { ConfirmModal } from '../../../components/ConfirmModal'
import { findBorderWallType } from '../../../engine/houseInterior'
import { PeerManager } from '../../../p2p/PeerManager'
import { enterHouse, exitHouse } from '../../../services/houseNavigation'
import { useMapStore } from '../../../store/useMapStore'
import { DEFAULT_HOUSE_SHELL, type HouseShellConfig } from '../../../types/customAsset'
import type { MapData } from '../../../types/map'
import { PixelArtThumbnail } from '../../PixelArtThumbnail'
import { HouseConfigControls } from '../../custom-element/HouseConfigControls'

export interface HousePaletteItem {
  id: string
  name: string
  width: number
  height: number
  houseShell: HouseShellConfig
  isCustom?: boolean
  iconColor?: string
  updatedAt?: number
}

interface Props {
  houses: HousePaletteItem[]
  rootMapData: MapData
  activeHouseId: string | null
  selectedFurnitureDefId: string
  setSelectedFurnitureDefId: (id: string) => void
  activeTool: string
  setActiveTool: (tool: any) => void
  onOpenHouseCreate: () => void
  onOpenHouseEdit: (id: string) => void
  onDeleteHouseAsset: (id: string) => void
  deleteCustomAsset: (id: string) => void
  onOpenAtlasImport?: () => void
  onExportAtlas?: () => void
}

function syncRootMap() {
  PeerManager.getInstance().broadcast({
    type: 'MAP_SYNC',
    senderId: 'host',
    payload: { mapData: useMapStore.getState().mapData },
    timestamp: Date.now(),
  })
}

export const HousesTab: React.FC<Props> = ({
  houses,
  rootMapData,
  activeHouseId,
  selectedFurnitureDefId,
  setSelectedFurnitureDefId,
  activeTool,
  setActiveTool,
  onOpenHouseCreate,
  onOpenHouseEdit,
  onDeleteHouseAsset,
  deleteCustomAsset,
  onOpenAtlasImport,
  onExportAtlas,
}) => {
  const { updateHouseInteriorConfig, removeFurnitureById } = useMapStore()
  const [configuringHouseId, setConfiguringHouseId] = useState<string | null>(null)
  const [showActiveConfig, setShowActiveConfig] = useState(false)
  const [assetToDelete, setAssetToDelete] = useState<{ id: string; name: string } | null>(null)

  const houseById = new Map(houses.map((h) => [h.id, h]))
  const placedHouses = (rootMapData.furniture || [])
    .map((furn) => ({ furn, def: houseById.get(furn.defId) }))
    .filter((entry): entry is { furn: (typeof rootMapData.furniture)[number]; def: HousePaletteItem } =>
      Boolean(entry.def)
    )

  const activeInterior = activeHouseId ? rootMapData.houseInteriors?.[activeHouseId] ?? null : null
  const activeFurn = activeHouseId ? rootMapData.furniture.find((f) => f.id === activeHouseId) : undefined
  const activeDef = activeFurn ? houseById.get(activeFurn.defId) : undefined

  const buildLiveShell = (houseId: string, def?: HousePaletteItem): HouseShellConfig => {
    const interior = rootMapData.houseInteriors?.[houseId]
    return {
      ...DEFAULT_HOUSE_SHELL,
      ...(def?.houseShell || {}),
      defaultInteriorWidth:
        interior?.width ?? def?.houseShell.defaultInteriorWidth ?? DEFAULT_HOUSE_SHELL.defaultInteriorWidth,
      defaultInteriorHeight:
        interior?.height ?? def?.houseShell.defaultInteriorHeight ?? DEFAULT_HOUSE_SHELL.defaultInteriorHeight,
      defaultInteriorFloor:
        interior?.defaultFloor ?? def?.houseShell.defaultInteriorFloor ?? DEFAULT_HOUSE_SHELL.defaultInteriorFloor,
      defaultInteriorWall:
        interior
          ? findBorderWallType(interior.walls)
          : (def?.houseShell.defaultInteriorWall !== undefined
              ? def.houseShell.defaultInteriorWall
              : DEFAULT_HOUSE_SHELL.defaultInteriorWall),
      defaultZoneColor:
        interior?.accentColor ?? def?.houseShell.defaultZoneColor ?? DEFAULT_HOUSE_SHELL.defaultZoneColor,
    }
  }

  return (
    <div className="space-y-3.5 font-mono text-lira-ink">
      <div className="flex items-center gap-1.5 p-1 bg-lira-ground border border-lira-quiet rounded-[8px]">
        <button
          type="button"
          onClick={onOpenHouseCreate}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-[6px] bg-lira-amber hover:bg-lira-ink text-lira-ground text-[11px] font-bold transition-colors"
          title="Criar uma nova casa personalizada com porta e interior editável"
        >
          <Home className="w-3.5 h-3.5" />
          <span>Criar Casa</span>
        </button>
        {onOpenAtlasImport && (
          <button
            type="button"
            onClick={onOpenAtlasImport}
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-[6px] bg-lira-surface hover:border-lira-online text-lira-online text-[10px] font-bold border border-lira-rule transition-colors"
            title="Importar pacote / Atlas de casas"
          >
            <FolderInput className="w-3 h-3" />
            <span>Importar</span>
          </button>
        )}
        {onExportAtlas && (
          <button
            type="button"
            onClick={onExportAtlas}
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-[6px] bg-lira-surface hover:border-lira-accent text-lira-muted hover:text-lira-ink text-[10px] font-bold border border-lira-rule transition-colors"
            title="Exportar modelos de casas"
          >
            <Download className="w-3 h-3" />
            <span>Exportar</span>
          </button>
        )}
      </div>

      {activeHouseId && activeInterior && (
        <div className="p-3 rounded-[10px] border border-dashed border-lira-amber/60 bg-lira-amber/10 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-bold text-lira-amber flex items-center gap-1.5 truncate">
                <Home className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{activeInterior.name}</span>
              </div>
              <p className="text-[10px] text-lira-muted">
                Interior ativo: {activeInterior.width}×{activeInterior.height} tiles
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setShowActiveConfig((v) => !v)}
                className={`p-1.5 rounded-[6px] border text-xs transition-colors ${
                  showActiveConfig
                    ? 'bg-lira-amber text-lira-ground border-lira-amber'
                    : 'bg-lira-surface text-lira-amber border-lira-rule hover:border-lira-amber'
                }`}
                title="Redimensionar ou renomear este interior"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => exitHouse()}
                className="px-2 py-1 rounded-[6px] bg-lira-surface hover:bg-lira-amber text-lira-amber hover:text-lira-ground border border-lira-amber/50 text-[10px] font-bold flex items-center gap-1 transition-colors"
              >
                <ArrowLeft className="w-3 h-3" />
                <span>Sair</span>
              </button>
            </div>
          </div>

          {showActiveConfig && (
            <HouseConfigControls
              compact
              isHouse
              houseName={activeInterior.name}
              onChangeHouseName={(name) => {
                updateHouseInteriorConfig(activeHouseId, { name })
                syncRootMap()
              }}
              houseShell={buildLiveShell(activeHouseId, activeDef)}
              onChange={(next) => {
                updateHouseInteriorConfig(activeHouseId, {
                  width: next.defaultInteriorWidth,
                  height: next.defaultInteriorHeight,
                  wallType: next.defaultInteriorWall,
                })
                syncRootMap()
              }}
            />
          )}

          <p className="text-[10px] text-lira-muted leading-snug">
            Para posicionar novas casas, volte ao mapa principal.
          </p>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-bold text-lira-muted uppercase tracking-wider">
            Modelos de Casa ({houses.length})
          </span>
        </div>

        {houses.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 max-h-56 overflow-y-auto p-0.5">
            {houses.map((item) => {
              const isBlocked = Boolean(activeHouseId)
              const isSelected = !isBlocked && selectedFurnitureDefId === item.id && activeTool === 'place_furniture'
              const intW = item.houseShell.defaultInteriorWidth ?? DEFAULT_HOUSE_SHELL.defaultInteriorWidth
              const intH = item.houseShell.defaultInteriorHeight ?? DEFAULT_HOUSE_SHELL.defaultInteriorHeight
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (isBlocked) return
                    if (isSelected) {
                      setSelectedFurnitureDefId('')
                      setActiveTool('select')
                    } else {
                      setSelectedFurnitureDefId(item.id)
                      setActiveTool('place_furniture')
                    }
                  }}
                  className={`group relative aspect-square rounded-[8px] border flex flex-col items-center justify-between p-1.5 transition-colors select-none ${
                    isBlocked
                      ? 'opacity-40 cursor-not-allowed border-lira-quiet bg-lira-ground'
                      : isSelected
                      ? 'cursor-pointer border-lira-amber bg-lira-surface ring-1 ring-lira-amber'
                      : 'cursor-pointer border-lira-quiet bg-lira-ground hover:border-lira-amber/60 hover:bg-lira-surface'
                  }`}
                  title={
                    isBlocked
                      ? 'Volte ao mapa principal para posicionar uma casa'
                      : `${item.name} • Base ${item.width}×${item.height} • Interior padrão ${intW}×${intH}`
                  }
                >
                  <div className="w-full flex items-center justify-between z-10 pointer-events-none">
                    <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-lira-panel text-lira-amber border border-lira-quiet leading-none">
                      {item.width}×{item.height}
                    </span>

                    <div className="flex items-center gap-0.5 pointer-events-auto">
                      {item.isCustom && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onOpenHouseEdit(item.id)
                            }}
                            className="p-1 rounded-[4px] bg-lira-surface hover:bg-lira-accent text-lira-accent hover:text-lira-ground border border-lira-rule opacity-0 group-hover:opacity-100 transition-opacity"
                            title={`Editar "${item.name}"`}
                          >
                            <Pencil className="w-2.5 h-2.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setAssetToDelete({ id: item.id, name: item.name })
                            }}
                            className="p-1 rounded-[4px] bg-lira-surface hover:bg-lira-error text-lira-error hover:text-lira-ground border border-lira-rule opacity-0 group-hover:opacity-100 transition-opacity"
                            title={`Excluir modelo "${item.name}"`}
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 flex items-center justify-center w-full overflow-hidden my-0.5 pointer-events-none">
                    <PixelArtThumbnail type="furniture" id={item.id} size={36} />
                  </div>

                  <div className="w-full text-center pointer-events-none">
                    <span className="text-[10px] font-bold text-lira-ink block truncate">{item.name}</span>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="py-6 text-center rounded-[10px] border border-dashed border-lira-rule text-lira-muted text-xs space-y-2">
            <Sparkles className="w-5 h-5 mx-auto text-lira-amber opacity-70" />
            <p>Nenhum modelo de casa disponível.</p>
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-dashed border-lira-rule/60 space-y-2">
        <span className="block text-[11px] font-bold text-lira-muted uppercase tracking-wider">
          Casas no Mapa ({placedHouses.length})
        </span>

        {placedHouses.length === 0 ? (
          <p className="text-[11px] text-lira-muted">
            Selecione um modelo acima e clique no mapa para adicionar uma casa.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
            {placedHouses.map(({ furn, def }) => {
              const interior = rootMapData.houseInteriors?.[furn.id]
              const houseName = furn.houseName || interior?.name || def.name
              const intW = interior?.width ?? def.houseShell.defaultInteriorWidth ?? DEFAULT_HOUSE_SHELL.defaultInteriorWidth
              const intH = interior?.height ?? def.houseShell.defaultInteriorHeight ?? DEFAULT_HOUSE_SHELL.defaultInteriorHeight
              const isConfigOpen = configuringHouseId === furn.id
              const isHere = activeHouseId === furn.id

              return (
                <div
                  key={furn.id}
                  className={`rounded-[8px] border p-2 space-y-2 ${
                    isHere ? 'border-lira-amber bg-lira-amber/10' : 'border-lira-quiet bg-lira-ground'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-lira-ink truncate flex items-center gap-1.5">
                        <Home className="w-3.5 h-3.5 text-lira-amber shrink-0" />
                        <span className="truncate">{houseName}</span>
                      </div>
                      <span className="text-[10px] text-lira-muted">
                        Interior {intW}×{intH} · Pos ({furn.x}, {furn.y})
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!isHere && (
                        <button
                          type="button"
                          onClick={() => enterHouse(furn.id)}
                          className="p-1.5 rounded-[6px] bg-lira-online/15 hover:bg-lira-online text-lira-online hover:text-lira-ground border border-lira-online/40 transition-colors"
                          title="Entrar no interior desta casa"
                        >
                          <DoorOpen className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfiguringHouseId(isConfigOpen ? null : furn.id)}
                        className={`p-1.5 rounded-[6px] border transition-colors ${
                          isConfigOpen
                            ? 'bg-lira-amber text-lira-ground border-lira-amber'
                            : 'bg-lira-surface hover:border-lira-amber text-lira-amber border-lira-rule'
                        }`}
                        title="Configurar nome e dimensões do interior"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (isHere) exitHouse({ skipTransition: true })
                          removeFurnitureById(furn.id, null)
                          syncRootMap()
                        }}
                        className="p-1.5 rounded-[6px] bg-lira-error/15 hover:bg-lira-error text-lira-error hover:text-lira-ground border border-lira-error/40 transition-colors"
                        title="Remover esta casa do mapa"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {isConfigOpen && (
                    <HouseConfigControls
                      compact
                      isHouse
                      houseName={houseName}
                      onChangeHouseName={(name) => {
                        updateHouseInteriorConfig(furn.id, { name })
                        syncRootMap()
                      }}
                      houseShell={buildLiveShell(furn.id, def)}
                      onChange={(next) => {
                        updateHouseInteriorConfig(furn.id, {
                          width: next.defaultInteriorWidth,
                          height: next.defaultInteriorHeight,
                          wallType: next.defaultInteriorWall,
                        })
                        syncRootMap()
                      }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={Boolean(assetToDelete)}
        title="Excluir Modelo de Casa"
        message={`Deseja excluir o modelo "${assetToDelete?.name || ''}"? As casas posicionadas com ele também serão removidas do mapa.`}
        confirmText="Excluir"
        confirmVariant="danger"
        onConfirm={() => {
          if (assetToDelete) {
            onDeleteHouseAsset(assetToDelete.id)
            deleteCustomAsset(assetToDelete.id)
          }
          setAssetToDelete(null)
        }}
        onCancel={() => setAssetToDelete(null)}
      />
    </div>
  )
}
