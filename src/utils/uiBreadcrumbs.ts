/**
 * Says which control a click landed on, for the trail of an error report
 * ("clicked Compartilhar tela" right before the failure). Only controls count
 * (buttons, links, tabs, menu items, fields): a click on the map or on a chat
 * message leaves nothing, and what was typed in a field is never read.
 */

interface ElementLike {
  tagName?: unknown
  textContent?: unknown
  parentElement?: unknown
  getAttribute?: unknown
}

export interface ClickTarget {
  tag: string
  role?: string
  label?: string
}

const CONTROL_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'LABEL'])
const FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA'])
const CONTROL_ROLES = new Set([
  'button',
  'link',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'switch',
  'checkbox',
  'radio',
])
const MAX_ANCESTORS = 6
const MAX_LABEL = 60

function attribute(element: ElementLike, name: string): string {
  const value = typeof element.getAttribute === 'function' ? element.getAttribute(name) : null
  return typeof value === 'string' ? value.trim() : ''
}

function tidy(text: string): string | undefined {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return undefined
  return clean.length > MAX_LABEL ? `${clean.slice(0, MAX_LABEL)}…` : clean
}

export function describeClickTarget(target: unknown): ClickTarget | null {
  try {
    let node = target as ElementLike | null
    for (let depth = 0; node && typeof node === 'object' && depth < MAX_ANCESTORS; depth++) {
      const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : ''
      const role = tag ? attribute(node, 'role').toLowerCase() : ''
      const byTag = CONTROL_TAGS.has(tag)
      if (byTag || CONTROL_ROLES.has(role)) {
        const named = attribute(node, 'aria-label') || attribute(node, 'title')
        const label = FIELD_TAGS.has(tag)
          ? tidy(named || attribute(node, 'name') || attribute(node, 'placeholder'))
          : tidy(named || (typeof node.textContent === 'string' ? node.textContent : ''))
        return {
          tag: tag.toLowerCase(),
          ...(byTag ? {} : { role }),
          ...(label ? { label } : {}),
        }
      }
      node = (node.parentElement as ElementLike | null) ?? null
    }
  } catch {
    // a detached or foreign node: nothing to say
  }
  return null
}
