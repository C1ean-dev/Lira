import { create } from 'zustand'

export type LiraTheme = 'night' | 'day' | 'nature'

export const LIRA_THEMES: ReadonlyArray<{ key: LiraTheme; label: string }> = [
  { key: 'night', label: 'Noite' },
  { key: 'day', label: 'Dia' },
  { key: 'nature', label: 'Natureza' },
]

const STORAGE_KEY = 'lira-theme'

function isValidTheme(val: unknown): val is LiraTheme {
  return val === 'night' || val === 'day' || val === 'nature'
}

function readInitialTheme(): LiraTheme {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (isValidTheme(saved)) return saved
    }
  } catch {
    // Fallback to default night theme if storage is unavailable
  }
  return 'night'
}

function applyThemeToDOM(theme: LiraTheme): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.theme = theme
  }
}

function persistTheme(theme: LiraTheme): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, theme)
    }
  } catch {
    // Theme switching works even when storage is blocked
  }
}

const initialTheme = readInitialTheme()
applyThemeToDOM(initialTheme)

export interface ThemeStoreState {
  theme: LiraTheme
  setTheme: (theme: LiraTheme) => void
  cycleTheme: () => void
}

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    applyThemeToDOM(theme)
    persistTheme(theme)
    set({ theme })
  },
  cycleTheme: () => {
    const current = get().theme
    const idx = LIRA_THEMES.findIndex((t) => t.key === current)
    const next = LIRA_THEMES[(idx + 1) % LIRA_THEMES.length].key
    applyThemeToDOM(next)
    persistTheme(next)
    set({ theme: next })
  },
}))
