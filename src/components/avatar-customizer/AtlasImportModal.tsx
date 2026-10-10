import React, { useState, useRef } from 'react'
import { X, Upload, FileCode, Image as ImageIcon, CheckCircle, AlertCircle, ArrowRight, Scissors } from 'lucide-react'
import { AvatarComponentSlot } from '../../types/game'
import {
  parseSparrowAtlasAndSlice,
  importPresetsIntoStore,
  ParsedAtlasPreset,
} from '../../engine/avatar/avatarAtlasImporter'
import { AvatarSpritesheetSlicerModal } from './AvatarSpritesheetSlicerModal'
import { saveAssetFileToDisk } from '../../utils/diskAssetPersistence'

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

  const handleConfirmImport = () => {
    if (parsedPresets.length === 0) return
    const created = importPresetsIntoStore(category, parsedPresets)

    const subfolder =
      category === 'pet'
        ? 'pet'
        : category === 'furniture'
        ? 'furniture'
        : category === 'floor'
        ? 'floor'
        : category === 'wall'
        ? 'wall'
        : 'avatar'
    const baseName = `${category}_imported_${Date.now()}`
    if (xmlContent) {
      saveAssetFileToDisk(
        `public/assets/${subfolder}/${baseName}.xml`,
        xmlContent,
        'utf-8'
      ).catch((e) => console.warn('Could not auto-save imported XML to disk:', e))
    }
    if (pngDataUrl) {
      saveAssetFileToDisk(
        `public/assets/${subfolder}/${baseName}.png`,
        pngDataUrl,
        'base64'
      ).catch((e) => console.warn('Could not auto-save imported PNG to disk:', e))
    }

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
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[#1e1f22] border border-[#383a40] w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh]">
        <div className="px-6 py-4 border-b border-[#2b2d31] flex items-center justify-between bg-[#18191c]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#3b82f6]/20 border border-[#3b82f6]/40 flex items-center justify-center text-[#3b82f6]">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Importar Atlas Sparrow
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#2b2d31] text-blue-400 border border-[#383a40]">
                  {CATEGORY_NAMES[category]}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Selecione os arquivos <strong className="text-slate-200">.xml</strong> e <strong className="text-slate-200">.png</strong> correspondentes para importar os presets.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[#2b2d31] hover:bg-[#383a40] text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex flex-col gap-5">
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-[#383a40] hover:border-[#3b82f6] bg-[#18191c]/50 hover:bg-[#18191c] rounded-2xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all group"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".xml,.png,image/png,text/xml,application/xml"
              onChange={handleFileInputChange}
              className="hidden"
            />

            <div className="w-12 h-12 rounded-2xl bg-[#2b2d31] group-hover:scale-110 transition-transform flex items-center justify-center text-slate-300 group-hover:text-blue-400 border border-[#383a40]">
              <Upload className="w-6 h-6" />
            </div>

            <div className="text-center">
              <span className="text-sm font-bold text-slate-200 group-hover:text-white block">
                Clique para selecionar os arquivos .xml e .png
              </span>
              <span className="text-xs text-slate-500 mt-0.5 block">
                Você pode selecionar os dois arquivos simultaneamente na caixa de diálogo
              </span>
            </div>

            <div className="flex items-center gap-3 mt-2">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold ${
                  xmlFile
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-[#2b2d31] border-[#383a40] text-slate-500'
                }`}
              >
                <FileCode className="w-4 h-4" />
                <span>{xmlFile ? xmlFile.name : 'Arquivo XML (.xml)'}</span>
                {xmlFile && <CheckCircle className="w-3.5 h-3.5 ml-1" />}
              </div>

              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold ${
                  pngFile
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-[#2b2d31] border-[#383a40] text-slate-500'
                }`}
              >
                <ImageIcon className="w-4 h-4" />
                <span>{pngFile ? pngFile.name : 'Folha PNG (.png)'}</span>
                {pngFile && <CheckCircle className="w-3.5 h-3.5 ml-1" />}
              </div>
            </div>
          </div>

          {pngFile && !xmlFile && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-2xl bg-gradient-to-r from-blue-500/15 via-indigo-500/15 to-blue-500/15 border border-blue-500/35 text-xs animate-in fade-in">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-500/25 border border-blue-500/40 flex items-center justify-center text-blue-400 shrink-0">
                  <Scissors className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-white text-sm flex items-center gap-2">
                    Apenas imagem detectada (sem .xml)
                  </h4>
                  <p className="text-slate-300 text-xs mt-0.5">
                    Recorte interativamente os frames direcionais na folha para gerar o arquivo <strong className="text-white">.xml</strong> e criar os presets.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsSlicerOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#3b82f6] hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-500/30 transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>Abrir Fatiador de Sprites ➔</span>
              </button>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successCount !== null && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs animate-in fade-in">
              <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>
                <strong>{successCount}</strong> presets importados e adicionados com sucesso ao seu catálogo!
              </span>
            </div>
          )}

          {parsedPresets.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Presets Detectados ({parsedPresets.length})
                </span>
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
                >
                  Limpar e escolher outros
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-56 overflow-y-auto p-1">
                {parsedPresets.map((preset, idx) => (
                  <div
                    key={`${preset.presetKey}_${idx}`}
                    className="flex flex-col gap-2 p-3 rounded-2xl bg-[#18191c] border border-[#383a40]/70 hover:border-[#3b82f6]/50 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200 truncate" title={preset.name}>
                        {preset.name}
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-1 bg-[#1e1f22] p-1.5 rounded-xl border border-[#383a40]/40">
                      {(['down', 'up', 'left', 'right'] as const).map((dir) => {
                        const frame = preset.directionalFrames[dir]
                        return (
                          <div
                            key={dir}
                            title={`Direção: ${dir}`}
                            className="flex flex-col items-center justify-center w-full aspect-square bg-[#141517] rounded-lg overflow-hidden border border-slate-700/50"
                          >
                            {frame ? (
                              <img
                                src={frame}
                                alt={dir}
                                className="w-6 h-6 [image-rendering:pixelated]"
                              />
                            ) : (
                              <span className="text-[9px] text-slate-600">-</span>
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

        <div className="px-6 py-4 border-t border-[#2b2d31] bg-[#18191c] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-[#2b2d31] transition-colors"
          >
            Cancelar
          </button>

          <button
            type="button"
            disabled={parsedPresets.length === 0 || isProcessing || successCount !== null}
            onClick={handleConfirmImport}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-extrabold bg-[#3b82f6] hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-lg shadow-blue-500/25 transition-all cursor-pointer"
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
