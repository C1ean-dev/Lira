import React, { useRef, useState } from 'react'
import { Upload, Trash2, User, Sparkles, Check, Image as ImageIcon, Crop } from 'lucide-react'
import { AvatarConfig, PresenceStatus, STATUS_OPTIONS } from '../../types/game'
import { PlayerAvatar } from '../common/PlayerAvatar'
import { ImageCropModal } from '../common/ImageCropModal'

interface Props {
  name: string
  onChangeName: (name: string) => void
  profilePicture?: string
  onChangeProfilePicture: (pic: string) => void
  avatar: AvatarConfig
  status: PresenceStatus
  onChangeStatus: (status: PresenceStatus) => void
}

export const ProfileSettingsPanel: React.FC<Props> = ({
  name,
  onChangeName,
  profilePicture,
  onChangeProfilePicture,
  avatar,
  status,
  onChangeStatus,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [cropModalOpen, setCropModalOpen] = useState(false)
  const [rawImageToCrop, setRawImageToCrop] = useState<string | null>(null)

  const hasCustomPicture = !!(profilePicture && profilePicture.trim() !== '')

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setErrorMsg('O arquivo selecionado não é uma imagem válida.')
      return
    }

    try {
      setIsProcessing(true)
      setErrorMsg(null)
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setRawImageToCrop(reader.result)
          setCropModalOpen(true)
        }
        setIsProcessing(false)
      }
      reader.onerror = () => {
        setErrorMsg('Erro ao ler o arquivo de imagem.')
        setIsProcessing(false)
      }
      reader.readAsDataURL(file)
    } catch (err: any) {
      console.warn('Erro ao carregar imagem para recorte:', err)
      setErrorMsg(err?.message || 'Falha ao processar a imagem selecionada.')
      setIsProcessing(false)
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleCropComplete = (croppedDataUrl: string) => {
    setCropModalOpen(false)
    setRawImageToCrop(null)
    onChangeProfilePicture(croppedDataUrl)
  }

  const handleCropCancel = () => {
    setCropModalOpen(false)
    setRawImageToCrop(null)
  }

  const handleOpenRecrop = () => {
    if (profilePicture && profilePicture.trim() !== '') {
      setRawImageToCrop(profilePicture)
      setCropModalOpen(true)
    }
  }

  const handleRemovePicture = () => {
    onChangeProfilePicture('')
    setErrorMsg(null)
  }

  return (
    <div className="flex-1 flex flex-col gap-5 overflow-y-auto pr-1 select-none animate-in fade-in duration-200">
      {/* Header Banner */}
      <div className="flex items-center justify-between pb-3 border-b border-[#383a40]">
        <div>
          <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
            <User className="w-4 h-4 text-blue-400" />
            <span>Configurações de Perfil</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Defina seu nome e a foto do perfil visíveis para todos nas chamadas, lista de amigos e chat.
          </p>
        </div>
      </div>

      {/* Profile Picture Section */}
      <div className="bg-[#1e1f22] p-4 rounded-2xl border border-[#383a40] flex flex-col sm:flex-row items-center sm:items-start gap-4 shadow-sm">
        <div className="relative group shrink-0">
          <PlayerAvatar
            name={name}
            profilePicture={profilePicture}
            avatar={avatar}
            status={status}
            showStatus={true}
            size="2xl"
            className="ring-4 ring-black/40 shadow-xl"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="absolute inset-0 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-white transition-opacity cursor-pointer backdrop-blur-[1px]"
            title="Alterar foto de perfil"
          >
            <Upload className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] font-bold">Trocar</span>
          </button>
        </div>

        <div className="flex-1 flex flex-col justify-center gap-2 text-center sm:text-left min-w-0">
          <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-200">Foto de Perfil</span>
            {hasCustomPicture && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1">
                <ImageIcon className="w-3 h-3 text-blue-400" />
                <span>Foto Personalizada</span>
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            {hasCustomPicture
              ? 'Sua foto personalizada está ativa e será exibida no lugar do seu personagem nos menus e chamadas.'
              : 'Nenhuma foto selecionada. O sistema está utilizando seu personagem como foto de perfil automaticamente.'}
          </p>

          {errorMsg && (
            <div className="text-[11px] font-semibold text-rose-400 bg-rose-950/40 border border-rose-500/30 px-2.5 py-1 rounded-lg">
              {errorMsg}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-center sm:justify-start gap-2 pt-1 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleFileChange}
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md shadow-blue-600/30 flex items-center gap-1.5 active:scale-95 cursor-pointer disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{hasCustomPicture ? 'Trocar Imagem' : 'Carregar Imagem'}</span>
            </button>

            {hasCustomPicture && (
              <>
                <button
                  onClick={handleOpenRecrop}
                  disabled={isProcessing}
                  className="px-3 py-1.5 rounded-xl bg-[#2b2d31] hover:bg-[#34373d] text-slate-200 hover:text-white text-xs font-bold transition-all border border-white/10 flex items-center gap-1.5 active:scale-95 cursor-pointer"
                  title="Ajustar o enquadramento ou zoom da sua foto de perfil atual"
                >
                  <Crop className="w-3.5 h-3.5 text-blue-400" />
                  <span>Ajustar Recorte</span>
                </button>

                <button
                  onClick={handleRemovePicture}
                  disabled={isProcessing}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-all border border-slate-700 flex items-center gap-1.5 active:scale-95 cursor-pointer"
                  title="Voltar a usar seu personagem como foto de perfil"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Usar Personagem</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Display Name Section */}
      <div className="bg-[#1e1f22] p-4 rounded-2xl border border-[#383a40] flex flex-col gap-2">
        <label className="text-xs font-bold text-slate-200 flex items-center justify-between">
          <span>Nome de Exibição (Nickname)</span>
          <span className="text-[10px] text-slate-400 font-mono">{name.length}/32</span>
        </label>
        <div className="flex items-center gap-2 bg-[#2b2d31] px-3 py-2 rounded-xl border border-[#383a40] focus-within:border-blue-500 transition-colors">
          <input
            type="text"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="Digite seu nome ou apelido"
            maxLength={32}
            className="bg-transparent text-sm font-semibold text-white focus:outline-none w-full"
          />
        </div>
        <span className="text-[11px] text-slate-400">
          Este nome será exibido sobre a sua cabeça no mapa, nas chamadas de voz/vídeo e no chat da sala.
        </span>
      </div>

      {/* Presence Status Quick Selection */}
      <div className="bg-[#1e1f22] p-4 rounded-2xl border border-[#383a40] flex flex-col gap-2.5">
        <label className="text-xs font-bold text-slate-200">
          Status de Disponibilidade
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {STATUS_OPTIONS.map((opt) => {
            const isSelected = status === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => onChangeStatus(opt.value)}
                className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs font-bold transition-all text-left ${
                  isSelected
                    ? 'bg-blue-600/20 border-blue-500/60 text-white shadow-sm'
                    : 'bg-[#2b2d31] hover:bg-[#34373d] border-[#383a40] text-slate-300'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${opt.dotColor} shrink-0`} />
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check className="w-3.5 h-3.5 ml-auto text-blue-400 shrink-0" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Interactive Image Crop Modal */}
      <ImageCropModal
        isOpen={cropModalOpen}
        imageSrc={rawImageToCrop}
        onCropComplete={handleCropComplete}
        onCancel={handleCropCancel}
      />
    </div>
  )
}
