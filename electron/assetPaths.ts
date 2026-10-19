import path from 'node:path'

export function runtimeAssetPath(appPath: string, packaged: boolean, name: string): string {
  return path.join(appPath, packaged ? 'dist' : 'public', name)
}
