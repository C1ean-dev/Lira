import React from 'react'
import * as Select from '@radix-ui/react-select'
import { ChevronDown, Check } from 'lucide-react'

export interface DropdownOption<T extends string = string> {
  value: T
  label: string
  dotColor?: string
  icon?: React.ReactNode
}

interface CustomDropdownProps<T extends string = string> {
  value: T
  options: DropdownOption<T>[]
  onChange: (value: T) => void
  labelPrefix?: string
  buttonClassName?: string
  size?: 'sm' | 'md'
  title?: string
  fullWidth?: boolean
}

function OptionContent({
  option,
  fallbackLabel,
  isBold = false,
}: {
  option?: DropdownOption
  fallbackLabel?: string
  isBold?: boolean
}) {
  return (
    <>
      {option?.dotColor && (
        <span className={`w-2 h-2 rounded-full shrink-0 ${option.dotColor}`} />
      )}
      {option?.icon && (
        <span className="shrink-0 flex items-center justify-center">{option.icon}</span>
      )}
      <span className={`truncate flex-1 ${isBold ? 'font-bold text-slate-100' : ''}`}>
        {option?.label || fallbackLabel}
      </span>
    </>
  )
}

export function CustomDropdown<T extends string = string>({
  value, options, onChange, labelPrefix, buttonClassName = '', size = 'sm', title, fullWidth = false,
}: CustomDropdownProps<T>) {
  const selected = options.find(option => option.value === value)
  const encode = (value: string) => `lira:${value}`
  return <Select.Root value={encode(value)} onValueChange={value => onChange(value.slice(5) as T)} disabled={!options.length}>
    <Select.Trigger title={title} aria-label={labelPrefix || title}
      className={`group inline-flex items-center justify-between gap-1.5 rounded-xl transition-all cursor-pointer select-none border bg-[#1b202c] hover:bg-[#232938] border-[#2a3142] text-slate-200 hover:text-white data-[state=open]:border-indigo-500/80 data-[state=open]:text-white ${fullWidth ? 'w-full' : ''} ${size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2.5 text-xs'} ${buttonClassName}`}>
      {labelPrefix && <span className="text-[11px] font-semibold text-slate-400 shrink-0">{labelPrefix}</span>}
      <Select.Value><span className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
        <OptionContent option={selected} fallbackLabel={options.length ? value : 'Nenhuma opção disponível'} isBold />
      </span></Select.Value>
      <Select.Icon><ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1.5 transition-transform group-data-[state=open]:rotate-180" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal><Select.Content position="popper" align="start" sideOffset={6} collisionPadding={12}
      style={{ minWidth: fullWidth ? 'var(--radix-select-trigger-width)' : 'max(150px, var(--radix-select-trigger-width))' }}
      className="z-[999] max-h-60 overflow-hidden bg-[#12151d]/95 backdrop-blur-xl border border-[#2a3142] rounded-xl shadow-2xl p-1 select-none text-slate-200">
      <Select.Viewport>{options.map(option => <Select.Item key={option.value} value={encode(option.value)}
        className="relative flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs font-medium outline-none cursor-pointer text-slate-300 data-[highlighted]:bg-[#1f2638] data-[highlighted]:text-white data-[state=checked]:bg-indigo-600/20 data-[state=checked]:text-indigo-300">
        <Select.ItemText><span className="flex items-center gap-2 min-w-0"><OptionContent option={option} /></span></Select.ItemText>
        <Select.ItemIndicator><Check className="w-3.5 h-3.5 text-indigo-400 shrink-0 ml-1.5" /></Select.ItemIndicator>
      </Select.Item>)}</Select.Viewport>
    </Select.Content></Select.Portal>
  </Select.Root>
}
