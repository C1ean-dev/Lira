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
  return <div className="flex flex-col gap-2 font-mono">
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Animação">
      {tabs.map(animation => <button key={animation.id} type="button" aria-pressed={activeAnimation === animation.id} title={animation.label}
        onClick={() => { setForm(null); setError(''); onSelect(animation.id) }}
        className={`min-w-20 flex-1 break-words rounded-[8px] px-2 py-2 text-xs font-mono font-bold border ${activeAnimation === animation.id ? 'bg-lira-accent text-lira-ground border-lira-accent' : 'bg-lira-ground text-lira-muted border-lira-quiet hover:bg-lira-surface hover:text-lira-ink'}`}>
        {animation.label}
      </button>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" aria-label="Nova animação" onClick={() => openForm('create')} className="flex items-center gap-1 rounded-[6px] bg-lira-surface border border-lira-rule px-2 py-1 text-xs font-mono text-lira-accent hover:border-lira-accent hover:text-lira-ink"><Plus size={13} />Nova animação</button>
      {custom && <>
        <button type="button" aria-label="Renomear animação" onClick={() => openForm('rename')} className="rounded-[6px] p-1 text-lira-muted hover:text-lira-ink hover:bg-lira-surface" title="Renomear animação"><Pencil size={14} /></button>
        <button type="button" aria-label="Excluir animação" onClick={() => { onChange(editCharacterAnimation(preset, { type: 'delete', id: activeAnimation })); onSelect('walk'); setForm(null); setError('') }} className="rounded-[6px] p-1 text-lira-error hover:bg-lira-error/15" title="Excluir animação e seus frames"><Trash2 size={14} /></button>
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
      <label className="text-xs font-mono text-lira-muted">Nome da animação
        <input autoFocus aria-label="Nome da animação" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded-[6px] border border-lira-rule bg-lira-ground px-2 py-1.5 text-sm font-mono text-lira-ink" />
      </label>
      {error && <p role="alert" className="text-xs font-mono text-lira-error">{error}</p>}
      <div className="flex gap-2"><button type="submit" className="rounded-[6px] bg-lira-accent px-3 py-1 text-xs font-mono font-bold text-lira-ground">{form.mode === 'create' ? 'Criar animação' : 'Salvar nome'}</button>
        <button type="button" onClick={() => { setForm(null); setError('') }} className="px-2 py-1 text-xs font-mono text-lira-muted hover:text-lira-ink">Cancelar</button></div>
    </form>}
  </div>
}
