import type { BinaryAtlas } from './atlasChunks'
import type { CustomAsset } from '../types/customAsset'
import type { AtlasDocument, PersistedAtlas } from './atlasFormat'
import * as core from './atlasCore'
import { runAtlasTask } from './atlasWorkerClient'
export { loadAtlasImage } from './atlasCore'
export async function atlasDigest(pair: PersistedAtlas): Promise<string> {
  return useWorker() ? runAtlasTask('digest', pair) : core.atlasDigest(pair)
}

const useWorker = () => typeof Worker !== 'undefined' && typeof document !== 'undefined'
export async function buildAtlas(assets: CustomAsset[], categories: string[] = [], deletedAssetIds: string[] = []): Promise<PersistedAtlas> {
  return useWorker() ? runAtlasTask('build', { assets, categories, deletedAssetIds }) : core.buildAtlas(assets, categories, deletedAssetIds)
}
export async function readAtlas(pair: PersistedAtlas): Promise<AtlasDocument> {
  return useWorker() ? runAtlasTask('read', pair) : core.readAtlas(pair)
}
export async function decodeTransferredAtlas(binary: BinaryAtlas): Promise<{ atlas: PersistedAtlas; document: AtlasDocument }> {
  if (useWorker()) {
    const transfer = [...new Set([...binary.xml, ...binary.png].map(bytes => bytes.buffer as ArrayBuffer))]
    return runAtlasTask('decodeTransfer', binary, transfer)
  }
  const atlas = { xml: await new Blob(binary.xml as BlobPart[]).text(), png: await new Blob(binary.png as BlobPart[]).text() }
  if (await core.atlasDigest(atlas) !== binary.digest) throw new Error('Atlas recebido com assinatura inválida')
  return { atlas, document: await core.readAtlas(atlas) }
}