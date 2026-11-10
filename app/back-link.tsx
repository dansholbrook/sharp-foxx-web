'use client';

// ============================================================================
// BACK, THE WAY THE PERSON CAME -- or, when they did not come from inside the app,
// a named link somewhere sensible.
//
// router.back() is right when the previous history entry is a page of ours (a box
// score, a team page, wherever). It is wrong when there is none, or when the
// previous entry is ANOTHER SITE: a shared link opened in a tab that had been on a
// search page has window.history.length > 1, and back() would leave the app. So
// history.length is not the test. NavHistory (mounted once, in the root layout)
// keeps this tab's in-app trail instead:
//
//   * an in-app navigation pushes the new path;
//   * a browser back/forward (popstate) pops when it lands on the previous path,
//     and pushes otherwise (a forward step).
//
// canGoBack = the trail has an entry before this one. In memory only: a full
// reload starts the trail again, so a reloaded page shows the fallback -- a
// working named link, never a back button that might leave the app.
//
// The control is the game page's: class game-back, same place (first in <main>),
// uppercase and letterspaced by the CSS. The label says what it does: "← Back" for
// history, "← Back to <place>" for the fallback.
// ============================================================================

import { useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

let trail: string[] = [];
let popPending = false;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const canGoBackNow = () => trail.length > 1;

export function NavHistory() {
  const pathname = usePathname();
  useEffect(() => {
    const onPop = () => { popPending = true; };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (!pathname) return;
    const n = trail.length;
    if (popPending && n >= 2 && trail[n - 2] === pathname) trail = trail.slice(0, -1);   // a back step
    else if (trail[n - 1] !== pathname) trail = [...trail, pathname];                     // a link, or a forward step
    popPending = false;
    listeners.forEach((l) => l());
  }, [pathname]);
  return null;
}

// false on the server and on the first client render, so markup never mismatches.
export function useCanGoBack(): boolean {
  return useSyncExternalStore(subscribe, canGoBackNow, () => false);
}

export function BackLink({ fallbackHref, fallbackLabel }: { fallbackHref: string; fallbackLabel: string }) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  if (canGoBack) {
    return (
      <button type="button" className="game-back" onClick={() => router.back()}>
        ← Back
      </button>
    );
  }
  return (
    <Link href={fallbackHref} className="game-back">
      ← Back to {fallbackLabel}
    </Link>
  );
}
