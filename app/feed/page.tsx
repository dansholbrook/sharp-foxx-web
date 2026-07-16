'use client';

import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { useFollows } from '../follows-context';
import { FollowButton } from '../follow-button';
import { AppNav } from '../nav';
import { YourPicksBand, NationalBoardBand, OpenGamesBand } from '../feed-picks';
import {
  getPublishedContent,
  getEvents,
  getFollowFeed,
  getFollowSuggestions,
  followTargetId,
  followTargetName,
  FeedItem,
  EventListItem,
  FollowMineEntry,
  FollowSuggestion,
  FollowFeedEntry,
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

      <h3 className="follow-subhead">From your follows</h3>
      {shown.length > 0 ? (
        <div className="row-track">
          {shown.map((entry) =>
            entry.kind === 'game' ? (
              <FollowGameCard key={`g-${entry.id}`} entry={entry} />
            ) : (
              <FollowArticleCard key={`a-${entry.id}`} entry={entry} />
            ),
          )}
        </div>
      ) : (
        <div className="row-empty">
          New games and articles from teams and athletes you follow will show up
          here.
        </div>
      )}
      {feed.length > FOLLOW_FEED_CAP && (
        <button
          type="button"
          className="show-all"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : `Show all (${feed.length})`}
        </button>
      )}
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

      {/* Your own points, first: what's still riding and what just landed. Above
          the follows band on purpose — a fan with points in play wants that
          before anything else on the page. Hides itself entirely when there's
          nothing in play, so a fan who has never picked sees the feed unchanged.
          Takes the events this page ALREADY fetched: /predictions/my-picks
          carries no game status, and this saves a read per pick. */}
      <YourPicksBand token={token} events={events ?? []} />

      {/* Personalized band — the real "following" experience. Renders once the
          shared follows membership has loaded; picks Following vs Suggested. */}
      {followsLoaded && (
        <FollowingSection
          mine={mine}
          followFeed={followFeed}
          suggestions={suggestions}
        />
      )}

      {/* The National Board — house questions, pickable right here. This band IS
          the surface (there's no /national page), so it sits below the follows
          band but above the browse rows: it's a thing to DO, not a thing to
          read. */}
      <NationalBoardBand token={token} />

      {/* …and the games with questions open right now. Followed teams sort
          first when the shared follows are already loaded — no extra fetch. */}
      <OpenGamesBand token={token} follows={followsLoaded ? mine : []} />

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
        </>
      )}
    </main>
  );
}
