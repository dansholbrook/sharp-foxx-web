'use client';

// ============================================================================
// THE DWELL HOOKS — the two engagement actions that aren't triggered by a tap.
//
// A pick, a follow, a check-in all have a MOMENT: something happened, report it.
// "Read an article" and "watch a live game" don't — they're durations, and the
// only honest way to report them from a browser is to watch for evidence the fan
// is actually there. Both hooks below are that evidence, and both fire AT MOST
// ONCE per target per mount.
//
// Neither one is a security boundary — a determined fan can scroll and wait.
// They're an honesty floor, and the daily cap on each action (3 articles, 2
// games) is what actually bounds the damage. See engagement-actions.ts.
// ============================================================================

import { useEffect, useRef } from 'react';
import { useEngagementEarn } from './earn-context';

// Read: 20 seconds AND 60% of the way down. BOTH, not either — 20s with no
// scroll is a tab left open, and an instant scroll to the bottom is a skim.
const ARTICLE_DWELL_MS = 20_000;
const ARTICLE_SCROLL_RATIO = 0.6;

// Watch: three minutes of the page actually being LOOKED AT.
const WATCH_VISIBLE_MS = 3 * 60_000;
// How often the visible-time accumulator ticks. One second is fine for a
// three-minute target and costs nothing; the timer is torn down the moment the
// earn fires, so it doesn't outlive its purpose.
const WATCH_TICK_MS = 1000;

// ---------------------------------------------------------------------------
// ARTICLE READ — 20s dwell AND ~60% scroll depth, whichever completes the pair.
//
// `articleId` keys the once-per-article guard: navigating between two articles
// remounts nothing in the App Router (the page component is reused), so without
// re-arming on the id a fan could only ever earn for the first story they open.
// `ready` gates the whole thing on the article having actually rendered — there
// is no scrollable body to measure while the loader is up, and a fan who lands
// on a 404 hasn't read anything.
// ---------------------------------------------------------------------------
export function useArticleReadEarn(articleId: string, ready: boolean): void {
  const earn = useEngagementEarn();
  // Survives the effect's own re-runs, so a re-render that re-arms the listener
  // (or a `ready` that flickers) can't pay twice for one article.
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (firedFor.current === articleId) return;

    // The two conditions live in closure variables, not state: nothing here
    // should cause a render, and the scroll listener needs to read the current
    // values without being re-bound on every change.
    let dwellMet = false;
    let scrollMet = false;
    let fired = false;

    function scrollDepthMet(): boolean {
      const doc = document.documentElement;
      // Scrollable DISTANCE, not page height: an article shorter than the
      // viewport never scrolls, and a fan looking at all of it has met the
      // depth condition by definition. That case can only be satisfied, never
      // failed — which is why it is measured LATE (see below) rather than at
      // mount, when a body that hasn't finished laying out would look short.
      if (doc.scrollHeight - window.innerHeight <= 0) return true;
      return (window.scrollY + window.innerHeight) / doc.scrollHeight >= ARTICLE_SCROLL_RATIO;
    }

    function maybeFire() {
      if (fired || !dwellMet) return;
      // Re-measure rather than trusting a stale false. By the time the dwell
      // timer has run, layout has long settled; a scroll event that already
      // latched scrollMet short-circuits this.
      if (!scrollMet && !scrollDepthMet()) return;
      scrollMet = true;
      fired = true;
      firedFor.current = articleId;
      // Tear the listener down the instant it's done its job — a long article
      // shouldn't keep paying for scroll events after the earn.
      window.removeEventListener('scroll', onScroll);
      void earn('article_read');
    }

    function onScroll() {
      if (scrollMet || !scrollDepthMet()) return;
      scrollMet = true;
      maybeFire();
    }

    const timer = setTimeout(() => {
      dwellMet = true;
      maybeFire();
    }, ARTICLE_DWELL_MS);

    // Passive: this listener never calls preventDefault, and saying so keeps it
    // off the scroll's critical path on mobile.
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [articleId, ready, earn]);
}

// ---------------------------------------------------------------------------
// WATCH LIVE GAME — three minutes of VISIBLE time on a live game page.
//
// document.visibilityState is the whole point: a backgrounded tab left on a game
// page overnight is not watching, and paying it would make the action worthless.
// The accumulator only advances while the page is visible, so three minutes
// means three minutes of the game actually being on screen.
//
// `active` is the caller's judgment about whether this page qualifies at all —
// on the game page that's "covered game AND status === live". It can flip true
// mid-visit (a game tipping off under a fan already on the page), which re-arms
// the timer from zero, which is correct: the clock should measure time spent
// watching a LIVE game, not time spent waiting for one.
// ---------------------------------------------------------------------------
export function useWatchLiveGameEarn(gameId: string, active: boolean): void {
  const earn = useEngagementEarn();
  // Survives the effect's own re-runs so a game that flickers live/not-live (or
  // a re-render that changes `earn`'s identity) can't pay twice for one visit.
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    if (firedFor.current === gameId) return;

    let visibleMs = 0;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      visibleMs += WATCH_TICK_MS;
      if (visibleMs < WATCH_VISIBLE_MS) return;
      clearInterval(timer);
      firedFor.current = gameId;
      void earn('watch_live_game');
    }, WATCH_TICK_MS);

    return () => clearInterval(timer);
  }, [gameId, active, earn]);
}
