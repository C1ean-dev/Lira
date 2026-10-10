export const COPY_SUFFIX = ' (Custom)'

export function presetNameForStudio(label: string, isExistingCustomAsset: boolean): string {
  return isExistingCustomAsset ? label : `${label}${COPY_SUFFIX}`
}
