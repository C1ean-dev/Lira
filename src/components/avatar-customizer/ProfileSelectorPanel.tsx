import React, { useRef, useState } from 'react'
import { User, Upload, Trash2, AlertCircle, Check } from 'lucide-react'
import { AvatarConfig, PresenceStatus, STATUS_META } from '../../types/game'
import { getAvatarSnapshot } from '../../utils/avatarSnapshot'

interface Props {
  name: string
  onChangeName: (name: string) => void
  profileImage?: string
  hasCustomPhoto?: boolean
  onChangeProfileImage: (image: string | undefined, isCustom: boolean) => void
  avatar: AvatarConfig
  status?: PresenceStatus
}

export const ProfileSelectorPanel: React.FC<Props> = ({
  name,
  onChangeName,
  profileImage,
  hasCustomPhoto = false,
  onChangeProfileImage,
  avatar,
  status = 'available',
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const showToast = (msg: string, isError = false) => {
    if (isError) {
      setErrorMessage(msg)
      setSuccessMessage(null)
      setTimeout(() => setErrorMessage(null), 3500)
    } else {
      setSuccessMessage(msg)
      setErrorMessage(null)
      setTimeout(() => setSuccessMessage(null), 3000)
    }
  }

  // Handle local image upload with square cropping & resize
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      showToast('Por favor, selecione um arquivo de imagem válido (PNG, JPG, WebP).', true)
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast('A imagem deve ter no máximo 5 MB.', true)
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        try {
          const maxDim = 256
          const canvas = document.createElement('canvas')
          canvas.width = maxDim
          canvas.height = maxDim
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            onChangeProfileImage(reader.result as string, true)
            showToast('Foto de perfil atualizada com sucesso!')
            return
          }

          // Center crop (cover ratio)
          const minSide = Math.min(img.width, img.height)
          const sx = (img.width - minSide) / 2
          const sy = (img.height - minSide) / 2

          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, maxDim, maxDim)

          const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
          onChangeProfileImage(dataUrl, true)
          showToast('Foto de perfil carregada com sucesso!')
        } catch {
          onChangeProfileImage(reader.result as string, true)
          showToast('Foto de perfil carregada!')
        }
      }
      img.onerror = () => {
        showToast('Não foi possível carregar a imagem selecionada.', true)
      }
      img.src = reader.result as string
    }
    reader.onerror = () => {
      showToast('Erro ao ler arquivo do computador.', true)
    }
    reader.readAsDataURL(file)

    // Reset input value so same file can be re-selected if needed
    if (e.target) e.target.value = ''
  }

  const handleRemovePhoto = () => {
    onChangeProfileImage(undefined, false)
    showToast('Foto de perfil removida. O avatar atual foi restaurado como padrão.')
  }

  const isUsingCustomPhoto = Boolean(hasCustomPhoto && profileImage)
  const avatarSnapshot = getAvatarSnapshot(avatar, name)
  const displayedImage = isUsingCustomPhoto ? profileImage : avatarSnapshot
  const initialLetter = (name.trim().charAt(0) || 'P').toUpperCase()
  const statusMeta = STATUS_META[status] || STATUS_META.available

  return (
    <div className="flex flex-col h-full overflow-y-auto pr-1 space-y-5">
      {/* Header Description */}
      <div>
        <h3 className="text-sm font-extrabold text-slate-100 flex items-center gap-2">
          <User className="w-4 h-4 text-blue-400" />
          <span>Nome e Imagem de Perfil</span>
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Defina seu nome de exibição no espaço. Por padrão, o seu avatar configurado é exibido como imagem de perfil nos menus, chat e chamadas de vídeo. Se desejar, você pode carregar uma foto personalizada do seu computador.
        </p>
      </div>

      {/* Notifications / Toast Feedback */}
      {errorMessage && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold animate-in fade-in duration-150">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold animate-in fade-in duration-150">
          <Check className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* 1. Nome de Exibição (Nickname) */}
      <div className="p-4 rounded-2xl bg-[#1e1f22] border border-[#383a40] space-y-2.5 shadow-sm">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-200">
            Nome de Exibição (Nickname)
          </label>
          <span className="text-[11px] font-mono text-slate-400 font-semibold">
            {name.length}/16
          </span>
        </div>

        <div className="relative flex items-center">
          <div className="absolute left-3 text-slate-400 pointer-events-none">
            <User className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            maxLength={16}
            placeholder="Digite seu nome ou nickname..."
            className="w-full bg-[#141517] border border-[#2b2d31] focus:border-blue-500 pl-9 pr-4 py-2.5 rounded-xl text-xs font-bold text-white placeholder-slate-500 outline-none transition-all shadow-inner"
          />
        </div>
        <p className="text-[11px] text-slate-400">
          Este nome será exibido em cima do seu boneco 2D no mapa e nas transmissões de vídeo e áudio.
        </p>
      </div>

      {/* 2. Imagem de Perfil (Profile Picture) */}
      <div className="p-4 rounded-2xl bg-[#1e1f22] border border-[#383a40] space-y-3.5 shadow-sm">
        <div>
          <label className="text-xs font-bold text-slate-200 block">
            Foto de Perfil
          </label>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {isUsingCustomPhoto
              ? 'Você está usando uma foto personalizada do seu computador.'
              : 'O visual do seu avatar atual está ativo por padrão como foto de perfil.'}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Avatar Picture Preview */}
          <div className="relative shrink-0 group">
            <div
              className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-white/20 shadow-md flex items-center justify-center transition-all group-hover:border-blue-400/60 bg-[#12151d]"
            >
              {displayedImage ? (
                <img
                  src={displayedImage}
                  alt={name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-500 via-blue-600 to-indigo-800 text-white font-black text-2xl tracking-wider select-none shadow-inner">
                  {initialLetter}
                </div>
              )}
            </div>

            {/* Online Status Dot */}
            <div
              className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full ring-2 ring-[#1e1f22] ${statusMeta.dotColor}`}
              title={`Status: ${statusMeta.label}`}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 flex-1">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
            />

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{isUsingCustomPhoto ? 'Trocar Foto' : 'Carregar Foto'}</span>
              </button>

              {isUsingCustomPhoto && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 text-xs font-semibold flex items-center gap-1.5 transition-all border border-rose-500/20 cursor-pointer active:scale-95"
                  title="Remover foto do computador e voltar a usar o avatar atual"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remover Foto (Usar Avatar)</span>
                </button>
              )}
            </div>

            <p className="text-[10px] text-slate-400">
              {isUsingCustomPhoto
                ? 'Para voltar ao avatar padrão, clique em "Remover Foto".'
                : 'Formatos aceitos: PNG, JPG, WebP ou GIF (máx. 5 MB).'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
