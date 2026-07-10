'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '../../auth-context';
import { AppNav, AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import {
  getFieldReps,
  getManagerReps,
  getRepAssignments,
  getContentByAuthor,
  getEvents,
  MyAssignment,
  EventContentItem,
  EventListItem,
} from '../../api';

const usd = (v: string) =>
  Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Format the timestamptz string the API returns; fall back to the raw value if
// it somehow doesn't parse (same helper shape as My Games).
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// "Home vs Away" when both names are present, else null -- callers fall back to
// the sport so no raw UUIDs ever surface.
function assignmentMatchup(a: MyAssignment): string | null {
  const { homeTeam, awayTeam } = a.event;
  if (!homeTeam || !awayTeam) return null;
  return `${homeTeam} vs ${awayTeam}`;
}

function contentMatchup(c: EventContentItem): string | null {
  if (!c.homeTeam || !c.awayTeam) return null;
  return `${c.homeTeam} vs ${c.awayTeam}`;
}

// The scores/replay link for a game, keyed by event id. Like /assignments/mine,
// the rep-scoped listing omits these, so we load them from GET /events and join
// by id -- the same approach My Games uses for its Report Result pre-fill.
type ResultSeed = Pick<
  EventListItem,
  'homeScore' | 'awayScore' | 'videoUrl' | 'status'
>;

export default function RepDrilldownPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ repId: string }>();
  const search = useSearchParams();
  const repId = params.repId;
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  // Header stats seed from the roster-row query params (see the roster link) so
  // they render instantly, then get refetched below off GET /reports/managers/
  // :id/reps so a hard refresh (no query params) still fills them in. Name falls
  // back to the rep resolved from GET /field-reps, then the id.
  const passedName = search.get('name') || '';

  const [repName, setRepName] = useState(passedName);
  const [commissions, setCommissions] = useState<string | null>(
    search.get('commissions'),
  );
  const [adOrders, setAdOrders] = useState<string | null>(search.get('adOrders'));
  const [games, setGames] = useState<MyAssignment[] | null>(null);
  const [articles, setArticles] = useState<EventContentItem[] | null>(null);
  const [resultsByEvent, setResultsByEvent] = useState<Record<string, ResultSeed>>({});
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  // No token in memory (e.g. after a page refresh) -> back to login.
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setForbidden(false);
    (async () => {
      try {
        // Assignments carry the roster-membership gate: a manager opening a rep
        // off their roster gets 403 here. field-reps resolves repId -> the USER
        // id that content is keyed on (the roster payload has no user id). events
        // is only for score/video badges, so a failure there mustn't break the
        // page -> swallow it.
        const [reps, assignments, events] = await Promise.all([
          getFieldReps(token),
          getRepAssignments(token, repId),
          getEvents(token).catch(() => [] as EventListItem[]),
        ]);
        if (cancelled) return;
        setGames(assignments);
        setResultsByEvent(
          Object.fromEntries(
            events.map((e) => [
              e.id,
              {
                homeScore: e.homeScore,
                awayScore: e.awayScore,
                videoUrl: e.videoUrl,
                status: e.status,
              },
            ]),
          ),
        );

        const rep = reps.find((r) => r.id === repId);
        if (rep?.displayName) setRepName((n) => n || rep.displayName!);

        // Refetch the header totals from the manager's roster so a hard refresh
        // (no query params) still shows them. rep.managerId is the owning
        // manager's field_reps id -- for a regional_manager that's their own
        // roster, for an admin any roster is allowed. Best-effort: a failure or a
        // manager-less rep just keeps whatever the query params seeded.
        if (rep?.managerId) {
          try {
            const roster = await getManagerReps(token, rep.managerId);
            const row = roster.reps.find((r) => r.repId === repId);
            if (row && !cancelled) {
              setCommissions(row.totalCommissions);
              setAdOrders(String(row.adOrdersCount));
            }
          } catch {
            /* header refetch is a nicety -- keep the query-param fallback */
          }
        }
        // Content is keyed on the rep's USER id, not the field_reps id. Without
        // a linked user there is nothing to query, so show an empty articles list.
        if (rep?.userId) {
          const content = await getContentByAuthor(token, rep.userId);
          if (!cancelled) setArticles(content);
        } else if (!cancelled) {
          setArticles([]);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load rep';
        // A rep off this manager's roster comes back 403 -- surface the branded
        // no-access page rather than a raw error string.
        if (message.startsWith('403')) setForbidden(true);
        else setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, repId, router, allowed]);

  if (!token) return null;
  if (!allowed || forbidden) return <AccessDenied />;

  const headerName = repName || repId;

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
        <span className="masthead-kicker">Rep drill-down</span>
        <h1 className="masthead-title">{headerName}</h1>
        <p className="masthead-standfirst">
          This rep&apos;s assigned games and the articles they&apos;ve authored.
        </p>
        <div className="rep-stats">
          <div className="rep-stat">
            <span className="rep-stat__label">Total commissions</span>
            <span className="rep-stat__value">
              {commissions != null ? usd(commissions) : '—'}
            </span>
          </div>
          <div className="rep-stat">
            <span className="rep-stat__label">Ad orders</span>
            <span className="rep-stat__value">
              {adOrders != null ? adOrders : '—'}
            </span>
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {/* ---- Games ---- */}
      <section className="card game">
        <span className="game-kicker">Assignments</span>
        <h2>Games</h2>
        {loading && <p className="muted">Loading games…</p>}
        {!loading && !error && games && games.length > 0 ? (
          <table className="report-table rep-table">
            <thead>
              <tr>
                <th>Matchup</th>
                <th>Venue</th>
                <th>Date</th>
                <th>Status</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => {
                const seed = resultsByEvent[g.event.id];
                const hasScore =
                  seed != null && seed.homeScore != null && seed.awayScore != null;
                const hasVideo = !!seed?.videoUrl;
                return (
                  <tr key={g.id}>
                    <td>{assignmentMatchup(g) ?? g.event.sport}</td>
                    <td>{g.event.venue ?? '—'}</td>
                    <td>{formatWhen(g.event.scheduledAt)}</td>
                    <td>
                      <span className="pill">{g.status}</span>
                    </td>
                    <td>
                      {hasScore || hasVideo ? (
                        <span className="rep-result">
                          {hasScore && (
                            <span className="rep-result__score">
                              {seed!.homeScore} – {seed!.awayScore}
                              {seed!.status === 'final' && (
                                <span className="pill">Final</span>
                              )}
                            </span>
                          )}
                          {hasVideo && <span className="pill">Video</span>}
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
        ) : (
          !loading &&
          !error && (
            <div className="results-empty">
              <p className="results-empty__title">No games assigned</p>
              <p className="results-empty__hint">
                When this rep is assigned a game — or claims one — it will show up
                here.
              </p>
            </div>
          )
        )}
      </section>

      {/* ---- Articles ---- */}
      <section className="card game">
        <span className="game-kicker">Content</span>
        <h2>Articles</h2>
        {loading && <p className="muted">Loading articles…</p>}
        {!loading && !error && articles && articles.length > 0 ? (
          <table className="report-table rep-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Game</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((c) => (
                <tr key={c.id}>
                  <td>{c.title}</td>
                  <td>
                    <span className="pill">{c.status}</span>
                  </td>
                  <td>
                    {c.eventId ? (
                      contentMatchup(c) ?? c.eventSport ?? 'Linked game'
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !loading &&
          !error && (
            <div className="results-empty">
              <p className="results-empty__title">No articles yet</p>
              <p className="results-empty__hint">
                Recaps this rep drafts or publishes will appear here.
              </p>
            </div>
          )
        )}
      </section>
    </main>
  );
}
