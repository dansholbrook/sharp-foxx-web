'use client';

// /games — the schedule. One browsable surface for every game we know about,
// answering "what can I watch tonight?". Open to every authenticated role: this
// is a fan surface, which is why it renders the feed's game CARDS rather than
// /discover's QueueTable (a table is for working a queue, not for browsing).
//
// Two tabs, both server-filtered and server-paged against GET /events
// ({ items, total }): UPCOMING is status=scheduled,live and RESULTS is
// status=final. Live games sit at the very top of Upcoming — that's the
// backend's ordering (live first, then scheduled soonest-first; finals come back
// most-recent-first), so pinning survives paging instead of being a client-side
// sort of whatever page 1 happened to contain.
//
// Two deliberate calls about the honest state of the data — there are very few
// games in the graph yet:
//   * The date window defaults to ALL, not "this week". A default window would
//     hide a schedule whose only games are next month and read as a broken page.
//   * If the UNFILTERED upcoming tab comes back empty, the page falls back to
//     recent finals under a "Recent results" header rather than rendering a
//     blank surface. An empty result that the user filtered their way into still
//     gets the normal "no games match" state — that one isn't a surprise.

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import { getGames, EventListItem } from '../api';

const PAGE_SIZE = 20;

type Tab = 'upcoming' | 'results';
type Window = 'week' | 'month' | 'all';

// Unlike the feed's date-only thumbnails, a schedule has to answer "tonight?" —
// so the tip-off time is part of the card, not just the date.
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// The shared pulsing LIVE badge (dot + wordmark) — same scoped .live-badge
// treatment used on the feed cards, the game page, and search results.
function LiveBadge({ className }: { className?: string }) {
  return (
    <span className={`live-badge${className ? ` ${className}` : ''}`}>
      <span className="live-badge__dot" aria-hidden="true" />
      Live
    </span>
  );
}

// Sport -> thumbnail gradient class (same treatment as the feed cards). The card
// itself is the artwork; unknown/missing sports fall back to 'other'.
const SPORT_SET = new Set([
  'basketball',
  'football',
  'baseball',
  'hockey',
  'soccer',
  'other',
]);
function thumbClass(sport: string | null): string {
  const key = sport && SPORT_SET.has(sport) ? sport : 'other';
  return `thumb thumb--${key}`;
}

// The sport pg enum, verbatim (same list /discover filters on).
const SPORTS = ['basketball', 'football', 'baseball', 'hockey', 'soccer', 'other'];

// Static on purpose — same reasoning as /discover: deriving the list would cost
// a distinct-scan per load to save nothing.
const STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO',
  'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

const WINDOWS: Array<{ value: Window; label: string }> = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All dates' },
];

// A quick-pick, not two date inputs: this is a fan surface, and "what's on this
// week" is one click where a pair of date fields is four interactions and a
// format to get wrong. The window resolves against the tab, since the same chip
// means opposite directions on the two tabs — "this week" is the next 7 days on
// Upcoming and the last 7 on Results.
//
// Upcoming counts from the START of today rather than from now: a game that
// tipped off an hour ago is live right now, and a dateFrom of "now" would filter
// the very games the tab is meant to pin to the top.
function windowRange(win: Window, tab: Tab): { dateFrom?: string; dateTo?: string } {
  if (win === 'all') return {};
  const days = win === 'week' ? 7 : 30;
  const now = new Date();

  if (tab === 'upcoming') {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + days);
    to.setHours(23, 59, 59, 999);
    return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
  }

  const from = new Date(now);
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);
  return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
}

// ---- Game card: the feed's GameCard markup verbatim, so the schedule reads as
// the same design language as everything else fans see. The gradient block IS
// the visual; score replaces "vs" once a result is in, and the whole card links
// to the game's page at /games/[id]. ----
function GameCard({ event }: { event: EventListItem }) {
  const home = event.homeTeam ?? 'TBD';
  const away = event.awayTeam ?? 'TBD';
  const hasScore = event.homeScore !== null && event.awayScore !== null;
  const isFinal = event.status === 'final';
  const isLive = event.status === 'live';
  const hasVideo = Boolean(event.videoUrl);

  return (
    <article className="tcard">
      <Link
        className="tcard-open"
        href={`/games/${event.id}`}
        aria-label={`View ${home} vs ${away}`}
      >
        <div className={thumbClass(event.sport)}>
          <span className="thumb-tag">{event.sport ?? 'event'}</span>
          {isLive ? (
            <LiveBadge className="thumb-live" />
          ) : (
            isFinal && <span className="thumb-final">Final</span>
          )}
          {hasVideo && (
            <span className="thumb-watch">
              <span className="thumb-watch__icon" aria-hidden="true">
                ▶
              </span>
              Watch
            </span>
          )}
          <div className="thumb-matchup">
            <span className="thumb-team">{home}</span>
            {hasScore ? (
              <span className="thumb-score">
                {event.homeScore} – {event.awayScore}
              </span>
            ) : (
              <span className="thumb-vs">vs</span>
            )}
            <span className="thumb-team">{away}</span>
          </div>
        </div>
        <div className="tcard-body">
          <div className="tcard-meta">
            {event.venue && <span className="tcard-meta__seg">{event.venue}</span>}
            <span className="tcard-meta__seg">{formatWhen(event.scheduledAt)}</span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function Games() {
  const router = useRouter();
  const params = useSearchParams();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], '/games');

  // The URL seeds the filters once, on mount; from there the page owns them and
  // mirrors back (see the sync effect) — same contract as /discover.
  const [tab, setTab] = useState<Tab>(
    params.get('tab') === 'results' ? 'results' : 'upcoming',
  );
  const [sport, setSport] = useState(params.get('sport') ?? '');
  const [stateCode, setStateCode] = useState(params.get('state') ?? '');
  const [win, setWin] = useState<Window>(() => {
    const w = params.get('window');
    return w === 'week' || w === 'month' ? w : 'all';
  });

  const [items, setItems] = useState<EventListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Recent finals, loaded only when the unfiltered Upcoming tab is empty (see
  // the file header). null = not in fallback mode.
  const [fallback, setFallback] = useState<EventListItem[] | null>(null);

  useEffect(() => {
    if (!token) router.replace('/');
  }, [token, router]);

  // Mirror the live filters into the URL so a view is shareable. replace(), not
  // push(): filtering shouldn't build history.
  useEffect(() => {
    const qs = new URLSearchParams();
    if (tab !== 'upcoming') qs.set('tab', tab);
    if (sport) qs.set('sport', sport);
    if (stateCode) qs.set('state', stateCode);
    if (win !== 'all') qs.set('window', win);
    const s = qs.toString();
    router.replace(s ? `/games?${s}` : '/games', { scroll: false });
  }, [router, tab, sport, stateCode, win]);

  const hasFilters = Boolean(sport || stateCode || win !== 'all');

  // Requests can overlap (a state change while a "Show more" is in flight), so
  // only the newest may touch state — the counter idiom /discover uses, for the
  // same reason: load() is called from both the filter effect and Show more, so
  // it can't hang a flag off a single effect's cleanup.
  const reqSeq = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      if (!token) return;
      const seq = ++reqSeq.current;
      const current = () => seq === reqSeq.current;
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const range = windowRange(win, tab);
        const page = await getGames(token, {
          status: tab === 'upcoming' ? 'scheduled,live' : 'final',
          sport: sport || undefined,
          state: stateCode || undefined,
          ...range,
          limit: PAGE_SIZE,
          offset,
        });
        if (!current()) return;
        setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setTotal(page.total);

        // Nothing upcoming and nothing filtered away: show recent finals instead
        // of a blank page. Only worth asking on the first page of an unfiltered
        // Upcoming tab — every other empty result is one the user asked for.
        if (offset === 0 && tab === 'upcoming' && !hasFilters && page.total === 0) {
          const recent = await getGames(token, { status: 'final', limit: PAGE_SIZE });
          if (!current()) return;
          setFallback(recent.items);
        } else if (offset === 0) {
          setFallback(null);
        }
      } catch (err) {
        if (!current()) return;
        setError(err instanceof Error ? err.message : 'Failed to load games');
      } finally {
        // A superseded request must not clear the spinner the newer one set.
        if (current()) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [token, tab, sport, stateCode, win, hasFilters],
  );

  // Refetch from the top whenever the query changes (`load`'s identity is the
  // filter set). Show more calls load(offset) directly and skips this.
  useEffect(() => {
    if (!token || !allowed) return;
    load(0);
  }, [token, allowed, load]);

  function clearFilters() {
    setSport('');
    setStateCode('');
    setWin('all');
  }

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  // Nothing to show yet vs. refiltering rows we already have — the second case
  // dims the grid rather than flashing it out and back.
  const showSkeleton = loading && items.length === 0;
  const busy = loading && items.length > 0;
  const inFallback = fallback !== null && items.length === 0;
  const noun = tab === 'upcoming' ? 'game' : 'result';

  return (
    <main className="feed-home gamesdir-page">
      <div className="header-row">
        <div>
          <span className="wordmark">Sharp Foxx</span>
          <span className="muted">
            Signed in as{' '}
            <span className="mono">{user?.displayName ?? user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <AppNav />
      </div>

      <header className="masthead">
        <span className="masthead-kicker">Games</span>
        <h1 className="masthead-title">What&apos;s on</h1>
        <p className="masthead-standfirst">
          Every game we cover — live now, coming up, and just played.
        </p>
      </header>

      {/* Tabs. Chips rather than role="tab", matching /discover: each tab is a
          filtered view of one page, not a persistent panel. */}
      <div className="gamesdir-tabs" role="group" aria-label="Upcoming games or results">
        {(['upcoming', 'results'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`chip${tab === t ? ' chip--on' : ''}`}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t === 'upcoming' ? 'Upcoming' : 'Results'}
          </button>
        ))}
      </div>

      <div className="gamesdir-filters">
        <div className="gamesdir-field">
          <label htmlFor="gamesdir-sport">Sport</label>
          <select
            id="gamesdir-sport"
            className="gamesdir-input"
            value={sport}
            onChange={(e) => setSport(e.target.value)}
          >
            <option value="">All sports</option>
            {SPORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="gamesdir-field">
          {/* The home team's state — see the backend note; a road game shows up
              under the host's state, which is where it's actually played. */}
          <label htmlFor="gamesdir-state">State</label>
          <select
            id="gamesdir-state"
            className="gamesdir-input"
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value)}
          >
            <option value="">All states</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Defaults to All — see the file header. */}
        <div className="filter-row" role="group" aria-label="Filter by date">
          {WINDOWS.map((w) => (
            <button
              key={w.value}
              type="button"
              className={`chip${win === w.value ? ' chip--on' : ''}`}
              aria-pressed={win === w.value}
              onClick={() => setWin(w.value)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {showSkeleton && !error && <div className="card muted">Loading games…</div>}

      {!showSkeleton && !error && (
        <div className={busy ? 'gamesdir-results gamesdir-results--busy' : 'gamesdir-results'}>
          {inFallback ? (
            // The unfiltered schedule is empty. Say so plainly, then show what we
            // do have rather than leaving the page blank.
            <>
              <div className="results-empty">
                <p className="results-empty__title">No games scheduled yet</p>
                <p className="results-empty__hint">
                  {fallback.length > 0 ? (
                    <>Nothing upcoming on the calendar. Here&apos;s what was played recently.</>
                  ) : (
                    // Genuinely nothing in the graph, either direction. Don't
                    // promise recent results we can't show.
                    <>
                      Nothing upcoming, and nothing played yet — the schedule
                      fills in as games are added. Try the{' '}
                      <Link href="/feed">feed</Link> meanwhile.
                    </>
                  )}
                </p>
              </div>
              {fallback.length > 0 && (
                <>
                  <h2 className="row-title gamesdir-fallback-title">Recent results</h2>
                  <div className="results-grid">
                    {fallback.map((ev) => (
                      <GameCard key={ev.id} event={ev} />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <p className="result-count">
                {total.toLocaleString()} {total === 1 ? noun : `${noun}s`}
                {hasFilters ? ' match your filters' : ''}
              </p>

              {items.length === 0 ? (
                <div className="results-empty">
                  <p className="results-empty__title">No games match these filters</p>
                  <p className="results-empty__hint">
                    Try widening them —{' '}
                    <button type="button" className="link-btn" onClick={clearFilters}>
                      clear all filters
                    </button>
                    .
                  </p>
                </div>
              ) : (
                <>
                  <div className="results-grid">
                    {items.map((ev) => (
                      <GameCard key={ev.id} event={ev} />
                    ))}
                  </div>

                  {items.length < total && (
                    <div className="queue-more">
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={loadingMore}
                        onClick={() => load(items.length)}
                      >
                        {loadingMore ? 'Loading…' : 'Show more'}
                      </button>
                      <span className="muted queue-more__note">
                        Showing {items.length} of {total.toLocaleString()}
                      </span>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}

// useSearchParams must render inside a Suspense boundary (Next.js App Router).
export default function GamesPage() {
  return (
    <Suspense
      fallback={
        <main className="feed-home">
          <div className="card muted">Loading games…</div>
        </main>
      }
    >
      <Games />
    </Suspense>
  );
}
