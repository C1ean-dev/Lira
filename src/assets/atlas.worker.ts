import { buildAtlas, readAtlas, atlasDigest } from './atlasCore'
const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(value: unknown, transfer?: Transferable[]): void }
let queue: Promise<void> = Promise.resolve()
scope.onmessage = event => {
  const { id, method, value } = event.data
  queue = queue.then(async () => {
    try {
      let result: unknown
      let transfer: Transferable[] = []
      if (method === 'build') result = await buildAtlas(value.assets, value.categories, value.deletedAssetIds)
      else if (method === 'read') result = await readAtlas(value)
      else if (method === 'digest') result = await atlasDigest(value)
      else if (method === 'encode') {
        const xml = new TextEncoder().encode(value.xml), png = new TextEncoder().encode(value.png)
        result = { xml, png }; transfer = [xml.buffer, png.buffer]
      } else if (method === 'decodeTransfer') {
        const atlas = { xml: await new Blob(value.xml).text(), png: await new Blob(value.png).text() }
        if (await atlasDigest(atlas) !== value.digest) throw new Error('Atlas recebido com assinatura inválida')
        result = { atlas, document: await readAtlas(atlas) }
      } else throw new Error('Operação de atlas inválida')
      scope.postMessage({ id, result }, transfer)
    } catch (error) { scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }) }
  })
}