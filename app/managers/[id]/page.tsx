'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../../auth-context';
import { AppNav, AccessDenied } from '../../nav';
import { AssignGameForm } from '../../assign-game-form';
import { canAccess } from '../../roles';
import { getManagerReps, ManagerRoster } from '../../api';

const usd = (v: string) =>
  Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

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
                  <td>{rep.displayName ?? '—'}</td>
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
