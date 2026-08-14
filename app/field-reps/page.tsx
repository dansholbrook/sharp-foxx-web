'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
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
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

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
  // The manual create form is demoted behind a toggle -- reps normally arrive via
  // the public application funnel, so it stays hidden until explicitly opened.
  const [showAddRep, setShowAddRep] = useState(false);

  // ---- WHICH LIST YOU ARE LOOKING AT -------------------------------------
  // Three views of one payload, not three fetches: GET /field-reps returns
  // every row a caller may see (with terms redacted per row, server-side), so
  // the tabs are a filter over data already in hand.
  const isAdmin = (user?.roles ?? []).includes('admin');
  // An admin manages nobody, so "My roster" is meaningless for them and they
  // land on the directory instead. An RM lands on their own team.
  const [tab, setTab] = useState<'mine' | 'reps' | 'managers'>(
    isAdmin ? 'reps' : 'mine',
  );

  // The caller's OWN field_reps row, found in the list rather than fetched:
  // every caller who may read this page can see their own row in it.
  const myRep = useMemo(
    () => (reps ?? []).find((r) => r.userId === user?.id) ?? null,
    [reps, user?.id],
  );

  const shown = useMemo(() => {
    const all = reps ?? [];
    if (tab === 'mine') return myRep ? all.filter((r) => r.managerId === myRep.id) : [];
    if (tab === 'managers') return all.filter((r) => r.kind === 'regional_manager');
    return all.filter((r) => r.kind === 'field_rep');
  }, [reps, tab, myRep]);

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
    // Skip the fetch for a role that can't use this page -- it would only 403.
    if (token && allowed) loadReps(token);
  }, [token, allowed]);

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

      {/* ---- ONE ROW: what this page is, which list you are on, and the one
          action that belongs here.

          GONE: the kicker, the display-size title, the standfirst ("add field
          reps and regional managers, and browse the current roster with their
          kind, status, cohort and commission rate" -- a description of the
          table directly beneath it), and the "+ Add Game" button, which opened
          AddGameForm and created an EVENT. Nothing on a roster screen concerns
          games; it sat in the masthead reading as this page's primary action.
          Game creation lives on /games and /my-games, which both already have
          it.

          The create-a-rep card is demoted to the button on the right -- it was
          232px of kicker, heading and "reps normally join via /apply" prose
          wrapped around a form that is collapsed by default. ---- */}
      <div className="page-head">
        <h1 className="row-title page-head__title">Field Reps</h1>
        <div className="gamesdir-tabs" role="group" aria-label="Which roster to show">
          {([
            ...(isAdmin ? [] : [['mine', 'My roster'] as const]),
            ['reps', 'Field Reps'] as const,
            ['managers', 'Regional Managers'] as const,
          ]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`chip${tab === value ? ' chip--on' : ''}`}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="btn-inline"
            onClick={() => setShowAddRep((v) => !v)}
          >
            + Add a field rep
          </button>
        </div>
      </div>

      {/* ---- Create a field rep. The card now appears ONLY when the button in
          the header row opens it: its kicker, heading and reveal button were
          232px of chrome standing permanently in front of a table, wrapped
          around a form that was collapsed anyway.

          THE /apply LINE SURVIVES, as one line inside the form rather than a
          paragraph above a closed card. It is the reason this form is demoted
          at all -- reps normally arrive through the funnel -- and losing it
          would make the manual path look like the intended one. ---- */}
      {showAddRep && (
      <section className="card game">
        <p className="muted" style={{ marginTop: 0, marginBottom: 18, fontSize: '0.9rem' }}>
          Reps normally join via the application funnel (
          <Link href="/apply" className="rep-roster-link">
            /apply
          </Link>
          ). Use this to add one by hand.
        </p>
        <form onSubmit={onCreate} className="rep-form">
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
          <div className="field field--wide">
            <label htmlFor="cohortLabel">Cohort label (optional)</label>
            <input
              id="cohortLabel"
              value={cohortLabel}
              onChange={(e) => setCohortLabel(e.target.value)}
              placeholder="Summer 2026"
              autoComplete="off"
            />
          </div>
          <div className="rep-form-actions">
            <button type="submit" disabled={busy || !displayName.trim() || !email.trim()}>
              {busy ? 'Creating…' : 'Create field rep'}
            </button>
          </div>
          {formError && <div className="error rep-form-msg">{formError}</div>}
          {notice && <div className="success rep-form-msg">{notice}</div>}
        </form>
      </section>
      )}

      {/* ---- The roster. The kicker and "All field reps" heading are gone: the
          active tab names the table, and a heading that says "All" above a
          filtered view was going to be wrong two thirds of the time. ---- */}
      <section className="card game">
        {loading && <p className="muted">Loading field reps…</p>}
        {error && <div className="error">{error}</div>}

        {/* ---- MY ROSTER, WHEN IT IS SMALL OR EMPTY. Five of six regional
            managers currently manage exactly one rep, so this is the normal
            case rather than an edge one, and a bare one-row table reads like a
            bug. The line says whose roster it is and how big, which is the
            context a single row cannot carry by itself. ---- */}
        {!loading && !error && tab === 'mine' && (
          <p className="muted" style={{ marginTop: 0, marginBottom: 16, fontSize: '0.95rem' }}>
            {!myRep
              ? 'You have no regional manager profile, so no reps are assigned to you.'
              : shown.length === 0
                ? 'No reps are assigned to you yet. Reps are linked to a manager when '
                  + 'they are onboarded — until then they appear under Field Reps.'
                : `${shown.length} rep${shown.length === 1 ? '' : 's'} report to you. `
                  + 'Commission is shown for your roster only.'}
          </p>
        )}

        {!loading && !error && shown.length > 0 ? (
          <table className="report-table rep-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Rep ID</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Cohort</th>
                <th className="num">Commission</th>
                <th>Roster</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((rep) => (
                <tr key={rep.id}>
                  <td>{rep.displayName ?? '—'}</td>
                  <td className="mono">{rep.id}</td>
                  <td>{KIND_LABELS[rep.kind] ?? rep.kind}</td>
                  <td>
                    <span className="pill">{rep.status}</span>
                  </td>
                  <td>{rep.cohortLabel ?? '—'}</td>
                  <td className="num">
                    {/* ABSENT IS NOT ZERO. The server omits commissionRate on
                        rows outside the caller's own roster, so `Number(undefined)`
                        would render NaN and `?? 0` would render "0.00%" -- a
                        confident claim that a peer earns nothing. The dash says
                        what is true: this is not yours to see. */}
                    {rep.commissionRate === undefined
                      ? <span className="muted" title="Visible on your own roster only">—</span>
                      : `${(Number(rep.commissionRate) * 100).toFixed(2)}%`}
                  </td>
                  <td>
                    {rep.kind === 'regional_manager' ? (
                      <Link href={`/managers/${rep.id}`} className="link-btn rep-roster-link">
                        View roster →
                      </Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !loading && !error && (
            <div className="results-empty">
              <p className="results-empty__title">No field reps yet</p>
              <p className="results-empty__hint">
                Add your first field rep or regional manager with the form
                above, and they&apos;ll appear here.
              </p>
            </div>
          )
        )}
      </section>
    </main>
  );
}
