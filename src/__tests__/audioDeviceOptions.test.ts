import { describe, it, expect } from 'vitest'
import { toDeviceOptions } from '../components/settings/deviceOptions'
import { AudioDeviceInfo } from '../types/audio'

const noIcon = () => null

// What Chromium lists on Windows: the OS default shows up a second time as a
// device whose id is literally "default", next to the "communications" one.
const microphones: AudioDeviceInfo[] = [
  { deviceId: 'default', label: 'Default - Microphone (Fuxi-H3 ) (040b:0897)' },
  { deviceId: 'communications', label: 'Communications - Microphone (Fuxi-H3 ) (040b:0897)' },
  { deviceId: 'a1b2c3d4e5f6', label: 'Microphone (Fuxi-H3 ) (040b:0897)' },
  { deviceId: 'f6e5d4c3b2a1', label: 'Microphone (DroidCam Audio)' },
]

describe('toDeviceOptions', () => {
  it('lists the system default once, as "Padrão do Sistema", first', () => {
    const options = toDeviceOptions(microphones, 'Microfone', noIcon)
    expect(options[0]).toMatchObject({ value: 'default', label: 'Microfone Padrão do Sistema' })
    expect(options.filter((o) => o.value === 'default')).toHaveLength(1)
  })

  it('drops the browser\'s own "Default - ..." copy of the default device', () => {
    const options = toDeviceOptions(microphones, 'Microfone', noIcon)
    expect(options.some((o) => /^default\b/i.test(o.label))).toBe(false)
    expect(options.map((o) => o.label)).toEqual([
      'Microfone Padrão do Sistema',
      'Communications - Microphone (Fuxi-H3 ) (040b:0897)',
      'Microphone (Fuxi-H3 ) (040b:0897)',
      'Microphone (DroidCam Audio)',
    ])
  })

  it('never produces two options with the same value', () => {
    const doubled = [...microphones, { deviceId: 'a1b2c3d4e5f6', label: 'Microphone (Fuxi-H3 ) (040b:0897)' }]
    const values = toDeviceOptions(doubled, 'Microfone', noIcon).map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('does the same for speakers', () => {
    const speakers: AudioDeviceInfo[] = [
      { deviceId: 'default', label: 'Default - Speakers (Realtek(R) Audio)' },
      { deviceId: 'abcdef123456', label: 'Speakers (Realtek(R) Audio)' },
    ]
    expect(toDeviceOptions(speakers, 'Alto-Falante', noIcon).map((o) => o.label)).toEqual([
      'Alto-Falante Padrão do Sistema',
      'Speakers (Realtek(R) Audio)',
    ])
  })

  it('names a device that has no label after its id', () => {
    const options = toDeviceOptions([{ deviceId: 'a1b2c3d4e5f6', label: '' }], 'Microfone', noIcon)
    expect(options[1].label).toBe('Microfone (a1b2c3d4...)')
  })

  it('still offers the default when no device is listed yet', () => {
    expect(toDeviceOptions([], 'Câmera', noIcon).map((o) => o.value)).toEqual(['default'])
  })

  it('gives the default option its own icon, highlighted', () => {
    const options = toDeviceOptions(microphones, 'Microfone', (cls) => cls)
    expect(options[0].icon).toContain('text-indigo-400')
    expect(options[1].icon).toContain('text-slate-400')
  })
})
