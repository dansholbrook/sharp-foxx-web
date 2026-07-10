'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../../auth-context';
import { AppNav, AccessDenied } from '../../nav';
import { AssignGameForm } from '../../assign-game-form';
import { canAccess } from '../../roles';
import {
  getManagerReps,
  getManagerSummary,
  ManagerRoster,
  ManagerSummary,
} from '../../api';

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

  // Territory summary (stat cards + recent activity). Loaded independently of the
  // roster and best-effort: a failure here must not blank the roster below, so it
  // just hides the summary strip. :id is the manager's own field_reps id -- the
  // same id the roster call uses -- so a regional_manager landing here loads their
  // own territory and an admin loads whichever manager they opened.
  const [summary, setSummary] = useState<ManagerSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

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
    return () => {
      cancelled = true;
    };
  }, [token, id, router, allowed]);

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
                {summary.recentOrders.map((o) => (
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
        {!loading && !error && reps.length > 0 ? (
          <table className="report-table rep-table">
            <thead>
              <tr>
                <th>Field rep</th>
                <th>Email</th>
                <th className="num">Total commissions</th>
                <th className="num">Ad orders</th>
                <th>Assign</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((rep) => (
                <tr key={rep.repId}>
                  <td>
                    {/* Drill into the rep. The header stats (name, commissions,
                        ad orders) come straight off this roster row via query
                        params so the drill-down needn't refetch them; the page
                        resolves the rep's user id separately for its content. */}
                    <Link
                      href={`/reps/${rep.repId}?name=${encodeURIComponent(
                        rep.displayName ?? '',
                      )}&commissions=${encodeURIComponent(
                        rep.totalCommissions,
                      )}&adOrders=${rep.adOrdersCount}`}
                      className="rep-roster-link"
                    >
                      {rep.displayName ?? '—'}
                    </Link>
                  </td>
                  <td className="mono">{rep.email ?? '—'}</td>
                  <td className="num">{usd(rep.totalCommissions)}</td>
                  <td className="num">{rep.adOrdersCount}</td>
                  <td>
                    <button
                      type="button"
                      className="link-btn rep-roster-link"
                      onClick={() =>
                        setAssign({
                          rep: {
                            id: rep.repId,
                            name: rep.displayName ?? 'this rep',
                          },
                        })
                      }
                    >
                      Assign game →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
