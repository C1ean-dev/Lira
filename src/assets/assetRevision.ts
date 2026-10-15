let revision = 0
export const getAssetRevision = () => revision
export function bumpAssetRevision() { revision++ }
