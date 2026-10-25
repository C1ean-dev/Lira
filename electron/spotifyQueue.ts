import type { SpotifyDjRequestResult } from '../src/types/spotifyDjRequests'

// Serialized into the dedicated browser. Only the selected track's context
// menu is used; a fresh Spotify notification is required to confirm success.
export async function enqueueSpotifyTrackInPage(trackId: string): Promise<SpotifyDjRequestResult> {
  if (location.origin !== 'https://open.spotify.com' || !/^[A-Za-z0-9]{22}$/.test(trackId)) {
    return { ok: false, error: 'Faixa ou página do Spotify inválida.' }
  }
  // Native hidden CDP targets can report visible; the user's focus remains separate.
  const background = () => typeof document.hasFocus === 'function' && !document.hasFocus()
  const paused = (): SpotifyDjRequestResult => ({ ok: false, error: 'A automação foi pausada porque esta aba está sendo usada. Volte à aba do player e tente novamente.' })
  if (!background()) return paused()
  const normalize = (text: string | null | undefined) => (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('main a[href*="/track/"], [role="main"] a[href*="/track/"]'))
  const matching = anchors.filter(link => {
    try {
      const url = new URL(link.getAttribute('href') || '', location.origin)
      return url.origin === location.origin && url.pathname.replace(/^\/intl-[a-z]{2}/, '').replace(/\/$/, '') === `/track/${trackId}`
    } catch { return false }
  })
  const row = matching.map(anchor => anchor.closest('[data-testid="tracklist-row"], [role="row"]')).find(Boolean)
    || matching.map(anchor => anchor.closest('[data-encore-id="card"], li')).find(Boolean)
  if (!row) return { ok: false, error: 'A faixa selecionada não está mais nos resultados do Spotify. Pesquise novamente.' }
  const visibleMenus = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]')).filter(menu => menu.getAttribute('aria-hidden') !== 'true'
    && (typeof menu.getClientRects !== 'function' || menu.getClientRects().length > 0))
  for (const menu of visibleMenus()) {
    if (!background()) return paused()
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
  }
  for (let attempt = 0; attempt < 10 && visibleMenus().length; attempt++) await new Promise(resolve => setTimeout(resolve, 50))
  if (visibleMenus().length) return { ok: false, error: 'Não foi possível fechar o menu anterior do Spotify. Tente novamente.' }
  if (!background()) return paused()
  const more = row.querySelector<HTMLButtonElement>('button[data-testid="more-button"], button[data-testid="tracklist-row-context-menu-button"], button[aria-haspopup="menu"]')
  if (more?.disabled || more?.getAttribute('aria-disabled') === 'true') return { ok: false, error: 'O menu desta faixa está indisponível no Spotify.' }
  if (more) more.click()
  else row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
  let item: HTMLElement | undefined
  for (let attempt = 0; attempt < 30; attempt++) {
    const menus = visibleMenus()
    item = menus.flatMap(menu => Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))).find(button => {
      const testId = button.getAttribute('data-testid') || ''
      return testId.includes('add-to-queue') || /^(add to (?:your )?queue|adicionar (?:a )?(?:sua )?fila(?: de reproducao)?)$/.test(normalize(button.textContent))
    })
    if (item) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  if (!item) return { ok: false, error: 'O Spotify não disponibilizou a opção Adicionar à fila para esta faixa.' }
  if ((item as HTMLButtonElement).disabled || item.getAttribute('aria-disabled') === 'true') {
    return { ok: false, error: 'Adicionar à fila está indisponível nesta conta do Spotify.' }
  }
  if (!background()) return paused()
  const notifications = () => Array.from(document.querySelectorAll<HTMLElement>('[role="status"], [role="alert"], [data-testid="toast"], [data-testid="toast-message"]'))
  const previous = new Map(notifications().map(node => [node, normalize(node.textContent)]))
  const changes = new Set<Node>()
  const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(records => {
    for (const record of records) { changes.add(record.target); record.addedNodes.forEach(node => changes.add(node)) }
  })
  observer?.observe(document.body, { subtree: true, childList: true, characterData: true })
  let clicked = false
  try {
    clicked = true
    item.click()
    for (let attempt = 0; attempt < 100; attempt++) {
      for (const node of notifications()) {
        const message = normalize(node.textContent)
        const fresh = !previous.has(node) || previous.get(node) !== message
          || Array.from(changes).some(changed => node === changed || node.contains(changed))
        if (!fresh) continue
        if (/^(added to (?:your )?queue|adicionad[oa] (?:a )?(?:sua )?fila(?: de reproducao)?)[.!]?$/.test(message)) return { ok: true }
        if (/couldn.t add|unable to add|something went wrong|nao foi possivel adicionar|ocorreu um erro/.test(message)) {
          return { ok: false, error: 'O Spotify recusou a inclusão na fila. Tente novamente pelo player.' }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return { ok: false, uncertain: true, error: 'O Spotify não confirmou a inclusão. Confira a fila antes de pedir a mesma música novamente.' }
  } catch {
    return { ok: false, ...(clicked ? { uncertain: true } : {}), error: 'Não foi possível confirmar a inclusão da música na fila do Spotify.' }
  } finally { observer?.disconnect() }
}
