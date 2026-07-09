'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../../auth-context';
import { AppNav, AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import { getManagerReps, ManagerRoster } from '../../api';

const usd = (v: string) =>
  Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

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
    return () => {
      cancelled = true;
    };
  }, [token, id, router, allowed]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const reps = roster?.reps ?? [];

  return (
    <main>
      <div className="header-row">
        <div>
          <h1>Manager roster</h1>
          <span className="muted">
            Regional manager <span className="mono">{id}</span>
          </span>
          <br />
          <span className="muted">
            Signed in as <span className="mono">{user?.displayName ?? user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <AppNav />
      </div>

      <section className="card">
        <h2>Field reps</h2>
        {loading && <p className="muted">Loading roster…</p>}
        {error && <div className="error">{error}</div>}
        {!loading && !error && reps.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Field rep</th>
                <th>Email</th>
                <th className="num">Total commissions</th>
                <th className="num">Ad orders</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((rep) => (
                <tr key={rep.repId}>
                  <td>{rep.displayName ?? '—'}</td>
                  <td className="mono">{rep.email ?? '—'}</td>
                  <td className="num">{usd(rep.totalCommissions)}</td>
                  <td className="num">{rep.adOrdersCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !loading && !error && (
            <p className="muted">No reps report to this manager.</p>
          )
        )}
      </section>
    </main>
  );
}
