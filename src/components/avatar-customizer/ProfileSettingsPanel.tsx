import React, { useRef, useState } from 'react'
import { Upload, Trash2, User, Sparkles, Check, Image as ImageIcon, Crop } from 'lucide-react'
import { AvatarConfig, PresenceStatus, STATUS_OPTIONS } from '../../types/game'
import { PlayerAvatar } from '../common/PlayerAvatar'
import { ImageCropModal } from '../common/ImageCropModal'
import { MoonPhaseIcon } from '../common/MoonPhaseIcon'
import { useGameStore } from '../../store/useGameStore'
import { useProfileModalStore } from '../../store/useProfileModalStore'
import { ProfileBar } from '../profile/ProfileBar'

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
  const localProfile = useGameStore((s) => s.localPlayer.profile)

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
    <div className="flex-1 flex flex-col gap-3 sm:gap-5 overflow-y-auto pr-1 select-none font-mono text-lira-ink">
      <div className="flex items-center justify-between pb-2 sm:pb-3 border-b border-dashed border-lira-rule/60">
        <div>
          <h3 className="text-xs sm:text-sm font-display font-bold text-lira-accent flex items-center gap-1.5 sm:gap-2">
            <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-lira-accent" />
            <span>Configurações de Perfil</span>
          </h3>
          <p className="text-[11px] sm:text-xs font-mono text-lira-muted mt-0.5">
            Defina seu nome e a foto do perfil visíveis para todos nas chamadas, lista de amigos e chat.
          </p>
        </div>
      </div>

      <div className="bg-lira-surface p-3 sm:p-4 rounded-[12px] border border-lira-quiet flex flex-col sm:flex-row items-center sm:items-start gap-3 sm:gap-4">
        <div className="relative group shrink-0">
          <div className="hidden sm:block">
            <PlayerAvatar
              name={name}
              profilePicture={profilePicture}
              avatar={avatar}
              avatarFrame={localProfile?.avatarFrame}
              status={status}
              showStatus={true}
              size="2xl"
              className="ring-2 ring-lira-rule"
            />
          </div>
          <div className="sm:hidden">
            <PlayerAvatar
              name={name}
              profilePicture={profilePicture}
              avatar={avatar}
              avatarFrame={localProfile?.avatarFrame}
              status={status}
              showStatus={true}
              size="lg"
              className="ring-2 ring-lira-rule"
            />
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="absolute inset-0 bg-lira-ground/80 rounded-full opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-lira-ink transition-opacity cursor-pointer"
            title="Alterar foto de perfil"
          >
            <Upload className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5 text-lira-accent" />
            <span className="text-[9px] sm:text-[10px] font-mono font-bold">Trocar</span>
          </button>
        </div>

        <div className="flex-1 flex flex-col justify-center gap-1.5 sm:gap-2 text-center sm:text-left min-w-0">
          <div className="flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 flex-wrap">
            <span className="text-xs font-mono font-bold text-lira-ink">Foto de Perfil</span>
            {hasCustomPicture && (
              <span className="text-[9px] sm:text-[10px] font-mono font-bold px-2 py-0.5 rounded-[6px] bg-lira-ground text-lira-accent border border-lira-rule flex items-center gap-1">
                <ImageIcon className="w-3 h-3 text-lira-accent" />
                <span>Foto Personalizada</span>
              </span>
            )}
          </div>

          <p className="text-[10px] sm:text-[11px] font-mono text-lira-muted leading-relaxed">
            {hasCustomPicture
              ? 'Sua foto personalizada está ativa e será exibida no lugar do seu personagem nos menus e chamadas.'
              : 'Nenhuma foto selecionada. O sistema está utilizando seu personagem como foto de perfil automaticamente.'}
          </p>

          {errorMsg && (
            <div className="text-[10px] sm:text-[11px] font-mono font-semibold text-lira-error bg-lira-error/15 border border-lira-error/40 px-2 py-1 rounded-[6px]">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 pt-1 flex-wrap">
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
              className="px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-[8px] bg-lira-accent hover:bg-lira-ink text-lira-ground text-[11px] sm:text-xs font-mono font-bold transition-colors border-2 border-lira-accent hover:border-lira-ink flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{hasCustomPicture ? 'Trocar Imagem' : 'Carregar Imagem'}</span>
            </button>

            {hasCustomPicture && (
              <>
                <button
                  onClick={handleOpenRecrop}
                  disabled={isProcessing}
                  className="px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-[8px] bg-lira-ground hover:bg-lira-panel text-lira-ink hover:text-lira-accent text-[11px] sm:text-xs font-mono font-bold transition-colors border border-lira-rule hover:border-lira-accent flex items-center gap-1.5 cursor-pointer"
                  title="Ajustar o enquadramento ou zoom da sua foto de perfil atual"
                >
                  <Crop className="w-3.5 h-3.5 text-lira-accent" />
                  <span>Ajustar Recorte</span>
                </button>

                <button
                  onClick={handleRemovePicture}
                  disabled={isProcessing}
                  className="px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-[8px] bg-lira-ground hover:bg-lira-error/15 text-lira-muted hover:text-lira-error text-[11px] sm:text-xs font-mono font-semibold transition-colors border border-lira-quiet hover:border-lira-error flex items-center gap-1.5 cursor-pointer"
                  title="Voltar a usar seu personagem como foto de perfil"
                >
                  <Trash2 className="w-3.5 h-3.5 text-lira-error" />
                  <span>Usar Personagem</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bg-lira-surface p-3 sm:p-4 rounded-[12px] border border-lira-quiet flex flex-col gap-1.5 sm:gap-2">
        <label className="text-xs font-mono font-bold text-lira-ink flex items-center justify-between">
          <span>Nome de Exibição (Nickname)</span>
          <span className="text-[10px] text-lira-muted font-mono tabular-nums">{name.length}/32</span>
        </label>
        <div className="flex items-center gap-2 bg-lira-ground px-3 py-1.5 sm:py-2 rounded-[8px] border border-lira-rule focus-within:border-lira-accent transition-colors">
          <input
            type="text"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="Digite seu nome ou apelido"
            maxLength={32}
            className="bg-transparent text-xs sm:text-sm font-mono font-semibold text-lira-ink focus:outline-none w-full"
          />
        </div>
        <span className="text-[10px] sm:text-[11px] font-mono text-lira-muted">
          Este nome será exibido sobre a sua cabeça no mapa, nas chamadas de voz/vídeo e no chat da sala.
        </span>
      </div>

      <div className="bg-lira-surface p-3 sm:p-4 rounded-[12px] border border-lira-quiet flex flex-col gap-2 sm:gap-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-mono font-bold text-lira-ink">
            Status de Disponibilidade
          </label>
          <span className="text-[10px] font-mono text-lira-muted font-medium">
            Tema Cósmico
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {STATUS_OPTIONS.map((opt) => {
            const isSelected = status === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => onChangeStatus(opt.value)}
                className={`relative flex flex-col items-center justify-center p-2.5 sm:p-4 rounded-[12px] border transition-colors text-center group ${
                  isSelected
                    ? 'bg-lira-panel border-lira-accent'
                    : 'bg-lira-ground hover:bg-lira-panel border-lira-quiet hover:border-lira-rule text-lira-muted'
                }`}
              >
                {isSelected && (
                  <div className="absolute top-1.5 right-1.5 sm:top-2.5 sm:right-2.5 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-lira-accent text-lira-ground flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0" />
                  </div>
                )}

                <div
                  className="w-10 h-10 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mb-1.5 sm:mb-2 overflow-hidden shrink-0"
                  style={{ backgroundColor: opt.bgColor }}
                >
                  <MoonPhaseIcon status={opt.value} className="w-full h-full" withBackground={true} />
                </div>

                <span className="text-xs sm:text-sm font-mono font-bold text-lira-ink tracking-wide">
                  {opt.label}
                </span>

                <span className="text-[10px] sm:text-xs font-mono text-lira-muted font-medium mt-0.5 leading-snug">
                  {opt.moonPhase}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="bg-[#1e1f22] p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-indigo-500/30 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h4 className="text-xs font-extrabold text-white flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Perfil Estilizado, Bordas, Medalhas &amp; Jogos</span>
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Personalize sua barra de perfil, moldura da imagem, medalhas e mural de jogos.
            </p>
          </div>
          <button
            type="button"
            onClick={() => useProfileModalStore.getState().openLocalProfile('view')}
            className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all active:scale-95"
          >
            Abrir Perfil Interativo
          </button>
        </div>

        <ProfileBar
          name={name || 'Você'}
          profilePicture={profilePicture}
          avatar={avatar}
          profile={localProfile}
          status={status}
          avatarSize="sm"
          compact={true}
          onClick={() => useProfileModalStore.getState().openLocalProfile('view')}
        />
      </div>

      <ImageCropModal
        isOpen={cropModalOpen}
        imageSrc={rawImageToCrop}
        onCropComplete={handleCropComplete}
        onCancel={handleCropCancel}
      />
    </div>
  )
}
