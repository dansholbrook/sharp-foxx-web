'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-context';
import { usePoints } from './points-context';
import { navLinksFor } from './roles';
import { getReviewQueue, getNilReviewQueue, points } from './api';

// The fan's points identity: a compact ⚡ chip that rides the nav on every page
// and links to their pick history. Renders only once the wallet has actually
// loaded — never a placeholder "0 pts", which would misread as "you're broke" to
// a fan who simply hasn't been fetched yet.
//
// Shown to EVERY role, not just fans: any authenticated caller can pick (the
// backend deliberately allows staff to play along), so any of them can hold a
// balance. It doubles as staff's way into /picks, which isn't in their nav.
function PointsChip() {
  const { balance } = usePoints();
  if (balance === null) return null;
  return (
    <Link href="/picks" className="points-chip" title="Your points and picks">
      <span className="points-chip__bolt" aria-hidden="true">
        ⚡
      </span>
      <span className="points-chip__value">{points(balance)}</span>
      <span className="points-chip__unit">pts</span>
    </Link>
  );
}

// The header nav links, filtered to what the signed-in role can actually use
// (see navLinksFor). Log Out is always present. Logout clears the in-memory
// session and bounces to the login page -- the same behavior every page had.
export function AppNav() {
  const router = useRouter();
  const { token, user, logout } = useAuth();

  function onLogout() {
    logout();
    router.replace('/');
  }

  const links = navLinksFor(user?.roles ?? []);

  // Badge the Review link with the queue count. One best-effort fetch on mount
  // (no polling); a failure or an empty queue simply shows no badge. Only staff
  // who can reach /review ever see the link, so gate the fetch on that too.
  const canReview = (user?.roles ?? []).some(
    (r) => r === 'admin' || r === 'regional_manager',
  );
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  // The NIL review queue count gets the same best-effort badge treatment; the
  // gate is identical (admin/regional_manager), so it rides on the same flag.
  const [nilReviewCount, setNilReviewCount] = useState<number | null>(null);
  useEffect(() => {
    if (!token || !canReview) return;
    let cancelled = false;
    getReviewQueue(token)
      .then((items) => {
        if (!cancelled) setReviewCount(items.length);
      })
      .catch(() => {
        /* leave the badge off on failure */
      });
    getNilReviewQueue(token)
      .then((items) => {
        if (!cancelled) setNilReviewCount(items.length);
      })
      .catch(() => {
        /* leave the badge off on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [token, canReview]);

  return (
    <div className="nav-links">
      <PointsChip />
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="link-btn">
          {l.label}
          {l.href === '/review' && reviewCount != null && reviewCount > 0 && (
            <span className="nav-badge">{reviewCount}</span>
          )}
          {l.href === '/nil-review' &&
            nilReviewCount != null &&
            nilReviewCount > 0 && <span className="nav-badge">{nilReviewCount}</span>}
        </Link>
      ))}
      <Link href="/account/password" className="link-btn">
        Change password
      </Link>
      <button className="link-btn" onClick={onLogout}>
        Log out
      </button>
    </div>
  );
}

// Branded "no access" page shown when a role directly visits a page it can't
// use, instead of the raw "403 Insufficient role" text. Reuses the feed shell,
// masthead, and empty-state styles -- no new CSS. The nav still lists the pages
// this role *can* reach, so it's a way out, not a dead end.
export function AccessDenied() {
  const { user } = useAuth();

  return (
    <main className="feed-home">
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

      <div className="masthead">
        <span className="masthead-kicker">Restricted</span>
        <h1 className="masthead-title">No access</h1>
        <p className="masthead-standfirst">
          This page is limited to roles your account doesn&apos;t have.
        </p>
      </div>

      <div className="results-empty">
        <p className="results-empty__title">You don&apos;t have access to this page</p>
        <p className="results-empty__hint">
          Your role can&apos;t open this page. Use the links above to head
          somewhere you can.
        </p>
      </div>
    </main>
  );
}
