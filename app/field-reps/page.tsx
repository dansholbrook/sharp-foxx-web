'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import {
  getFieldReps,
  createUser,
  createFieldRep,
  FieldRep,
} from '../api';

const KIND_LABELS: Record<FieldRep['kind'], string> = {
  field_rep: 'Field rep',
  regional_manager: 'Regional manager',
};

export default function FieldRepsPage() {
  const router = useRouter();
  const { token, user, logout } = useAuth();

  const [reps, setReps] = useState<FieldRep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Create form state.
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [kind, setKind] = useState<FieldRep['kind']>('field_rep');
  const [commissionRate, setCommissionRate] = useState('0');
  const [cohortLabel, setCohortLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // No token in memory (e.g. after a page refresh) -> back to login.
  useEffect(() => {
    if (!token) router.replace('/');
  }, [token, router]);

  // Load (and reload) the rep list.
  async function loadReps(t: string) {
    setLoading(true);
    setError(null);
    try {
      setReps(await getFieldReps(t));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load field reps');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) loadReps(token);
  }, [token]);

  function onLogout() {
    logout();
    router.replace('/');
  }

  // Two-step create: mint the user, then create the rep linked to it, then
  // refresh the list so the new rep shows up.
  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      const rate = commissionRate.trim() === '' ? 0 : Number(commissionRate);
      if (Number.isNaN(rate) || rate < 0 || rate > 1) {
        throw new Error('Commission rate must be a number between 0 and 1');
      }

      const newUser = await createUser(token, {
        email: email.trim(),
        displayName: displayName.trim(),
      });
      await createFieldRep(token, {
        userId: newUser.id,
        kind,
        commissionRate: rate,
        cohortLabel: cohortLabel.trim() || undefined,
      });

      setNotice(`Created ${KIND_LABELS[kind].toLowerCase()} for ${newUser.displayName}.`);
      setEmail('');
      setDisplayName('');
      setKind('field_rep');
      setCommissionRate('0');
      setCohortLabel('');
      await loadReps(token);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create field rep');
    } finally {
      setBusy(false);
    }
  }

  if (!token) return null;

  return (
    <main>
      <div className="header-row">
        <div>
          <h1>Field reps</h1>
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

      {/* ---- Create a field rep ---- */}
      <section className="card">
        <h2>Add a field rep</h2>
        <p className="muted" style={{ marginTop: -4, marginBottom: 16, fontSize: '0.85rem' }}>
          Creates a new user, then a rep linked to it.
        </p>
        <form onSubmit={onCreate}>
          <div className="field">
            <label htmlFor="displayName">Display name</label>
            <input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jordan Fox"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jordan@example.com"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label htmlFor="kind">Kind</label>
            <select
              id="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as FieldRep['kind'])}
            >
              <option value="field_rep">Field rep</option>
              <option value="regional_manager">Regional manager</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="commissionRate">Commission rate (0–1)</label>
            <input
              id="commissionRate"
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
              placeholder="0.05"
              inputMode="decimal"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="cohortLabel">Cohort label (optional)</label>
            <input
              id="cohortLabel"
              value={cohortLabel}
              onChange={(e) => setCohortLabel(e.target.value)}
              placeholder="Summer 2026"
              autoComplete="off"
            />
          </div>
          <button type="submit" disabled={busy || !displayName.trim() || !email.trim()}>
            {busy ? 'Creating…' : 'Create field rep'}
          </button>
          {formError && <div className="error">{formError}</div>}
          {notice && <div className="success">{notice}</div>}
        </form>
      </section>

      {/* ---- Existing field reps ---- */}
      <section className="card">
        <h2>All field reps</h2>
        {loading && <p className="muted">Loading field reps…</p>}
        {error && <div className="error">{error}</div>}
        {!loading && !error && reps && reps.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Rep ID</th>
                <th>User ID</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Cohort</th>
                <th className="num">Commission</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((rep) => (
                <tr key={rep.id}>
                  <td className="mono">{rep.id}</td>
                  <td className="mono">{rep.userId}</td>
                  <td>{KIND_LABELS[rep.kind] ?? rep.kind}</td>
                  <td>
                    <span className="pill">{rep.status}</span>
                  </td>
                  <td>{rep.cohortLabel ?? '—'}</td>
                  <td className="num">
                    {(Number(rep.commissionRate) * 100).toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !loading && !error && <p className="muted">No field reps yet.</p>
        )}
      </section>
    </main>
  );
}
