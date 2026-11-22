import { RasterImage } from '../common/RasterImage'
import React, { useState, useRef } from 'react'
import { X, Upload, FileCode, Image as ImageIcon, CheckCircle, AlertCircle, ArrowRight, Scissors } from 'lucide-react'
import { AvatarComponentSlot } from '../../types/game'
import {
  parseSparrowAtlasAndSlice,
  importPresetsIntoStore,
  ParsedAtlasPreset,
} from '../../engine/avatar/avatarAtlasImporter'
import { AvatarSpritesheetSlicerModal } from './AvatarSpritesheetSlicerModal'

interface Props {
  isOpen: boolean
  onClose: () => void
  category: AvatarComponentSlot | 'furniture' | 'floor' | 'wall'
  onImportSuccess?: (count: number) => void
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

export const AtlasImportModal: React.FC<Props> = ({
  isOpen,
  onClose,
  category,
  onImportSuccess,
}) => {
  const [xmlFile, setXmlFile] = useState<File | null>(null)
  const [xmlContent, setXmlContent] = useState<string>('')
  const [pngFile, setPngFile] = useState<File | null>(null)
  const [pngDataUrl, setPngDataUrl] = useState<string>('')

  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [parsedPresets, setParsedPresets] = useState<ParsedAtlasPreset[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successCount, setSuccessCount] = useState<number | null>(null)
  const [isSlicerOpen, setIsSlicerOpen] = useState<boolean>(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  if (!isOpen) return null

  const handleProcessFiles = async (xmlText: string, imgSrc: string) => {
    setIsProcessing(true)
    setErrorMessage(null)

    try {
      const img = new Image()
      img.src = imgSrc
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Falha ao decodificar a imagem PNG do spritesheet.'))
      })

      const presets = await parseSparrowAtlasAndSlice(xmlText, img, category)
      if (presets.length === 0) {
        setErrorMessage('Nenhum subtexture compatível encontrado no arquivo XML fornecido.')
      } else {
        setParsedPresets(presets)
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Erro ao processar arquivos do Atlas.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    let nextXmlText = xmlContent
    let nextPngUrl = pngDataUrl

    for (const file of files) {
      if (file.name.toLowerCase().endsWith('.xml')) {
        setXmlFile(file)
        const reader = new FileReader()
        reader.onload = (ev) => {
          const text = ev.target?.result as string
          setXmlContent(text)
          nextXmlText = text
          if (nextPngUrl) {
            handleProcessFiles(text, nextPngUrl)
          }
        }
        reader.readAsText(file)
      } else if (file.type.startsWith('image/') || file.name.toLowerCase().endsWith('.png')) {
        setPngFile(file)
        const reader = new FileReader()
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string
          setPngDataUrl(dataUrl)
          nextPngUrl = dataUrl
          if (nextXmlText) {
            handleProcessFiles(nextXmlText, dataUrl)
          }
        }
        reader.readAsDataURL(file)
      }
    }
  }

  const handleConfirmImport = async () => {
    if (parsedPresets.length === 0) return
    let created
    setIsProcessing(true)
    try { created = await importPresetsIntoStore(category, parsedPresets) }
    catch (error) { setErrorMessage(String(error)); return }
    finally { setIsProcessing(false) }

    setSuccessCount(created.length)
    if (onImportSuccess) {
      onImportSuccess(created.length)
    }
    setTimeout(() => {
      onClose()
    }, 1200)
  }

  const handleReset = () => {
    setXmlFile(null)
    setXmlContent('')
    setPngFile(null)
    setPngDataUrl('')
    setParsedPresets([])
    setErrorMessage(null)
    setSuccessCount(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-lira-ground/80 p-4 font-mono text-lira-ink">
      <div className="bg-lira-panel border border-dashed border-lira-rule w-full max-w-2xl rounded-[12px] flex flex-col overflow-hidden max-h-[85vh]">
        <div className="px-6 py-4 border-b border-dashed border-lira-rule/60 flex items-center justify-between bg-lira-sidebar">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[8px] bg-lira-surface border border-lira-rule flex items-center justify-center text-lira-accent">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-display font-bold text-lira-accent flex items-center gap-2">
                Importar Atlas Sparrow
                <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-[6px] bg-lira-surface text-lira-accent border border-lira-rule">
                  {CATEGORY_NAMES[category]}
                </span>
              </h2>
              <p className="text-xs font-mono text-lira-muted">
                Selecione os arquivos <strong className="text-lira-ink">.xml</strong> e <strong className="text-lira-ink">.png</strong> correspondentes para importar os presets.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-[8px] bg-lira-surface border border-lira-rule hover:border-lira-accent text-lira-muted hover:text-lira-ink flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex flex-col gap-5">
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-lira-rule/60 hover:border-lira-accent bg-lira-ground hover:bg-lira-surface rounded-[12px] p-6 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors group"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".xml,.png,image/png,text/xml,application/xml"
              onChange={handleFileInputChange}
              className="hidden"
            />

            <div className="w-12 h-12 rounded-[8px] bg-lira-surface flex items-center justify-center text-lira-muted group-hover:text-lira-accent border border-lira-rule group-hover:border-lira-accent">
              <Upload className="w-6 h-6" />
            </div>

            <div className="text-center">
              <span className="text-sm font-mono font-bold text-lira-ink block">
                Clique para selecionar os arquivos .xml e .png
              </span>
              <span className="text-xs font-mono text-lira-muted mt-0.5 block">
                Você pode selecionar os dois arquivos simultaneamente na caixa de diálogo
              </span>
            </div>

            <div className="flex items-center gap-3 mt-2">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-[8px] border text-xs font-mono font-semibold ${
                  xmlFile
                    ? 'bg-lira-online/15 border-lira-online/40 text-lira-online'
                    : 'bg-lira-surface border-lira-quiet text-lira-muted'
                }`}
              >
                <FileCode className="w-4 h-4" />
                <span>{xmlFile ? xmlFile.name : 'Arquivo XML (.xml)'}</span>
                {xmlFile && <CheckCircle className="w-3.5 h-3.5 ml-1" />}
              </div>

              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-[8px] border text-xs font-mono font-semibold ${
                  pngFile
                    ? 'bg-lira-online/15 border-lira-online/40 text-lira-online'
                    : 'bg-lira-surface border-lira-quiet text-lira-muted'
                }`}
              >
                <ImageIcon className="w-4 h-4" />
                <span>{pngFile ? pngFile.name : 'Folha PNG (.png)'}</span>
                {pngFile && <CheckCircle className="w-3.5 h-3.5 ml-1" />}
              </div>
            </div>
          </div>

          {pngFile && !xmlFile && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-[12px] bg-lira-surface border border-dashed border-lira-rule text-xs font-mono">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[8px] bg-lira-ground border border-lira-rule flex items-center justify-center text-lira-accent shrink-0">
                  <Scissors className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-display font-bold text-lira-accent text-sm flex items-center gap-2">
                    Apenas imagem detectada (sem .xml)
                  </h4>
                  <p className="text-lira-muted text-xs mt-0.5">
                    Recorte interativamente os frames direcionais na folha para gerar o arquivo <strong className="text-lira-ink">.xml</strong> e criar os presets.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsSlicerOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] bg-lira-accent hover:bg-lira-ink text-lira-ground font-mono font-bold text-xs border-2 border-lira-accent hover:border-lira-ink transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>Abrir Fatiador de Sprites ➔</span>
              </button>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-[8px] bg-lira-error/15 border border-lira-error/40 text-lira-error text-xs font-mono">
              <AlertCircle className="w-4 h-4 shrink-0 text-lira-error" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successCount !== null && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-[8px] bg-lira-online/15 border border-lira-online/40 text-lira-online text-xs font-mono">
              <CheckCircle className="w-4 h-4 shrink-0 text-lira-online" />
              <span>
                <strong>{successCount}</strong> presets importados e adicionados com sucesso ao seu catálogo!
              </span>
            </div>
          )}

          {parsedPresets.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-lira-accent uppercase tracking-wider">
                  Presets Detectados ({parsedPresets.length})
                </span>
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-xs font-mono text-lira-muted hover:text-lira-ink underline cursor-pointer"
                >
                  Limpar e escolher outros
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-56 overflow-y-auto p-1">
                {parsedPresets.map((preset, idx) => (
                  <div
                    key={`${preset.presetKey}_${idx}`}
                    className="flex flex-col gap-2 p-3 rounded-[8px] bg-lira-surface border border-lira-quiet hover:border-lira-accent transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-lira-ink truncate" title={preset.name}>
                        {preset.name}
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-1 bg-lira-panel p-1.5 rounded-[8px] border border-lira-quiet">
                      {(['down', 'up', 'left', 'right'] as const).map((dir) => {
                        const frame = preset.directionalFrames[dir]
                        return (
                          <div
                            key={dir}
                            title={`Direção: ${dir}`}
                            className="flex flex-col items-center justify-center w-full aspect-square bg-lira-ground rounded-[6px] overflow-hidden border border-lira-quiet"
                          >
                            {frame ? (
                              <RasterImage
                                src={Array.isArray(frame) ? frame[0] : frame}
                                alt={dir}
                                className="w-6 h-6 [image-rendering:pixelated]"
                              />
                            ) : (
                              <span className="text-[9px] text-lira-muted">-</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-dashed border-lira-rule/60 bg-lira-sidebar flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[8px] text-xs font-mono font-bold text-lira-muted hover:text-lira-ink bg-lira-surface border border-lira-rule hover:border-lira-accent transition-colors"
          >
            Cancelar
          </button>

          <button
            type="button"
            disabled={parsedPresets.length === 0 || isProcessing || successCount !== null}
            onClick={handleConfirmImport}
            className="flex items-center gap-2 px-6 py-2.5 rounded-[8px] text-xs font-mono font-extrabold bg-lira-accent hover:bg-lira-ink disabled:opacity-50 disabled:cursor-not-allowed text-lira-ground border-2 border-lira-accent hover:border-lira-ink transition-colors cursor-pointer"
          >
            <span>Importar {parsedPresets.length > 0 ? `${parsedPresets.length} Presets` : 'Atlas'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isSlicerOpen && pngDataUrl && (
        <AvatarSpritesheetSlicerModal
          isOpen={isSlicerOpen}
          onClose={() => setIsSlicerOpen(false)}
          imageSrc={pngDataUrl}
          imageFileName={pngFile?.name || `${category}.png`}
          category={category}
          onSaveComplete={(created) => {
            setIsSlicerOpen(false)
            setSuccessCount(created.length)
            if (onImportSuccess) onImportSuccess(created.length)
            setTimeout(() => onClose(), 1200)
          }}
        />
      )}
    </div>
  )
}
