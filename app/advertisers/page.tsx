'use client';

// The advertiser directory (/advertisers): a read-only book of every advertiser
// on the network, for admins and regional managers. Creation still happens via
// Log a Sale (which mints an advertiser on the fly), so this is browse-only in
// v1 -- click a row for the details the /advertisers payload carries.

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../auth-context';
import { AccessDenied } from '../nav';
import { canAccess } from '../roles';
import { QueueTable, SlideOver, Column } from '../queue-table';
import { getAdvertisers, getFieldReps, Advertiser } from '../api';

export default function AdvertisersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [advertisers, setAdvertisers] = useState<Advertiser[] | null>(null);
  // managedByRep is a field_reps id; resolve it to a display name via
  // GET /field-reps (both allowed roles can list) so the "Managed by" column
  // shows a name rather than a raw UUID. Best-effort -- a failure leaves it '—'.
  const [repNameById, setRepNameById] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
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
    (async () => {
      try {
        const data = await getAdvertisers(token);
        if (!cancelled) setAdvertisers(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load advertisers');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // Rep-name map for the "Managed by" column. Independent + best-effort: a
    // failure just leaves managing reps showing their id (or '—' when unset).
    (async () => {
      try {
        const reps = await getFieldReps(token);
        if (!cancelled) {
          setRepNameById(
            Object.fromEntries(
              reps
                .filter((r) => r.displayName)
                .map((r) => [r.id, r.displayName as string]),
            ),
          );
        }
      } catch {
        /* leave the map empty -- the column falls back to the rep id */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router, allowed]);

  // The managing rep as a name (resolved), else the raw id, else '—'.
  const managedBy = (a: Advertiser) =>
    a.managedByRep ? repNameById[a.managedByRep] ?? a.managedByRep : null;

  const columns: Column<Advertiser>[] = [
    { key: 'business', header: 'Business', cell: (a) => a.businessName },
    {
      key: 'market',
      header: 'Market',
      cell: (a) =>
        a.marketId ? (
          <span className="mono">{a.marketId}</span>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      key: 'managed',
      header: 'Managed by',
      cell: (a) => {
        const name = managedBy(a);
        if (!name) return <span className="muted">—</span>;
        // A resolved name renders plain; an unresolved rep id stays mono.
        return name === a.managedByRep ? (
          <span className="mono">{name}</span>
        ) : (
          name
        );
      },
    },
  ];

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  return (
    <main className="feed-home">
      <div className="masthead">
        <span className="masthead-kicker">Advertising</span>
        <h1 className="masthead-title">Advertisers</h1>
        <p className="masthead-standfirst">
          Every advertiser on the network. Read-only for now — new advertisers are
          created when a rep logs a sale.
        </p>
      </div>

      {loading && <div className="card muted">Loading advertisers…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && advertisers && advertisers.length > 0 ? (
        <QueueTable
          columns={columns}
          rows={advertisers}
          rowKey={(a) => a.id}
          ariaLabel="Advertisers"
          renderDetail={(a, close) => {
            const name = managedBy(a);
            return (
              <SlideOver
                onClose={close}
                kicker="Advertiser"
                title={a.businessName}
                label="Advertiser detail"
              >
                <div className="review-facts">
                  <span className="applicant-fact">
                    <span className="applicant-fact__label">Business</span>
                    {a.businessName}
                  </span>
                  <span className="applicant-fact">
                    <span className="applicant-fact__label">Market</span>
                    {a.marketId ? (
                      <span className="mono">{a.marketId}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </span>
                  <span className="applicant-fact">
                    <span className="applicant-fact__label">Managed by</span>
                    {name ? (
                      name === a.managedByRep ? (
                        <span className="mono">{name}</span>
                      ) : (
                        name
                      )
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </span>
                </div>
                <p className="game-hint">
                  Order history isn&apos;t available from the advertiser directory
                  yet — a rep&apos;s logged sales appear on their drill-down.
                </p>
              </SlideOver>
            );
          }}
        />
      ) : (
        !loading &&
        !error && (
          <div className="results-empty">
            <p className="results-empty__title">No advertisers yet</p>
            <p className="results-empty__hint">
              When a rep logs a sale against a new business, that advertiser will
              appear here.
            </p>
          </div>
        )
      )}
    </main>
  );
}
