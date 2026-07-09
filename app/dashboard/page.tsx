'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import {
  getCommissions,
  getRevenue,
  CommissionsReport,
  RevenueReport,
} from '../api';

// Human labels for the commission source_type keys and revenue streams.
const SOURCE_LABELS: Record<string, string> = {
  ad_order: 'Ad orders',
  nil_contribution: 'NIL',
  subscription: 'Subscriptions',
  retail_order: 'Retail',
};
const SOURCE_KEYS = Object.keys(SOURCE_LABELS);

const STREAM_LABELS: Record<string, string> = {
  adOrders: 'Ad orders',
  nilContributions: 'NIL contributions',
  subscriptionPayments: 'Subscription payments',
  retailOrders: 'Retail orders',
};

const usd = (v: string) =>
  Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function DashboardPage() {
  const router = useRouter();
  const { token, user, logout } = useAuth();
  const [commissions, setCommissions] = useState<CommissionsReport | null>(null);
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // No token in memory (e.g. after a page refresh) -> back to login.
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [c, r] = await Promise.all([
          getCommissions(token),
          getRevenue(token),
        ]);
        if (!cancelled) {
          setCommissions(c);
          setRevenue(r);
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
  }, [token, router]);

  function onLogout() {
    logout();
    router.replace('/');
  }

  if (!token) return null;

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
        <div className="nav-links">
          <Link href="/feed" className="link-btn">
            Feed
          </Link>
          <Link href="/my-games" className="link-btn">
            My games
          </Link>
          <Link href="/field-reps" className="link-btn">
            Field reps
          </Link>
          <button className="link-btn" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>

      <div className="masthead">
        <span className="masthead-kicker">Revenue &amp; commissions</span>
        <h1 className="masthead-title">Reports</h1>
        <p className="masthead-standfirst">
          Commissions earned per field rep and revenue booked by stream, pulled
          live from the Sharp Foxx ledger.
        </p>
      </div>

      {loading && <div className="card muted">Loading reports…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && (
        <>
          {/* ---- Commissions by rep ---- */}
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
                      {rep.displayName ? (
                        <td>{rep.displayName}</td>
                      ) : (
                        <td className="mono">{rep.repId}</td>
                      )}
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

          {/* ---- Revenue by stream ---- */}
          <section className="card game">
            <span className="game-kicker">By stream</span>
            <h2>Revenue by stream</h2>
            {revenue && (
              <>
                <div className="report-total">
                  <span className="report-total__value">
                    {usd(revenue.total)}
                  </span>
                  <span className="report-total__label">Total revenue</span>
                </div>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Stream</th>
                      <th className="num total">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(revenue.byStream).map(([key, val]) => (
                      <tr key={key}>
                        <td>{STREAM_LABELS[key] ?? key}</td>
                        <td className="num total">{usd(val)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num total">{usd(revenue.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
