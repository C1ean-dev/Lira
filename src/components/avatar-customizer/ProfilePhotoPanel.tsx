import React, { useRef } from 'react'
import { Upload, Trash2, Camera, User } from 'lucide-react'
import { AvatarConfig, PresenceStatus, STATUS_META } from '../../types/game'

interface Props {
  profilePhoto?: string
  onChangePhoto: (photo?: string) => void
  avatar: AvatarConfig
  name: string
  onChangeName: (name: string) => void
  status: PresenceStatus
}

export const ProfilePhotoPanel: React.FC<Props> = ({
  profilePhoto,
  onChangePhoto,
  avatar,
  name,
  onChangeName,
  status,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        // High-quality square crop with automatic resize to 256x256
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 256
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          const minDim = Math.min(img.width, img.height)
          const sx = (img.width - minDim) / 2
          const sy = (img.height - minDim) / 2
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 256, 256)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
          onChangePhoto(dataUrl)
        }
      }
      img.src = event.target?.result as string
    }
    reader.readAsDataURL(file)

    // Reset input so same file can be re-selected if desired
    e.target.value = ''
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto pr-1 space-y-5">
      {/* Top Banner & Current Photo Preview */}
      <div className="bg-[#1e1f22] p-4 rounded-2xl border border-[#383a40] flex items-center gap-5">
        {/* Large Profile Picture Avatar Frame */}
        <div className="relative group shrink-0">
          <div
            className="w-24 h-24 rounded-3xl overflow-hidden border-2 border-indigo-500/50 shadow-xl flex items-center justify-center bg-slate-800 transition-all group-hover:border-indigo-400"
            style={{
              backgroundColor: avatar.shirtColor || avatar.topColor || '#4c6ef5',
            }}
          >
            {profilePhoto ? (
              <img
                src={profilePhoto}
                alt={name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-white">
                <span className="text-3xl font-black">
                  {(name || 'U').charAt(0).toUpperCase()}
                </span>
                <span className="text-[10px] text-white/70 font-semibold mt-0.5">Sem Foto</span>
              </div>
            )}
          </div>

          {/* Quick upload hover trigger */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute inset-0 rounded-3xl bg-black/50 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-white transition-opacity cursor-pointer backdrop-blur-[2px]"
            title="Clique para carregar uma nova foto"
          >
            <Camera className="w-6 h-6 mb-1" />
            <span className="text-[10px] font-bold">Alterar</span>
          </button>

          {/* Status Indicator Dot */}
          <div
            className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full ring-4 ring-[#1e1f22] ${
              STATUS_META[status]?.dotColor || 'bg-emerald-500'
            }`}
            title={`Status: ${STATUS_META[status]?.label || 'Disponível'}`}
          />
        </div>

        {/* Info & Action Controls */}
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <h3 className="text-sm font-bold text-slate-100">Foto de Perfil</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Esta foto aparecerá na barra superior, no chat, na lista de amigos e nos cards de chamadas.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Carregar Imagem</span>
            </button>

            {profilePhoto && (
              <button
                type="button"
                onClick={() => onChangePhoto(undefined)}
                className="px-3 py-1.5 rounded-xl bg-[#2b2d31] hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-[#383a40] hover:border-rose-500/40 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remover Foto</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Nome de Exibição / Troca de Nome */}
      <div className="bg-[#1e1f22] p-5 rounded-2xl border border-[#383a40] space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <User className="w-4 h-4 text-indigo-400" />
            <span>Nome de Exibição</span>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {name.length}/16
          </span>
        </div>

        <div className="relative">
          <input
            type="text"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="Digite seu nickname..."
            maxLength={16}
            className="w-full bg-[#14161a] border border-[#383a40] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-100 placeholder:text-slate-500 outline-none transition-all"
          />
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Este é o nome com o qual você será identificado no espaço virtual, na lista de participantes online e nas mensagens de chat.
        </p>
      </div>
    </div>
  )
}
