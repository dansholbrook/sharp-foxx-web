'use client';

// The rep's "business office" (/my-sales): where a rep logs advertiser sales and
// tracks the commission they've earned. Split out of My Games so that page stays
// game-day only. Open to anyone with a rep profile (field_rep, regional_manager,
// admin with a rep row); a bare admin with no rep profile 403s on the earnings
// call, which we surface as a branded access state rather than a broken page.

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../auth-context';
import { AccessDenied } from '../nav';
import { LogSaleForm } from '../log-sale-form';
import { RefShareCard } from '../refshare-card';
import { canAccess } from '../roles';
import { QueueTable, SlideOver, Column } from '../queue-table';
import {
  getMyAdOrders,
  getAdvertisers,
  getAdPackages,
  getMyReferral,
  getMyEarnings,
  etDateTime,
  AdOrder,
  AdPackage,
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

// Readable earned/paid timestamp as an ET date; '—' when absent.
function formatEarned(iso: string | null): string {
  if (!iso) return '—';
  return (
    etDateTime(iso, { year: 'numeric', month: 'short', day: 'numeric' }) || iso
  );
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
  // packageId -> package, so the sale detail can name the package + its run length
  // (ad orders carry only the package UUID). Best-effort like the advertiser map.
  const [packagesById, setPackagesById] = useState<Record<string, AdPackage>>({});
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
      const [orders, advertisers, packages] = await Promise.all([
        getMyAdOrders(t),
        getAdvertisers(t),
        getAdPackages(t),
      ]);
      setSales(orders);
      setAdvertisersById(
        Object.fromEntries(advertisers.map((a) => [a.id, a.businessName])),
      );
      setPackagesById(Object.fromEntries(packages.map((p) => [p.id, p])));
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
    // The rep's own commission rate for the Log a Sale confirmation, from the
    // endpoint that resolves THEIR OWN row by their own user_id. This used to
    // list every field rep and filter for self, which is why closing that
    // route's leak briefly took this number with it; me/referral now carries it
    // and there is no directory read in the path at all.
    //
    // Still best-effort: a caller with no field_reps row 403s here (the share
    // card treats that the same way), and the confirmation falls back to
    // "Sale logged." without a rate.
    getMyReferral(token)
      .then((r) => setCommissionRate(r.commissionRate))
      .catch(() => {});
  }, [token, router, allowed, loadSales, loadEarnings]);

  const advertiserName = (s: AdOrder) =>
    advertisersById[s.advertiserId] ?? 'Advertiser';
  const packageOf = (s: AdOrder) =>
    s.packageId ? packagesById[s.packageId] : undefined;

  // ---- My Sales table: one row per ad order; row click -> full sale detail. ----
  const salesColumns: Column<AdOrder>[] = [
    { key: 'advertiser', header: 'Advertiser', cell: advertiserName },
    {
      key: 'package',
      header: 'Package',
      cell: (s) => {
        const pkg = packageOf(s);
        if (pkg) return pkg.name;
        return s.packageId ? <span className="muted">Custom</span> : <span className="muted">—</span>;
      },
    },
    { key: 'amount', header: 'Amount', align: 'right', cell: (s) => usd(s.amount) },
    {
      key: 'status',
      header: 'Status',
      cell: (s) => <span className="pill">{s.status}</span>,
    },
    { key: 'date', header: 'Date', cell: (s) => formatEarned(s.createdAt) },
  ];

  // ---- Commission ledger table: one row per commission; row click -> detail. ----
  const commissionColumns: Column<MyEarningsReport['commissions'][number]>[] = [
    {
      key: 'source',
      header: 'Source',
      cell: (c) => (
        <span className="pill">
          {SOURCE_LABELS_COMMISSION[c.sourceType] ?? c.sourceType}
        </span>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'right', cell: (c) => usd(c.amount) },
    {
      key: 'status',
      header: 'Status',
      cell: (c) => <span className="pill">{c.status}</span>,
    },
    { key: 'date', header: 'Date', cell: (c) => formatEarned(c.earnedAt) },
  ];

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  return (
    <main className="feed-home">
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
          {/* ---- Share your referral link (self-hides if no rep profile) ---- */}
          <RefShareCard token={token} />

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
                  <QueueTable
                    columns={commissionColumns}
                    rows={earnings.commissions}
                    rowKey={(c) => c.id}
                    ariaLabel="Your commission ledger"
                    renderDetail={(c, close) => (
                      <SlideOver
                        onClose={close}
                        kicker={SOURCE_LABELS_COMMISSION[c.sourceType] ?? c.sourceType}
                        title={usd(c.amount)}
                        label="Commission detail"
                      >
                        <div className="review-facts">
                          <span className="applicant-fact">
                            <span className="applicant-fact__label">Source</span>
                            {SOURCE_LABELS_COMMISSION[c.sourceType] ?? c.sourceType}
                          </span>
                          <span className="applicant-fact">
                            <span className="applicant-fact__label">Base × rate</span>
                            <span className="mono">
                              {usd(c.baseAmount)} × {ratePct(c.rate)}
                            </span>
                          </span>
                          <span className="applicant-fact">
                            <span className="applicant-fact__label">Amount</span>
                            {usd(c.amount)}
                          </span>
                          <span className="applicant-fact">
                            <span className="applicant-fact__label">Status</span>
                            <span className="pill">{c.status}</span>
                          </span>
                          <span className="applicant-fact">
                            <span className="applicant-fact__label">Earned</span>
                            {formatEarned(c.earnedAt)}
                          </span>
                          <span className="applicant-fact">
                            <span className="applicant-fact__label">Paid</span>
                            {formatEarned(c.paidAt)}
                          </span>
                        </div>
                      </SlideOver>
                    )}
                  />
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
              <QueueTable
                columns={salesColumns}
                rows={sales}
                rowKey={(s) => s.id}
                ariaLabel="Your logged sales"
                renderDetail={(s, close) => {
                  const advertiser = advertiserName(s);
                  const pkg = packageOf(s);
                  const runs =
                    s.startsOn || s.endsOn
                      ? `${formatDate(s.startsOn)} – ${formatDate(s.endsOn)}`
                      : '—';
                  // Estimated payout to the rep at their own commission rate. The
                  // actual commission is credited server-side; this is the preview.
                  const estCommission = commissionRate
                    ? String(Number(s.amount) * Number(commissionRate))
                    : null;
                  return (
                    <SlideOver
                      onClose={close}
                      kicker="Ad sale"
                      title={advertiser}
                      label="Sale detail"
                      footer={
                        <span className="muted">
                          Sold by you · {formatEarned(s.createdAt)}
                        </span>
                      }
                    >
                      <div className="review-facts">
                        <span className="applicant-fact">
                          <span className="applicant-fact__label">Advertiser</span>
                          {advertiser}
                        </span>
                        <span className="applicant-fact">
                          <span className="applicant-fact__label">Package</span>
                          {pkg
                            ? `${pkg.name} · ${pkg.durationDays} days`
                            : s.packageId
                              ? 'Custom package'
                              : 'No package'}
                        </span>
                        <span className="applicant-fact">
                          <span className="applicant-fact__label">Amount</span>
                          {usd(s.amount)}
                        </span>
                        <span className="applicant-fact">
                          <span className="applicant-fact__label">Status</span>
                          <span className="pill">{s.status}</span>
                        </span>
                        <span className="applicant-fact">
                          <span className="applicant-fact__label">Runs</span>
                          {runs}
                        </span>
                        {estCommission && (
                          <span className="applicant-fact">
                            <span className="applicant-fact__label">
                              Est. commission
                            </span>
                            {usd(estCommission)}
                          </span>
                        )}
                        <span className="applicant-fact">
                          <span className="applicant-fact__label">Logged</span>
                          {formatEarned(s.createdAt)}
                        </span>
                      </div>
                      {estCommission && (
                        <p className="game-hint">
                          Estimated at your {ratePct(commissionRate!)} rate — the
                          actual commission is credited when the sale is booked and
                          shows in My Earnings above.
                        </p>
                      )}
                    </SlideOver>
                  );
                }}
              />
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
