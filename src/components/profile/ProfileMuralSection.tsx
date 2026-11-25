import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Gamepad2, Search, X } from 'lucide-react'
import {
  GAMES_CATALOG_PAGE_SIZE,
  POPULAR_GAMES,
  POPULAR_GAME_CATEGORIES,
  POPULAR_GAME_MAP,
  PopularGameCategory,
  PopularGameMeta,
} from '../../data/profileCatalog'
import { MAX_PROFILE_GAMES, PopularGameId } from '../../types/profile'

interface Props {
  games: PopularGameId[]
  isLocal?: boolean
  scrollRootRef?: React.RefObject<HTMLDivElement | null>
  onToggleGame?: (gameId: PopularGameId) => void
  onClearGames?: () => void
}

export const GamePosterCard: React.FC<{
  game: PopularGameMeta
  selected?: boolean
  removable?: boolean
  showLabelAlways?: boolean
  onClick?: () => void
  onRemove?: (e: React.MouseEvent) => void
}> = ({ game, selected = false, removable = false, showLabelAlways = false, onClick, onRemove }) => {
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      style={{
        background: game.gradient,
        borderColor: selected ? game.accent : 'rgba(255,255,255,0.12)',
        boxShadow: selected ? `0 0 0 1px ${game.accent}99, 0 8px 20px rgba(0,0,0,0.45)` : undefined,
      }}
      className={`group relative aspect-[3/4] rounded-xl overflow-hidden border select-none transition-all ${
        onClick ? 'cursor-pointer hover:scale-[1.03] hover:brightness-110' : ''
      }`}
      title={`${game.name} — ${game.genre}`}
    >
      {!imgFailed && game.coverUrl ? (
        <img
          src={game.coverUrl}
          alt={game.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl opacity-35"
            style={{ backgroundColor: game.accent }}
          />
          <div className="absolute top-2 left-2 z-10 px-1.5 py-0.5 rounded-md bg-black/45 backdrop-blur-sm border border-white/15 text-[9px] font-black tracking-wider text-white/95">
            {game.monogram}
          </div>
          <div className="absolute inset-0 flex items-center justify-center pb-7">
            <span className="text-4xl drop-shadow-[0_4px_12px_rgba(0,0,0,0.65)] transition-transform duration-200 group-hover:scale-110">
              {game.emoji}
            </span>
          </div>
        </>
      )}

      {removable && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remover ${game.name}`}
          title={`Remover ${game.name}`}
          className="absolute top-1.5 right-1.5 z-20 p-1 rounded-full bg-black/75 hover:bg-rose-600 text-slate-200 hover:text-white border border-white/15 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all"
        >
          <X className="w-3 h-3" />
        </button>
      )}

      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-2 pt-7 pb-2 transition-opacity duration-200 ${
          imgFailed || showLabelAlways ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <div className="text-[11px] font-extrabold text-white leading-tight line-clamp-2 drop-shadow">
          {game.name}
        </div>
        <div className="text-[9px] text-slate-300/90 truncate mt-0.5">{game.genre}</div>
      </div>
    </div>
  )
}

export const ProfileMuralSection: React.FC<Props> = ({
  games,
  isLocal = false,
  scrollRootRef,
  onToggleGame,
  onClearGames,
}) => {
  const [gameQuery, setGameQuery] = useState('')
  const [gameCategory, setGameCategory] = useState<PopularGameCategory>('Todos')
  const [page, setPage] = useState(1)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const validGames = useMemo(
    () =>
      games
        .map((id) => POPULAR_GAME_MAP[id])
        .filter((item): item is PopularGameMeta => !!item),
    [games]
  )

  const filteredCatalog = useMemo(() => {
    const q = gameQuery.trim().toLowerCase()
    return POPULAR_GAMES.filter((g) => {
      if (gameCategory !== 'Todos' && g.category !== gameCategory) return false
      if (!q) return true
      return (
        g.name.toLowerCase().includes(q) ||
        g.genre.toLowerCase().includes(q) ||
        g.monogram.toLowerCase().includes(q)
      )
    })
  }, [gameQuery, gameCategory])

  const totalPages = Math.max(1, Math.ceil(filteredCatalog.length / GAMES_CATALOG_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const visibleCatalog = useMemo(
    () => filteredCatalog.slice(0, currentPage * GAMES_CATALOG_PAGE_SIZE),
    [filteredCatalog, currentPage]
  )
  const hasMore = visibleCatalog.length < filteredCatalog.length

  const loadNextPage = useCallback(() => {
    setPage((prev) => (prev < totalPages ? prev + 1 : prev))
  }, [totalPages])

  useEffect(() => {
    setPage(1)
  }, [gameQuery, gameCategory])

  // Infinite scroll via IntersectionObserver + scroll listener on the mural container
  useEffect(() => {
    if (!isLocal || !hasMore) return
    const sentinel = sentinelRef.current
    const root = scrollRootRef?.current ?? null

    let observer: IntersectionObserver | null = null
    if (sentinel && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            loadNextPage()
          }
        },
        { root, rootMargin: '180px 0px', threshold: 0.01 }
      )
      observer.observe(sentinel)
    }

    const onScroll = () => {
      if (!root) return
      if (root.scrollHeight - root.scrollTop - root.clientHeight < 160) {
        loadNextPage()
      }
    }
    root?.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      observer?.disconnect()
      root?.removeEventListener('scroll', onScroll)
    }
  }, [isLocal, hasMore, loadNextPage, scrollRootRef])

  // Viewing another user's profile: read-only showcase
  if (!isLocal) {
    return (
      <div className="rounded-2xl bg-[#131419] border border-white/[0.08] p-4 shadow-lg space-y-3">
        <div className="flex items-center gap-2">
          <Gamepad2 className="w-4 h-4 text-indigo-400" />
          <h4 className="text-xs font-extrabold text-slate-100 tracking-wide">Jogos que eu jogo</h4>
          {validGames.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-white/[0.06] text-slate-400">
              {validGames.length}
            </span>
          )}
        </div>

        {validGames.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Este usuário ainda não selecionou jogos no mural.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {validGames.map((game) => (
              <GamePosterCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Selected games showcase (when user has picked at least 1 game) */}
      {validGames.length > 0 && (
        <div className="rounded-2xl bg-[#131419] border border-white/[0.08] p-4 shadow-lg space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Gamepad2 className="w-4 h-4 text-indigo-400" />
              <h4 className="text-xs font-extrabold text-slate-100 tracking-wide">Jogos que eu jogo</h4>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-white/[0.06] text-slate-400">
                {validGames.length}/{MAX_PROFILE_GAMES}
              </span>
            </div>

            {onClearGames && (
              <button
                type="button"
                onClick={onClearGames}
                className="text-[11px] font-semibold text-slate-400 hover:text-rose-300 transition-colors"
              >
                Limpar
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {validGames.map((game) => (
              <GamePosterCard
                key={game.id}
                game={game}
                removable={!!onToggleGame}
                onRemove={
                  onToggleGame
                    ? (e) => {
                        e.stopPropagation()
                        onToggleGame(game.id)
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Embedded infinite-scroll paginated catalog right inside the Mural */}
      <div className="rounded-2xl bg-[#131419] border border-white/[0.08] p-4 shadow-lg space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Gamepad2 className="w-4 h-4 text-indigo-400" />
            <h4 className="text-xs font-extrabold text-slate-100 tracking-wide">
              {validGames.length === 0 ? 'Jogos que eu jogo' : 'Adicionar jogos ao mural'}
            </h4>
          </div>
          <span className="text-[11px] text-slate-400">
            <strong className="text-slate-200">{validGames.length}</strong>/{MAX_PROFILE_GAMES}
          </span>
        </div>

        <p className="text-xs text-slate-400">
          Clique nos jogos que você joga para adicionar ou remover do seu mural:
        </p>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={gameQuery}
            onChange={(e) => setGameQuery(e.target.value)}
            placeholder="Buscar jogo (ex: Valorant, Minecraft, Elden Ring...)"
            className="w-full bg-[#1a1c24] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {POPULAR_GAME_CATEGORIES.map((cat) => {
            const active = gameCategory === cat
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setGameCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all shrink-0 ${
                  active
                    ? 'bg-indigo-600 text-white'
                    : 'bg-[#1a1c24] text-slate-300 hover:text-white border border-white/10'
                }`}
              >
                {cat}
              </button>
            )
          })}
        </div>

        {filteredCatalog.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Nenhum jogo encontrado para "{gameQuery}".
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {visibleCatalog.map((game) => {
                const isSelected = games.includes(game.id)
                const atLimit = !isSelected && games.length >= MAX_PROFILE_GAMES
                return (
                  <div
                    key={game.id}
                    className={`relative ${atLimit ? 'opacity-45 pointer-events-none' : ''}`}
                  >
                    <GamePosterCard
                      game={game}
                      selected={isSelected}
                      onClick={() => onToggleGame?.(game.id)}
                    />
                    {isSelected && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1.5 right-1.5 z-20 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md ring-2 ring-black/60"
                      >
                        <Check className="w-3 h-3 stroke-[3]" />
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            <div ref={sentinelRef} className="pt-2 flex flex-col items-center gap-2">
              <div className="text-[11px] text-slate-400">
                Mostrando <strong className="text-slate-200">{visibleCatalog.length}</strong> de{' '}
                <strong className="text-slate-200">{filteredCatalog.length}</strong> jogos • Página{' '}
                <strong className="text-slate-200">{currentPage}</strong>/{totalPages}
              </div>
              {hasMore && (
                <button
                  type="button"
                  onClick={loadNextPage}
                  className="px-4 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] border border-white/10 text-xs font-bold text-slate-100 inline-flex items-center gap-1.5 transition-all"
                >
                  <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Carregar mais jogos</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
