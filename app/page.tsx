'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from './api';
import { useAuth } from './auth-context';

// Dev login: type a userId (UUID), POST it to /auth/login, stash the returned
// token in memory, and head to the dashboard. No password -- the backend's
// /auth/login is a dev token minter (see its FLAG comment).
export default function LoginPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await login(userId.trim());
      setSession(res);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="header-row">
        <div>
          <h1>Sharp Foxx</h1>
          <span className="muted">Admin dashboard — dev login</span>
        </div>
      </div>

      <form className="card" onSubmit={onSubmit}>
        <label htmlFor="userId">User ID (UUID)</label>
        <input
          id="userId"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={busy || !userId.trim()}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        {error && <div className="error">{error}</div>}
        <p className="muted" style={{ marginTop: 16, fontSize: '0.82rem' }}>
          Use a user with the <strong>admin</strong> role — the reports endpoints
          are admin-gated.
        </p>
      </form>
    </main>
  );
}
