'use client';

import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { AppNav } from '../nav';
import {
  getPublishedContent,
  getEvents,
  FeedItem,
  EventListItem,
} from '../api';

// Format the timestamptz string the API returns; fall back to the raw value if
// it somehow doesn't parse. Date-only for compact thumbnail metadata.
function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { dateStyle: 'medium' });
}

// Full date + time — used in the article reader byline.
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
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

// ---- A YouTube-style row: title + horizontally scrolling track of cards. ----
function Row({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="row">
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
// beneath. Clicking opens the reader (keeps the read-the-body behavior). ----
function ArticleThumb({
  item,
  onOpen,
}: {
  item: FeedItem;
  onOpen: () => void;
}) {
  const meta = [item.author, item.eventSport, formatDate(item.publishedAt)].filter(
    Boolean,
  );

  return (
    <article className="tcard">
      <button
        className="tcard-open"
        onClick={onOpen}
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
      </button>
    </article>
  );
}

// ---- Coming-soon placeholder card: shows the vision without fake data. ----
function ComingSoonCard() {
  return (
    <article className="tcard tcard--soon" aria-hidden="true">
      <div className="thumb thumb--soon">
        <span className="thumb-soon-label">Coming soon</span>
      </div>
      <div className="tcard-body">
        <div className="tcard-meta">
          <span className="tcard-meta__seg">Personalized picks</span>
        </div>
      </div>
    </article>
  );
}

// ---- Article reader: modal overlay that renders the trusted HTML body via
// dangerouslySetInnerHTML (same pipeline/behavior as the old inline card). ----
function ArticleReader({
  item,
  onClose,
}: {
  item: FeedItem;
  onClose: () => void;
}) {
  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const matchup =
    item.homeTeam && item.awayTeam ? `${item.awayTeam} @ ${item.homeTeam}` : null;
  const meta = [
    item.author,
    item.eventSport,
    matchup,
    formatWhen(item.publishedAt),
  ].filter(Boolean);

  return (
    <div className="reader-overlay" onClick={onClose}>
      <div
        className="reader"
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="reader-close" onClick={onClose} aria-label="Close article">
          ✕
        </button>
        <span className="story-kicker">{item.eventSport ?? 'Feature'}</span>
        <h1 className="reader-title">{item.title}</h1>
        <div className="story-meta reader-meta">
          {meta.map((seg, i) => (
            <span key={i} className="story-meta__seg">
              {seg}
            </span>
          ))}
        </div>
        <div
          className="article-body"
          dangerouslySetInnerHTML={{ __html: item.body }}
        />
      </div>
    </div>
  );
}

export default function FeedPage() {
  const router = useRouter();
  const { token, user } = useAuth();

  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const [articles, setArticles] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Which article is open in the reader (null = closed).
  const [active, setActive] = useState<FeedItem | null>(null);

  // Active sport filter (ALL = show everything). Client-side over fetched data.
  const [sport, setSport] = useState<string>(ALL);

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
        <AppNav />
      </div>

      <SearchBar />

      {!loading && !error && availableSports.length > 0 && (
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

      {loading && <div className="card muted">Loading feed…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && (
        <>
          {liveEvents.length > 0 && (
            <Row title="Live Now">
              {liveEvents.map((ev) => (
                <GameCard key={ev.id} event={ev} />
              ))}
            </Row>
          )}

          <Row title="Upcoming Games">
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

          {resultEvents.length > 0 && (
            <Row title="Recent Results">
              {resultEvents.map((ev) => (
                <GameCard key={ev.id} event={ev} />
              ))}
            </Row>
          )}

          <Row title="Latest Articles">
            {visibleArticles.length > 0 ? (
              visibleArticles.map((item) => (
                <ArticleThumb
                  key={item.id}
                  item={item}
                  onOpen={() => setActive(item)}
                />
              ))
            ) : (
              <div className="row-empty">
                {sport === ALL
                  ? 'No published articles yet'
                  : `No articles for ${sport}`}
              </div>
            )}
          </Row>

          <Row title="Recommended for you">
            {Array.from({ length: 5 }).map((_, i) => (
              <ComingSoonCard key={i} />
            ))}
          </Row>
        </>
      )}

      {active && (
        <ArticleReader item={active} onClose={() => setActive(null)} />
      )}
    </main>
  );
}
