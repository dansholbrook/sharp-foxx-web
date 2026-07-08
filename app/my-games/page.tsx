'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { getMyAssignments, MyAssignment } from '../api';

// Human labels for the assignment source. 'assigned' means a manager put the
// rep on this game; 'self_claimed' means the rep grabbed it themselves.
const SOURCE_LABELS: Record<MyAssignment['source'], string> = {
  assigned: 'Assigned',
  self_claimed: 'Self-claimed',
};

// Format the timestamptz string the API returns; fall back to the raw value if
// it somehow doesn't parse.
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}

// The API returns team UUIDs only (no name join), so show ids when present and
// an honest dash when either side is missing.
function teams(a: MyAssignment): string {
  const { homeTeamId, awayTeamId } = a.event;
  if (!homeTeamId && !awayTeamId) return '—';
  return `${homeTeamId ?? '—'} vs ${awayTeamId ?? '—'}`;
}

export default function MyGamesPage() {
  const router = useRouter();
  const { token, user, logout } = useAuth();

  const [games, setGames] = useState<MyAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // No token in memory (e.g. after a page refresh) -> back to login.
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await getMyAssignments(token);
        if (!cancelled) setGames(data);
      } catch (err) {
        // The client turns failures into "<status> <message>", e.g. a user with
        // no rep profile gets "404 No rep profile for this user".
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load games');
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
    <main>
      <div className="header-row">
        <div>
          <h1>My games</h1>
          <span className="muted">
            Signed in as <span className="mono">{user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <div className="nav-links">
          <Link href="/dashboard" className="link-btn">
            ← Reports
          </Link>
          <button className="link-btn" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>

      <section className="card">
        <h2>Assigned games</h2>
        {loading && <p className="muted">Loading games…</p>}
        {error && <div className="error">{error}</div>}
        {!loading && !error && games && games.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Sport</th>
                <th>Venue</th>
                <th>Scheduled</th>
                <th>Teams</th>
                <th>Event</th>
                <th>Assignment</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr key={g.id}>
                  <td style={{ textTransform: 'capitalize' }}>{g.event.sport}</td>
                  <td>{g.event.venue ?? '—'}</td>
                  <td>{formatWhen(g.event.scheduledAt)}</td>
                  <td className="mono">{teams(g)}</td>
                  <td>
                    <span className="pill">{g.event.status}</span>
                  </td>
                  <td>
                    <span className="pill">{g.status}</span>
                  </td>
                  <td>
                    <span className="pill">{SOURCE_LABELS[g.source] ?? g.source}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !loading && !error && <p className="muted">No games assigned yet.</p>
        )}
      </section>
    </main>
  );
}
