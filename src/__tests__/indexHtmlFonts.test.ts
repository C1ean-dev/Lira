import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { fileURLToPath } from 'url'

// A stylesheet <link> in <head> blocks painting, and it also holds back the
// module script that comes after it, so the whole app waits for it. The Google
// Fonts stylesheet lives on the network: a slow DNS lookup or no connection at all
// would keep the window empty. It is loaded as "print" and switched to "all" when
// it arrives, which blocks nothing.

const html = fs.readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf-8')
const outsideNoscript = html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, '')
const noscriptBlocks = html.match(/<noscript>[\s\S]*?<\/noscript>/gi) ?? []

const tags = (source: string, name: string) => source.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? []
const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1]

const stylesheets = tags(outsideNoscript, 'link').filter((tag) => attr(tag, 'rel') === 'stylesheet')
const external = stylesheets.filter((tag) => /^https?:\/\//i.test(attr(tag, 'href') ?? ''))
const googleFonts = external.filter((tag) => (attr(tag, 'href') ?? '').includes('fonts.googleapis.com/css2'))

describe('index.html', () => {
  it('still asks for the Google fonts the app is drawn with', () => {
    expect(googleFonts).toHaveLength(1)
    const href = attr(googleFonts[0], 'href') ?? ''
    expect(href).toContain('family=Inter')
    expect(href).toContain('family=Press+Start+2P')
    expect(href).toContain('display=swap')
  })

  it('does not let any external stylesheet block painting or the app script', () => {
    expect(external.length).toBeGreaterThan(0)
    for (const tag of external) {
      expect(attr(tag, 'media'), tag).toBe('print')
      expect(attr(tag, 'onload'), tag).toMatch(/this\.media\s*=\s*['"]all['"]/)
    }
  })

  it('has the normal stylesheet inside <noscript>, for a page without scripts', () => {
    const fallback = noscriptBlocks.join('\n')
    const links = tags(fallback, 'link').filter((tag) => (attr(tag, 'href') ?? '').includes('fonts.googleapis.com/css2'))
    expect(links).toHaveLength(1)
    expect(attr(links[0], 'rel')).toBe('stylesheet')
    expect(attr(links[0], 'media')).toBeUndefined()
  })

  it('keeps the connection hints for the font hosts', () => {
    const preconnects = tags(html, 'link').filter((tag) => attr(tag, 'rel') === 'preconnect')
    const hosts = preconnects.map((tag) => attr(tag, 'href'))
    expect(hosts).toEqual(expect.arrayContaining(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']))
  })

  it('puts nothing that blocks before the app script', () => {
    const head = html.slice(0, html.indexOf('<script'))
    const blocking = tags(head.replace(/<noscript>[\s\S]*?<\/noscript>/gi, ''), 'link').filter(
      (tag) => attr(tag, 'rel') === 'stylesheet' && (attr(tag, 'media') ?? 'all') !== 'print'
    )
    expect(blocking).toEqual([])
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>')
  })
})
