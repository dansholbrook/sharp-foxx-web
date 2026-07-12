'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../../auth-context';
import { AppNav, AccessDenied } from '../../nav';
import { AssignGameForm } from '../../assign-game-form';
import { canAccess } from '../../roles';
import { QueueTable, Column } from '../../queue-table';
import {
  getManagerReps,
  getManagerSummary,
  getFieldReps,
  updateFieldRepStatus,
  ManagerRoster,
  ManagerSummary,
  RepStatus,
} from '../../api';

// The territory dashboard shows the latest few recent orders inline; the rest
// are one click away behind "Show all" so the strip stays compact.
const RECENT_ACTIVITY_CAP = 8;

const usd = (v: string) =>
  Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Sum two money strings (commissions owed = pending + approved) at the render
// boundary only. Both come from the same report, so they're well-formed decimals.
function sumMoney(a: string, b: string): string {
  return (Number(a) + Number(b)).toFixed(2);
}

// Readable created-at timestamp for a recent order (timestamptz ISO); falls back
// to the raw value if it somehow doesn't parse.
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

// Which modal is open: a specific rep to assign, or a self-claim for the
// manager themselves (rep: null). null = closed.
type AssignTarget = { rep: { id: string; name: string } | null };

export default function ManagerRosterPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [roster, setRoster] = useState<ManagerRoster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [assign, setAssign] = useState<AssignTarget | null>(null);

  // The roster payload carries no rep status, so we join it from GET /field-reps
  // (keyed by field_reps id === roster repId) to surface an "Activate" action on
  // reps still onboarding. Best-effort: a failed lookup just hides Activate.
  const [statusByRep, setStatusByRep] = useState<Record<string, RepStatus>>({});
  // Reps mid-activation (for the button's busy state) + any activation error.
  const [activating, setActivating] = useState<Record<string, boolean>>({});
  const [activateError, setActivateError] = useState<string | null>(null);

  // Territory summary (stat cards + recent activity). Loaded independently of the
  // roster and best-effort: a failure here must not blank the roster below, so it
  // just hides the summary strip. :id is the manager's own field_reps id -- the
  // same id the roster call uses -- so a regional_manager landing here loads their
  // own territory and an admin loads whichever manager they opened.
  const [summary, setSummary] = useState<ManagerSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  // Recent activity is capped to the latest few until "Show all" is clicked.
  const [showAllActivity, setShowAllActivity] = useState(false);

  // No token in memory (e.g. after a page refresh) -> back to login.
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setSummaryLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await getManagerReps(token, id);
        if (!cancelled) setRoster(data);
      } catch (err) {
        // The client turns 400/404 into "<status> <message>", e.g.
        // "400 Invalid manager id" or "404 Regional manager not found".
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load roster');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // Territory summary loads on its own so a failure degrades to just the roster.
    (async () => {
      try {
        const data = await getManagerSummary(token, id);
        if (!cancelled) setSummary(data);
      } catch {
        /* leave the summary strip hidden -- the roster below still renders */
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    })();
    // Rep statuses (for the Activate action). Best-effort + independent so a
    // failure just leaves every rep without an Activate button.
    (async () => {
      try {
        const reps = await getFieldReps(token);
        if (!cancelled) {
          setStatusByRep(
            Object.fromEntries(reps.map((r) => [r.id, r.status as RepStatus])),
          );
        }
      } catch {
        /* leave statuses empty -- no Activate buttons render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, id, router, allowed]);

  // Activate an onboarding rep -> status 'active'. Updates the local status map
  // on success so the Activate button disappears without a full refetch.
  async function activateRep(repId: string) {
    if (!token) return;
    setActivating((m) => ({ ...m, [repId]: true }));
    setActivateError(null);
    try {
      const updated = await updateFieldRepStatus(token, repId, 'active');
      setStatusByRep((m) => ({ ...m, [repId]: updated.status as RepStatus }));
    } catch (err) {
      setActivateError(
        err instanceof Error ? err.message : 'Failed to activate rep',
      );
    } finally {
      setActivating((m) => ({ ...m, [repId]: false }));
    }
  }

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const reps = roster?.reps ?? [];

  // The roster payload carries no manager name, so resolve one for the heading.
  // The backend only lets a non-admin regional_manager load their OWN roster
  // (any other :id 403s), so a successfully-loaded roster for such a user means
  // :id is their own rep row -> use their displayName. Admins can view any
  // manager's roster and we don't have that name client-side, so keep the id.
  const roles = user?.roles ?? [];
  const ownRoster =
    !!roster && roles.includes('regional_manager') && !roles.includes('admin');
  const managerName = ownRoster ? user?.displayName ?? null : null;

  // Drill into a rep on click (a full page exists, so navigate rather than open a
  // slide-over). The header stats seed from the roster row via query params so the
  // drill-down renders instantly -- same link the old Name cell carried.
  const openRep = (rep: ManagerRoster['reps'][number]) =>
    router.push(
      `/reps/${rep.repId}?name=${encodeURIComponent(
        rep.displayName ?? '',
      )}&commissions=${encodeURIComponent(rep.totalCommissions)}&adOrders=${
        rep.adOrdersCount
      }`,
    );

  // Reps table columns (Name · Status · aggregates the payload carries). The
  // Assign cell keeps the per-rep Activate/Assign actions; it stops click/key
  // propagation so pressing a button never also fires the row's navigation.
  const repColumns: Column<ManagerRoster['reps'][number]>[] = [
    { key: 'name', header: 'Field rep', cell: (rep) => rep.displayName ?? '—' },
    {
      key: 'status',
      header: 'Status',
      cell: (rep) => {
        const st = statusByRep[rep.repId];
        return st ? (
          <span className="pill">{st}</span>
        ) : (
          <span className="muted">—</span>
        );
      },
    },
    {
      key: 'orders',
      header: 'Ad orders',
      align: 'right',
      cell: (rep) => rep.adOrdersCount,
    },
    {
      key: 'commissions',
      header: 'Total commissions',
      align: 'right',
      cell: (rep) => usd(rep.totalCommissions),
    },
    {
      key: 'assign',
      header: 'Assign',
      cell: (rep) => (
        <div
          className="roster-actions"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {statusByRep[rep.repId] === 'onboarding' && (
            <button
              type="button"
              className="btn-inline roster-activate"
              onClick={() => activateRep(rep.repId)}
              disabled={activating[rep.repId]}
            >
              {activating[rep.repId] ? 'Activating…' : 'Activate'}
            </button>
          )}
          <button
            type="button"
            className="link-btn rep-roster-link"
            onClick={() =>
              setAssign({
                rep: { id: rep.repId, name: rep.displayName ?? 'this rep' },
              })
            }
          >
            Assign game →
          </button>
        </div>
      ),
    },
  ];

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
            <span className="masthead-kicker">Team &amp; roster</span>
            <h1 className="masthead-title">Manager roster</h1>
            <p className="masthead-standfirst">
              Assign games to the reps who report to{' '}
              {managerName ? managerName : <span className="mono">{id}</span>}, or
              claim a game for yourself.
            </p>
          </div>
          <button
            type="button"
            className="btn-inline add-game-btn"
            onClick={() => setAssign({ rep: null })}
          >
            + Claim a game for myself
          </button>
        </div>
      </div>

      {assign && (
        <AssignGameForm
          token={token}
          rep={assign.rep}
          onClose={() => setAssign(null)}
        />
      )}

      {/* ---- Territory summary: stat cards + recent activity ---- */}
      {summaryLoading && <div className="card muted">Loading territory…</div>}
      {summary && (
        <section className="card game">
          <span className="game-kicker">Territory</span>
          <h2>Overview</h2>
          <div className="rep-stats territory-stats">
            <div className="rep-stat">
              <span className="rep-stat__label">Roster</span>
              <span className="rep-stat__value">{summary.repCount}</span>
            </div>
            <div className="rep-stat">
              <span className="rep-stat__label">Territory sales</span>
              <span className="rep-stat__value">{usd(summary.totalSales.amount)}</span>
              <span className="rep-stat__sub">
                {summary.totalSales.count}{' '}
                {summary.totalSales.count === 1 ? 'order' : 'orders'}
              </span>
            </div>
            <div className="rep-stat">
              <span className="rep-stat__label">Commissions owed</span>
              <span className="rep-stat__value">
                {usd(
                  sumMoney(
                    summary.totalCommissions.pending,
                    summary.totalCommissions.approved,
                  ),
                )}
              </span>
              <span className="rep-stat__sub">pending + approved</span>
            </div>
            <div className="rep-stat">
              <span className="rep-stat__label">Paid</span>
              <span className="rep-stat__value">
                {usd(summary.totalCommissions.paid)}
              </span>
            </div>
          </div>

          <h3 className="territory-activity__head">Recent activity</h3>
          {summary.recentOrders.length > 0 ? (
            <>
              <table className="report-table rep-table">
                <thead>
                  <tr>
                    <th>Advertiser</th>
                    <th>Rep</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAllActivity
                    ? summary.recentOrders
                    : summary.recentOrders.slice(0, RECENT_ACTIVITY_CAP)
                  ).map((o) => (
                    <tr key={o.id}>
                      <td>{o.businessName ?? 'Advertiser'}</td>
                      <td>{o.repDisplayName ?? '—'}</td>
                      <td className="num total">{usd(o.amount)}</td>
                      <td>
                        <span className="pill">{o.status}</span>
                      </td>
                      <td>{formatWhen(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!showAllActivity &&
                summary.recentOrders.length > RECENT_ACTIVITY_CAP && (
                  <div className="queue-more">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setShowAllActivity(true)}
                    >
                      Show all
                    </button>
                    <span className="muted queue-more__note">
                      Showing {RECENT_ACTIVITY_CAP} of {summary.recentOrders.length}
                    </span>
                  </div>
                )}
            </>
          ) : (
            <div className="results-empty">
              <p className="results-empty__title">No sales yet</p>
              <p className="results-empty__hint">
                When reps in this territory log advertiser deals, the most recent
                will appear here.
              </p>
            </div>
          )}
        </section>
      )}

      <section className="card game">
        <span className="game-kicker">Roster</span>
        <h2>Field reps</h2>
        {loading && <p className="muted">Loading roster…</p>}
        {error && <div className="error">{error}</div>}
        {activateError && <div className="error">{activateError}</div>}
        {!loading && !error && reps.length > 0 ? (
          <QueueTable
            columns={repColumns}
            rows={reps}
            rowKey={(rep) => rep.repId}
            onRowActivate={openRep}
            ariaLabel="Field reps on this roster"
          />
        ) : (
          !loading && !error && (
            <div className="results-empty">
              <p className="results-empty__title">No reps report to this manager</p>
              <p className="results-empty__hint">
                When reps are assigned to this manager, they&apos;ll appear here
                and you can assign them games.
              </p>
            </div>
          )
        )}
      </section>
    </main>
  );
}
