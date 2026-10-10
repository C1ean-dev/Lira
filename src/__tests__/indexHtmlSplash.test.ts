import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { fileURLToPath } from 'url'

// The window opens at once but the app needs seconds to load (its modules keep the main thread
// busy), and until then all there was to see was a black window. index.html now carries a splash
// that needs nothing from the app: plain markup and CSS written inline, so it is painted as soon as
// the page arrives. React replaces it when the app renders into #root.

const read = (relative: string) => fs.readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8')
const html = read('index.html')

const rootContent = (() => {
  const start = html.indexOf('<div id="root"')
  const end = html.indexOf('<script type="module"')
  return html.slice(start, end)
})()

describe('index.html splash', () => {
  it('is inside #root, so the first render of the app replaces it', () => {
    expect(rootContent).toContain('id="boot-splash"')
  })

  it('says the app is opening, for a screen reader too', () => {
    expect(rootContent).toMatch(/id="boot-splash-status"[^>]*role="status"[^>]*>[^<]*Abrindo o Lira/)
  })

  it('shows the lyre of the logo', () => {
    expect(rootContent).toContain('<svg')
    expect(rootContent).toContain('M 31 28 C 21 28 16 17 24 13')
    expect(rootContent).toContain('M 69 28 C 79 28 84 17 76 13')
  })

  it('has a spinner', () => {
    expect(rootContent).toContain('class="boot-spinner"')
  })

  it('is plain markup: no script and no class that needs the app\'s stylesheet', () => {
    expect(rootContent).not.toContain('<script')
    expect(rootContent).not.toMatch(/class="[^"]*\b(flex|items-center|text-slate|bg-\[)/)
  })

  it('is styled by a <style> in <head>, which does not wait for any file', () => {
    const head = html.slice(0, html.indexOf('</head>'))
    const styles = head.match(/<style>[\s\S]*?<\/style>/g) ?? []
    const css = styles.join('\n')
    expect(css).toContain('#boot-splash')
    expect(css).toContain('.boot-spinner')
    expect(css).toMatch(/@keyframes boot-spin/)
  })

  it('spins with transform, which keeps moving while the main thread is busy', () => {
    const css = (html.match(/<style>[\s\S]*?<\/style>/g) ?? []).join('\n')
    expect(css).toMatch(/@keyframes boot-spin\s*\{\s*to\s*\{\s*transform:\s*rotate\(360deg\)/)
    expect(css).toMatch(/animation:\s*boot-spin/)
  })

  it('has the colour of the window, so nothing flashes between the two', () => {
    const main = read('electron/main.ts')
    const windowColour = /backgroundColor:\s*'(#[0-9a-fA-F]{6})'/.exec(main)?.[1]
    expect(windowColour).toBeDefined()
    const css = (html.match(/<style>[\s\S]*?<\/style>/g) ?? []).join('\n')
    expect(css.toLowerCase()).toContain(`background: ${windowColour!.toLowerCase()}`)
    expect(html.toLowerCase()).toContain(`bg-[${windowColour!.toLowerCase()}]`)
  })

  it('slows the spinner down for people who ask for less motion', () => {
    const css = (html.match(/<style>[\s\S]*?<\/style>/g) ?? []).join('\n')
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/)
  })

  it('does not hold up the first paint with anything but that style', () => {
    const head = html.slice(0, html.indexOf('<script'))
    const blocking = (head.replace(/<noscript>[\s\S]*?<\/noscript>/gi, '').match(/<link\b[^>]*>/gi) ?? []).filter(
      (tag) => /rel="stylesheet"/i.test(tag) && !/media="print"/i.test(tag)
    )
    expect(blocking).toEqual([])
  })
})
