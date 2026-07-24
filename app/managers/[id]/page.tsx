'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../../auth-context';
import { AppNav, AccessDenied } from '../../nav';
import { AssignGameForm } from '../../assign-game-form';
import { canAccess } from '../../roles';
import { QueueTable, Column } from '../../queue-table';
import { RevChart } from '../../rev-chart';
import { RefTotalsStrip, RefBarChart, RefLeaderboard } from '../../refreport';
import {
  getManagerSummary,
  getTerritoryReport,
  getReferralsTerritory,
  updateFieldRepStatus,
  ManagerSummary,
  TerritoryReport,
  ReferralsTerritoryReport,
} from '../../api';

// Territory referrals refresh cadence -- "live" while the page is open.
const REFERRALS_POLL_MS = 30_000;

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

type PerRep = TerritoryReport['perRep'][number];

export default function ManagerRosterPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [assign, setAssign] = useState<AssignTarget | null>(null);

  // Reps mid-activation (for the button's busy state) + any activation error.
  const [activating, setActivating] = useState<Record<string, boolean>>({});
  const [activateError, setActivateError] = useState<string | null>(null);

  // Territory performance: KPIs, the 6-month trend and the per-rep coaching
  // table. This is the page's primary payload -- it carries each rep's status,
  // so unlike the old roster read it needs no second /field-reps lookup to know
  // who can be activated. :id is the manager's own field_reps id, so a
  // regional_manager landing here loads their own territory and an admin loads
  // whichever manager they opened (the backend 403s anyone else's).
  const [territory, setTerritory] = useState<TerritoryReport | null>(null);

  // Recent orders + the commission status split. Loaded independently and
  // best-effort: a failure here must not blank the performance table above, so
  // it just hides the activity section.
  const [summary, setSummary] = useState<ManagerSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  // Recent activity is capped to the latest few until "Show all" is clicked.
  const [showAllActivity, setShowAllActivity] = useState(false);

  // Territory referrals, polled on its own 30s cadence (same "live" treatment as
  // the exec dashboard). Best-effort: a failed poll keeps the last good data.
  const [referrals, setReferrals] = useState<ReferralsTerritoryReport | null>(null);
  const [referralsError, setReferralsError] = useState<string | null>(null);

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
        const data = await getTerritoryReport(token, id);
        if (!cancelled) setTerritory(data);
      } catch (err) {
        // The client turns 400/403/404 into "<status> <message>", e.g.
        // "400 Invalid manager id" or "403 You can only view your own territory".
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load territory');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    (async () => {
      try {
        const data = await getManagerSummary(token, id);
        if (!cancelled) setSummary(data);
      } catch {
        /* leave the activity section hidden -- performance above still renders */
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, id, router, allowed]);

  // Live territory referrals: fetch on mount, then re-poll every 30s. Separate
  // from the loads above so a slow/failed poll never disturbs the performance
  // table, and the interval is torn down on unmount / id change.
  useEffect(() => {
    if (!token || !allowed) return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await getReferralsTerritory(token, id);
        if (!cancelled) {
          setReferrals(data);
          setReferralsError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setReferralsError(
            err instanceof Error ? err.message : 'Failed to load referrals',
          );
        }
      }
    };
    load();
    const timer = window.setInterval(load, REFERRALS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, id, allowed]);

  // Activate an onboarding rep -> status 'active'. Patches the rep's row in the
  // loaded territory so the Activate button disappears without a full refetch.
  async function activateRep(repId: string) {
    if (!token) return;
    setActivating((m) => ({ ...m, [repId]: true }));
    setActivateError(null);
    try {
      const updated = await updateFieldRepStatus(token, repId, 'active');
      setTerritory((t) =>
        t === null
          ? t
          : {
              ...t,
              perRep: t.perRep.map((r) =>
                r.repId === repId ? { ...r, status: updated.status } : r,
              ),
              // activeRepCount is derived from the same statuses, so it has to
              // move with them or the KPI card contradicts the table below it.
              kpis: {
                ...t.kpis,
                activeRepCount:
                  updated.status === 'active'
                    ? t.kpis.activeRepCount + 1
                    : t.kpis.activeRepCount,
              },
            },
      );
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

  const reps = territory?.perRep ?? [];

  // The payload carries no manager name, so resolve one for the heading. The
  // backend only lets a non-admin regional_manager load their OWN territory (any
  // other :id 403s), so a successfully-loaded territory for such a user means :id
  // is their own rep row -> use their displayName. Admins can view any manager
  // and we don't have that name client-side, so fall back to the manager's own
  // row in perRep (they're in it as the player-coach), then to the id.
  const roles = user?.roles ?? [];
  const ownTerritory =
    !!territory && roles.includes('regional_manager') && !roles.includes('admin');
  const managerName =
    (ownTerritory ? user?.displayName : null) ??
    reps.find((r) => r.isManager)?.name ??
    null;

  // Drill into a rep on click (a full page exists, so navigate rather than open a
  // slide-over). The header stats seed from the row via query params so the
  // drill-down renders instantly -- the same link the old roster table carried.
  const openRep = (rep: PerRep) =>
    router.push(
      `/reps/${rep.repId}?name=${encodeURIComponent(
        rep.name ?? '',
      )}&commissions=${encodeURIComponent(rep.commissionsEarned)}&adOrders=${
        rep.ordersCount
      }`,
    );

  // The coaching table: who's producing and who's stalled, sorted by revenue
  // desc server-side. This replaces the old roster table rather than sitting
  // above it -- both listed the same reps, and the old one's columns (rep,
  // status, orders, commissions) are a subset of these. Its Activate/Assign
  // actions are preserved in the last column.
  const repColumns: Column<PerRep>[] = [
    {
      key: 'name',
      header: 'Rep',
      cell: (rep) => (
        <>
          {rep.name ?? '—'}
          {/* The manager sells too (player-coach), so their own row is in the
              territory. Mark it so the roster doesn't look off-by-one. */}
          {rep.isManager && <span className="terr-self-badge">Manager</span>}
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (rep) => <span className="pill">{rep.status}</span>,
    },
    {
      key: 'revenue',
      header: 'Revenue',
      align: 'right',
      cell: (rep) => usd(rep.revenue),
    },
    {
      key: 'commissions',
      header: 'Commissions',
      align: 'right',
      cell: (rep) => usd(rep.commissionsEarned),
    },
    {
      key: 'games',
      header: 'Games',
      align: 'right',
      cell: (rep) => rep.gamesCovered,
    },
    {
      key: 'articles',
      header: 'Articles',
      align: 'right',
      cell: (rep) => rep.articlesPublished,
    },
    {
      key: 'thirtyDay',
      header: '30-day',
      align: 'right',
      cell: (rep) => usd(rep.thirtyDayRevenue),
    },
    {
      key: 'lastActive',
      header: 'Last active',
      cell: (rep) =>
        rep.lastActivityAt ? (
          formatWhen(rep.lastActivityAt)
        ) : (
          // No order, no game, no article, ever -- the row worth a phone call.
          <span className="terr-stale">Never</span>
        ),
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
          {rep.status === 'onboarding' && (
            <button
              type="button"
              className="btn-inline roster-activate"
              onClick={() => activateRep(rep.repId)}
              disabled={activating[rep.repId]}
            >
              {activating[rep.repId] ? 'Activating…' : 'Activate'}
            </button>
          )}
          {/* The manager claims games for themselves via the masthead button,
              which posts a self-claim rather than an assignment -- so no
              "Assign game" action on their own row. */}
          {!rep.isManager && (
            <button
              type="button"
              className="link-btn rep-roster-link"
              onClick={() =>
                setAssign({
                  rep: { id: rep.repId, name: rep.name ?? 'this rep' },
                })
              }
            >
              Assign game →
            </button>
          )}
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
            <h1 className="masthead-title">Territory</h1>
            <p className="masthead-standfirst">
              Performance for the reps who report to{' '}
              {managerName ? managerName : <span className="mono">{id}</span>} —
              assign them games, or claim one for yourself.
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

      {loading && <div className="card muted">Loading territory…</div>}
      {error && <div className="error">{error}</div>}

      {/* ---- Performance: territory KPIs + 6-month trend ---- */}
      {!loading && !error && territory && (
        <section className="card game">
          <span className="game-kicker">Territory</span>
          <h2>Performance</h2>
          <div className="rep-stats terr-stats">
            <div className="rep-stat">
              <span className="rep-stat__label">Roster</span>
              <span className="rep-stat__value">{territory.kpis.repCount}</span>
              <span className="rep-stat__sub">
                {territory.kpis.activeRepCount} active
              </span>
            </div>
            <div className="rep-stat">
              <span className="rep-stat__label">Territory revenue</span>
              <span className="rep-stat__value">
                {usd(territory.kpis.totalRevenue)}
              </span>
              <span className="rep-stat__sub">booked</span>
            </div>
            <div className="rep-stat">
              <span className="rep-stat__label">Commissions</span>
              <span className="rep-stat__value">
                {usd(territory.kpis.totalCommissions)}
              </span>
              <span className="rep-stat__sub">lifetime earned</span>
            </div>
            <div className="rep-stat">
              <span className="rep-stat__label">Games covered</span>
              <span className="rep-stat__value">
                {territory.kpis.gamesCovered}
              </span>
            </div>
            <div className="rep-stat">
              <span className="rep-stat__label">Articles</span>
              <span className="rep-stat__value">
                {territory.kpis.articlesPublished}
              </span>
              <span className="rep-stat__sub">published</span>
            </div>
          </div>

          <h3 className="terr-section__head">Revenue — last 6 months</h3>
          <RevChart
            months={territory.revenueByMonth}
            mini
            ariaLabel="Territory booked revenue by month, last 6 months"
          />
        </section>
      )}

      {/* ---- Referrals: live signups brought in by this territory ---- */}
      <section className="card game refreport-section">
        <div className="refreport-head">
          <div>
            <span className="game-kicker">Growth</span>
            <h2>Referrals</h2>
          </div>
          <span className="refreport-live" title="Refreshes every 30 seconds">
            <span className="refreport-live__dot" aria-hidden="true" />
            Live
          </span>
        </div>
        <p className="exec-section__note">
          Fans this territory has brought in through rep{' '}
          <span className="mono">/join</span> links. Updates every 30 seconds.
        </p>

        {referralsError && !referrals && <div className="error">{referralsError}</div>}
        {!referrals && !referralsError && <p className="muted">Loading referrals…</p>}

        {referrals && (
          <>
            <RefTotalsStrip totals={referrals.totals} />

            {referrals.byManager && (
              <div className="rep-stats terr-stats refreport-rollup">
                <div className="rep-stat">
                  <span className="rep-stat__label">Manager&apos;s own</span>
                  <span className="rep-stat__value">
                    {referrals.byManager.ownReferrals}
                  </span>
                  <span className="rep-stat__sub">brought in directly</span>
                </div>
                <div className="rep-stat">
                  <span className="rep-stat__label">Team</span>
                  <span className="rep-stat__value">
                    {referrals.byManager.teamReferrals}
                  </span>
                  <span className="rep-stat__sub">from correspondents</span>
                </div>
                <div className="rep-stat">
                  <span className="rep-stat__label">Combined</span>
                  <span className="rep-stat__value">
                    {referrals.byManager.combined}
                  </span>
                </div>
              </div>
            )}

            <h3 className="terr-section__head">Referrals — last 30 days</h3>
            <RefBarChart
              points={referrals.timeseries}
              ariaLabel="Territory referrals per day, last 30 days"
            />

            <h3 className="terr-section__head">By rep</h3>
            <RefLeaderboard rows={referrals.perRep} variant="territory" />
          </>
        )}
      </section>

      {/* ---- The coaching table ---- */}
      <section className="card game">
        <span className="game-kicker">Roster</span>
        <h2>Field reps</h2>
        {activateError && <div className="error">{activateError}</div>}
        {!loading && !error && reps.length > 0 ? (
          <QueueTable
            columns={repColumns}
            rows={reps}
            rowKey={(rep) => rep.repId}
            onRowActivate={openRep}
            ariaLabel="Field rep performance for this territory"
          />
        ) : (
          !loading &&
          !error && (
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

      {/* ---- Commission status + recent orders ---- */}
      {summaryLoading && <div className="card muted">Loading activity…</div>}
      {summary && (
        <section className="card game">
          <span className="game-kicker">Activity</span>
          <h2>Recent orders</h2>
          {/* The lifetime total lives in the Performance strip above; this is the
              status split, which is a different question: what's owed vs settled. */}
          <div className="rep-stats terr-stats">
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
    </main>
  );
}
