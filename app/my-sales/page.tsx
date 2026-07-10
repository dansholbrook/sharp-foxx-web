'use client';

// The rep's "business office" (/my-sales): where a rep logs advertiser sales and
// tracks the commission they've earned. Split out of My Games so that page stays
// game-day only. Open to anyone with a rep profile (field_rep, regional_manager,
// admin with a rep row); a bare admin with no rep profile 403s on the earnings
// call, which we surface as a branded access state rather than a broken page.

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { LogSaleForm } from '../log-sale-form';
import { canAccess } from '../roles';
import {
  getMyAdOrders,
  getAdvertisers,
  getFieldReps,
  getMyEarnings,
  AdOrder,
  MyEarningsReport,
} from '../api';

const usd = (v: string) =>
  Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Human badge label for a commission's source_type (Ad Sale / NIL /
// Subscription / Retail). Falls back to the raw value for any future source.
const SOURCE_LABELS_COMMISSION: Record<
  MyEarningsReport['commissions'][number]['sourceType'],
  string
> = {
  ad_order: 'Ad Sale',
  nil_contribution: 'NIL',
  subscription: 'Subscription',
  retail_order: 'Retail',
};

// A 4dp rate string (e.g. "0.1500") as a compact percent ("15%"). Trims trailing
// zeros so 0.1500 -> "15%" and 0.1250 -> "12.5%".
function ratePct(rate: string): string {
  const n = Number(rate) * 100;
  if (Number.isNaN(n)) return '—';
  return `${Number(n.toFixed(2))}%`;
}

// Readable earned/paid timestamp (timestamptz ISO); '—' when absent.
function formatEarned(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

// Readable date for an ad order's date-only fields (yyyy-mm-dd), parsed as UTC so
// it never drifts a day in negative-offset timezones. '—' when absent.
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
}

export default function MySalesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [showLogSale, setShowLogSale] = useState(false);

  // My Sales: the rep's own ad orders, plus an advertiserId -> businessName map
  // (ad orders carry only the id) and the rep's commission rate for the Log a
  // Sale confirmation. All best-effort -- a failure here must not break the page.
  const [sales, setSales] = useState<AdOrder[] | null>(null);
  const [advertisersById, setAdvertisersById] = useState<Record<string, string>>({});
  const [salesError, setSalesError] = useState<string | null>(null);
  const [salesLoading, setSalesLoading] = useState(true);
  const [commissionRate, setCommissionRate] = useState<string | null>(null);

  // My Earnings: the caller's own commission totals + ledger (reps AND managers
  // have a rep profile). A caller with no rep profile (e.g. a bare admin) 403s --
  // there's nothing for this page to show, so we flip noRepProfile and render the
  // branded access state in place of the sales/earnings sections.
  const [earnings, setEarnings] = useState<MyEarningsReport | null>(null);
  const [earningsError, setEarningsError] = useState<string | null>(null);
  const [earningsLoading, setEarningsLoading] = useState(true);
  const [noRepProfile, setNoRepProfile] = useState(false);

  // Load (or reload) the My Sales section: the rep's own ad orders plus the
  // advertiser-name map used to render them. Reused on mount and after logging a
  // sale. Its own error state so a sales failure never touches the earnings list.
  const loadSales = useCallback(async (t: string) => {
    setSalesLoading(true);
    setSalesError(null);
    try {
      const [orders, advertisers] = await Promise.all([
        getMyAdOrders(t),
        getAdvertisers(t),
      ]);
      setSales(orders);
      setAdvertisersById(
        Object.fromEntries(advertisers.map((a) => [a.id, a.businessName])),
      );
    } catch (err) {
      setSalesError(err instanceof Error ? err.message : 'Failed to load sales');
    } finally {
      setSalesLoading(false);
    }
  }, []);

  // Load (or reload) the My Earnings section: the caller's own commission totals
  // and ledger. Its own error state so an earnings failure never touches the
  // sales list; a 403 (no rep profile) turns the whole page into its access state.
  const loadEarnings = useCallback(async (t: string) => {
    setEarningsLoading(true);
    setEarningsError(null);
    try {
      const data = await getMyEarnings(t);
      setEarnings(data);
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Failed to load earnings';
      // No rep profile -> nothing to show; render the branded access state.
      if (m.startsWith('403')) setNoRepProfile(true);
      else setEarningsError(m);
    } finally {
      setEarningsLoading(false);
    }
  }, []);

  // No token in memory (e.g. after a page refresh) -> back to login.
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    loadSales(token);
    loadEarnings(token);
    // Resolve the rep's own commission rate for the Log a Sale confirmation.
    // Best-effort: a plain rep may not be able to list field-reps, in which case
    // the confirmation just falls back to "Sale logged."
    const uid = user?.id;
    if (uid) {
      getFieldReps(token)
        .then((reps) => {
          const mine = reps.find((r) => r.userId === uid);
          if (mine) setCommissionRate(mine.commissionRate);
        })
        .catch(() => {});
    }
  }, [token, router, allowed, loadSales, loadEarnings, user?.id]);

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
        <div className="masthead-head">
          <div>
            <span className="masthead-kicker">Your business</span>
            <h1 className="masthead-title">My Sales</h1>
            <p className="masthead-standfirst">
              Log advertiser deals and track the commission you&apos;ve earned —
              every sale you close and every dollar it pays out, in one place.
            </p>
          </div>
          {!noRepProfile && (
            <div className="masthead-actions">
              <button
                type="button"
                className="btn-inline"
                onClick={() => setShowLogSale(true)}
              >
                Log a Sale
              </button>
            </div>
          )}
        </div>
      </div>

      {showLogSale && (
        <LogSaleForm
          token={token}
          commissionRate={commissionRate}
          onCreated={() => {
            // A logged sale creates its commission atomically, so refresh both.
            loadSales(token);
            loadEarnings(token);
          }}
          onClose={() => setShowLogSale(false)}
        />
      )}

      {/* ---- No rep profile (e.g. a bare admin): branded access state instead of
          empty sales/earnings sections that would only ever error. ---- */}
      {noRepProfile ? (
        <div className="results-empty">
          <p className="results-empty__title">No rep profile on this account</p>
          <p className="results-empty__hint">
            My Sales is a rep&apos;s business office — logging sales and tracking
            commissions needs a rep profile, which this account doesn&apos;t have.
            Use the links above to head somewhere you can.
          </p>
        </div>
      ) : (
        <>
          {/* ---- My Earnings ---- */}
          <section className="card game">
            <span className="game-kicker">Commissions</span>
            <h2>My Earnings</h2>
            {earningsLoading && <p className="muted">Loading earnings…</p>}
            {earningsError && <div className="error">{earningsError}</div>}
            {!earningsLoading && !earningsError && earnings && (
              <>
                <div className="rep-stats earnings-stats">
                  <div className="rep-stat">
                    <span className="rep-stat__label">Pending</span>
                    <span className="rep-stat__value">{usd(earnings.totals.pending)}</span>
                  </div>
                  <div className="rep-stat">
                    <span className="rep-stat__label">Approved</span>
                    <span className="rep-stat__value">{usd(earnings.totals.approved)}</span>
                  </div>
                  <div className="rep-stat">
                    <span className="rep-stat__label">Paid</span>
                    <span className="rep-stat__value">{usd(earnings.totals.paid)}</span>
                  </div>
                  <div className="rep-stat">
                    <span className="rep-stat__label">Lifetime</span>
                    <span className="rep-stat__value">{usd(earnings.totals.lifetime)}</span>
                  </div>
                </div>

                {earnings.commissions.length > 0 ? (
                  <table className="report-table rep-table earnings-ledger">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Base × rate</th>
                        <th className="num">Amount</th>
                        <th>Status</th>
                        <th>Earned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {earnings.commissions.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <span className="pill">
                              {SOURCE_LABELS_COMMISSION[c.sourceType] ?? c.sourceType}
                            </span>
                          </td>
                          <td className="mono earnings-calc">
                            {usd(c.baseAmount)} × {ratePct(c.rate)}
                          </td>
                          <td className="num total">{usd(c.amount)}</td>
                          <td>
                            <span className="pill">{c.status}</span>
                          </td>
                          <td>{formatEarned(c.earnedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="results-empty">
                    <p className="results-empty__title">No commissions yet</p>
                    <p className="results-empty__hint">
                      Log a sale or land an NIL, subscription, or retail deal — the
                      commission you earn will show up here.
                    </p>
                  </div>
                )}
              </>
            )}
          </section>

          {/* ---- My Sales ---- */}
          <section className="card game">
            <span className="game-kicker">Advertising</span>
            <h2>My Sales</h2>
            {salesLoading && <p className="muted">Loading sales…</p>}
            {salesError && <div className="error">{salesError}</div>}
            {!salesLoading && !salesError && sales && sales.length > 0 ? (
              <table className="report-table rep-table">
                <thead>
                  <tr>
                    <th>Advertiser</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Dates</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.id}>
                      <td>{advertisersById[s.advertiserId] ?? 'Advertiser'}</td>
                      <td>{usd(s.amount)}</td>
                      <td>
                        <span className="pill">{s.status}</span>
                      </td>
                      <td>
                        {s.startsOn || s.endsOn ? (
                          `${formatDate(s.startsOn)} – ${formatDate(s.endsOn)}`
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              !salesLoading &&
              !salesError && (
                <div className="results-empty">
                  <p className="results-empty__title">No sales logged yet</p>
                  <p className="results-empty__hint">
                    Use “Log a Sale” above to record an advertiser deal — it will show
                    up here with the commission you earned.
                  </p>
                </div>
              )
            )}
          </section>
        </>
      )}
    </main>
  );
}
