import { describe, it, expect } from 'vitest'
import { describeClickTarget } from '../utils/uiBreadcrumbs'

interface FakeElement {
  tagName: string
  textContent?: string
  parentElement?: FakeElement | null
  getAttribute(name: string): string | null
}

const el = (tagName: string, attributes: Record<string, string> = {}, textContent = '', parentElement: FakeElement | null = null): FakeElement => ({
  tagName: tagName.toUpperCase(),
  textContent,
  parentElement,
  getAttribute: (name) => attributes[name] ?? null,
})

describe('describeClickTarget', () => {
  it('names a button by its accessible label', () => {
    expect(describeClickTarget(el('button', { 'aria-label': 'Compartilhar tela' }, 'x'))).toEqual({
      tag: 'button',
      label: 'Compartilhar tela',
    })
  })

  it('falls back to the title, then to the text', () => {
    expect(describeClickTarget(el('button', { title: 'Sair do espaço' }))).toEqual({ tag: 'button', label: 'Sair do espaço' })
    expect(describeClickTarget(el('button', {}, '  Criar \n  espaço  '))).toEqual({ tag: 'button', label: 'Criar espaço' })
  })

  it('finds the control around the element that was hit', () => {
    const button = el('button', { 'aria-label': 'Mutar' })
    const icon = el('svg', {}, '', el('span', {}, '', button))
    expect(describeClickTarget(icon)).toEqual({ tag: 'button', label: 'Mutar' })
  })

  it('recognizes elements that act as controls by their role', () => {
    expect(describeClickTarget(el('div', { role: 'tab' }, 'Áudio'))).toEqual({ tag: 'div', role: 'tab', label: 'Áudio' })
    expect(describeClickTarget(el('li', { role: 'menuitem' }, 'Convidar para este espaço'))).toEqual({
      tag: 'li',
      role: 'menuitem',
      label: 'Convidar para este espaço',
    })
  })

  it('never reads what was typed in a field', () => {
    const input = { ...el('input', { type: 'text', placeholder: 'Código do espaço' }, 'ignored'), value: 'SECRET-CODE' }
    expect(describeClickTarget(input)).toEqual({ tag: 'input', label: 'Código do espaço' })
    expect(describeClickTarget(el('input', { type: 'checkbox', name: 'echo' }))).toEqual({ tag: 'input', label: 'echo' })
    expect(describeClickTarget(el('textarea', {}, 'what the user wrote'))).toEqual({ tag: 'textarea' })
  })

  it('bounds the label', () => {
    expect(describeClickTarget(el('button', {}, 'x'.repeat(500)))!.label!.length).toBeLessThanOrEqual(61)
  })

  it('ignores clicks that are not on a control', () => {
    expect(describeClickTarget(el('canvas'))).toBeNull()
    expect(describeClickTarget(el('p', {}, 'a chat message', el('div')))).toBeNull()
  })

  it('does not look further up than a few ancestors', () => {
    let node = el('button', { 'aria-label': 'far away' })
    for (let i = 0; i < 10; i++) node = el('div', {}, '', node)
    expect(describeClickTarget(node)).toBeNull()
  })

  it('survives anything that is not an element', () => {
    expect(describeClickTarget(null)).toBeNull()
    expect(describeClickTarget(undefined)).toBeNull()
    expect(describeClickTarget('text')).toBeNull()
    expect(describeClickTarget({})).toBeNull()
    const hostile = {
      tagName: 'BUTTON',
      getAttribute: () => {
        throw new Error('detached')
      },
    }
    expect(describeClickTarget(hostile)).toBeNull()
  })
})
