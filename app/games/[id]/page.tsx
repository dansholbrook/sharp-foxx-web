'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../auth-context';
import { AppNav, AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import {
  getEvents,
  getEventContent,
  getPublishedContent,
  getEventSponsorship,
  EventListItem,
  EventContentItem,
  FeedItem,
  Sponsorship,
} from '../../api';
import { toYouTubeEmbed } from '../../video';

// The shared pulsing LIVE badge (dot + wordmark). Styling/animation live in the
// scoped .live-badge classes in globals.css so it reads identically here, on the
// feed/search cards, and in the rail. `className` lets callers add positioning.
function LiveBadge({ className }: { className?: string }) {
  return (
    <span className={`live-badge${className ? ` ${className}` : ''}`}>
      <span className="live-badge__dot" aria-hidden="true" />
      Live
    </span>
  );
}

// Date-only formatting for compact card metadata (mirrors the feed page).
function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { dateStyle: 'medium' });
}

// Full date + time — used for "Coverage begins" and the upcoming scoreboard line.
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// The published feed (FeedItem) carries no eventId, so to link an article back to
// its game page we match on the joined matchup + scheduled time against the
// events list. Fine at current scale; unresolved articles are simply dropped
// from the rail so every row navigates somewhere real.
function eventKey(
  home: string | null,
  away: string | null,
  scheduledAt: string | null,
): string {
  return `${home ?? ''}|${away ?? ''}|${scheduledAt ?? ''}`;
}

// ---- Video area: the branded top of the main column, always 16:9, never an
// empty player box. A replay embeds (or falls back to an external link); with no
// replay we show a countdown card (upcoming) or a final-score card. ----
function GameVideo({ event }: { event: EventListItem }) {
  const home = event.homeTeam ?? 'TBD';
  const away = event.awayTeam ?? 'TBD';
  const title = `${home} vs ${away}`;
  const isLive = event.status === 'live';
  const embed = event.videoUrl ? toYouTubeEmbed(event.videoUrl) : null;

  if (event.videoUrl) {
    return embed ? (
      // When live, the embed plays as normal with a pulsing LIVE pill pinned to
      // the player corner (a replay shows no pill).
      <div className="game-player">
        {isLive && <LiveBadge className="game-live-pill" />}
        <iframe
          src={embed}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    ) : (
      // A stray non-YouTube replay/stream link — a branded card with a real link
      // out rather than a broken frame.
      <div className="game-coverage">
        <span className="game-coverage__kicker">{isLive ? 'Live' : 'Replay'}</span>
        <span className="game-coverage__matchup">{title}</span>
        <a
          className="video-link"
          href={event.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {isLive ? 'Watch live ↗' : 'Watch video ↗'}
        </a>
      </div>
    );
  }

  // Live but no stream online yet — a branded card with the running score.
  if (isLive) {
    const hasScore = event.homeScore !== null && event.awayScore !== null;
    return (
      <div className="game-coverage">
        <LiveBadge />
        <span className="game-coverage__matchup">{title}</span>
        {hasScore && (
          <span className="game-coverage__score">
            {event.homeScore} — {event.awayScore}
          </span>
        )}
        <span className="game-coverage__detail">
          Live now — stream coming online
        </span>
        {event.venue && (
          <span className="game-coverage__detail game-coverage__detail--venue">
            {event.venue}
          </span>
        )}
      </div>
    );
  }

  if (event.status === 'final') {
    const hasScore = event.homeScore !== null && event.awayScore !== null;
    return (
      <div className="game-coverage">
        <span className="game-coverage__kicker">Final</span>
        <span className="game-coverage__matchup">{title}</span>
        {hasScore && (
          <span className="game-coverage__score">
            {event.homeScore} — {event.awayScore}
          </span>
        )}
        {event.venue && (
          <span className="game-coverage__detail">{event.venue}</span>
        )}
      </div>
    );
  }

  // Scheduled (or postponed with no stream yet) — a countdown card.
  return (
    <div className="game-coverage">
      <span className="game-coverage__kicker">Upcoming</span>
      <span className="game-coverage__matchup">{title}</span>
      <span className="game-coverage__detail">
        Coverage begins {formatWhen(event.scheduledAt)}
      </span>
      {event.venue && (
        <span className="game-coverage__detail game-coverage__detail--venue">
          {event.venue}
        </span>
      )}
    </div>
  );
}

// ---- Scoreboard strip: the visually dominant score line beneath the video. ----
function Scoreboard({ event }: { event: EventListItem }) {
  const home = event.homeTeam ?? 'TBD';
  const away = event.awayTeam ?? 'TBD';
  const hasScore = event.homeScore !== null && event.awayScore !== null;
  const isFinal = event.status === 'final';
  const isLive = event.status === 'live';

  return (
    <div className="game-scoreboard">
      <span className="game-scoreboard__team game-scoreboard__team--home">
        {home}
      </span>
      <span className="game-scoreboard__center">
        {hasScore ? (
          <span className="game-scoreboard__score">
            {event.homeScore} — {event.awayScore}
          </span>
        ) : (
          <span className="game-scoreboard__vs">vs</span>
        )}
        {isLive ? (
          <LiveBadge />
        ) : isFinal ? (
          <span className="pill">Final</span>
        ) : (
          <span className="game-scoreboard__when">
            {formatWhen(event.scheduledAt)}
          </span>
        )}
      </span>
      <span className="game-scoreboard__team game-scoreboard__team--away">
        {away}
      </span>
    </div>
  );
}

// ---- Presenting sponsor strip: a slim gold-bordered band beneath the
// scoreboard, stadium-naming-rights classy. Renders nothing when a game has no
// sponsor (the caller passes null through), never an empty placeholder. ----
function PresentingSponsorStrip({ sponsorship }: { sponsorship: Sponsorship }) {
  return (
    <div className="sponsor-strip">
      <span className="sponsor-strip__label">Presented by</span>
      <span className="sponsor-strip__name">{sponsorship.businessName}</span>
    </div>
  );
}

// ---- Share row: plain intent URLs (no SDKs) + clipboard copy. ----
function ShareRow({ event }: { event: EventListItem }) {
  const home = event.homeTeam ?? 'TBD';
  const away = event.awayTeam ?? 'TBD';

  // Resolve the page URL on the client only (no window during SSR).
  const [pageUrl, setPageUrl] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setPageUrl(window.location.href);
  }, []);

  const shareText = `${home} vs ${away} — Sharp Foxx`;
  const tweetUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(
    pageUrl,
  )}&text=${encodeURIComponent(shareText)}`;
  const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
    pageUrl,
  )}`;

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(pageUrl || window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — no-op; the buttons still work for sharing */
    }
  }

  // When live, the metadata line leads with "LIVE from <venue>" (or just "Live"
  // if the venue is unknown); otherwise the usual sport · venue segments.
  const meta =
    event.status === 'live'
      ? [event.venue ? `Live from ${event.venue}` : 'Live', event.sport].filter(
          Boolean,
        )
      : [event.sport, event.venue].filter(Boolean);

  return (
    <div className="game-actions">
      <div className="game-share">
        <a
          className="game-share-btn"
          href={tweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on X"
        >
          𝕏 <span>Post</span>
        </a>
        <a
          className="game-share-btn"
          href={fbUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on Facebook"
        >
          f <span>Share</span>
        </a>
        <button
          type="button"
          className={`game-share-btn${copied ? ' game-share-btn--copied' : ''}`}
          onClick={onCopy}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      {meta.length > 0 && (
        <div className="game-metaline">
          {meta.map((seg, i) => (
            <span key={i} className="game-metaline__seg">
              {seg}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- One published article, rendered inline (not a modal). Reuses the reader
// typography (.story-* + .article-body) so it reads like the article modal. ----
function Article({ item }: { item: EventContentItem }) {
  const meta = [item.author, formatWhen(item.publishedAt ?? item.createdAt)].filter(
    Boolean,
  );
  return (
    <article className="game-article">
      <span className="story-kicker">{item.eventSport ?? 'Coverage'}</span>
      <h2 className="story-title">{item.title}</h2>
      <div className="story-meta">
        {meta.map((seg, i) => (
          <span key={i} className="story-meta__seg">
            {seg}
          </span>
        ))}
      </div>
      {item.body && (
        <div
          className="article-body"
          dangerouslySetInnerHTML={{ __html: item.body }}
        />
      )}
    </article>
  );
}

// ---- Right-rail game card: a compact matchup + score/date/venue that links to
// that game's page. ----
function RailGameCard({ event }: { event: EventListItem }) {
  const home = event.homeTeam ?? 'TBD';
  const away = event.awayTeam ?? 'TBD';
  const hasScore = event.homeScore !== null && event.awayScore !== null;
  const isFinal = event.status === 'final';
  const isLive = event.status === 'live';

  return (
    <Link href={`/games/${event.id}`} className="game-railcard">
      <span className="game-railcard__matchup">
        {home} <span className="game-railcard__vs">vs</span> {away}
      </span>
      <span className="game-railcard__meta">
        {hasScore ? (
          <span className="game-railcard__score">
            {event.homeScore} – {event.awayScore}
          </span>
        ) : (
          <span>{formatDate(event.scheduledAt)}</span>
        )}
        {isLive && <LiveBadge />}
        {isFinal && <span className="pill">Final</span>}
        {event.venue && <span className="game-railcard__venue">{event.venue}</span>}
      </span>
    </Link>
  );
}

export default function GamePage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const [articles, setArticles] = useState<EventContentItem[] | null>(null);
  const [latest, setLatest] = useState<FeedItem[] | null>(null);
  // The game's presenting sponsor, or null when it has none. A failed lookup
  // degrades silently (stays null), so the strip simply doesn't render.
  const [sponsorship, setSponsorship] = useState<Sponsorship | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // No guaranteed GET /events/:id, so pull the list and find by id (also
        // powers the "More games" rail). Published-only content for this game;
        // the global published feed powers "Latest articles". Article/feed
        // failures shouldn't blank the page, so they're swallowed to [].
        const [ev, content, feed, sponsor] = await Promise.all([
          getEvents(token),
          getEventContent(token, id, 'published').catch(
            () => [] as EventContentItem[],
          ),
          getPublishedContent(token).catch(() => [] as FeedItem[]),
          // The sponsor strip is a garnish, not the page -- a failed lookup
          // degrades silently to null rather than blanking the game.
          getEventSponsorship(token, id).catch(() => null),
        ]);
        if (cancelled) return;
        setEvents(ev);
        setArticles(content);
        setLatest(feed);
        setSponsorship(sponsor);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load game');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, id, router, allowed]);

  const event = useMemo(
    () => events?.find((e) => e.id === id) ?? null,
    [events, id],
  );

  // "More games": live games float to the very top of the rail, then same-sport
  // first among the rest, then everything else. Current game excluded.
  const moreGames = useMemo(() => {
    if (!events || !event) return [];
    const others = events.filter((e) => e.id !== id);
    const live = others.filter((e) => e.status === 'live');
    const notLive = others.filter((e) => e.status !== 'live');
    const same = notLive.filter((e) => e.sport === event.sport);
    const rest = notLive.filter((e) => e.sport !== event.sport);
    return [...live, ...same, ...rest].slice(0, 10);
  }, [events, event, id]);

  // "Latest articles": resolve each published feed item to a game page via the
  // matchup+time key, drop the current game's own articles and any that don't
  // resolve to a game, keep the newest handful.
  const latestArticles = useMemo(() => {
    if (!events || !latest) return [];
    const idByKey = new Map(
      events.map((e) => [eventKey(e.homeTeam, e.awayTeam, e.scheduledAt), e.id]),
    );
    return latest
      .map((a) => ({
        item: a,
        eventId: idByKey.get(
          eventKey(a.homeTeam, a.awayTeam, a.eventScheduledAt),
        ),
      }))
      .filter((r): r is { item: FeedItem; eventId: string } =>
        Boolean(r.eventId && r.eventId !== id),
      )
      .slice(0, 8);
  }, [events, latest, id]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  return (
    <main className="feed-home game-page">
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

      <Link href="/feed" className="game-back">
        ← Back to feed
      </Link>

      {loading && <div className="card muted">Loading game…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && !event && (
        <div className="results-empty">
          <p className="results-empty__title">Game not found</p>
          <p className="results-empty__hint">
            This game may have been removed. Head back to the{' '}
            <Link href="/feed">homepage</Link> to browse what&apos;s on.
          </p>
        </div>
      )}

      {!loading && !error && event && (
        <div className="game-layout">
          <div className="game-main">
            <GameVideo event={event} />
            <Scoreboard event={event} />
            {sponsorship && <PresentingSponsorStrip sponsorship={sponsorship} />}
            <ShareRow event={event} />

            <section className="game-articles">
              <h2 className="game-articles__head">Coverage</h2>
              {articles && articles.length > 0 ? (
                articles.map((a) => <Article key={a.id} item={a} />)
              ) : (
                <div className="results-empty">
                  <p className="results-empty__title">No coverage published yet</p>
                  <p className="results-empty__hint">
                    Recaps and features for this game will appear here once
                    published.
                  </p>
                </div>
              )}
            </section>
          </div>

          <aside className="game-rail">
            <section className="game-rail-section">
              <h2 className="game-rail-title">More games</h2>
              {moreGames.length > 0 ? (
                moreGames.map((e) => <RailGameCard key={e.id} event={e} />)
              ) : (
                <p className="muted">No other games right now.</p>
              )}
            </section>

            <section className="game-rail-section">
              <h2 className="game-rail-title">Latest articles</h2>
              {latestArticles.length > 0 ? (
                latestArticles.map(({ item, eventId }) => (
                  <Link
                    key={item.id}
                    href={`/games/${eventId}`}
                    className="game-railrow"
                  >
                    <span className="game-railrow__title">{item.title}</span>
                    {item.homeTeam && item.awayTeam && (
                      <span className="game-railrow__match">
                        {item.homeTeam} vs {item.awayTeam}
                      </span>
                    )}
                  </Link>
                ))
              ) : (
                <p className="muted">No articles published yet.</p>
              )}
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}
