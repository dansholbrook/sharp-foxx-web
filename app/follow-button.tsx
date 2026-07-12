'use client';

// The shared Follow pill: "Follow" (gold outline) <-> "Following ✓" (subtle
// filled), optimistically toggled through the follows context (POST/DELETE runs
// behind the flip). Beside it, the follower count when > 0. Membership is read
// from the shared context (one /follows/mine for the whole app); the COUNT is
// this button's own concern — it fetches GET /follows/count on mount and
// re-reads it after each toggle to reconcile the optimistic nudge.

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { useFollows } from './follows-context';
import { getFollowCount, followTargetId, FollowMineEntry } from './api';

export function FollowButton({
  entry,
  showCount = true,
  size,
  className,
}: {
  // A full mine-shaped entry: identifies the target AND enriches the feed
  // carousel when the toggle adds it. Heroes build one from their loaded data.
  entry: FollowMineEntry;
  showCount?: boolean;
  size?: 'sm';
  className?: string;
}) {
  const { token } = useAuth();
  const { isFollowing, toggle, loaded } = useFollows();
  const targetId = followTargetId(entry);
  const following = isFollowing(entry.targetType, targetId);

  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Initial follower count (best-effort — a failure just hides the count).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getFollowCount(token, entry.targetType, targetId)
      .then((r) => {
        if (!cancelled) setCount(r.count);
      })
      .catch(() => {
        /* leave count null -> hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [token, entry.targetType, targetId]);

  async function onClick() {
    if (busy || !token) return;
    setBusy(true);
    // Optimistic count nudge in the toggle direction; reconciled below.
    setCount((c) => (c === null ? c : Math.max(0, c + (following ? -1 : 1))));
    await toggle(entry);
    try {
      const r = await getFollowCount(token, entry.targetType, targetId);
      setCount(r.count);
    } catch {
      /* keep the optimistic value */
    }
    setBusy(false);
  }

  return (
    <div
      className={`follow-wrap${size === 'sm' ? ' follow-wrap--sm' : ''}${
        className ? ` ${className}` : ''
      }`}
    >
      <button
        type="button"
        className={`follow-btn${following ? ' follow-btn--on' : ''}${
          size === 'sm' ? ' follow-btn--sm' : ''
        }`}
        aria-pressed={following}
        disabled={busy || !loaded}
        onClick={onClick}
      >
        {following ? 'Following ✓' : 'Follow'}
      </button>
      {showCount && count !== null && count > 0 && (
        <span className="follow-count">
          {count === 1 ? '1 follower' : `${count} followers`}
        </span>
      )}
    </div>
  );
}
