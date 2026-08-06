'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { AddGameForm } from '../add-game-form';
import { canAccess } from '../roles';
import { QueueTable, Column } from '../queue-table';
import { useOwnRep, TrainingGate } from '../training-gate';
import {
  getMyAssignments,
  getEvents,
  getContentByAuthor,
  getEventSponsorship,
  etDateTime,
  eventStatusLabel,
  MyAssignment,
  EventListItem,
} from '../api';

// The current status/scores of a game, keyed by event id. /assignments/mine
// carries the assignment's event status but not the freshest score/live state,
// so the schedule seeds its Game-status column from GET /events (which the page
// already loads) and falls back to the status on the assignment.
type EventStatus = EventListItem['status'];

// Format the timestamptz string the API returns, in ET; fall back to the raw
// value if it somehow doesn't parse. Labelled — this is the kickoff a rep plans
// their night around.
function formatWhen(iso: string): string {
  return etDateTime(iso, { zone: true }) || iso;
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

// The next thing to DO on a game, as a label for the row's action cell.
//
// The workspace was always one click away -- the whole row has been activatable
// since it was built -- but nothing on the row said so: eight data columns, no
// action, no chevron. A reviewer looking straight at a scheduled game concluded
// the result form didn't exist. It does, and it does NOT require going live; a
// correspondent can open a scheduled game and file 3-5 without ever touching
// Go Live. This column is the door, labelled.
// Returns null when there is no next thing to do -- the cell then renders
// nothing rather than inventing an action.
function actionLabel(status: EventStatus, scheduledAt: string): string | null {
  if (status === 'live') return 'Open console →';
  if (status === 'final') return 'Write recap →';
  // A canceled game did not happen, so there is no result to report and nothing
  // to write up. This branch exists because its ABSENCE was a bug: canceled used
  // to fall through to the pre-game default below, and since a canceled game's
  // kickoff is almost always in the past it rendered "Report result →" --
  // walking a correspondent into a form for a game that was never played. The
  // workspace still lets them file one (a wrongly-canceled game must not be a
  // dead end), but the row must not invite it.
  if (status === 'canceled') return null;
  // Postponed means "not tonight", not "not happening": the workspace keeps its
  // Go Live button for exactly that reason, so the row says the same thing. It
  // must skip the kickoff check below -- a postponed game is past its original
  // tip-off by definition, which would otherwise read "Report result →".
  if (status === 'postponed') return 'Go live →';
  // Scheduled. Past its kickoff, the job is filing what happened; before it,
  // the job is starting the broadcast.
  const kickoff = new Date(scheduledAt).getTime();
  if (!Number.isNaN(kickoff) && kickoff < Date.now()) return 'Report result →';
  return 'Go live →';
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

  // Split the sorted schedule into two tables. sortedGames already orders live
  // first, then upcoming ascending, then finals descending -- so filtering by
  // bucket preserves the right per-table order (upcoming: live pinned on top,
  // then soonest-first; past: newest-first).
  const upcoming = sortedGames?.filter((g) => statusOf(g) !== 'final') ?? [];
  const past = sortedGames?.filter((g) => statusOf(g) === 'final') ?? [];

  // Shared columns for both schedule tables (same eight the flat table carried).
  // Cells close over the freshest status + the best-effort sponsor/article maps.
  const columns: Column<MyAssignment>[] = [
    { key: 'when', header: 'Date / time', cell: (g) => formatWhen(g.event.scheduledAt) },
    { key: 'matchup', header: 'Matchup', cell: (g) => matchup(g) ?? g.event.sport },
    { key: 'venue', header: 'Venue', cell: (g) => g.event.venue ?? '—' },
    { key: 'sport', header: 'Sport', cell: (g) => g.event.sport },
    {
      key: 'game',
      header: 'Game',
      cell: (g) => {
        const status = statusOf(g);
        return status === 'live' ? (
          <LiveBadge />
        ) : (
          <span className="pill">{eventStatusLabel(status)}</span>
        );
      },
    },
    {
      key: 'mine',
      header: 'My status',
      cell: (g) => <span className="pill">{g.status}</span>,
    },
    {
      key: 'sponsor',
      header: 'Sponsor',
      cell: (g) => sponsorByEvent[g.event.id] ?? <span className="muted">—</span>,
    },
    {
      key: 'article',
      header: 'Article',
      cell: (g) => {
        const article = articleByEvent[g.event.id];
        if (!article) return <span className="muted">—</span>;
        return (
          <span className={`pill${article === 'submitted' ? ' pill--review' : ''}`}>
            {article === 'published'
              ? 'Published'
              : article === 'submitted'
                ? 'In review'
                : 'Draft'}
          </span>
        );
      },
    },
    {
      key: 'action',
      header: '',
      // A span, not a button: the whole <tr> already activates (role="link",
      // Enter/Space, pointer cursor), so a nested control here would be a second
      // tab stop that does the same thing. This is the affordance, not the
      // handler.
      cell: (g) => {
        const label = actionLabel(statusOf(g), g.event.scheduledAt);
        if (!label) return null;
        return <span className="mygames-action">{label}</span>;
      },
    },
  ];

  const openGame = (g: MyAssignment) => router.push(`/my-games/${g.event.id}`);

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

      {/* ---- FIRST RUN: no assignments at all. Two empty tables taught a new
           correspondent nothing and the only Add Game button was up in the
           masthead, so the screen that should be their home base and their
           onboarding was a pair of blank boxes. One card, the three steps of the
           job in order, and the action that starts it. ---- */}
      {!loading && !error && sortedGames && sortedGames.length === 0 && (
        <section className="card game">
          <span className="game-kicker">Start here</span>
          <h2>Your first game</h2>
          <p className="firstrun__lead">
            My Games is your home base. Every game you cover runs from here —
            add it, go live from the stands, then file the result and the recap.
          </p>
          <ol className="firstrun__steps">
            <li className="firstrun__step">
              <span className="firstrun__step-n">1</span>
              <span className="firstrun__step-text">
                <span className="firstrun__step-title">Add the game</span>
                Pick the sport, both teams and the tip-off time. Times are
                Eastern, and the line under the date shows you exactly what you
                picked.
              </span>
            </li>
            <li className="firstrun__step">
              <span className="firstrun__step-n">2</span>
              <span className="firstrun__step-text">
                <span className="firstrun__step-title">Go live from the gym</span>
                Open the game and hit Go Live. The courtside console gives you
                the scoreboard, quick +1/+2/+3, big plays and fan predictions.
              </span>
            </li>
            <li className="firstrun__step">
              <span className="firstrun__step-n">3</span>
              <span className="firstrun__step-text">
                <span className="firstrun__step-title">File the result</span>
                End the game to mark it final, then write the recap and upload
                your photos. You can file a score without going live — open the
                game and use Report the result.
              </span>
            </li>
          </ol>
          <button
            type="button"
            className="btn-inline"
            onClick={() => setShowAdd(true)}
          >
            + Add your first game
          </button>
          <p className="game-hint">
            Assigned a game by your manager? It shows up here automatically.
          </p>
        </section>
      )}

      {!loading && !error && sortedGames && sortedGames.length > 0 && (
        <>
          {/* ---- Upcoming: live pinned on top, then soonest-first ---- */}
          <section className="card game">
            <span className="game-kicker">Schedule</span>
            <h2>Upcoming</h2>
            {upcoming.length > 0 ? (
              <QueueTable
                columns={columns}
                rows={upcoming}
                rowKey={(g) => g.id}
                onRowActivate={openGame}
                pageSize={10}
                ariaLabel="Upcoming games"
              />
            ) : (
              <div className="results-empty">
                <p className="results-empty__title">No upcoming games — add one</p>
                <p className="results-empty__hint">
                  When a manager assigns you a game — or you claim one with “Add
                  Game” — it will show up here.
                </p>
              </div>
            )}
          </section>

          {/* ---- Past: finals, newest-first. The section doesn't exist until
               there IS a final -- an empty "No completed games yet" box on a new
               correspondent's screen is a second blank panel telling them
               nothing they can act on. ---- */}
          {past.length > 0 && (
            <section className="card game">
              <span className="game-kicker">Schedule</span>
              <h2>Past games</h2>
              <QueueTable
                columns={columns}
                rows={past}
                rowKey={(g) => g.id}
                onRowActivate={openGame}
                pageSize={10}
                ariaLabel="Past games"
              />
            </section>
          )}
        </>
      )}
    </main>
  );
}
