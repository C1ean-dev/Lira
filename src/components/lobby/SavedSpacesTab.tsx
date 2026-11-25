import React, { useRef, useState } from 'react'
import { Plus, LayoutGrid, Check, X, Copy, ArrowRight, Edit2, Trash2, Download, Upload } from 'lucide-react'
import { SavedSpace } from '../../store/useSavedSpacesStore'
import { ConfirmModal } from '../ConfirmModal'
import { Button, Input, Card } from '../ui'

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
  copiedRoomCode?: string | null
  handleCopyCode?: (e: React.MouseEvent, code: string) => void
  loading: boolean
  error?: string | null
  handleRegenerateCode?: (spaceId: string) => void
  onExportSpace?: (spaceId: string) => void | Promise<void>
  onImportSpacesFile?: (file: File) => void | Promise<void>
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
  onExportSpace,
  onImportSpacesFile,
}) => {
  const [spaceToDelete, setSpaceToDelete] = useState<{ id: string; name: string } | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  return (
    <div className="p-4 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1 font-mono text-lira-ink bg-lira-panel">
      {error && (
        <div className="text-xs text-lira-error bg-lira-error/15 p-3 rounded-[8px] border border-lira-error/40 flex items-center justify-between">
          <span>{error}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-sm font-bold text-lira-accent">Meus Espaços & Salas Salvas</h3>
          <p className="text-[11px] font-mono text-lira-muted">Mapas completos com pisos, paredes, móveis e zonas</p>
        </div>
        <div className="flex items-center gap-2">
          {onImportSpacesFile && (
            <>
              <input
                ref={importInputRef}
                type="file"
                accept=".gz,.json,.lira-space"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void onImportSpacesFile(file)
                }}
              />
              <Button
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => importInputRef.current?.click()}
                title="Importar espaço (.lira-space.json.gz ou nativeSpaces.json)"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Importar</span>
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleCreateNewSpace}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Novo Espaço</span>
          </Button>
        </div>
      </div>

      <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-1">
        {savedSpaces.length === 0 ? (
          <Card variant="dashed" className="text-center py-10 text-lira-muted text-xs bg-lira-ground p-6 space-y-3">
            <div className="w-12 h-12 rounded-[12px] bg-lira-surface border border-lira-rule text-lira-accent mx-auto flex items-center justify-center">
              <LayoutGrid className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-display text-sm font-bold text-lira-accent">Nenhum ambiente salvo</h4>
              <p className="text-[11px] font-mono text-lira-muted mt-1 max-w-sm mx-auto">
                Crie um novo ambiente na aba Conectar ou clique no botão abaixo para começar um espaço do zero!
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleCreateNewSpace}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Criar Novo Espaço</span>
            </Button>
          </Card>
        ) : (
          savedSpaces.map((space) => {
            const isEditing = editingSpaceId === space.id
            const totalZones = space.zonesCount ?? space.mapData.zones?.length ?? 0
            const totalFurniture = space.furnitureCount ?? space.mapData.furniture?.length ?? 0

            return (
              <Card
                key={space.id}
                variant="ground"
                onDoubleClick={() => !isEditing && handleEnterSavedSpace(space.id)}
                className="flex items-center justify-between p-3.5 hover:border-lira-accent hover:bg-lira-surface/50 transition-colors group"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                  <div
                    className="w-3.5 h-3.5 rounded-full shrink-0"
                    style={{ backgroundColor: space.color || '#d1b5ff' }}
                  />

                  {isEditing ? (
                    <div className="flex items-center gap-1.5 flex-1" onClick={(e) => e.stopPropagation()}>
                      <Input
                        type="text"
                        value={editingSpaceName}
                        onChange={(e) => setEditingSpaceName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEditingSpace(space.id)
                          if (e.key === 'Escape') setEditingSpaceId(null)
                        }}
                        autoFocus
                        className="h-7 px-2.5 py-1 text-xs font-bold flex-1"
                        maxLength={35}
                      />
                      <Button
                        type="button"
                        variant="quiet"
                        size="icon"
                        onClick={() => handleSaveEditingSpace(space.id)}
                        className="h-7 w-7 border-lira-online/50 text-lira-online hover:bg-lira-online hover:text-lira-ground"
                        title="Salvar Nome"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingSpaceId(null)}
                        className="h-7 w-7"
                        title="Cancelar"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ) : (
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-display text-sm font-bold truncate text-lira-ink group-hover:text-lira-accent transition-colors">
                            {space.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] font-mono text-lira-muted">
                            {totalZones} {totalZones === 1 ? 'zona privada' : 'zonas privadas'} • {totalFurniture} {totalFurniture === 1 ? 'móvel' : 'móveis'}
                          </span>
                        </div>
                      </div>
                  )}
                </div>

                {!isEditing && (
                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => handleEnterSavedSpace(space.id)}
                      disabled={loading}
                      className="cursor-pointer"
                      title="Entrar neste Espaço"
                    >
                      <span>Entrar</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleStartEditingSpace(space)}
                      className="h-8 w-8"
                      title="Editar Nome do Espaço"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => duplicateSavedSpace(space.id)}
                      className="h-8 w-8"
                      title="Duplicar Espaço"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    {onExportSpace && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => void onExportSpace(space.id)}
                        className="h-8 w-8 hover:text-lira-online"
                        title="Exportar Espaço (.lira-space.json.gz)"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setSpaceToDelete({ id: space.id, name: space.name })}
                      className="h-8 w-8 hover:text-lira-error hover:border-lira-error/40"
                      title="Excluir Espaço"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </Card>
            )
          })
        )}
      </div>

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
