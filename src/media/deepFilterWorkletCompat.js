// wasm-bindgen decodes Rust error messages even when only PCM frames are used.
// AudioWorkletGlobalScope does not expose the Encoding API. Keep this fallback
// inside libDF's closure so it does not alter other processors or the page.
var TextDecoder = globalThis.TextDecoder || class {
  constructor(_encoding, options = {}) {
    this.fatal = !!options.fatal
    this.ignoreBOM = !!options.ignoreBOM
  }

  decode(input = new Uint8Array()) {
    let text = ''
    for (let i = 0; i < input.length;) {
      const first = input[i]
      let count = first < 0x80 ? 1 : first >= 0xc2 && first <= 0xdf ? 2
        : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0
      let codePoint = count === 1 ? first : first & (0x7f >> count)
      let valid = count > 0 && i + count <= input.length
      for (let j = 1; valid && j < count; j++) {
        const byte = input[i + j]
        valid = byte >= 0x80 && byte <= 0xbf
        codePoint = (codePoint << 6) | (byte & 0x3f)
      }
      valid = valid && (count < 2 || codePoint >= (count === 2 ? 0x80 : count === 3 ? 0x800 : 0x10000))
        && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff)
      if (!valid) {
        if (this.fatal) throw new TypeError('Invalid UTF-8 in DeepFilterNet message')
        text += '\ufffd'
        i++
      } else {
        if (i !== 0 || this.ignoreBOM || codePoint !== 0xfeff) text += String.fromCodePoint(codePoint)
        i += count
      }
    }
    return text
  }
}
