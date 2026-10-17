/** Encode PNGs asynchronously, including while the app is in the background. */
export async function canvasToPngDataUrl(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<string> {
  const blob = 'convertToBlob' in canvas
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => {
      if (value) resolve(value)
      else reject(new Error('Não foi possível codificar o PNG'))
    }, 'image/png'))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Não foi possível ler o PNG'))
    reader.onerror = () => reject(reader.error || new Error('Não foi possível ler o PNG'))
    reader.onabort = () => reject(new Error('Leitura do PNG interrompida'))
    reader.readAsDataURL(blob)
  })
}