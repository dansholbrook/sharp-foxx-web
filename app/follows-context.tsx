'use client';

// One shared source of truth for "who does the signed-in user follow?" so every
// Follow button (profile hero, team hero, suggestion card) can read its state
// without each one hitting GET /follows/mine. The list is fetched ONCE when a
// token is present and mutated optimistically on toggle — the network call
// (POST/DELETE /follows) runs behind the flipped UI and reverts on failure.
//
// Follower COUNTS are not held here: they're per-target and cheap, so each
// FollowButton fetches its own via GET /follows/count. Only membership lives here.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { useAuth } from './auth-context';
import {
  getMyFollows,
  followTarget,
  unfollowTarget,
  followTargetId,
  FollowMineEntry,
  FollowTargetType,
} from './api';

// A follow's identity across types: "team:<uuid>", "athlete:<uuid>", …
function keyOf(targetType: FollowTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
}
function entryKey(entry: FollowMineEntry): string {
  return keyOf(entry.targetType, followTargetId(entry));
}

interface FollowsState {
  // The caller's follows (enriched), newest-first. Drives the feed carousel.
  mine: FollowMineEntry[];
  // True once GET /follows/mine has resolved (or failed) — gates the feed's
  // Following-vs-Suggested decision so it doesn't flash the wrong section.
  loaded: boolean;
  isFollowing: (targetType: FollowTargetType, targetId: string) => boolean;
  // Optimistically flips membership, then POST/DELETEs; reverts on error. Pass a
  // full entry so following enriches the carousel without a refetch.
  toggle: (entry: FollowMineEntry) => Promise<void>;
  refresh: () => void;
}

const FollowsContext = createContext<FollowsState | undefined>(undefined);

export function FollowsProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [mine, setMine] = useState<FollowMineEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    if (!token) {
      setMine([]);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    getMyFollows(token)
      .then((rows) => {
        if (!cancelled) {
          setMine(rows);
          setLoaded(true);
        }
      })
      .catch(() => {
        // Best-effort: a failed load leaves follows empty (buttons still work,
        // they just start from "Follow"). The 401 path tears the session down.
        if (!cancelled) {
          setMine([]);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Load once per token (login / logout re-runs it).
  useEffect(() => load(), [load]);

  const keys = useMemo(() => new Set(mine.map(entryKey)), [mine]);

  const isFollowing = useCallback(
    (targetType: FollowTargetType, targetId: string) =>
      keys.has(keyOf(targetType, targetId)),
    [keys],
  );

  const toggle = useCallback(
    async (entry: FollowMineEntry) => {
      if (!token) return;
      const targetId = followTargetId(entry);
      const k = entryKey(entry);
      const wasFollowing = keys.has(k);

      // Optimistic flip.
      setMine((prev) =>
        wasFollowing
          ? prev.filter((e) => entryKey(e) !== k)
          : prev.some((e) => entryKey(e) === k)
            ? prev
            : [entry, ...prev],
      );

      try {
        if (wasFollowing) {
          await unfollowTarget(token, { targetType: entry.targetType, targetId });
        } else {
          await followTarget(token, { targetType: entry.targetType, targetId });
        }
      } catch {
        // Revert to the pre-toggle membership.
        setMine((prev) =>
          wasFollowing
            ? prev.some((e) => entryKey(e) === k)
              ? prev
              : [entry, ...prev]
            : prev.filter((e) => entryKey(e) !== k),
        );
      }
    },
    [token, keys],
  );

  const value = useMemo<FollowsState>(
    () => ({ mine, loaded, isFollowing, toggle, refresh: load }),
    [mine, loaded, isFollowing, toggle, load],
  );

  return (
    <FollowsContext.Provider value={value}>{children}</FollowsContext.Provider>
  );
}

export function useFollows(): FollowsState {
  const ctx = useContext(FollowsContext);
  if (!ctx) throw new Error('useFollows must be used within <FollowsProvider>');
  return ctx;
}
