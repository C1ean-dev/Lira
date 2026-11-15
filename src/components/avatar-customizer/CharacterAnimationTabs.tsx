import React, { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import type { SlicedPreset } from './AvatarSpritesheetSlicerModal'
import { characterAnimationTabs, DEFAULT_CHARACTER_ANIMATIONS, editCharacterAnimation } from '../../utils/characterAnimations'
import { generateUUID } from '../../utils/uuid'

interface Props { preset: SlicedPreset; activeAnimation: string; onSelect(id: string): void; onChange(preset: SlicedPreset): void }
export const CharacterAnimationTabs: React.FC<Props> = ({ preset, activeAnimation, onSelect, onChange }) => {
  const [form, setForm] = useState<{ mode: 'create' | 'rename'; name: string } | null>(null)
  const [error, setError] = useState('')
  const tabs = characterAnimationTabs(preset)
  const custom = !DEFAULT_CHARACTER_ANIMATIONS.some(item => item.id === activeAnimation)
  const openForm = (mode: 'create' | 'rename') => { setError(''); setForm({ mode, name: mode === 'rename' ? tabs.find(item => item.id === activeAnimation)?.label || '' : '' }) }
  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Animação">
      {tabs.map(animation => <button key={animation.id} type="button" aria-pressed={activeAnimation === animation.id} title={animation.label}
        onClick={() => { setForm(null); setError(''); onSelect(animation.id) }}
        className={`min-w-20 flex-1 break-words rounded-xl px-2 py-2 text-xs font-bold ${activeAnimation === animation.id ? 'bg-[#3b82f6] text-white' : 'bg-[#1e1f22] text-slate-300 hover:bg-[#383a40]'}`}>
        {animation.label}
      </button>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" aria-label="Nova animação" onClick={() => openForm('create')} className="flex items-center gap-1 rounded-lg bg-indigo-500/20 px-2 py-1 text-xs text-indigo-200 hover:bg-indigo-500/30"><Plus size={13} />Nova animação</button>
      {custom && <>
        <button type="button" aria-label="Renomear animação" onClick={() => openForm('rename')} className="rounded-lg p-1 text-slate-300 hover:bg-slate-600" title="Renomear animação"><Pencil size={14} /></button>
        <button type="button" aria-label="Excluir animação" onClick={() => { onChange(editCharacterAnimation(preset, { type: 'delete', id: activeAnimation })); onSelect('walk'); setForm(null); setError('') }} className="rounded-lg p-1 text-rose-300 hover:bg-rose-500/20" title="Excluir animação e seus frames"><Trash2 size={14} /></button>
      </>}
    </div>
    {form && <form className="flex flex-col gap-2" onSubmit={event => {
      event.preventDefault()
      try {
        const id = form.mode === 'create' ? `animation_${generateUUID()}` : activeAnimation
        onChange(editCharacterAnimation(preset, { type: form.mode, id, name: form.name }))
        onSelect(id); setForm(null); setError('')
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível alterar a animação.') }
    }}>
      <label className="text-xs text-slate-300">Nome da animação
        <input autoFocus aria-label="Nome da animação" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-[#1e1f22] px-2 py-1.5 text-sm text-white" />
      </label>
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      <div className="flex gap-2"><button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1 text-xs text-white">{form.mode === 'create' ? 'Criar animação' : 'Salvar nome'}</button>
        <button type="button" onClick={() => { setForm(null); setError('') }} className="px-2 py-1 text-xs text-slate-300">Cancelar</button></div>
    </form>}
  </div>
}
