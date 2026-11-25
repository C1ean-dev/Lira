import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  Download,
  Check,
  Search,
  CheckCircle,
  AlertCircle,
  CheckSquare,
  Square,
  PackageOpen,
} from 'lucide-react'
import { AvatarComponentSlot } from '../../types/game'
import { CustomAsset } from '../../types/customAsset'
import { PixelArtThumbnail } from '../../editor/PixelArtThumbnail'
import { RasterImage } from '../common/RasterImage'
import {
  exportCategoryAtlas,
  filterCategoryAssets,
  sanitizeAtlasFileBaseName,
} from '../../engine/avatar/avatarAtlasExporter'

export type ExportAtlasCategory = AvatarComponentSlot | 'furniture' | 'floor' | 'wall'

interface Props {
  isOpen: boolean
  onClose: () => void
  category: ExportAtlasCategory
  customAssets: CustomAsset[]
  initialSubCategory?: string
}

const CATEGORY_NAMES: Record<string, string> = {
  hair: 'Cabelo',
  top: 'Parte de Cima',
  jacket: 'Jaqueta',
  bottom: 'Parte de Baixo',
  shoes: 'Sapatos',
  hat: 'Chapéu / Laço',
  glasses: 'Óculos',
  facialHair: 'Pelos Faciais',
  eyes: 'Olhos',
  skin: 'Maquiagem',
  other: 'Personagem',
  pet: 'Pet / Mascote',
  furniture: 'Mobília',
  floor: 'Piso',
  wall: 'Parede',
}

const ALL_SUBCATEGORIES = '__ALL__'

function getAvatarPreviewSrc(asset: CustomAsset): string {
  const down = asset.directionalFrames?.down
  if (Array.isArray(down) && down[0]) return down[0]
  if (typeof down === 'string' && down) return down
  if (asset.frames?.[0]) return asset.frames[0]
  return asset.thumbnail || ''
}

export const AtlasExportModal: React.FC<Props> = ({
  isOpen,
  onClose,
  category,
  customAssets,
  initialSubCategory,
}) => {
  const categoryAssets = useMemo(
    () => filterCategoryAssets(category, customAssets),
    [category, customAssets]
  )

  const subCategories = useMemo(() => {
    if (category !== 'furniture') return []
    const set = new Set<string>()
    for (const asset of categoryAssets) {
      set.add(asset.category || 'Geral')
    }
    return Array.from(set)
  }, [category, categoryAssets])

  const defaultSubCategory = useMemo(() => {
    if (
      category === 'furniture' &&
      initialSubCategory &&
      initialSubCategory !== 'Todos' &&
      initialSubCategory !== 'Customizados' &&
      subCategories.includes(initialSubCategory)
    ) {
      return initialSubCategory
    }
    return ALL_SUBCATEGORIES
  }, [category, initialSubCategory, subCategories])

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [activeSubCategory, setActiveSubCategory] = useState<string>(defaultSubCategory)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [fileBaseName, setFileBaseName] = useState<string>(category)
  const [isExporting, setIsExporting] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [exportedCount, setExportedCount] = useState<number | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setSelectedIds(new Set())
    setActiveSubCategory(defaultSubCategory)
    setSearchQuery('')
    setFileBaseName(category)
    setIsExporting(false)
    setErrorMessage(null)
    setExportedCount(null)
  }, [isOpen, category, defaultSubCategory])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isExporting) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isExporting, onClose])

  const visibleAssets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return categoryAssets.filter((asset) => {
      if (
        category === 'furniture' &&
        activeSubCategory !== ALL_SUBCATEGORIES &&
        (asset.category || 'Geral') !== activeSubCategory
      ) {
        return false
      }
      if (query && !asset.name.toLowerCase().includes(query)) {
        return false
      }
      return true
    })
  }, [categoryAssets, category, activeSubCategory, searchQuery])

  if (!isOpen) return null

  const isFiltered =
    searchQuery.trim().length > 0 ||
    (category === 'furniture' && activeSubCategory !== ALL_SUBCATEGORIES)

  const allVisibleSelected =
    visibleAssets.length > 0 && visibleAssets.every((asset) => selectedIds.has(asset.id))

  const toggleAsset = (id: string) => {
    if (isExporting || exportedCount !== null) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setErrorMessage(null)
  }

  const handleToggleVisible = () => {
    if (isExporting || exportedCount !== null || visibleAssets.length === 0) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const asset of visibleAssets) next.delete(asset.id)
      } else {
        for (const asset of visibleAssets) next.add(asset.id)
      }
      return next
    })
    setErrorMessage(null)
  }

  const handleClearSelection = () => {
    if (isExporting || exportedCount !== null) return
    setSelectedIds(new Set())
    setErrorMessage(null)
  }

  const handleConfirmExport = async () => {
    if (selectedIds.size === 0 || isExporting) return
    setIsExporting(true)
    setErrorMessage(null)
    try {
      const ids = Array.from(selectedIds)
      await exportCategoryAtlas(category, customAssets, undefined, {
        selectedIds: ids,
        fileBaseName: sanitizeAtlasFileBaseName(fileBaseName, category),
      })
      setExportedCount(ids.length)
      closeTimerRef.current = setTimeout(() => {
        onClose()
      }, 1200)
    } catch (err: any) {
      setErrorMessage(err?.message || 'Erro ao exportar os objetos selecionados.')
    } finally {
      setIsExporting(false)
    }
  }

  const isMapAsset = category === 'furniture' || category === 'floor' || category === 'wall'
  const safePreviewName = sanitizeAtlasFileBaseName(fileBaseName, category)

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-lira-ground/80 p-4 font-mono text-lira-ink select-none"
      onClick={() => {
        if (!isExporting) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="atlas-export-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-lira-panel border border-dashed border-lira-rule w-full max-w-2xl rounded-[12px] flex flex-col overflow-hidden max-h-[85vh]"
      >
        <div className="px-5 py-4 border-b border-dashed border-lira-rule/60 flex items-center justify-between bg-lira-sidebar">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-[8px] bg-lira-surface border border-lira-rule flex items-center justify-center text-lira-accent shrink-0">
              <Download className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="atlas-export-modal-title"
                className="text-base font-display font-bold text-lira-accent flex items-center gap-2 flex-wrap"
              >
                <span>Exportar Atlas</span>
                <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-[6px] bg-lira-surface text-lira-accent border border-lira-rule">
                  {CATEGORY_NAMES[category] || category}
                </span>
              </h2>
              <p className="text-xs font-mono text-lira-muted">
                Escolha quais objetos deseja incluir nos arquivos{' '}
                <strong className="text-lira-ink">.png</strong> e{' '}
                <strong className="text-lira-ink">.xml</strong>.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            aria-label="Fechar"
            className="w-8 h-8 rounded-[8px] bg-lira-surface border border-lira-rule hover:border-lira-accent text-lira-muted hover:text-lira-ink flex items-center justify-center transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex flex-col gap-4 flex-1 min-h-0">
          {categoryAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 rounded-[12px] bg-lira-ground border border-dashed border-lira-rule/60 text-center">
              <div className="w-12 h-12 rounded-[8px] bg-lira-surface border border-lira-rule flex items-center justify-center text-lira-muted">
                <PackageOpen className="w-6 h-6" />
              </div>
              <div>
                <div className="text-sm font-mono font-bold text-lira-ink">
                  Nenhum objeto personalizado para exportar
                </div>
                <p className="text-xs font-mono text-lira-muted mt-1">
                  Crie, fatie ou importe itens personalizados nesta seção para exportá-los como Atlas.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-lira-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar objeto por nome..."
                    aria-label="Buscar objeto por nome"
                    className="w-full bg-lira-ground border border-lira-rule rounded-[8px] pl-8 pr-8 py-1.5 text-xs font-mono text-lira-ink placeholder:text-lira-muted focus:outline-none focus:border-lira-accent"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Limpar busca"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-lira-muted hover:text-lira-ink p-0.5 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleToggleVisible}
                    disabled={visibleAssets.length === 0 || isExporting}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-accent text-lira-ink text-[11px] font-mono font-semibold border border-lira-rule transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {allVisibleSelected ? (
                      <>
                        <Square className="w-3.5 h-3.5 text-lira-muted" />
                        <span>{isFiltered ? 'Desmarcar visíveis' : 'Desmarcar todos'}</span>
                      </>
                    ) : (
                      <>
                        <CheckSquare className="w-3.5 h-3.5 text-lira-accent" />
                        <span>
                          {isFiltered
                            ? `Selecionar visíveis (${visibleAssets.length})`
                            : `Selecionar todos (${visibleAssets.length})`}
                        </span>
                      </>
                    )}
                  </button>

                  {selectedIds.size > 0 && (
                    <button
                      type="button"
                      onClick={handleClearSelection}
                      disabled={isExporting}
                      className="px-2.5 py-1.5 rounded-[8px] bg-lira-ground hover:border-lira-rule text-lira-muted hover:text-lira-ink text-[11px] font-mono font-semibold border border-lira-quiet transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      Limpar ({selectedIds.size})
                    </button>
                  )}
                </div>
              </div>

              {subCategories.length > 1 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => setActiveSubCategory(ALL_SUBCATEGORIES)}
                    className={`px-2.5 py-1 rounded-[6px] text-xs font-mono font-semibold whitespace-nowrap flex items-center gap-1.5 transition-colors border shrink-0 cursor-pointer ${
                      activeSubCategory === ALL_SUBCATEGORIES
                        ? 'bg-lira-surface text-lira-accent border-lira-accent'
                        : 'bg-lira-ground text-lira-muted border-lira-quiet hover:text-lira-ink'
                    }`}
                  >
                    <span>Todas</span>
                    <span className="text-[10px] opacity-70">({categoryAssets.length})</span>
                  </button>

                  {subCategories.map((subCat) => {
                    const itemsInCat = categoryAssets.filter(
                      (a) => (a.category || 'Geral') === subCat
                    )
                    const selectedInCat = itemsInCat.filter((a) => selectedIds.has(a.id)).length
                    const isActive = activeSubCategory === subCat
                    return (
                      <button
                        key={subCat}
                        type="button"
                        onClick={() => setActiveSubCategory(subCat)}
                        className={`px-2.5 py-1 rounded-[6px] text-xs font-mono font-semibold whitespace-nowrap flex items-center gap-1.5 transition-colors border shrink-0 cursor-pointer ${
                          isActive
                            ? 'bg-lira-surface text-lira-accent border-lira-accent'
                            : 'bg-lira-ground text-lira-muted border-lira-quiet hover:text-lira-ink'
                        }`}
                      >
                        <span>{subCat}</span>
                        <span className="text-[10px] opacity-70">
                          {selectedInCat > 0
                            ? `(${selectedInCat}/${itemsInCat.length})`
                            : `(${itemsInCat.length})`}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {visibleAssets.length === 0 ? (
                <div className="text-xs font-mono text-lira-muted text-center py-8 bg-lira-ground rounded-[8px] border border-dashed border-lira-rule/60">
                  Nenhum objeto encontrado para o filtro atual.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-[42vh] overflow-y-auto p-0.5">
                  {visibleAssets.map((asset) => {
                    const isSelected = selectedIds.has(asset.id)
                    const avatarSrc = !isMapAsset ? getAvatarPreviewSrc(asset) : ''
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => toggleAsset(asset.id)}
                        title={asset.name}
                        className={`group relative rounded-[8px] border flex flex-col items-center justify-between p-2 gap-1.5 transition-colors cursor-pointer text-left ${
                          isSelected
                            ? 'border-lira-accent bg-lira-surface ring-1 ring-lira-accent'
                            : 'border-lira-quiet bg-lira-ground hover:border-lira-rule hover:bg-lira-surface'
                        }`}
                      >
                        <div className="w-full flex items-center justify-between gap-1">
                          {isMapAsset ? (
                            <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-lira-panel text-lira-muted border border-lira-quiet leading-none">
                              {asset.width || 1}×{asset.height || 1}
                            </span>
                          ) : (
                            <span />
                          )}

                          <span
                            className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-colors shrink-0 ${
                              isSelected
                                ? 'bg-lira-accent border-lira-accent text-lira-ground'
                                : 'bg-lira-panel border-lira-rule text-transparent group-hover:border-lira-accent'
                            }`}
                          >
                            <Check className="w-3 h-3 stroke-[3]" />
                          </span>
                        </div>

                        <div className="flex items-center justify-center w-full h-14 overflow-hidden">
                          {isMapAsset ? (
                            <PixelArtThumbnail
                              key={`${asset.id}_${asset.updatedAt || ''}`}
                              type={category}
                              id={asset.id}
                              size={48}
                            />
                          ) : avatarSrc ? (
                            <RasterImage
                              src={avatarSrc}
                              alt={asset.name}
                              className="w-12 h-12 object-contain [image-rendering:pixelated]"
                            />
                          ) : (
                            <span className="text-[10px] text-lira-muted">-</span>
                          )}
                        </div>

                        <div className="w-full text-center px-0.5">
                          <div className="text-[11px] font-mono font-semibold text-lira-ink truncate leading-tight">
                            {asset.name}
                          </div>
                          {category === 'furniture' && activeSubCategory === ALL_SUBCATEGORIES && (
                            <div className="text-[9px] font-mono text-lira-muted truncate mt-0.5">
                              {asset.category || 'Geral'}
                            </div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-dashed border-lira-rule/60">
                <label
                  htmlFor="atlas-export-filename"
                  className="text-[11px] font-mono font-semibold text-lira-muted shrink-0"
                >
                  Nome do arquivo:
                </label>
                <div className="flex items-center gap-2 flex-1 sm:max-w-xs">
                  <input
                    id="atlas-export-filename"
                    type="text"
                    value={fileBaseName}
                    onChange={(e) => setFileBaseName(e.target.value)}
                    placeholder={category}
                    disabled={isExporting}
                    className="w-full bg-lira-ground border border-lira-rule rounded-[6px] px-2.5 py-1 text-xs font-mono text-lira-ink focus:outline-none focus:border-lira-accent disabled:opacity-50"
                  />
                  <span className="text-[10px] font-mono text-lira-muted whitespace-nowrap">
                    {safePreviewName}.png / .xml
                  </span>
                </div>
              </div>
            </>
          )}

          {errorMessage && (
            <div className="flex items-center gap-2.5 p-3 rounded-[8px] bg-lira-error/15 border border-lira-error/40 text-lira-error text-xs font-mono">
              <AlertCircle className="w-4 h-4 shrink-0 text-lira-error" />
              <span>{errorMessage}</span>
            </div>
          )}

          {exportedCount !== null && (
            <div className="flex items-center gap-2.5 p-3 rounded-[8px] bg-lira-online/15 border border-lira-online/40 text-lira-online text-xs font-mono">
              <CheckCircle className="w-4 h-4 shrink-0 text-lira-online" />
              <span>
                <strong>{exportedCount}</strong>{' '}
                {exportedCount === 1 ? 'objeto exportado' : 'objetos exportados'} com sucesso!
              </span>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-dashed border-lira-rule/60 bg-lira-sidebar flex items-center justify-between gap-3">
          <span className="text-xs font-mono text-lira-muted">
            {selectedIds.size === 0
              ? 'Nenhum objeto selecionado'
              : `${selectedIds.size} de ${categoryAssets.length} ${
                  selectedIds.size === 1 ? 'selecionado' : 'selecionados'
                }`}
          </span>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className="px-4 py-2 rounded-[8px] text-xs font-mono font-bold text-lira-muted hover:text-lira-ink bg-lira-surface border border-lira-rule hover:border-lira-accent transition-colors disabled:opacity-50 cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="button"
              disabled={selectedIds.size === 0 || isExporting || exportedCount !== null}
              onClick={handleConfirmExport}
              className="flex items-center gap-2 px-5 py-2 rounded-[8px] text-xs font-mono font-extrabold bg-lira-accent hover:bg-lira-ink disabled:opacity-50 disabled:cursor-not-allowed text-lira-ground border-2 border-lira-accent hover:border-lira-ink transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                {isExporting
                  ? 'Exportando...'
                  : selectedIds.size > 0
                    ? `Exportar (${selectedIds.size})`
                    : 'Exportar'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
