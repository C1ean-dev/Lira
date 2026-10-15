export interface BundledImageManifest {
  version: 1
  images: Record<string, { path: string; mime: string }>
  aliases: Record<string, string>
}
