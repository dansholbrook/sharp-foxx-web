'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import { RevChart, RevChartLegend } from '../rev-chart';
import { RefTotalsStrip, RefBarChart, RefLeaderboard } from '../refreport';
import {
  getCommissions,
  getExecutiveReport,
  getReferralsExecutive,
  CommissionsReport,
  ExecutiveReport,
  ReferralsExecutiveReport,
} from '../api';

// Referrals refresh cadence: the section is "live" while the tab is open.
const REFERRALS_POLL_MS = 30_000;

// Human labels for the commission source_type keys.
const SOURCE_LABELS: Record<string, string> = {
  ad_order: 'Ad orders',
  nil_contribution: 'NIL',
  subscription: 'Subscriptions',
  retail_order: 'Retail',
};
const SOURCE_KEYS = Object.keys(SOURCE_LABELS);

// Labels for /reports/executive's revenueByStream keys. nil_fees is Sharp Foxx's
// platform fee on NIL releases -- NOT gross contributions, which are the school's
// money passing through us. The label has to say so or the number reads as a ~7x
// undercount of NIL volume to anyone who remembers the old Reports page.
const STREAM_LABELS: Record<string, string> = {
  ad_sales: 'Ad sales',
  nil_fees: 'NIL platform fees',
  subscriptions: 'Subscriptions',
  retail: 'Retail',
};

const usd = (v: string) =>
  Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function DashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);
  const [exec, setExec] = useState<ExecutiveReport | null>(null);
  const [commissions, setCommissions] = useState<CommissionsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Referrals: polled on its own cadence, independent of the one-shot exec load
  // above. Best-effort -- a poll failure keeps the last good data on screen
  // rather than blanking the live section.
  const [referrals, setReferrals] = useState<ReferralsExecutiveReport | null>(null);
  const [referralsError, setReferralsError] = useState<string | null>(null);

  // No token in memory (e.g. after a page refresh) -> back to login. Skip the
  // fetch entirely for a role that can't use this page -- it would only 403.
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;
    (async () => {
      try {
        const [e, c] = await Promise.all([
          getExecutiveReport(token),
          getCommissions(token),
        ]);
        if (!cancelled) {
          setExec(e);
          setCommissions(c);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load reports');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router, allowed]);

  // Live referrals: fetch on mount, then re-poll every 30s while the page is
  // mounted. Separate from the exec load so a slow/failed poll never disturbs the
  // rest of the dashboard, and the interval is torn down on unmount.
  useEffect(() => {
    if (!token || !allowed) return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await getReferralsExecutive(token);
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
    const id = window.setInterval(load, REFERRALS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [token, allowed]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

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
        <span className="masthead-kicker">Executive</span>
        <h1 className="masthead-title">Dashboard</h1>
        <p className="masthead-standfirst">
          Every revenue stream, territory and NIL pool on the platform, pulled
          live from the Sharp Foxx ledger.
        </p>
      </div>

      {loading && <div className="card muted">Loading reports…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && exec && (
        <>
          {/* ---- KPI strip ---- */}
          <section className="card game">
            <span className="game-kicker">At a glance</span>
            <h2>Key figures</h2>
            <div className="rep-stats exec-stats">
              <div className="rep-stat">
                <span className="rep-stat__label">Booked revenue</span>
                <span className="rep-stat__value">{usd(exec.kpis.totalRevenue)}</span>
                <span className="rep-stat__sub">ad sales, lifetime</span>
              </div>
              <div className="rep-stat">
                <span className="rep-stat__label">This month</span>
                <span className="rep-stat__value">
                  {usd(exec.kpis.revenueThisMonth)}
                </span>
              </div>
              <div className="rep-stat">
                <span className="rep-stat__label">Active reps</span>
                <span className="rep-stat__value">{exec.kpis.activeReps}</span>
              </div>
              <div className="rep-stat">
                <span className="rep-stat__label">Advertisers</span>
                <span className="rep-stat__value">{exec.kpis.activeAdvertisers}</span>
                <span className="rep-stat__sub">with booked spend</span>
              </div>
              <div className="rep-stat">
                <span className="rep-stat__label">NIL pool balance</span>
                <span className="rep-stat__value">
                  {usd(exec.kpis.nilPoolTotalBalance)}
                </span>
                <span className="rep-stat__sub">held for schools</span>
              </div>
              <div className="rep-stat">
                <span className="rep-stat__label">NIL released</span>
                <span className="rep-stat__value">
                  {usd(exec.kpis.nilTotalReleased)}
                </span>
                <span className="rep-stat__sub">gross, to athletes</span>
              </div>
            </div>
          </section>

          {/* ---- Revenue by month ---- */}
          <section className="card game">
            <span className="game-kicker">Last 12 months</span>
            <h2>Revenue by month</h2>
            <RevChartLegend />
            <RevChart
              months={exec.revenueByMonth}
              ariaLabel="Ad sales and NIL platform fees by month, last 12 months"
            />
          </section>

          {/* ---- By stream + by state ---- */}
          <div className="exec-split">
            <section className="card game">
              <span className="game-kicker">By stream</span>
              <h2>Revenue streams</h2>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Stream</th>
                    <th className="num">This month</th>
                    <th className="num total">Lifetime</th>
                  </tr>
                </thead>
                <tbody>
                  {exec.revenueByStream.map((s) => (
                    <tr key={s.stream}>
                      <td>{STREAM_LABELS[s.stream] ?? s.stream}</td>
                      <td className="num">{usd(s.thisMonth)}</td>
                      <td className="num total">{usd(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="card game">
              <span className="game-kicker">By state</span>
              <h2>Revenue by state</h2>
              {exec.revenueByState.length > 0 ? (
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>State</th>
                      <th className="num">Orders</th>
                      <th className="num total">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exec.revenueByState.map((s) => (
                      <tr key={s.state ?? 'unassigned'}>
                        {/* A null state means the advertiser isn't linked to an
                            institution -- sponsoring a school is optional, so this
                            bucket is expected to be large, not a data error. */}
                        <td className={s.state ? undefined : 'exec-unassigned'}>
                          {s.state ?? 'Unassigned'}
                        </td>
                        <td className="num">{s.orderCount}</td>
                        <td className="num total">{usd(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">No booked revenue yet.</p>
              )}
            </section>
          </div>

          {/* ---- By manager: drill-through exec -> territory -> rep ---- */}
          <section className="card game">
            <span className="game-kicker">By territory</span>
            <h2>Revenue by manager</h2>
            <p className="exec-section__note">
              Each rep&apos;s booked orders rolled up to their regional manager.
              Open a territory to see per-rep performance.
            </p>
            {exec.revenueByManager.length > 0 ? (
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Manager</th>
                    <th className="num">Reps</th>
                    <th className="num">Commissions</th>
                    <th className="num total">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {exec.revenueByManager.map((m) => (
                    <tr key={m.managerId ?? 'unassigned'}>
                      <td>
                        {/* The Unassigned bucket is reps with no manager_id --
                            there's no territory page to open for it. */}
                        {m.managerId ? (
                          <Link
                            href={`/managers/${m.managerId}`}
                            className="exec-manager-link"
                          >
                            {m.managerName ?? m.managerId}
                          </Link>
                        ) : (
                          <span className="exec-unassigned">Unassigned</span>
                        )}
                      </td>
                      <td className="num">{m.repCount}</td>
                      <td className="num">{usd(m.totalCommissions)}</td>
                      <td className="num total">{usd(m.totalRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No managers on the platform yet.</p>
            )}
          </section>

          {/* ---- Commissions by rep: the by-manager table's drill-sibling ---- */}
          <section className="card game">
            <span className="game-kicker">By field rep</span>
            <h2>Commissions by rep</h2>
            {commissions && commissions.perRep.length > 0 ? (
              <>
                <div className="report-total">
                  <span className="report-total__value">
                    {usd(commissions.grandTotal)}
                  </span>
                  <span className="report-total__label">Total commissions</span>
                </div>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Rep</th>
                      {SOURCE_KEYS.map((k) => (
                        <th key={k} className="num">
                          {SOURCE_LABELS[k]}
                        </th>
                      ))}
                      <th className="num total">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commissions.perRep.map((rep) => (
                      <tr key={rep.repId}>
                        {/* Drill into the rep. Seed the drill-down header with the
                            name + commission total this row already has (it has no
                            ad-order count, so that stat fills in after refetch). */}
                        <td className={rep.displayName ? undefined : 'mono'}>
                          <Link
                            href={`/reps/${rep.repId}?name=${encodeURIComponent(
                              rep.displayName ?? '',
                            )}&commissions=${encodeURIComponent(rep.total)}`}
                            className="rep-roster-link"
                          >
                            {rep.displayName ?? rep.repId}
                          </Link>
                        </td>
                        {SOURCE_KEYS.map((k) => (
                          <td key={k} className="num">
                            {usd(rep.bySource[k] ?? '0')}
                          </td>
                        ))}
                        <td className="num total">{usd(rep.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Grand total</td>
                      {SOURCE_KEYS.map((k) => (
                        <td key={k} />
                      ))}
                      <td className="num total">{usd(commissions.grandTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </>
            ) : (
              <p className="muted">No commissions recorded.</p>
            )}
          </section>

          {/* ---- Referrals: live signups attributed to reps ---- */}
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
              Fans brought in by a rep&apos;s <span className="mono">/join</span>{' '}
              link, versus organic signups. Updates every 30 seconds.
            </p>

            {referralsError && !referrals && (
              <div className="error">{referralsError}</div>
            )}
            {!referrals && !referralsError && (
              <p className="muted">Loading referrals…</p>
            )}

            {referrals && (
              <>
                <RefTotalsStrip totals={referrals.totals} />

                <h3 className="terr-section__head">Signups — last 30 days</h3>
                <RefBarChart
                  points={referrals.timeseries}
                  ariaLabel="Referred versus organic signups per day, last 30 days"
                />

                <h3 className="terr-section__head">Leaderboard</h3>
                <RefLeaderboard rows={referrals.byRep} variant="exec" />

                <h3 className="terr-section__head">By manager</h3>
                {referrals.byManager.length > 0 ? (
                  <div className="refreport-table-wrap">
                    <table className="report-table refreport-table">
                      <thead>
                        <tr>
                          <th>Manager</th>
                          <th className="num">Own</th>
                          <th className="num">Team</th>
                          <th className="num total">Combined</th>
                        </tr>
                      </thead>
                      <tbody>
                        {referrals.byManager.map((m) => (
                          <tr key={m.managerId}>
                            <td>{m.name}</td>
                            <td className="num">{m.ownReferrals}</td>
                            <td className="num">{m.teamReferrals}</td>
                            <td className="num total">{m.combined}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">No managers with referrals yet.</p>
                )}
              </>
            )}
          </section>

          {/* ---- NIL health ---- */}
          <section className="card game">
            <span className="game-kicker">NIL</span>
            <h2>Pool health</h2>
            <p className="exec-section__note">
              Pending obligations are deliverables assigned or submitted but not
              yet released. A pool owing more than it holds is flagged.
            </p>
            {exec.nilHealth.length > 0 ? (
              <table className="report-table">
                <thead>
                  <tr>
                    <th>School</th>
                    <th className="num">Contributed</th>
                    <th className="num">Released</th>
                    <th className="num">Pending</th>
                    <th className="num total">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {exec.nilHealth.map((p) => {
                    // The early warning: the pool owes athletes more than it
                    // holds. Flagged with a badge as well as the row tint --
                    // colour alone isn't a signal everyone can read.
                    const short =
                      Number(p.pendingObligations) > Number(p.balance);
                    return (
                      <tr
                        key={p.institutionId}
                        className={short ? 'exec-warn-row' : undefined}
                      >
                        <td>
                          {p.name}
                          {short && (
                            <span className="exec-warn-badge">Low balance</span>
                          )}
                        </td>
                        <td className="num">{usd(p.totalContributed)}</td>
                        <td className="num">{usd(p.totalReleased)}</td>
                        <td className="num">{usd(p.pendingObligations)}</td>
                        <td className="num total">{usd(p.balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="results-empty">
                <p className="results-empty__title">No NIL pools yet</p>
                <p className="results-empty__hint">
                  When a school opens a NIL pool, its balance and outstanding
                  obligations will appear here.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
