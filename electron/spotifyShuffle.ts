// Evaluated in the dedicated tab. Toggle the semantic button instead of a
// coordinate that can miss when the sidebar changes the playback layout.
export function toggleSpotifyShuffle() {
  if (location.origin !== 'https://open.spotify.com') return false
  const button = document.querySelector<HTMLButtonElement>('[data-testid="control-button-shuffle"]')
  if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false
  button.click()
  return true
}
