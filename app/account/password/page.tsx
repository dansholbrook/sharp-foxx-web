'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { changePassword } from '../../api';
import { useAuth } from '../../auth-context';
import { AppNav } from '../../nav';
import { landingFor } from '../../roles';

// Backend minimum for a new password.
const MIN = 10;

// Change (or first-time set) the caller's password. Reached two ways:
//  - Forced: right after a login whose response had mustChangePassword (the
//    login page routes here with ?first=1) -- the copy nudges the user to
//    replace their temporary password before continuing.
//  - Voluntary: from the "Change password" nav item, any time.
// Both require the current password (the backend enforces it whenever any
// password is set, including temps) and both continue to the role landing on
// success. useSearchParams needs a Suspense boundary, so the page wraps the
// form in one.
function ChangePasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const forced = params.get('first') === '1';
  const { token, user } = useAuth();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // No token in memory (e.g. a page refresh cleared it) -> back to login.
  useEffect(() => {
    if (!token) router.replace('/');
  }, [token, router]);

  if (!token) return null;

  const landing = landingFor(user?.roles ?? []);
  const mismatch = confirm.length > 0 && confirm !== next;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    if (next.length < MIN) {
      setError(`New password must be at least ${MIN} characters.`);
      return;
    }
    if (next !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await changePassword(token, { currentPassword: current, newPassword: next });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="apply-page">
      <div className="header-row">
        <div>
          <span className="wordmark">Sharp Foxx</span>
          <span className="muted">
            Signed in as{' '}
            <span className="mono">{user?.displayName ?? user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <AppNav />
      </div>

      {done ? (
        <>
          <div className="masthead">
            <span className="masthead-kicker">Account</span>
            <h1 className="masthead-title">Password updated</h1>
            <p className="masthead-standfirst">
              Your new password is set — use it the next time you sign in.
            </p>
          </div>
          <section className="card game">
            <p className="apply-confirm__lead">You&apos;re all set.</p>
            <div className="rep-form-actions">
              <button type="button" onClick={() => router.push(landing)}>
                Continue
              </button>
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="masthead">
            <span className="masthead-kicker">Account</span>
            <h1 className="masthead-title">
              {forced ? 'Set your password' : 'Change password'}
            </h1>
            <p className="masthead-standfirst">
              {forced
                ? "You're signed in with a temporary password. Choose a new one to finish setting up your account."
                : "Update the password you use to sign in. You'll need your current password to confirm."}
            </p>
          </div>

          <section className="card game apply-card">
            <span className="game-kicker">Security</span>
            <h2>New password</h2>

            <form onSubmit={onSubmit} className="rep-form apply-form">
              <div className="field">
                <label htmlFor="current">Current password</label>
                <input
                  id="current"
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder={forced ? 'Your temporary password' : 'Your current password'}
                  autoComplete="current-password"
                />
              </div>

              <div className="field">
                <label htmlFor="new">New password</label>
                <input
                  id="new"
                  type="password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder={`At least ${MIN} characters`}
                  autoComplete="new-password"
                />
                <span
                  className={`apply-pitch-count${
                    next.length >= MIN ? ' apply-pitch-count--ok' : ''
                  }`}
                >
                  {next.length < MIN
                    ? `${next.length}/${MIN} characters — ${MIN - next.length} to go`
                    : `${next.length} characters`}
                </span>
              </div>

              <div className="field">
                <label htmlFor="confirm">Confirm new password</label>
                <input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter your new password"
                  autoComplete="new-password"
                />
                {mismatch && (
                  <span className="apply-field-error">
                    New passwords do not match.
                  </span>
                )}
              </div>

              <div className="rep-form-actions">
                <button
                  type="submit"
                  disabled={busy || !current || next.length < MIN || mismatch}
                >
                  {busy ? 'Saving…' : 'Update password'}
                </button>
              </div>

              {error && <div className="error rep-form-msg">{error}</div>}
            </form>
          </section>
        </>
      )}
    </main>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense fallback={null}>
      <ChangePasswordInner />
    </Suspense>
  );
}
