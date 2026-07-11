'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { AddGameForm } from '../add-game-form';
import { canAccess } from '../roles';
import { useOwnRep, TrainingGate } from '../training-gate';
import {
  getMyAssignments,
  getEvents,
  getContentByAuthor,
  getEventSponsorship,
  MyAssignment,
  EventListItem,
} from '../api';

// The current status/scores of a game, keyed by event id. /assignments/mine
// carries the assignment's event status but not the freshest score/live state,
// so the schedule seeds its Game-status column from GET /events (which the page
// already loads) and falls back to the status on the assignment.
type EventStatus = EventListItem['status'];

// Format the timestamptz string the API returns; fall back to the raw value if
// it somehow doesn't parse.
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// The matchup as readable team names ("Home vs Away"), or null when either side
// is missing a name -- the row then falls back to the sport headline (no UUIDs).
function matchup(a: MyAssignment): string | null {
  const { homeTeam, awayTeam } = a.event;
  if (!homeTeam || !awayTeam) return null;
  return `${homeTeam} vs ${awayTeam}`;
}

// The shared pulsing LIVE badge (dot + wordmark) — same scoped .live-badge
// treatment used on the feed/search cards and the game page.
function LiveBadge() {
  return (
    <span className="live-badge">
      <span className="live-badge__dot" aria-hidden="true" />
      Live
    </span>
  );
}

// Schedule sort buckets: live floats to the top, then upcoming ascending by
// date, then finals descending. Everything not live-or-final (scheduled,
// postponed, canceled) sorts as upcoming.
function bucket(status: EventStatus): number {
  if (status === 'live') return 0;
  if (status === 'final') return 2;
  return 1;
}

export default function MyGamesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);
  // Gate an onboarding rep behind the training holding card (see below).
  const { ownRep } = useOwnRep(token, user?.id, allowed);

  const [games, setGames] = useState<MyAssignment[] | null>(null);
  // eventId -> freshest game status, from GET /events, for the Game-status
  // column + the schedule sort. Falls back to the assignment's event status.
  const [statusByEvent, setStatusByEvent] = useState<Record<string, EventStatus>>({});
  // eventId -> presenting sponsor business name. No batch endpoint exists, so
  // these are fetched per game, best-effort, and fill in after the table renders.
  const [sponsorByEvent, setSponsorByEvent] = useState<Record<string, string>>({});
  // eventId -> the rep's article status for that game (published wins over
  // draft). Fetched in ONE request via GET /content?authorId= (the rep's own
  // content across all games) rather than one lookup per row.
  const [articleByEvent, setArticleByEvent] = useState<
    Record<string, 'draft' | 'submitted' | 'published'>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // Whether the signed-in user is actually a field_rep -- only then does adding
  // a game self-claim it (an admin viewing this page just creates the event).
  const isFieldRep = (user?.roles ?? []).includes('field_rep');

  // Load the assignments (the schedule) plus the events lookup for the
  // Game-status column. Reused on mount and after adding + claiming a game.
  const loadGames = useCallback(async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      // Assignments are the page; the events lookup only powers the status
      // column, so a failure there must not break the page -> swallow it.
      const [data, events] = await Promise.all([
        getMyAssignments(t),
        getEvents(t).catch(() => [] as EventListItem[]),
      ]);
      setGames(data);
      setStatusByEvent(Object.fromEntries(events.map((e) => [e.id, e.status])));
    } catch (err) {
      // The client turns failures into "<status> <message>", e.g. a user with
      // no rep profile gets "404 No rep profile for this user".
      setError(err instanceof Error ? err.message : 'Failed to load games');
    } finally {
      setLoading(false);
    }
  }, []);

  // No token in memory (e.g. after a page refresh) -> back to login.
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    loadGames(token);
  }, [token, router, allowed, loadGames]);

  // Article status for every row in ONE request: the rep's own content, keyed on
  // their USER id, mapped event -> status (published wins). Best-effort and
  // silent -- a failure just leaves the Article column showing "—".
  useEffect(() => {
    if (!token || !allowed || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const content = await getContentByAuthor(token, user.id);
        if (cancelled) return;
        // Precedence published > submitted > draft, so the "furthest along"
        // article wins a game's cell when a rep has more than one.
        const rank = { draft: 0, submitted: 1, published: 2 } as const;
        const map: Record<string, 'draft' | 'submitted' | 'published'> = {};
        for (const c of content) {
          if (!c.eventId) continue;
          if (c.status !== 'draft' && c.status !== 'submitted' && c.status !== 'published') {
            continue;
          }
          const prev = map[c.eventId];
          if (!prev || rank[c.status] > rank[prev]) map[c.eventId] = c.status;
        }
        setArticleByEvent(map);
      } catch {
        /* leave the Article column at "—" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, allowed, user?.id]);

  // Presenting sponsor per game. No batch endpoint, so fire one lookup per game
  // (best-effort, in parallel) once the schedule is loaded; each result fills in
  // its own row's Sponsor cell without blocking the table render.
  useEffect(() => {
    if (!token || !games) return;
    let cancelled = false;
    (async () => {
      await Promise.all(
        games.map(async (g) => {
          try {
            const s = await getEventSponsorship(token, g.event.id);
            if (!cancelled && s) {
              setSponsorByEvent((prev) => ({ ...prev, [g.event.id]: s.businessName }));
            }
          } catch {
            /* a failed lookup just leaves this row's Sponsor cell at "—" */
          }
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [token, games]);

  // The freshest status for a game (GET /events, else the assignment's event).
  const statusOf = useCallback(
    (g: MyAssignment): EventStatus => statusByEvent[g.event.id] ?? g.event.status,
    [statusByEvent],
  );

  // Live first, then upcoming ascending by date, then finals descending.
  const sortedGames = useMemo(() => {
    if (!games) return null;
    return [...games].sort((a, b) => {
      const ba = bucket(statusOf(a));
      const bb = bucket(statusOf(b));
      if (ba !== bb) return ba - bb;
      const ta = new Date(a.event.scheduledAt).getTime();
      const tb = new Date(b.event.scheduledAt).getTime();
      // Finals read newest-first; live + upcoming read soonest-first.
      return ba === 2 ? tb - ta : ta - tb;
    });
  }, [games, statusOf]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;
  // An onboarding rep sees the Academy holding card instead of the schedule.
  if (ownRep?.status === 'onboarding') return <TrainingGate />;

  return (
    <main className="feed-home">
      <div className="header-row">
        <div>
          <span className="wordmark">Sharp Foxx</span>
          <span className="muted">
            Signed in as <span className="mono">{user?.displayName ?? user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <AppNav />
      </div>

      <div className="masthead">
        <div className="masthead-head">
          <div>
            <span className="masthead-kicker">Your assignments</span>
            <h1 className="masthead-title">My Games</h1>
            <p className="masthead-standfirst">
              Games assigned to you or self-claimed. Open a game to run it
              courtside — go live, report the result, and draft its recap.
            </p>
          </div>
          <div className="masthead-actions">
            <button
              type="button"
              className="btn-inline"
              onClick={() => setShowAdd(true)}
            >
              + Add Game
            </button>
          </div>
        </div>
      </div>

      {showAdd && (
        <AddGameForm
          token={token}
          selfClaim={isFieldRep}
          onCreated={() => loadGames(token)}
          onClose={() => setShowAdd(false)}
        />
      )}

      {loading && <div className="card muted">Loading games…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && sortedGames && sortedGames.length > 0 ? (
        <div className="card game sched-card">
          <table className="report-table sched-table">
            <thead>
              <tr>
                <th>Date / time</th>
                <th>Matchup</th>
                <th>Venue</th>
                <th>Sport</th>
                <th>Game</th>
                <th>My status</th>
                <th>Sponsor</th>
                <th>Article</th>
              </tr>
            </thead>
            <tbody>
              {sortedGames.map((g) => {
                const status = statusOf(g);
                const sponsor = sponsorByEvent[g.event.id];
                const article = articleByEvent[g.event.id];
                const open = () => router.push(`/my-games/${g.event.id}`);
                return (
                  <tr
                    key={g.id}
                    className="sched-row"
                    role="link"
                    tabIndex={0}
                    onClick={open}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        open();
                      }
                    }}
                  >
                    <td>{formatWhen(g.event.scheduledAt)}</td>
                    <td className="total">{matchup(g) ?? g.event.sport}</td>
                    <td>{g.event.venue ?? '—'}</td>
                    <td className="sched-sport">{g.event.sport}</td>
                    <td>
                      {status === 'live' ? (
                        <LiveBadge />
                      ) : (
                        <span className="pill">
                          {status === 'final' ? 'Final' : status}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="pill">{g.status}</span>
                    </td>
                    <td>{sponsor ?? <span className="muted">—</span>}</td>
                    <td>
                      {article ? (
                        <span
                          className={`pill${article === 'submitted' ? ' pill--review' : ''}`}
                        >
                          {article === 'published'
                            ? 'Published'
                            : article === 'submitted'
                              ? 'In review'
                              : 'Draft'}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        !loading &&
        !error && (
          <div className="results-empty">
            <p className="results-empty__title">No games assigned yet</p>
            <p className="results-empty__hint">
              When a manager assigns you a game — or you claim one — it will show
              up here.
            </p>
          </div>
        )
      )}
    </main>
  );
}
