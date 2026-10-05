/** Added to the name of a built-in preset that is copied into the studio, so the copy is not mistaken for the original. */
export const COPY_SUFFIX = ' (Custom)'

/**
 * The name the pixel art studio opens with for a preset of the avatar customizer.
 *
 * - An asset the user already made: its own name, unchanged. Saving does not rename it, however many
 *   times it is edited.
 * - A built-in preset, which saving turns into a new asset of its own: the name of the original plus
 *   COPY_SUFFIX.
 */
export function presetNameForStudio(label: string, isExistingCustomAsset: boolean): string {
  return isExistingCustomAsset ? label : `${label}${COPY_SUFFIX}`
}
