import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import source from '../../media/deepFilterWorkletCompat.js?raw'

function decoder(options = { fatal: true, ignoreBOM: true }) {
  const context = createContext({ options })
  const instance = runInContext(`(() => { ${source}; return new TextDecoder('utf-8', options) })()`, context)
  return { instance, context }
}

describe('libDF UTF-8 compatibility inside AudioWorklet', () => {
  it.each(['', 'DeepFilterNet model error', 'Falha na inferência: ação inválida', '日本語 🎙️', '\ufeffmensagem'])('decodes Rust messages: %s', text => {
    const { instance, context } = decoder()
    expect(instance.decode(new TextEncoder().encode(text))).toBe(text)
    expect(runInContext('typeof TextDecoder', context)).toBe('undefined')
    expect(instance.decode()).toBe('')
  })
  it.each([[0xff], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82]])('preserves fatal decoding for invalid UTF-8: %s', (...bytes) => {
    expect(() => decoder().instance.decode(Uint8Array.from(bytes))).toThrow('Invalid UTF-8')
  })
  it('honors BOM handling and uses the native decoder when available', () => {
    expect(decoder({ fatal: true, ignoreBOM: false }).instance.decode(new TextEncoder().encode('\ufeffmensagem'))).toBe('mensagem')
    const context = createContext({ TextDecoder })
    expect(runInContext(`(() => { ${source}; return TextDecoder })()`, context)).toBe(TextDecoder)
  })
})
