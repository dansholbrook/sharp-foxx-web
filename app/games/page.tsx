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
// Upcoming also sends upcomingOnly=true, which drops scheduled games whose
// kickoff has passed. That bucket exists because a covered game nobody filed a
// result for stays 'scheduled' forever, and the scheduled-ASC ordering above
// sorts the stalest one FIRST — three-week-old games at the top of "what's on".
// The feed carousel and two other surfaces fix this in the browser; /games pages
// server-side and can't, since stale rows consume slots before we see them. The
// backend scopes the constraint to scheduled rows only, so the live pin holds.
//
// Two deliberate calls about the honest state of the data — there are very few
// games in the graph yet:
//   * The date window defaults to ALL, not "this week". A default window would
//     hide a schedule whose only games are next month and read as a broken page.
//   * If the UNFILTERED upcoming tab comes back empty, the page falls back to
//     recent finals under a "Recent results" header rather than rendering a
//     blank surface. An empty result that the user filtered their way into still
//     gets the normal "no games match" state — that one isn't a surprise.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { GamePickStrip, GamePicks, useGamePicks } from '../game-pick-strip';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import {
  getGames,
  isFeedEvent,
  etDateTime,
  etDateKey,
  etWallClockToIso,
  EventListItem,
} from '../api';

const PAGE_SIZE = 20;

type Tab = 'upcoming' | 'results';
type Window = 'week' | 'month' | 'all';
// The WATCH/PLAY scope toggle. 'foxx' (default) = covered Sharp Foxx broadcasts
// only; 'all' also surfaces ingested feed games, rendered as the quieter,
// play-only card. It maps to the coverage query param, so this is a server
// filter like the rest -- isFeedEvent still picks the CARD, which is rendering,
// not filtering. See THE RULE in api.ts (isCoveredEvent/isFeedEvent).
type Scope = 'foxx' | 'all';

// Unlike the feed's date-only thumbnails, a schedule has to answer "tonight?" —
// so the tip-off time is part of the card, not just the date. Labelled ET: this
// is the whole reason a fan is on this page.
function formatWhen(iso: string): string {
  return etDateTime(iso, { zone: true }) || iso;
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
//
// THE BOUNDARIES ARE ET MIDNIGHTS, not the browser's. These chips build the
// dateFrom/dateTo the server filters on, so anchoring them to local midnight
// made "this week" a DIFFERENT SET OF GAMES per viewer: a fan in LA got a window
// running three hours behind a fan in New York, and a late Sunday game sat
// inside one and outside the other. The schedule is one schedule.
function windowRange(win: Window, tab: Tab): { dateFrom?: string; dateTo?: string } {
  if (win === 'all') return {};
  const days = win === 'week' ? 7 : 30;
  const now = new Date();
  const today = etDateKey(now.toISOString());
  if (!today) return {};

  if (tab === 'upcoming') {
    const from = etWallClockToIso(`${today}T00:00:00`);
    const to = etWallClockToIso(`${shiftDays(today, days)}T23:59:59`);
    return from && to ? { dateFrom: from, dateTo: to } : {};
  }

  const from = etWallClockToIso(`${shiftDays(today, -days)}T00:00:00`);
  return from ? { dateFrom: from, dateTo: now.toISOString() } : {};
}

// Add (or subtract) days on a bare 'YYYY-MM-DD'. Done in UTC on purpose: this
// touches no instant, so it walks the calendar without a DST offset ever
// entering the arithmetic. The result goes back through etWallClockToIso, which
// is where the ET offset for that particular day gets applied.
function shiftDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ---- Feed game card (source != null): the QUIETER, play-only variant shown
// under "All games". No Watch affordance and no video-implying live pulse card --
// these are ingested scores, contest material for picks, not a Sharp Foxx
// broadcast. A muted "Scores" tag stands in for the watch treatment; a live feed
// game still gets the subtle LIVE text pill (a status, not a stream). Same tcard
// shell so the grid stays uniform; the .playcard/.gamescope-* scope knocks it
// back. See THE RULE in api.ts. ----
function FeedGameCard({ event, picks }: { event: EventListItem; picks: GamePicks }) {
  const home = event.homeTeam ?? 'TBD';
  const away = event.awayTeam ?? 'TBD';
  const hasScore = event.homeScore !== null && event.awayScore !== null;
  const isLive = event.status === 'live';

  return (
    <article className="tcard playcard">
      <Link
        className="tcard-open"
        href={`/games/${event.id}`}
        aria-label={`View ${home} vs ${away} scores`}
      >
        <div className={`${thumbClass(event.sport)} gamescope-feedthumb`}>
          <span className="thumb-tag">{event.sport ?? 'event'}</span>
          {/* Subtle LIVE text pill only -- never the Watch affordance. */}
          {isLive && <LiveBadge className="thumb-live" />}
          <span className="gamescope-scorestag">Scores</span>
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
      {/* OUTSIDE THE <Link>, AND IT HAS TO BE: the whole card above is one
          anchor, and a <button> nested inside an <a> is invalid markup that
          breaks the tap target on iOS. The strip is a sibling; it renders null
          when this game carries no question. */}
      <GamePickStrip eventId={event.id} picks={picks} />
    </article>
  );
}

// ---- Game card: the feed's GameCard markup verbatim, so the schedule reads as
// the same design language as everything else fans see. The gradient block IS
// the visual; score replaces "vs" once a result is in, and the whole card links
// to the game's page at /games/[id]. A feed game (source != null) is a play
// surface, so it renders the quieter FeedGameCard instead. ----
function GameCard({ event, picks }: { event: EventListItem; picks: GamePicks }) {
  if (isFeedEvent(event.source)) return <FeedGameCard event={event} picks={picks} />;
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
      {/* Sibling of the <Link>, not inside it -- see FeedGameCard. */}
      <GamePickStrip eventId={event.id} picks={picks} />
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
  // Covered-only by default; ?scope=all opts into feed games too.
  const [scope, setScope] = useState<Scope>(
    params.get('scope') === 'all' ? 'all' : 'foxx',
  );

  const [items, setItems] = useState<EventListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Recent finals, loaded only when the unfiltered Upcoming tab is empty (see
  // the file header). null = not in fallback mode.
  const [fallback, setFallback] = useState<EventListItem[] | null>(null);
  // The API answered an Upcoming request WITHOUT confirming upcomingOnly, which
  // means it's a build that predates the parameter: the unknown query key was
  // stripped and we were handed the wider list with a 200. The rows are real,
  // but stale never-closed games are back in them (sorted first, at that), so
  // the tab is lying about what it's showing unless we say so. Detection only --
  // the client can't re-filter, because paging happened server-side and the
  // stale rows already consumed slots in this page.
  const [unfilteredUpcoming, setUnfilteredUpcoming] = useState(false);
  // The same skew, for the coverage filter: we asked for Sharp Foxx games and
  // the API didn't confirm it, so this is a build that predates the parameter
  // and stripped it. Every row it sent is real, but feed games are mixed in and
  // `total` counts them. Detection only, for the same reason as above -- the
  // rows we'd want gone already consumed slots in this server-built page.
  const [unfilteredCoverage, setUnfilteredCoverage] = useState(false);

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
    if (scope !== 'foxx') qs.set('scope', scope);
    const s = qs.toString();
    router.replace(s ? `/games?${s}` : '/games', { scroll: false });
  }, [router, tab, sport, stateCode, win, scope]);

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
        // Upcoming only: Results wants finals, which have no stale bucket to
        // trim. windowRange already floors Upcoming at the START of today so
        // live games survive the date filter; upcomingOnly does the finer cut
        // the date filter can't, scoped to scheduled rows alone.
        const wantsUpcomingOnly = tab === 'upcoming';
        // The scope toggle is a SERVER filter: GET /events takes coverage, so
        // the narrowing happens before paging and `total` counts what the user
        // asked for. Under 'all' we send nothing -- that's the server default,
        // and asking for nothing can't come back wrong.
        const wantsCoverage = scope === 'foxx' ? 'covered' : undefined;
        const page = await getGames(token, {
          status: tab === 'upcoming' ? 'scheduled,live' : 'final',
          sport: sport || undefined,
          state: stateCode || undefined,
          ...range,
          upcomingOnly: wantsUpcomingOnly || undefined,
          coverage: wantsCoverage,
          limit: PAGE_SIZE,
          offset,
        });
        if (!current()) return;
        // Only meaningful when we ASKED: on Results the key is legitimately
        // absent and means nothing. Re-evaluated on every page, including Show
        // more, so a mid-session rollout can only make the banner more accurate.
        setUnfilteredUpcoming(
          wantsUpcomingOnly && page.applied?.upcomingOnly !== true,
        );
        // Compare the echoed VALUE, never `'coverage' in applied` -- see the
        // note on GamesPage. Under 'all' there's nothing to confirm.
        setUnfilteredCoverage(
          wantsCoverage !== undefined && page.applied?.coverage !== wantsCoverage,
        );
        setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setTotal(page.total);

        // Nothing upcoming and nothing filtered away: show recent finals instead
        // of a blank page. Only worth asking on the first page of an unfiltered
        // Upcoming tab — every other empty result is one the user asked for.
        if (offset === 0 && tab === 'upcoming' && !hasFilters && page.total === 0) {
          // Same scope as the list it stands in for: offering feed scores under
          // the Sharp Foxx toggle would answer a question nobody asked.
          const recent = await getGames(token, {
            status: 'final',
            coverage: wantsCoverage,
            limit: PAGE_SIZE,
          });
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
    [token, tab, sport, stateCode, win, scope, hasFilters],
  );

  // Refetch from the top whenever the query changes (`load`'s identity is the
  // filter set). Show more calls load(offset) directly and skips this.
  useEffect(() => {
    if (!token || !allowed) return;
    load(0);
  }, [token, allowed, load]);

  // ---- CASUAL PICKING. One request for the whole page (see game-pick-strip.tsx),
  // keyed on the rows currently rendered -- so a "Show more" widens the set and
  // costs one more read rather than one per new card.
  //
  // `items` only, not the recent-finals fallback: that list is finals, and the
  // batch read returns open and locked questions alone. Asking about twenty
  // settled games would be a request whose answer is always empty.
  //
  // Called ABOVE the token/permission early-returns because hooks cannot be
  // conditional; the hook itself declines to fetch without a token or ids.
  const pickEventIds = useMemo(() => items.map((ev) => ev.id), [items]);
  const picks = useGamePicks(token ?? '', pickEventIds);

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

  // Scope narrows on the SERVER (coverage=covered), so `items` is already the
  // list to render and `total` already counts it -- there is nothing left to
  // filter here. Nothing between the response and the grid drops rows, which is
  // what makes "Show more" and "X of Y" mean what they say.
  const fallbackItems = fallback ?? [];

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
        {/* NO STANDFIRST. "Every game we cover — live now, coming up, and just
            played" was a description of the two tabs sitting directly beneath
            it, which the tabs make in one word each and make truthfully. A line
            that only restates the controls under it is furniture. */}
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

      {/* WATCH/PLAY scope toggle: Sharp Foxx broadcasts (default) vs. every game
          incl. ingested feed scores. Compact chips, URL-synced like the rest. */}
      <div
        className="gamescope-toggle"
        role="group"
        aria-label="Which games to show"
      >
        {([
          ['foxx', 'Sharp Foxx'],
          ['all', 'All games'],
        ] as Array<[Scope, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`chip${scope === value ? ' chip--on' : ''}`}
            aria-pressed={scope === value}
            onClick={() => setScope(value)}
          >
            {label}
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

      {/* Not an error -- the request succeeded and these rows are real -- but the
          list is wider than the tab asked for, which is exactly what .notice is
          for. Says what's actually wrong with the list rather than blaming the
          data ("no games scheduled" would be a lie in the other direction). */}
      {unfilteredUpcoming && !error && (
        <div className="notice">
          Showing every scheduled game, including ones whose start time has
          already passed — this API build doesn&apos;t support the upcoming-only
          filter, so games that were never closed out may appear here, sorted
          first. Refresh once the API finishes deploying.
        </div>
      )}

      {unfilteredCoverage && !error && (
        <div className="notice">
          Showing every game, not just Sharp Foxx ones — this API build
          doesn&apos;t support the coverage filter, so external feed scores are
          mixed in below and counted in the total. Refresh once the API finishes
          deploying.
        </div>
      )}

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
                  {fallbackItems.length > 0 ? (
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
              {fallbackItems.length > 0 && (
                <>
                  <h2 className="row-title gamesdir-fallback-title">Recent results</h2>
                  <div className="results-grid">
                    {fallbackItems.map((ev) => (
                      <GameCard key={ev.id} event={ev} picks={picks} />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {/* Straight off `total` — the server counted what it filtered. */}
              <p className="result-count">
                {`${total.toLocaleString()} ${scope === 'foxx' ? 'Sharp Foxx ' : ''}${
                  total === 1 ? noun : `${noun}s`
                }${hasFilters ? ' match your filters' : ''}`}
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
                <div className="results-grid">
                  {items.map((ev) => (
                    <GameCard key={ev.id} event={ev} picks={picks} />
                  ))}
                </div>
              )}

              {/* OUTSIDE the non-empty branch on purpose. "More rows exist than
                  we've loaded" is a fact about the response, not about whether
                  this page happened to render any — nesting it under the grid
                  makes an empty page the end of the list, with the button that
                  would fix it hidden by the condition it needs to clear. */}
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
                    {`Showing ${items.length} of ${total.toLocaleString()}`}
                  </span>
                </div>
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
