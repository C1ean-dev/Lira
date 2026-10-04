import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AudioDevicesTab } from '../components/settings/AudioDevicesTab'

const html = renderToStaticMarkup(
  React.createElement(AudioDevicesTab, {
    inputDevices: [],
    outputDevices: [],
    videoDevices: [],
    isPlayingTestSound: false,
    onPlayTestSound: () => {},
  })
)

const INPUT_TITLE = 'Dispositivo de Entrada (Microfone)'
const OUTPUT_TITLE = 'Dispositivo de Saída'

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Classes of the element that directly wraps the <label> titled `title`. */
function headerRowClasses(title: string): string[] {
  const match = new RegExp(
    `<div class="([^"]*)"><label[^>]*>(?:(?!</label>)[\\s\\S])*<span>${escapeRegExp(title)}</span>`
  ).exec(html)
  if (!match) throw new Error(`no header row found for "${title}"`)
  return match[1].split(' ')
}

describe('AudioDevicesTab layout', () => {
  // The output header also holds the "Testar Som" button, which is taller than
  // the title alone. Without one shared height, everything under the output
  // title (dropdown, volume slider) sits a few pixels below the input column.
  it('opens the input and output columns with header rows of the same fixed height', () => {
    const heights = (classes: string[]) => classes.filter((c) => /^h-\d+$/.test(c))

    const input = heights(headerRowClasses(INPUT_TITLE))
    const output = heights(headerRowClasses(OUTPUT_TITLE))

    expect(input).toHaveLength(1)
    expect(output).toEqual(input)
  })

  it('centers the title vertically in that row, in both columns', () => {
    expect(headerRowClasses(INPUT_TITLE)).toContain('items-center')
    expect(headerRowClasses(OUTPUT_TITLE)).toContain('items-center')
  })
})
