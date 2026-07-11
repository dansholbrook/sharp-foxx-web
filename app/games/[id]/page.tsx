'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  getLiveEvents,
  getGamePhotos,
  EventListItem,
  EventContentItem,
  FeedItem,
  Sponsorship,
  LiveEvent,
  GamePhoto,
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

// ---- Scoreboard strip: the visually dominant score line beneath the video.
// While live, liveHome/liveAway (fed by the poller) override the event's static
// scores, and scoreVersion bumps on each change to re-key the score span so the
// pulse-flash animation replays. period renders a small label under the line. ----
function Scoreboard({
  event,
  liveHome = null,
  liveAway = null,
  scoreVersion = 0,
  period = null,
}: {
  event: EventListItem;
  liveHome?: number | null;
  liveAway?: number | null;
  scoreVersion?: number;
  period?: string | null;
}) {
  const home = event.homeTeam ?? 'TBD';
  const away = event.awayTeam ?? 'TBD';
  const homeScore = liveHome ?? event.homeScore;
  const awayScore = liveAway ?? event.awayScore;
  const hasScore = homeScore !== null && awayScore !== null;
  const isFinal = event.status === 'final';
  const isLive = event.status === 'live';

  return (
    <div className="game-scoreboard">
      <span className="game-scoreboard__team game-scoreboard__team--home">
        {home}
      </span>
      <span className="game-scoreboard__center">
        {hasScore ? (
          <span
            key={`score-${scoreVersion}`}
            className={`game-scoreboard__score${
              isLive && scoreVersion > 0 ? ' pulse-flash' : ''
            }`}
          >
            {homeScore} — {awayScore}
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
        {isLive && period && <span className="pulse-period">{period}</span>}
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

// Time-of-day only, for the courtside feed timestamps ("7:04 PM").
function formatClock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Human line for a courtside feed event (big_play / timeout / status_note).
function pulseFeedText(ev: LiveEvent): string {
  if (ev.type === 'timeout') return 'Timeout on the floor';
  return ev.payload.text ? String(ev.payload.text) : 'Courtside update';
}

// After a fan hits the X on a sponsor takeover, suppress any new takeovers for
// this long — an X means "not now", and a fan doesn't want the next ad a second
// later. New spots that arrive during the window are dropped, not queued.
const TAKEOVER_COOLDOWN_MS = 60_000;

// ---- The fan live pulse: full history first, then a 5s cursor poll while the
// game is live. score_update drives the scoreboard override (+ a version bump to
// flash it), period sets the label, big_play/timeout/status_note stack onto the
// courtside feed (newest first), and sponsor_spot queues a takeover (one at a
// time). The initial history seeds score/period/feed WITHOUT firing takeovers
// for old spots. Polling stops on unmount and whenever `live` goes false. ----
function useLivePulse(token: string | null, eventId: string, live: boolean) {
  const [home, setHome] = useState<number | null>(null);
  const [away, setAway] = useState<number | null>(null);
  const [scoreVersion, setScoreVersion] = useState(0);
  const [period, setPeriod] = useState<string | null>(null);
  const [feed, setFeed] = useState<LiveEvent[]>([]); // newest-first
  const [queue, setQueue] = useState<LiveEvent[]>([]); // pending sponsor spots
  const [takeover, setTakeover] = useState<LiveEvent | null>(null);
  const cursorRef = useRef<string | null>(null);
  // Epoch-ms of the last manual (X) dismissal; 0 = never. Read at apply time to
  // enforce TAKEOVER_COOLDOWN_MS. A ref, not state, so it never re-renders.
  const dismissedAtRef = useRef(0);

  // Apply an ascending batch. `isHistory` seeds state on first load without
  // queueing takeovers (we don't replay old sponsor spots as overlays).
  const apply = useCallback((batch: LiveEvent[], isHistory: boolean) => {
    if (batch.length === 0) return;
    const newFeed: LiveEvent[] = [];
    const newSpots: LiveEvent[] = [];
    for (const ev of batch) {
      switch (ev.type) {
        case 'score_update':
          if (typeof ev.payload.homeScore === 'number') setHome(ev.payload.homeScore);
          if (typeof ev.payload.awayScore === 'number') setAway(ev.payload.awayScore);
          setScoreVersion((v) => v + 1);
          break;
        case 'period':
          if (ev.payload.label) setPeriod(String(ev.payload.label));
          break;
        case 'sponsor_spot':
          if (!isHistory) newSpots.push(ev);
          break;
        case 'big_play':
        case 'timeout':
        case 'status_note':
          newFeed.push(ev);
          break;
      }
    }
    // Ascending -> reverse so newest sits at the head of the feed.
    if (newFeed.length) setFeed((f) => [...newFeed.reverse(), ...f]);
    // Collapse the whole batch to at most ONE takeover — several sponsor_spot
    // events in a single poll are the same ad, and stacking them is spam. Keep
    // the latest. Drop it entirely while a manual dismissal is still cooling
    // down. (History never reaches here: those spots aren't pushed above.)
    if (newSpots.length) {
      const withinCooldown =
        Date.now() - dismissedAtRef.current < TAKEOVER_COOLDOWN_MS;
      if (!withinCooldown) {
        const latest = newSpots[newSpots.length - 1];
        setQueue((q) => [...q, latest]);
      }
    }
    cursorRef.current = batch[batch.length - 1].createdAt;
  }, []);

  // History-then-poll. Re-runs (and tears down) when the game stops being live.
  useEffect(() => {
    if (!token || !live) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      try {
        const history = await getLiveEvents(token, eventId);
        if (cancelled) return;
        apply(history, true);
      } catch {
        /* a failed history load still lets polling pick up from now */
      }
      if (cancelled) return;
      timer = setInterval(async () => {
        try {
          const batch = await getLiveEvents(
            token,
            eventId,
            cursorRef.current ?? undefined,
          );
          if (!cancelled) apply(batch, false);
        } catch {
          /* transient poll error — try again on the next tick */
        }
      }, 5000);
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [token, eventId, live, apply]);

  // Promote the next queued sponsor spot when nothing is on screen.
  useEffect(() => {
    if (takeover || queue.length === 0) return;
    setTakeover(queue[0]);
    setQueue((q) => q.slice(1));
  }, [takeover, queue]);

  // Auto-hide the current takeover after ~12s. This just clears the current
  // spot; the promote effect above advances to the next queued one (if any).
  // It does NOT touch the queue or the cooldown — an unattended ad rotating on
  // is fine; only a deliberate X means "stop".
  useEffect(() => {
    if (!takeover) return;
    const t = setTimeout(() => setTakeover(null), 12000);
    return () => clearTimeout(t);
  }, [takeover]);

  // A manual X is "not now": clear what's on screen, empty the whole pending
  // queue so nothing replays, and start the cooldown so incoming spots are
  // dropped for a while.
  const dismissTakeover = useCallback(() => {
    dismissedAtRef.current = Date.now();
    setQueue([]);
    setTakeover(null);
  }, []);

  return {
    home,
    away,
    scoreVersion,
    period,
    feed,
    takeover,
    dismissTakeover,
  };
}

// ---- "Live from courtside": the stacking play-by-play feed under the sponsor
// strip. Newest first; each item gently animates in. ----
function LiveFeed({ items }: { items: LiveEvent[] }) {
  if (items.length === 0) return null;
  return (
    <section className="pulse-feed">
      <div className="pulse-feed__head">
        <LiveBadge />
        <h2 className="pulse-feed__title">Live from courtside</h2>
      </div>
      <ul className="pulse-feed__list">
        {items.map((ev) => (
          <li key={ev.id} className="pulse-feed__item">
            <span className="pulse-feed__time">{formatClock(ev.createdAt)}</span>
            <span className="pulse-feed__text">{pulseFeedText(ev)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- The sponsor TAKEOVER: a gold-bordered card that slides over the video
// area for ~12s. Never blocks the page (the wrapper is click-through; only the
// card + X are interactive). businessName comes from the page's sponsorship. ----
function SponsorTakeover({
  businessName,
  onDismiss,
}: {
  businessName: string;
  onDismiss: () => void;
}) {
  return (
    <div className="pulse-takeover" role="status" aria-live="polite">
      <div className="pulse-takeover__card">
        <button
          type="button"
          className="pulse-takeover__close"
          aria-label="Dismiss sponsor spot"
          onClick={onDismiss}
        >
          ×
        </button>
        <span className="pulse-takeover__kicker">
          A word from our presenting sponsor
        </span>
        <span className="pulse-takeover__name">{businessName}</span>
      </div>
    </div>
  );
}

// ---- Fan photo gallery: a responsive lazy thumbnail grid of the game's
// confirmed photos with a no-library lightbox (full image over a dark overlay,
// click/X/Esc to close). Loads best-effort and renders NOTHING until at least
// one photo exists, so a failed load or an empty game simply shows no section. ----
function GamePhotos({ token, eventId }: { token: string | null; eventId: string }) {
  const [photos, setPhotos] = useState<GamePhoto[]>([]);
  const [active, setActive] = useState<GamePhoto | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await getGamePhotos(token, eventId);
        if (!cancelled) setPhotos(list);
      } catch {
        /* photos are a garnish -- a failed load just hides the section */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, eventId]);

  // Esc closes the lightbox while it's open.
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setActive(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (photos.length === 0) return null;

  return (
    <section className="game-photos">
      <h2 className="game-articles__head">Photos</h2>
      <div className="photos-grid photos-grid--gallery">
        {photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            className="photos-tile photos-tile--btn"
            onClick={() => setActive(photo)}
            aria-label="View photo"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.publicUrl}
              alt="Game photo"
              loading="lazy"
              className="photos-tile__img"
            />
          </button>
        ))}
      </div>

      {active && (
        <div
          className="lightbox-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          onClick={() => setActive(null)}
        >
          <button
            type="button"
            className="lightbox-close"
            aria-label="Close"
            onClick={() => setActive(null)}
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active.publicUrl}
            alt="Game photo"
            className="lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
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

  // Fan live pulse: only polls while this game is live (the hook itself no-ops
  // and tears down when `live` is false). Hooks run before the early returns.
  const live = event?.status === 'live';
  const pulse = useLivePulse(token, id, live);

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
          <div className="game-main game-main--live-anchor">
            {live && pulse.takeover && (
              <SponsorTakeover
                businessName={sponsorship?.businessName ?? 'our presenting sponsor'}
                onDismiss={pulse.dismissTakeover}
              />
            )}
            <GameVideo event={event} />
            <Scoreboard
              event={event}
              liveHome={live ? pulse.home : null}
              liveAway={live ? pulse.away : null}
              scoreVersion={pulse.scoreVersion}
              period={live ? pulse.period : null}
            />
            {sponsorship && <PresentingSponsorStrip sponsorship={sponsorship} />}
            {live && <LiveFeed items={pulse.feed} />}
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

            <GamePhotos token={token} eventId={id} />
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
