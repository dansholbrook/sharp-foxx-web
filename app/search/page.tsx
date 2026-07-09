'use client';

import { Suspense, useEffect, useMemo, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { getEvents, EventListItem } from '../api';

// Date-only formatting for compact thumbnail metadata (mirrors the feed page).
function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { dateStyle: 'medium' });
}

// Sport -> thumbnail gradient class (same treatment as the feed cards). The card
// itself is the artwork; unknown/missing sports fall back to 'other'.
const SPORTS = new Set([
  'basketball',
  'football',
  'baseball',
  'hockey',
  'soccer',
  'other',
]);
function thumbClass(sport: string | null): string {
  const key = sport && SPORTS.has(sport) ? sport : 'other';
  return `thumb thumb--${key}`;
}

// ---- Game thumbnail card: identical markup to the feed's GameCard so the
// results grid reads as the same design language. ----
function GameCard({ event }: { event: EventListItem }) {
  const home = event.homeTeam ?? 'TBD';
  const away = event.awayTeam ?? 'TBD';

  return (
    <article className="tcard">
      <div className={thumbClass(event.sport)}>
        <span className="thumb-tag">{event.sport ?? 'event'}</span>
        <div className="thumb-matchup">
          <span className="thumb-team">{home}</span>
          <span className="thumb-vs">vs</span>
          <span className="thumb-team">{away}</span>
        </div>
      </div>
      <div className="tcard-body">
        <div className="tcard-meta">
          {event.venue && <span className="tcard-meta__seg">{event.venue}</span>}
          <span className="tcard-meta__seg">{formatDate(event.scheduledAt)}</span>
        </div>
      </div>
    </article>
  );
}

// Does an event match the free-text query? Case-insensitive substring across
// team names, venue, and sport. Empty query matches everything.
function matchesQuery(event: EventListItem, q: string): boolean {
  if (!q) return true;
  const haystack = [
    event.homeTeam,
    event.awayTeam,
    event.venue,
    event.sport,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

// The special "all sports" sentinel for the sport filter chips.
const ALL = 'all';

function SearchResults() {
  const router = useRouter();
  const params = useSearchParams();
  const { token, user, logout } = useAuth();

  const initialQ = params.get('q') ?? '';

  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Live-refining query (seeded from ?q=) and the active sport filter.
  const [query, setQuery] = useState(initialQ);
  const [sport, setSport] = useState<string>(ALL);

  // Keep the input in sync if the URL query changes (e.g. arriving from the
  // homepage search with a new ?q= while this page is already mounted).
  useEffect(() => {
    setQuery(initialQ);
  }, [initialQ]);

  // No token in memory (e.g. after a refresh) -> back to login. Otherwise pull
  // every event once and filter entirely client-side (small data set for now).
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const ev = await getEvents(token);
        if (!cancelled) setEvents(ev);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load games');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  const normalizedQ = query.trim().toLowerCase();

  // Sports present in the data (matching the current text query) — drives which
  // filter chips are worth showing. Sorted for a stable chip order.
  const availableSports = useMemo(() => {
    if (!events) return [];
    const set = new Set<string>();
    for (const ev of events) {
      if (matchesQuery(ev, normalizedQ)) set.add(ev.sport);
    }
    return Array.from(set).sort();
  }, [events, normalizedQ]);

  // Final result set: text match, then narrow by the selected sport.
  const results = useMemo(() => {
    if (!events) return [];
    return events.filter(
      (ev) =>
        matchesQuery(ev, normalizedQ) && (sport === ALL || ev.sport === sport),
    );
  }, [events, normalizedQ, sport]);

  // Submitting the search box mirrors the query into the URL so it's shareable;
  // filtering itself is state-driven, so results already updated as they typed.
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    router.replace(
      trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search',
    );
  }

  function onLogout() {
    logout();
    router.replace('/');
  }

  if (!token) return null;

  return (
    <main className="feed-home">
      <div className="header-row">
        <div>
          <span className="wordmark">Sharp Foxx</span>
          <span className="muted">
            Signed in as{' '}
            <span className="mono">{user?.displayName ?? user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <div className="nav-links">
          <Link href="/feed" className="link-btn">
            ← Home
          </Link>
          <button className="link-btn" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>

      <form className="feed-search" onSubmit={onSubmit} role="search">
        <svg
          className="feed-search__icon"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className="feed-search__input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search games, teams, venues, sports…"
          aria-label="Search games, teams, venues, sports"
          autoFocus
        />
        <button className="feed-search__btn" type="submit">
          Search
        </button>
      </form>

      {loading && <div className="card muted">Searching games…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && (
        <>
          {/* Filter region — sport chips today; status/date can slot in here. */}
          {availableSports.length > 0 && (
            <div className="filter-row" role="group" aria-label="Filter by sport">
              <button
                type="button"
                className={`chip${sport === ALL ? ' chip--on' : ''}`}
                aria-pressed={sport === ALL}
                onClick={() => setSport(ALL)}
              >
                All sports
              </button>
              {availableSports.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`chip${sport === s ? ' chip--on' : ''}`}
                  aria-pressed={sport === s}
                  onClick={() => setSport(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <p className="result-count">
            {results.length} {results.length === 1 ? 'game' : 'games'}
            {normalizedQ ? (
              <>
                {' '}
                matching <span className="result-count__q">“{query.trim()}”</span>
              </>
            ) : null}
          </p>

          {results.length > 0 ? (
            <div className="results-grid">
              {results.map((ev) => (
                <GameCard key={ev.id} event={ev} />
              ))}
            </div>
          ) : (
            <div className="results-empty">
              <p className="results-empty__title">
                {normalizedQ
                  ? `No games match “${query.trim()}”`
                  : 'No games found'}
              </p>
              <p className="results-empty__hint">
                Try a different team, venue, or sport — or{' '}
                <Link href="/feed">browse the homepage</Link>.
              </p>
            </div>
          )}
        </>
      )}
    </main>
  );
}

// useSearchParams must render inside a Suspense boundary (Next.js App Router).
export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <main className="feed-home">
          <div className="card muted">Loading search…</div>
        </main>
      }
    >
      <SearchResults />
    </Suspense>
  );
}
