'use client';

// The front door: PUBLIC fan self-signup (/join). No auth gate -- like /apply
// and the login page, it renders its own minimal branded shell and never bounces
// an anonymous visitor to login. On success it AUTO-LOGS-IN off the signup
// response (same payload shape as login) and lands the new fan on the feed.
//
// REFERRAL: a rep's link is /join?ref=CODE. When ref is present we show a subtle
// "invited by a correspondent" note and carry the code silently into the signup;
// when it's absent we offer a collapsed "Have an invite code?" input instead, so
// a hand-typed code still attributes. Attribution is best-effort server-side -- a
// bad code never blocks the signup.

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signup, SignupValidationError, SignupInput } from '../api';
import { useAuth } from '../auth-context';

// Client mirror of signupSchema so a fan gets instant feedback before the round
// trip. Keyed by the same field names the server's zod flatten() returns, so a
// later server 400 slots into the same map. confirm is client-only (the API
// takes a single password), so it never collides with a server key.
function validate(v: {
  displayName: string;
  email: string;
  password: string;
  confirm: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = v.displayName.trim();
  if (name.length < 2) errors.displayName = 'Enter a display name (2+ characters).';
  else if (name.length > 40) errors.displayName = 'Display name is too long (40 max).';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }
  if (v.password.length < 8) errors.password = 'Use at least 8 characters.';
  if (v.confirm !== v.password) errors.confirm = 'Passwords don’t match.';
  return errors;
}

// A minimal branded public header: the wordmark and a small "Sign in" link back
// to the login page. NOT the logged-in AppNav -- this page has no session yet.
function PublicHeader() {
  return (
    <div className="header-row">
      <span className="wordmark">Sharp Foxx</span>
      <Link href="/" className="link-btn">
        Sign in
      </Link>
    </div>
  );
}

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { setSession } = useAuth();

  // The referral code from ?ref=CODE, if any. Trimmed; an empty param is treated
  // as absent so the "Have an invite code?" affordance still appears.
  const refFromUrl = (params.get('ref') ?? '').trim();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  // Manual code entry, only offered when the URL carried no ref. Collapsed by
  // default so the form stays a clean three-field funnel.
  const [codeOpen, setCodeOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // The code actually sent: the URL's ref wins; otherwise the hand-typed one.
  const effectiveCode = refFromUrl || manualCode.trim();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGeneralError(null);
    setIsDuplicate(false);

    const errors = validate({ displayName, email, password, confirm });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const input: SignupInput = {
      email: email.trim(),
      password,
      displayName: displayName.trim(),
    };
    if (effectiveCode) input.referralCode = effectiveCode;

    setSubmitting(true);
    try {
      const res = await signup(input);
      // Auto-login: establish the session exactly as the login page does, then
      // land the new fan on the feed (viewer's home).
      setSession(res);
      router.push('/feed');
    } catch (err) {
      if (err instanceof SignupValidationError) {
        const flat: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(err.fieldErrors)) {
          if (msgs?.length) flat[k] = msgs[0];
        }
        setFieldErrors(flat);
        if (err.formErrors.length) setGeneralError(err.formErrors[0]);
      } else {
        const msg = err instanceof Error ? err.message : 'Something went wrong.';
        setGeneralError(msg);
        // A 409 means the email already has an account -> nudge to sign in.
        setIsDuplicate(msg.startsWith('409'));
      }
      setSubmitting(false);
    }
    // On success we navigate away, so leave `submitting` true to keep the button
    // disabled through the redirect rather than flashing it back to idle.
  }

  return (
    <main className="apply-page join-page">
      <PublicHeader />

      <div className="masthead">
        <span className="masthead-kicker">Join free</span>
        <h1 className="masthead-title">Get closer to the game</h1>
        <p className="masthead-standfirst">
          Sharp Foxx covers the local games the big networks skip — live, with a
          correspondent on the ground. Create a free account to follow your teams,
          make picks, and play the contests.
        </p>
      </div>

      {refFromUrl && (
        <div className="join-ref-note">
          <span className="join-ref-note__badge">Invite</span>
          Invited by a Sharp Foxx correspondent — your account will be linked to
          them.
        </div>
      )}

      <section className="card game apply-card">
        <span className="game-kicker">Create account</span>
        <h2>Your details</h2>

        <form onSubmit={onSubmit} className="rep-form apply-form join-form" noValidate>
          <div className="field">
            <label htmlFor="displayName">Display name</label>
            <input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jordan F."
              autoComplete="nickname"
            />
            {fieldErrors.displayName && (
              <span className="apply-field-error">{fieldErrors.displayName}</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              spellCheck={false}
            />
            {fieldErrors.email && (
              <span className="apply-field-error">{fieldErrors.email}</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            {fieldErrors.password && (
              <span className="apply-field-error">{fieldErrors.password}</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your password"
              autoComplete="new-password"
            />
            {fieldErrors.confirm && (
              <span className="apply-field-error">{fieldErrors.confirm}</span>
            )}
          </div>

          {/* Manual invite code, only when the URL carried none. Collapsed so the
              default funnel stays three clean fields. */}
          {!refFromUrl && (
            <div className="field field--wide join-code">
              {!codeOpen ? (
                <button
                  type="button"
                  className="link-btn join-code__toggle"
                  onClick={() => setCodeOpen(true)}
                >
                  Have an invite code?
                </button>
              ) : (
                <>
                  <label htmlFor="inviteCode">Invite code (optional)</label>
                  <input
                    id="inviteCode"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="e.g. FOXX7Q2K"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </>
              )}
            </div>
          )}

          <div className="rep-form-actions join-actions">
            <button type="submit" disabled={submitting}>
              {submitting ? 'Creating your account…' : 'Create free account'}
            </button>
            <span className="join-signin-nudge">
              Already have an account?{' '}
              <Link href="/" className="apply-signin-link">
                Sign in
              </Link>
            </span>
          </div>

          {generalError && (
            <div className="error rep-form-msg">
              {generalError}
              {isDuplicate && (
                <>
                  {' '}
                  Try{' '}
                  <Link href="/" className="apply-signin-link">
                    signing in
                  </Link>{' '}
                  instead.
                </>
              )}
            </div>
          )}
        </form>
      </section>
    </main>
  );
}

// useSearchParams must render inside a Suspense boundary (Next.js App Router).
export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <main className="apply-page join-page">
          <div className="card muted">Loading…</div>
        </main>
      }
    >
      <JoinForm />
    </Suspense>
  );
}
