'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, devLogin, LoginResponse } from './api';
import { useAuth } from './auth-context';
import { landingFor } from './roles';

// The front door: a branded email + password sign-in. On success, if the
// account is still on a temporary password (mustChangePassword) we route to the
// change-password step BEFORE the normal role landing; otherwise we land the
// user on the right page for their role.
//
// The legacy dev login (a bare userId/UUID -> a minted token) still works and is
// tucked behind a "Developer sign-in" toggle for test users not yet migrated to
// a password. Dev logins carry no mustChangePassword, so it's treated as false.
export default function LoginPage() {
  const router = useRouter();
  const { setSession } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Developer (UUID) sign-in, hidden behind a toggle with its own state.
  const [devOpen, setDevOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [devError, setDevError] = useState<string | null>(null);
  const [devBusy, setDevBusy] = useState(false);

  // Shared landing: honor mustChangePassword on EVERY path (absent -> false).
  function proceed(res: LoginResponse) {
    setSession(res);
    if (res.mustChangePassword) router.push('/account/password?first=1');
    else router.push(landingFor(res.user.roles));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      proceed(await login(email.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function onDevSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDevError(null);
    setDevBusy(true);
    try {
      proceed(await devLogin(userId.trim()));
    } catch (err) {
      setDevError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setDevBusy(false);
    }
  }

  return (
    <main className="apply-page">
      <div className="masthead">
        <span className="masthead-kicker">Members</span>
        <h1 className="masthead-title">Sign in</h1>
        <p className="masthead-standfirst">
          Welcome back to the Sharp Foxx network. Sign in with the email and
          password from your welcome message.
        </p>
      </div>

      <section className="card game apply-card">
        <span className="game-kicker">Sign in</span>
        <h2>Your account</h2>

        <form onSubmit={onSubmit} className="rep-form apply-form">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
              spellCheck={false}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
            />
          </div>

          <div className="rep-form-actions">
            <button type="submit" disabled={busy || !email.trim() || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>

          {error && <div className="error rep-form-msg">{error}</div>}
        </form>
      </section>

      {/* Legacy UUID login for test users not yet migrated to a password. */}
      <div className="dev-signin">
        <button
          type="button"
          className="link-btn dev-signin__toggle"
          onClick={() => setDevOpen((v) => !v)}
        >
          {devOpen ? 'Hide developer sign-in' : 'Developer sign-in'}
        </button>

        {devOpen && (
          <form onSubmit={onDevSubmit} className="card dev-signin__panel">
            <label htmlFor="userId">User ID (UUID)</label>
            <input
              id="userId"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" disabled={devBusy || !userId.trim()}>
              {devBusy ? 'Signing in…' : 'Dev sign in'}
            </button>
            {devError && <div className="error">{devError}</div>}
            <p className="muted" style={{ marginTop: 12, fontSize: '0.82rem' }}>
              Legacy sign-in for test users not yet migrated to a password —
              paste a user ID to mint a token.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
