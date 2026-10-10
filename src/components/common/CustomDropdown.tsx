import React, { useState, useRef, useEffect } from 'react'
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
  value,
  options,
  onChange,
  labelPrefix,
  buttonClassName = '',
  size = 'sm',
  title,
  fullWidth = false,
}: CustomDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((opt) => opt.value === value)

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (e: PointerEvent | MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const isSmall = size === 'sm'

  return (
    <div
      ref={containerRef}
      className={`relative ${fullWidth ? 'w-full block' : 'inline-block'}`}
      title={title}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center justify-between gap-1.5 rounded-xl transition-all cursor-pointer select-none border ${
          fullWidth ? 'w-full' : ''
        } ${
          isSmall ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2.5 text-xs'
        } ${
          isOpen
            ? 'bg-[#1b202c] border-indigo-500/80 shadow-md shadow-indigo-500/10 text-white'
            : 'bg-[#1b202c] hover:bg-[#232938] border-[#2a3142] text-slate-200 hover:text-white'
        } ${buttonClassName}`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
          {labelPrefix && (
            <span className="text-[11px] font-semibold text-slate-400 shrink-0">
              {labelPrefix}
            </span>
          )}
          <OptionContent option={selectedOption} fallbackLabel={value} isBold />
        </div>

        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ml-1.5 ${
            isOpen ? 'rotate-180 text-indigo-400' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute left-0 z-[999] mt-1.5 ${
            fullWidth ? 'w-full min-w-full' : 'min-w-[150px]'
          } max-h-60 overflow-y-auto bg-[#12151d]/95 backdrop-blur-xl border border-[#2a3142] rounded-xl shadow-2xl p-1 select-none text-slate-200 animate-in fade-in zoom-in-95 duration-150`}
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400 text-center">
              Nenhuma opção disponível
            </div>
          ) : (
            options.map((option) => {
              const isSelected = option.value === value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value)
                    setIsOpen(false)
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all text-left cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600/20 text-indigo-300 font-bold border border-indigo-500/30'
                      : 'text-slate-300 hover:text-white hover:bg-[#1f2638]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <OptionContent option={option} />
                  </div>

                  {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0 ml-1.5" />}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
