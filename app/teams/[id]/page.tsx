'use client';

// The team hub (/teams/[id]) — the fan surface that ties a team's games,
// coverage, photos, and roster together. Open to every authenticated role incl.
// viewers/fans (see roles.ts); reached by links (an athlete's affiliation line, a
// game scoreboard), never a nav item.
//
// Payloads are assembled frontend-side from existing reads: GET /teams/:id for
// identity, GET /athletes?teamId= for the roster, GET /events (filtered client-
// side on home/away team id) for games, and the published feed matched to those
// games for coverage. Photos merge getGamePhotos across the team's recent finals.
// Where a proper backend filter is missing (published content by teamId) it's
// noted as a future enrichment rather than a new endpoint.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../auth-context';
import { AppNav, AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import { FollowButton } from '../../follow-button';
import {
  getTeam,
  getTeamRoster,
  getEvents,
  getPublishedContent,
  getGamePhotos,
  TeamDetail,
  TeamRosterAthlete,
  EventListItem,
  FeedItem,
  GamePhoto,
  FollowMineEntry,
} from '../../api';

// ---- formatting helpers (mirror the game / athlete-profile pages) ----
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { dateStyle: 'medium' });
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Up to two initials from a composed "First Last" roster name.
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return `${first}${last}`.toUpperCase() || '—';
}

// Same matchup key the game page uses to reconcile the eventId-less published
// feed against the events list: home | away | scheduledAt.
function eventKey(
  home: string | null,
  away: string | null,
  scheduledAt: string | null,
): string {
  return `${home ?? ''}|${away ?? ''}|${scheduledAt ?? ''}`;
}

// The shared pulsing LIVE badge (mirrors the game/feed surfaces).
function LiveBadge({ className }: { className?: string }) {
  return (
    <span className={`live-badge${className ? ` ${className}` : ''}`}>
      <span className="live-badge__dot" aria-hidden="true" />
      Live
    </span>
  );
}

// ---- Next up / Live: a prominent card for the team's live game, else the next
// scheduled one. Renders nothing when the team has neither. ----
function NextUpCard({ event }: { event: EventListItem }) {
  const home = event.homeTeam ?? 'TBD';
  const away = event.awayTeam ?? 'TBD';
  const isLive = event.status === 'live';
  const hasScore = event.homeScore !== null && event.awayScore !== null;

  return (
    <Link
      href={`/games/${event.id}`}
      className={`team-nextup${isLive ? ' team-nextup--live' : ''}`}
    >
      <div className="team-nextup__head">
        {isLive ? <LiveBadge /> : <span className="game-kicker">Next up</span>}
        <span className="team-nextup__sport">{titleCase(event.sport)}</span>
      </div>
      <div className="team-nextup__matchup">
        {home} <span className="team-nextup__vs">vs</span> {away}
      </div>
      <div className="team-nextup__meta">
        {isLive ? (
          <>
            {hasScore && (
              <span className="team-nextup__score">
                {event.homeScore} — {event.awayScore}
              </span>
            )}
            <span className="team-nextup__detail">Live now — watch →</span>
          </>
        ) : (
          <span className="team-nextup__detail">
            {formatWhen(event.scheduledAt)}
            {event.venue ? ` · ${event.venue}` : ''}
          </span>
        )}
      </div>
    </Link>
  );
}

// ---- Recent results: last ~6 finals as compact linked rows, Show-all expander. ----
const RESULTS_CAP = 6;

function RecentResults({ finals }: { finals: EventListItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? finals : finals.slice(0, RESULTS_CAP);

  return (
    <section className="card team-section">
      <span className="game-kicker">Results</span>
      <h2 className="team-section__title">Recent results</h2>
      <div className="team-results">
        {shown.map((g) => {
          const home = g.homeTeam ?? 'TBD';
          const away = g.awayTeam ?? 'TBD';
          const hasScore = g.homeScore !== null && g.awayScore !== null;
          return (
            <Link key={g.id} href={`/games/${g.id}`} className="team-result">
              <span className="team-result__matchup">
                {home} <span className="team-result__vs">vs</span> {away}
              </span>
              <span className="team-result__meta">
                {hasScore && (
                  <span className="team-result__score">
                    {g.homeScore} – {g.awayScore}
                  </span>
                )}
                <span className="team-result__date">
                  {formatDate(g.scheduledAt)}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
      {finals.length > RESULTS_CAP && (
        <button
          type="button"
          className="show-all"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : `Show all (${finals.length})`}
        </button>
      )}
    </section>
  );
}

// ---- Roster grid: athlete cards (avatar/initials disc, name, #jersey · pos)
// linking to the public profile. ----
function RosterCard({ athlete }: { athlete: TeamRosterAthlete }) {
  const meta = [
    athlete.jerseyNumber ? `#${athlete.jerseyNumber}` : null,
    athlete.position,
    athlete.classYear,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link href={`/athletes/${athlete.id}`} className="team-rostercard">
      <span className="team-rostercard__disc">
        {athlete.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={athlete.avatarUrl}
            alt={athlete.name}
            loading="lazy"
            className="team-rostercard__img"
          />
        ) : (
          <span className="team-rostercard__initials" aria-hidden="true">
            {initialsOf(athlete.name)}
          </span>
        )}
      </span>
      <span className="team-rostercard__name">{athlete.name}</span>
      {meta && <span className="team-rostercard__meta">{meta}</span>}
    </Link>
  );
}

// ---- Coverage: published articles tied to the team's games, capped + expander. ----
const COVERAGE_CAP = 6;

function Coverage({ articles }: { articles: FeedItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? articles : articles.slice(0, COVERAGE_CAP);

  return (
    <section className="card team-section">
      <span className="game-kicker">Coverage</span>
      <h2 className="team-section__title">In the news</h2>
      <div className="game-covlist">
        {shown.map((a) => (
          <Link key={a.id} href={`/articles/${a.id}`} className="game-covrow">
            <span className="game-covrow__title">{a.title}</span>
            <span className="game-covrow__date">{formatDate(a.publishedAt)}</span>
          </Link>
        ))}
      </div>
      {articles.length > COVERAGE_CAP && (
        <button
          type="button"
          className="show-all"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : `Show all (${articles.length})`}
        </button>
      )}
    </section>
  );
}

// ---- Photo gallery: merged across the team's recent finals, no-library
// lightbox (reused from the game page). Hidden when empty. ----
function TeamPhotos({ photos }: { photos: GamePhoto[] }) {
  const [active, setActive] = useState<GamePhoto | null>(null);

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
    <section className="card team-section">
      <span className="game-kicker">Gallery</span>
      <h2 className="team-section__title">Photos</h2>
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
              alt="Team photo"
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
            alt="Team photo"
            className="lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
}

// How many of the team's most-recent finals to pull photos from, and the total
// gallery cap — a modest garnish, not an exhaustive archive.
const PHOTO_SOURCE_GAMES = 4;
const PHOTO_TOTAL_CAP = 12;

export default function TeamPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [roster, setRoster] = useState<TeamRosterAthlete[]>([]);
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [published, setPublished] = useState<FeedItem[]>([]);
  const [photos, setPhotos] = useState<GamePhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // No token (e.g. after a refresh) -> back to login.
  useEffect(() => {
    if (!token) router.replace('/');
  }, [token, router]);

  const load = useCallback(
    async (t: string) => {
      setLoading(true);
      setError(null);
      setNotFound(false);
      try {
        // The team read is the page; the rest are garnish — a failed roster /
        // events / feed load degrades to empty rather than blanking the hub.
        const [teamDetail, rosterList, allEvents, feed] = await Promise.all([
          getTeam(t, id),
          getTeamRoster(t, id).catch(() => [] as TeamRosterAthlete[]),
          getEvents(t).catch(() => [] as EventListItem[]),
          getPublishedContent(t).catch(() => [] as FeedItem[]),
        ]);
        setTeam(teamDetail);
        setRoster(rosterList);
        setEvents(allEvents);
        setPublished(feed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load team';
        if (msg.startsWith('404')) setNotFound(true);
        else setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    if (token && allowed) load(token);
  }, [token, allowed, load]);

  // The team's games: events where it is home or away (no backend team filter on
  // /events yet — a client-side filter is fine at this scale, and a future
  // GET /events?teamId= would replace it).
  const teamEvents = useMemo(
    () => events.filter((e) => e.homeTeamId === id || e.awayTeamId === id),
    [events, id],
  );

  // Finals, newest-first, for the results list + stat + photo sourcing.
  const finals = useMemo(
    () =>
      teamEvents
        .filter((e) => e.status === 'final')
        .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)),
    [teamEvents],
  );

  // Live game (if any) wins the Next-up slot; otherwise the soonest scheduled.
  const nextUp = useMemo(() => {
    const live = teamEvents.find((e) => e.status === 'live');
    if (live) return live;
    return (
      teamEvents
        .filter((e) => e.status === 'scheduled')
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0] ?? null
    );
  }, [teamEvents]);

  // Coverage: published articles matched to the team's games via the matchup key
  // (the published feed carries no teamId/eventId). A future GET /content?teamId=
  // would make this exact rather than event-derived. Newest-first is preserved
  // from the feed order.
  const coverage = useMemo(() => {
    if (teamEvents.length === 0) return [] as FeedItem[];
    const keys = new Set(
      teamEvents.map((e) => eventKey(e.homeTeam, e.awayTeam, e.scheduledAt)),
    );
    return published.filter((a) =>
      keys.has(eventKey(a.homeTeam, a.awayTeam, a.eventScheduledAt)),
    );
  }, [teamEvents, published]);

  // Stable id list of the finals we pull photos from, so the photo effect only
  // re-runs when that set actually changes.
  const photoSourceIds = useMemo(
    () => finals.slice(0, PHOTO_SOURCE_GAMES).map((e) => e.id),
    [finals],
  );
  const photoSourceKey = photoSourceIds.join(',');

  // Merge photos across the team's recent finals, capped. Best-effort: a per-game
  // failure is swallowed so one bad game doesn't hide the whole gallery.
  useEffect(() => {
    if (!token || photoSourceIds.length === 0) {
      setPhotos([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const batches = await Promise.all(
        photoSourceIds.map((eventId) =>
          getGamePhotos(token, eventId).catch(() => [] as GamePhoto[]),
        ),
      );
      if (cancelled) return;
      setPhotos(batches.flat().slice(0, PHOTO_TOTAL_CAP));
    })();
    return () => {
      cancelled = true;
    };
    // photoSourceKey stands in for the id array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, photoSourceKey]);

  // "Sport · Level · Institution" for the hero affiliation line.
  const affiliation = useMemo(() => {
    if (!team) return [] as string[];
    const level = team.level ? team.level.replace(/_/g, ' ') : '';
    return [
      titleCase(team.sport),
      level ? titleCase(level) : '',
      team.institution?.name ?? '',
    ].filter(Boolean);
  }, [team]);

  // A mine-shaped entry for the hero Follow button — identifies this team and
  // enriches the feed carousel when followed.
  const followEntry = useMemo<FollowMineEntry | null>(() => {
    if (!team) return null;
    return {
      targetType: 'team',
      followId: '',
      createdAt: '',
      teamId: id,
      name: team.name,
      sport: team.sport,
      institutionName: team.institution?.name ?? null,
    };
  }, [team, id]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  return (
    <main className="feed-home team-page">
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

      {loading && <div className="card muted">Loading team…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && notFound && (
        <div className="results-empty">
          <p className="results-empty__title">Team not found</p>
          <p className="results-empty__hint">
            This team may have been removed. Head back to the{' '}
            <Link href="/feed">homepage</Link> to browse what&apos;s on.
          </p>
        </div>
      )}

      {!loading && !error && team && (
        <>
          {/* ---- HERO ---- */}
          {/* No team logos exist yet — a branded gradient banner stands in.
              Logo upload is a future enhancement (a media purpose + a column). */}
          <section className="team-hero">
            <div className="team-banner team-banner--fallback">
              <span className="team-banner__monogram" aria-hidden="true">
                {initialsOf(team.name)}
              </span>
            </div>
            <div className="team-identity">
              <h1 className="team-name">{team.name}</h1>
              {affiliation.length > 0 && (
                <p className="team-affil">
                  {affiliation.map((seg, i) => (
                    <span key={i} className="team-affil__seg">
                      {seg}
                    </span>
                  ))}
                </p>
              )}
              {followEntry && (
                <FollowButton entry={followEntry} className="team-follow" />
              )}
            </div>
          </section>

          {/* ---- STAT STRIP ---- */}
          <section className="team-stats">
            <div className="team-stat">
              <span className="team-stat__value">{finals.length}</span>
              <span className="team-stat__label">Games covered</span>
            </div>
            <div className="team-stat">
              <span className="team-stat__value">{coverage.length}</span>
              <span className="team-stat__label">Articles</span>
            </div>
            <div className="team-stat">
              <span className="team-stat__value">{roster.length}</span>
              <span className="team-stat__label">On roster</span>
            </div>
          </section>

          {/* ---- NEXT UP / LIVE ---- */}
          {nextUp && (
            <section className="team-nextup-wrap">
              <NextUpCard event={nextUp} />
            </section>
          )}

          {/* ---- RECENT RESULTS ---- */}
          {finals.length > 0 && <RecentResults finals={finals} />}

          {/* ---- ROSTER ---- */}
          {roster.length > 0 && (
            <section className="card team-section">
              <span className="game-kicker">Squad</span>
              <h2 className="team-section__title">Roster</h2>
              <div className="team-roster">
                {roster.map((a) => (
                  <RosterCard key={a.id} athlete={a} />
                ))}
              </div>
            </section>
          )}

          {/* ---- COVERAGE ---- */}
          {coverage.length > 0 && <Coverage articles={coverage} />}

          {/* ---- PHOTOS ---- */}
          <TeamPhotos photos={photos} />

          {/* Nothing to show beyond identity — a gentle empty state. */}
          {finals.length === 0 &&
            !nextUp &&
            roster.length === 0 &&
            coverage.length === 0 &&
            photos.length === 0 && (
              <div className="results-empty">
                <p className="results-empty__title">Nothing here yet</p>
                <p className="results-empty__hint">
                  Games, coverage, and roster for this team will appear here as
                  they&apos;re added.
                </p>
              </div>
            )}
        </>
      )}
    </main>
  );
}
