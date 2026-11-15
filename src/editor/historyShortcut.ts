type Key = { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; target?: { tagName?: string; isContentEditable?: boolean; closest?: (selector: string) => unknown } | null }
export function editorHistoryShortcut(event: Key): 'undo' | 'redo' | null {
  const target = event.target
  if (!(event.ctrlKey || event.metaKey) || event.altKey || target?.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/i.test(target?.tagName || '') || target?.closest?.('[contenteditable="true"], [role="dialog"]')) return null
  const key = event.key.toLowerCase()
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
  return key === 'y' ? 'redo' : null
}
