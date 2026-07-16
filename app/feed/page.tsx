'use client';

import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { useFollows } from '../follows-context';
import { usePoints } from '../points-context';
import { FollowButton } from '../follow-button';
import { FanCard } from '../fan-card';
import { AppNav } from '../nav';
import { YourPicksBand, NationalBoardBand, OpenGamesBand } from '../feed-picks';
import {
  getPublishedContent,
  getEvents,
  getFollowFeed,
  getFollowSuggestions,
  getPointsLeaderboard,
  followTargetId,
  followTargetName,
  points,
  FeedItem,
  EventListItem,
  FollowMineEntry,
  FollowSuggestion,
  FollowFeedEntry,
  LeaderboardEntry,
  PointsLeaderboard,
} from '../api';

// Format the timestamptz string the API returns; fall back to the raw value if
// it somehow doesn't parse. Date-only for compact thumbnail metadata.
function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { dateStyle: 'medium' });
}

// The shared pulsing LIVE badge (dot + wordmark) — same scoped .live-badge
// treatment used on the game page, search cards, and the rail.
function LiveBadge({ className }: { className?: string }) {
  return (
    <span className={`live-badge${className ? ` ${className}` : ''}`}>
      <span className="live-badge__dot" aria-hidden="true" />
      Live
    </span>
  );
}

// Sport -> thumbnail gradient class. The card itself is the artwork (there are
// no real images), so each sport gets its own branded, gold-anchored gradient.
// Unknown/missing sports fall back to the neutral 'other' treatment.
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

// The special "all sports" sentinel for the sport filter chips (mirrors /search).
const ALL = 'all';

// ---- Search bar: renders prominently; submit navigates to /search (built
// later). The query is passed along so that page can pick it up. ----
function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = q.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search');
  }

  return (
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
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search games, teams, sports…"
        aria-label="Search games, teams, sports"
      />
      <button className="feed-search__btn" type="submit">
        Search
      </button>
    </form>
  );
}

// ---- A YouTube-style row: title + horizontally scrolling track of cards. The
// optional className lets the games hero flag its Live/Upcoming rows for the
// larger, first-impression sizing without a second component. ----
function Row({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`row${className ? ` ${className}` : ''}`}>
      <h2 className="row-title">{title}</h2>
      <div className="row-track">{children}</div>
    </section>
  );
}

// ---- Game thumbnail card: the gradient block IS the visual. Matchup front and
// center, venue + date beneath. When a result is in, the score replaces the
// "vs" and a FINAL badge shows; when a replay link is set, a watch indicator
// appears. The whole card links to the game's watch page at /games/[id]. ----
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
            {event.venue && (
              <span className="tcard-meta__seg">{event.venue}</span>
            )}
            <span className="tcard-meta__seg">
              {formatDate(event.scheduledAt)}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

// ---- Article thumbnail card: branded block with the title; author/sport/date
// beneath. The whole card links to the article's own page at /articles/[id]. ----
function ArticleThumb({ item }: { item: FeedItem }) {
  const meta = [item.author, item.eventSport, formatDate(item.publishedAt)].filter(
    Boolean,
  );

  return (
    <article className="tcard">
      <Link
        className="tcard-open"
        href={`/articles/${item.id}`}
        aria-label={`Read article: ${item.title}`}
      >
        <div className={`${thumbClass(item.eventSport)} thumb--article`}>
          <span className="thumb-tag">{item.eventSport ?? 'Feature'}</span>
          <h3 className="thumb-headline">{item.title}</h3>
        </div>
        <div className="tcard-body">
          <div className="tcard-meta">
            {meta.map((seg, i) => (
              <span key={i} className="tcard-meta__seg">
                {seg}
              </span>
            ))}
          </div>
        </div>
      </Link>
    </article>
  );
}

// ---- Follows experience ----------------------------------------------------
// The homepage's personalized band: a carousel of who you follow + a "From your
// follows" content row, or a "Suggested for you" row when you follow nobody yet.

// Up to two initials from a "First Last" (or single-word) display name.
function followInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return `${first}${last}`.toUpperCase() || '—';
}

// Where a followed/suggested target links (correspondents have no page yet).
function followHref(
  entry: FollowMineEntry | FollowSuggestion,
): string | null {
  if (entry.targetType === 'athlete') return `/athletes/${entry.athleteId}`;
  if (entry.targetType === 'team') return `/teams/${entry.teamId}`;
  return null;
}

// Avatar (athletes with a photo) or a monogram disc (teams, correspondents, or
// avatar-less athletes). Sized by the caller via a modifier class.
function FollowDisc({
  entry,
  size,
}: {
  entry: FollowMineEntry | FollowSuggestion;
  size: 'lg' | 'sm';
}) {
  const name = followTargetName(entry);
  const avatarUrl = entry.targetType === 'athlete' ? entry.avatarUrl : null;
  return (
    <span
      className={`follow-disc follow-disc--${size} follow-disc--${entry.targetType}`}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} loading="lazy" className="follow-disc__img" />
      ) : (
        <span className="follow-disc__mono" aria-hidden="true">
          {followInitials(name)}
        </span>
      )}
    </span>
  );
}

// One tile in the "Following" carousel — disc + name, linking to the page.
function CarouselItem({ entry }: { entry: FollowMineEntry }) {
  const name = followTargetName(entry);
  const href = followHref(entry);
  const inner = (
    <>
      <FollowDisc entry={entry} size="lg" />
      <span className="follow-carousel__name">{name}</span>
    </>
  );
  return href ? (
    <Link href={href} className="follow-carousel__item">
      {inner}
    </Link>
  ) : (
    <span className="follow-carousel__item follow-carousel__item--nolink">
      {inner}
    </span>
  );
}

// A compact suggestion in the "Suggested" strip shown beneath the carousel.
function SuggestionChip({ s }: { s: FollowSuggestion }) {
  const name = followTargetName(s);
  const href = followHref(s);
  return (
    <div className="follow-sugchip">
      <FollowDisc entry={s} size="sm" />
      <div className="follow-sugchip__body">
        {href ? (
          <Link href={href} className="follow-sugchip__name">
            {name}
          </Link>
        ) : (
          <span className="follow-sugchip__name">{name}</span>
        )}
        <span className="follow-sugchip__reason">{s.reason}</span>
      </div>
      <FollowButton entry={s} showCount={false} size="sm" />
    </div>
  );
}

// A full suggestion card for the empty-state "Suggested for you" row.
function SuggestionCard({ s }: { s: FollowSuggestion }) {
  const name = followTargetName(s);
  const href = followHref(s);
  return (
    <article className="follow-sugcard">
      <FollowDisc entry={s} size="lg" />
      {href ? (
        <Link href={href} className="follow-sugcard__name">
          {name}
        </Link>
      ) : (
        <span className="follow-sugcard__name">{name}</span>
      )}
      <span className="follow-sugcard__reason">{s.reason}</span>
      <FollowButton entry={s} showCount={false} size="sm" />
    </article>
  );
}

// A game from your follows: matchup, a live/final/score pill, and a "via …"
// source tag. Links to the game watch page.
function FollowGameCard({ entry }: { entry: Extract<FollowFeedEntry, { kind: 'game' }> }) {
  const hasScore = entry.homeScore !== null && entry.awayScore !== null;
  const isLive = entry.status === 'live';
  const isFinal = entry.status === 'final';
  return (
    <Link href={`/games/${entry.id}`} className="ffeed-card">
      <div className="ffeed-card__top">
        {isLive ? (
          <LiveBadge />
        ) : isFinal ? (
          <span className="ffeed-pill">Final</span>
        ) : (
          <span className="ffeed-pill ffeed-pill--soon">Upcoming</span>
        )}
        {hasScore && (
          <span className="ffeed-card__score">
            {entry.homeScore} – {entry.awayScore}
          </span>
        )}
      </div>
      <div className="ffeed-card__matchup">{entry.matchup}</div>
      <div className="ffeed-card__meta">
        <span className="ffeed-card__src">via {entry.source.name}</span>
        <span className="ffeed-card__date">{formatDate(entry.scheduledAt)}</span>
      </div>
    </Link>
  );
}

// An article from your follows: title, date, and a "via …" source tag. Links to
// the article page.
function FollowArticleCard({
  entry,
}: {
  entry: Extract<FollowFeedEntry, { kind: 'article' }>;
}) {
  return (
    <Link href={`/articles/${entry.id}`} className="ffeed-card ffeed-card--article">
      <span className="ffeed-card__kind">Article</span>
      <div className="ffeed-card__title">{entry.title}</div>
      <div className="ffeed-card__meta">
        <span className="ffeed-card__src">via {entry.source.name}</span>
        {entry.publishedAt && (
          <span className="ffeed-card__date">{formatDate(entry.publishedAt)}</span>
        )}
      </div>
    </Link>
  );
}

// How many "From your follows" cards to show before the Show-more expander.
const FOLLOW_FEED_CAP = 8;

// The whole personalized band. Chooses Following vs Suggested from the shared
// follows membership; renders nothing until that has loaded, and nothing in the
// empty state when there aren't even suggestions to offer.
function FollowingSection({
  mine,
  followFeed,
  suggestions,
}: {
  mine: FollowMineEntry[];
  followFeed: FollowFeedEntry[] | null;
  suggestions: FollowSuggestion[] | null;
}) {
  const [expanded, setExpanded] = useState(false);

  // Empty state -> "Suggested for you" (or nothing to show at all).
  if (mine.length === 0) {
    const sugs = suggestions ?? [];
    if (sugs.length === 0) return null;
    return (
      <section className="row follow-section">
        <h2 className="row-title">Suggested for you</h2>
        <p className="follow-sub">
          Follow athletes and teams to build your personalized feed.
        </p>
        <div className="row-track follow-sugrow">
          {sugs.map((s) => (
            <SuggestionCard
              key={`${s.targetType}:${followTargetId(s)}`}
              s={s}
            />
          ))}
        </div>
      </section>
    );
  }

  // Following state -> carousel + optional Suggested strip + content row.
  const feed = followFeed ?? [];
  const shown = expanded ? feed : feed.slice(0, FOLLOW_FEED_CAP);
  const stripSuggestions = (suggestions ?? []).slice(0, 5);

  return (
    <section className="row follow-section">
      <h2 className="row-title">Following</h2>
      <div className="row-track follow-carousel">
        {mine.map((e) => (
          <CarouselItem key={`${e.targetType}:${followTargetId(e)}`} entry={e} />
        ))}
      </div>

      {stripSuggestions.length > 0 && (
        <div className="follow-sugstrip">
          <span className="follow-sugstrip__label">Suggested</span>
          <div className="follow-sugstrip__track">
            {stripSuggestions.map((s) => (
              <SuggestionChip
                key={`${s.targetType}:${followTargetId(s)}`}
                s={s}
              />
            ))}
          </div>
        </div>
      )}

      {/* "From your follows" only exists when there's something in it. The old
          placeholder copy is gone on purpose — on a dashboard an empty section
          reads as dead weight, so the whole subhead + track hide until a
          followed team or athlete actually has a game or article to show. */}
      {shown.length > 0 && (
        <>
          <h3 className="follow-subhead">From your follows</h3>
          <div className="row-track">
            {shown.map((entry) =>
              entry.kind === 'game' ? (
                <FollowGameCard key={`g-${entry.id}`} entry={entry} />
              ) : (
                <FollowArticleCard key={`a-${entry.id}`} entry={entry} />
              ),
            )}
          </div>
          {feed.length > FOLLOW_FEED_CAP && (
            <button
              type="button"
              className="show-all"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Show less' : `Show all (${feed.length})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ---- Right rail: the points economy -------------------------------------
// New markup, no new data — the rail is a layout of things this page (and its
// shared contexts) already hold.

// Medal for the podium, plain number otherwise. Same treatment /leaderboard
// uses on its own rows, kept local since it's three lines and the board page's
// copy isn't exported.
function railRank(rank: number | null): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return rank === null ? '—' : `${rank}`;
}

// POINTS HERO: the fan's balance, large, with the lifetime score under it and
// the two doors into the points surfaces. Balance + lifetime both come from the
// shared wallet (points-context), which loaded them together from the one
// /predictions/my-picks read it already makes.
//
// Renders for EVERY role — staff pick too — and shows the starting state
// gracefully: a fan with no wallet row reads back the untouched 1,000-point
// grant, so there's no "no points" empty state to guard. It shows nothing only
// while the wallet is still in flight (balance null), so it never flashes a
// wrong zero.
function PointsHero() {
  const { balance, lifetimeEarned } = usePoints();
  if (balance === null) return null;
  return (
    <section className="frail-points">
      <span className="frail-points__label">Your points</span>
      <div className="frail-points__balance">
        <span className="frail-points__bolt" aria-hidden="true">
          ⚡
        </span>
        <span className="frail-points__value">{points(balance)}</span>
        <span className="frail-points__unit">pts</span>
      </div>
      {lifetimeEarned !== null && (
        <span className="frail-points__lifetime">
          {points(lifetimeEarned)} pts won all-time
        </span>
      )}
      <div className="frail-points__links">
        <Link href="/picks" className="frail-points__link">
          My picks →
        </Link>
        <Link href="/leaderboard" className="frail-points__link">
          Leaderboard →
        </Link>
      </div>
    </section>
  );
}

// LEADERBOARD TEASER: the top five off the global board, each row opening the
// same fan card the full /leaderboard opens (the component is exported and
// self-contained, so it's cheap to reuse here). Hides entirely when the board
// hasn't loaded or nobody's on it yet.
function LeaderboardTeaser({
  board,
  meId,
  onOpen,
}: {
  board: PointsLeaderboard | null;
  meId: string | undefined;
  onOpen: (entry: LeaderboardEntry) => void;
}) {
  if (!board || board.top.length === 0) return null;
  const top5 = board.top.slice(0, 5);
  return (
    <section className="frail-lb">
      <div className="feedpicks__head">
        <h2 className="row-title">Leaderboard</h2>
        <Link href="/leaderboard" className="feedpicks__all">
          Full leaderboard →
        </Link>
      </div>
      <ol className="frail-lb__list">
        {top5.map((entry) => (
          <li
            key={entry.userId}
            className={`frail-lb__row${
              entry.userId === meId ? ' frail-lb__row--me' : ''
            }`}
          >
            <span className="frail-lb__rank">{railRank(entry.rank)}</span>
            <button
              type="button"
              className="frail-lb__name fancard-open"
              aria-haspopup="dialog"
              onClick={() => onOpen(entry)}
            >
              {entry.displayName ?? 'You'}
            </button>
            <span className="frail-lb__score">
              {points(entry.score)}
              <span className="frail-lb__unit">pts</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function FeedPage() {
  const router = useRouter();
  const { token, user } = useAuth();
  const { mine, loaded: followsLoaded } = useFollows();

  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const [articles, setArticles] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The personalized band's data — loaded separately from the browse rows and
  // re-fetched whenever the set of follows changes (follow/unfollow), so "From
  // your follows" and the suggestions stay in sync after a toggle.
  const [followFeed, setFollowFeed] = useState<FollowFeedEntry[] | null>(null);
  const [suggestions, setSuggestions] = useState<FollowSuggestion[] | null>(null);

  // The rail's leaderboard teaser: the global board, best-effort (a failure just
  // hides the teaser). Held whole so its `me.userId` can flag the caller's own
  // row and title the fan card the way /leaderboard does.
  const [board, setBoard] = useState<PointsLeaderboard | null>(null);
  // The fan whose card is open from a teaser row, held as the entry so the card
  // titles itself instantly. Mounting the card IS opening it — null = closed.
  const [openFan, setOpenFan] = useState<LeaderboardEntry | null>(null);

  // Active sport filter (ALL = show everything). Client-side over fetched data.
  const [sport, setSport] = useState<string>(ALL);

  // A stable signature of the current follows so the personalized fetch below
  // re-runs on follow/unfollow (membership changes) but not on every render.
  const followsSignature = useMemo(
    () =>
      mine
        .map((e) => `${e.targetType}:${followTargetId(e)}`)
        .sort()
        .join(','),
    [mine],
  );

  // No token in memory (e.g. after a page refresh) -> back to login.
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
        // Both rows load together; if only one fails we still show the other.
        // Fetch every event (not just scheduled) so finished games -- the ones
        // that carry a replay videoUrl -- reach the "Recent Results" row and
        // render as clickable video cards. Filtering to scheduled here would
        // strip out every game with a video (they're all status 'final').
        const [ev, art] = await Promise.all([
          getEvents(token),
          getPublishedContent(token),
        ]);
        if (!cancelled) {
          setEvents(ev);
          setArticles(art);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load feed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  // Personalized band: the follows feed + suggestions. Best-effort (a failure
  // just hides the band), and keyed on followsSignature so a follow/unfollow
  // refreshes it. followsLoaded gates the first run so we don't fetch before we
  // know whether the user follows anything.
  useEffect(() => {
    if (!token || !followsLoaded) return;
    let cancelled = false;
    (async () => {
      const [feed, sugs] = await Promise.all([
        getFollowFeed(token).catch(() => [] as FollowFeedEntry[]),
        getFollowSuggestions(token).catch(() => [] as FollowSuggestion[]),
      ]);
      if (!cancelled) {
        setFollowFeed(feed);
        setSuggestions(sugs);
      }
    })();
    return () => {
      cancelled = true;
    };
    // followsSignature stands in for the identity of the follow set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, followsLoaded, followsSignature]);

  // The rail's leaderboard teaser. Best-effort and independent of the browse
  // load — a slow or failed board never holds up the games, and just leaves the
  // teaser hidden. Global scope only; the event board is a game-page concern.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getPointsLeaderboard(token, 'global')
      .then((data) => {
        if (!cancelled) setBoard(data);
      })
      .catch(() => {
        // Silent: the teaser is an addition to a feed that works without it.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Sports present across BOTH rows — the union drives which chips to show.
  // Games carry a non-null sport enum; articles carry a nullable eventSport.
  // Sorted for a stable chip order.
  const availableSports = useMemo(() => {
    const set = new Set<string>();
    for (const ev of events ?? []) set.add(ev.sport);
    for (const item of articles ?? []) {
      if (item.eventSport) set.add(item.eventSport);
    }
    return Array.from(set).sort();
  }, [events, articles]);

  // Narrow each row by the selected sport (ALL passes everything through).
  const visibleEvents = (events ?? []).filter(
    (ev) => sport === ALL || ev.sport === sport,
  );
  // Live = in progress right now (its own row above Upcoming); Upcoming =
  // scheduled/not-yet-started (excludes live so a game shows in one row, not
  // two); Results = finished games, which carry a replay videoUrl and open the
  // watch page on click.
  const liveEvents = visibleEvents.filter((ev) => ev.status === 'live');
  const upcomingEvents = visibleEvents.filter(
    (ev) => ev.status !== 'final' && ev.status !== 'live',
  );
  const resultEvents = visibleEvents.filter((ev) => ev.status === 'final');
  const visibleArticles = (articles ?? []).filter(
    (item) => sport === ALL || item.eventSport === sport,
  );

  if (!token) return null;

  return (
    <main className="feed-home feed-dash">
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

      <SearchBar />

      {error && <div className="error">{error}</div>}

      {/* Two columns on desktop, one interleaved column on mobile. The .fmain /
          .frail wrappers are real elements at desktop (the rail is the sticky
          one) and `display: contents` below ~1024px, so every section becomes a
          direct grid item there and CSS `order` alone weaves them into the
          points-first mobile sequence — no duplicated markup. */}
      <div className="fgrid">
        {/* ---- MAIN COLUMN ---- */}
        <div className="fmain">
          {/* HERO: the live/upcoming games are the first thing on the page. The
              sport chips ride with them since they filter the games (and the
              articles down in the tail). */}
          <section className="fmain-hero">
            {!loading && !error && availableSports.length > 0 && (
              <div
                className="filter-row"
                role="group"
                aria-label="Filter by sport"
              >
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

            {loading && <div className="card muted">Loading games…</div>}

            {!loading && liveEvents.length > 0 && (
              <Row title="Live Now" className="fmain-live">
                {liveEvents.map((ev) => (
                  <GameCard key={ev.id} event={ev} />
                ))}
              </Row>
            )}

            {!loading && (
              <Row title="Upcoming Games" className="fmain-upcoming">
                {upcomingEvents.length > 0 ? (
                  upcomingEvents.map((ev) => <GameCard key={ev.id} event={ev} />)
                ) : (
                  <div className="row-empty">
                    {sport === ALL
                      ? 'No upcoming games'
                      : `No upcoming games for ${sport}`}
                  </div>
                )}
              </Row>
            )}
          </section>

          {/* FOLLOWING + FROM YOUR FOLLOWS. Renders once the shared follows
              membership has loaded; picks Following vs Suggested and hides the
              "from your follows" track when it's empty. */}
          {followsLoaded && (
            <FollowingSection
              mine={mine}
              followFeed={followFeed}
              suggestions={suggestions}
            />
          )}

          {/* TAIL: results + the article shelf. */}
          <section className="fmain-tail">
            {!loading && resultEvents.length > 0 && (
              <Row title="Recent Results">
                {resultEvents.map((ev) => (
                  <GameCard key={ev.id} event={ev} />
                ))}
              </Row>
            )}

            {!loading && (
              <Row title="Latest Articles">
                {visibleArticles.length > 0 ? (
                  visibleArticles.map((item) => (
                    <ArticleThumb key={item.id} item={item} />
                  ))
                ) : (
                  <div className="row-empty">
                    {sport === ALL
                      ? 'No published articles yet'
                      : `No articles for ${sport}`}
                  </div>
                )}
              </Row>
            )}
          </section>
        </div>

        {/* ---- RIGHT RAIL: the points economy. Sticky with its own scroll on
            desktop; interleaves into the single column on mobile. Every section
            below self-hides when empty, so the rail is never a column of gaps. */}
        <aside className="frail" aria-label="Your points">
          {/* a. POINTS HERO — balance large, lifetime under, the two doors. */}
          <PointsHero />

          {/* b. YOUR PICKS — the pending + just-settled cards, stacked to rail
              width by the .frail-picks scope. Same self-fetching band as before;
              hides itself when there's nothing riding. */}
          <div className="frail-picks">
            <YourPicksBand token={token} events={events ?? []} />
          </div>

          {/* c. NATIONAL BOARD — house questions, pickable right here. The
              PickCards stack one-per-row at rail width; cap-4 + expander kept. */}
          <div className="frail-natboard">
            <NationalBoardBand token={token} />
          </div>

          {/* d. LEADERBOARD TEASER — top five, rows open the real fan card. */}
          <LeaderboardTeaser
            board={board}
            meId={board?.me.userId}
            onOpen={setOpenFan}
          />

          {/* e. MAKE YOUR PICKS — games with a question open now, as compact
              rail rows. Followed teams sort first (no extra fetch). */}
          <div className="frail-open">
            <OpenGamesBand token={token} follows={followsLoaded ? mine : []} />
          </div>
        </aside>
      </div>

      {/* Mounting is opening (SlideOver's contract). Keyed by fan so a second
          click remounts rather than leaving the previous fan under a new title. */}
      {openFan && (
        <FanCard
          key={openFan.userId}
          userId={openFan.userId}
          fallbackName={openFan.displayName}
          isMe={openFan.userId === board?.me.userId}
          onClose={() => setOpenFan(null)}
        />
      )}
    </main>
  );
}
