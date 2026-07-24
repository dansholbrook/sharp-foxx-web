'use client';

// The rep's "share your link" card, mounted on My Sales (the rep's business
// hub). It's the correspondent/RM's growth tool: their /join?ref= link big and
// copyable, the raw code, live counts, and the last few fans they've brought in.
//
// Self-contained and best-effort: it fetches the caller's own referral hub and,
// if the account has no rep profile (403), renders NOTHING -- a bare admin or a
// fan viewing My Sales simply doesn't see it. Any other failure shows a small
// inline notice rather than blanking the page around it.

import { useEffect, useState } from 'react';
import { getMyReferral, RepReferral } from './api';

// A referred fan's joined-at timestamp -> a readable date. '—' if it won't parse.
function formatJoined(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function RefShareCard({ token }: { token: string }) {
  const [referral, setReferral] = useState<RepReferral | null>(null);
  // 'no-profile' is the 403 case: hide the whole card. 'error' is any other
  // failure: show a small notice. null = fine (or still loading).
  const [state, setState] = useState<'loading' | 'ok' | 'no-profile' | 'error'>(
    'loading',
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMyReferral(token)
      .then((data) => {
        if (cancelled) return;
        setReferral(data);
        setState('ok');
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : '';
        setState(msg.startsWith('403') ? 'no-profile' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function copyLink() {
    if (!referral) return;
    try {
      await navigator.clipboard.writeText(referral.shareUrl);
      setCopied(true);
      // Revert the button label after a beat so it's ready to copy again.
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / permissions) -- leave the link
      // visible for a manual copy rather than surfacing an error.
    }
  }

  // No rep profile: the card doesn't apply to this account, so render nothing.
  if (state === 'no-profile') return null;

  if (state === 'loading') {
    return (
      <section className="card game refshare-card">
        <span className="game-kicker">Grow the network</span>
        <h2>Your referral link</h2>
        <p className="muted">Loading your link…</p>
      </section>
    );
  }

  if (state === 'error' || !referral) {
    return (
      <section className="card game refshare-card">
        <span className="game-kicker">Grow the network</span>
        <h2>Your referral link</h2>
        <p className="muted">
          Your referral link couldn&apos;t be loaded right now. Refresh to try
          again.
        </p>
      </section>
    );
  }

  return (
    <section className="card game refshare-card">
      <span className="game-kicker">Grow the network</span>
      <h2>Your referral link</h2>
      <p className="refshare-lead">
        Share this link. Every fan who signs up through it is credited to you.
      </p>

      <div className="refshare-linkrow">
        <span className="refshare-url" title={referral.shareUrl}>
          {referral.shareUrl}
        </span>
        <button type="button" className="btn-inline refshare-copy" onClick={copyLink}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>

      <div className="refshare-code">
        <span className="refshare-code__label">Your code</span>
        <span className="mono refshare-code__value">{referral.referralCode}</span>
      </div>

      <div className="rep-stats refshare-stats">
        <div className="rep-stat">
          <span className="rep-stat__label">Referred all-time</span>
          <span className="rep-stat__value">
            {referral.totalReferred.toLocaleString()}
          </span>
        </div>
        <div className="rep-stat">
          <span className="rep-stat__label">This month</span>
          <span className="rep-stat__value">
            {referral.referredThisMonth.toLocaleString()}
          </span>
        </div>
      </div>

      {referral.recentReferrals.length > 0 ? (
        <div className="refshare-recent">
          <h3 className="refshare-recent__head">Recent sign-ups</h3>
          <ul className="refshare-recent__list">
            {referral.recentReferrals.map((r, i) => (
              <li key={`${r.displayName}-${i}`} className="refshare-recent__item">
                <span className="refshare-recent__name">{r.displayName}</span>
                <span className="refshare-recent__when">{formatJoined(r.joinedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted refshare-empty">
          No sign-ups yet — share your link to bring in your first fan.
        </p>
      )}
    </section>
  );
}
