let revision = 0
export const getAssetRevision = () => revision
export function bumpAssetRevision() { revision++ }

// Pixel readiness changes previews, not the persisted catalog or peer payload.
let imageRevision = 0
export const getAssetImageRevision = () => imageRevision
export function bumpAssetImageRevision() { imageRevision++ }
