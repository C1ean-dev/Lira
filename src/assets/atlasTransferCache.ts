import type { CustomAsset } from '../types/customAsset'
import type { PersistedAtlas } from './atlasFormat'
import { buildAtlas, atlasDigest } from './atlasService'
import { getAssetRevision } from './assetRevision'

type TransferAtlas = { atlas: PersistedAtlas; digest: string }
let latest: {
  assets: CustomAsset[]
  categories: string[]
  revision: number
  pending: Promise<TransferAtlas>
} | null = null

/** Keep only the latest library; concurrent joins share its encoding and hash. */
export function getTransferAtlas(assets: CustomAsset[], categories: string[]): Promise<TransferAtlas> {
  const revision = getAssetRevision()
  if (latest?.assets === assets && latest.categories === categories && latest.revision === revision) return latest.pending
  const pending = buildAtlas(assets, categories).then(async (atlas) => ({ atlas, digest: await atlasDigest(atlas) }))
  latest = { assets, categories, revision, pending }
  void pending.catch(() => {
    if (latest?.pending === pending) latest = null
  })
  return pending
}