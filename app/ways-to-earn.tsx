'use client';

// ============================================================================
// WAYS TO EARN — the fan-facing face of the engagement economy, on /picks.
//
// One read (GET /points/earn-menu) answers everything this panel says: what's
// earnable, what it pays RIGHT NOW (the backend applies live promotions before
// it answers, so the number on screen is the number that lands in the wallet),
// and how much of each daily cap the fan has already taken.
//
// It is a STATEMENT, not a set of buttons. Nothing here is tappable, because
// none of these actions can be performed from this page — you earn "watch a live
// game" by watching a live game. The panel's job is to make the economy legible
// so a fan knows the points are there to be had.
//
// REFETCH ON FOCUS, NOT ON A TIMER. The only things that move these numbers are
// the fan earning elsewhere (another tab, their phone) and an admin retuning the
// economy — neither is worth a polling loop on a page that's usually idle in a
// background tab. Coming back to the tab is the moment the numbers might be
// stale, so that's when it re-reads.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import {
  getEarnMenu,
  points,
  formatMultiplier,
  etDateTime,
  etWeekday,
  EarnMenu,
  EarnMenuItem,
} from './api';

// "through Sunday" / "through Feb 9" — a promotion's end as a fan reads a
// deadline, not as a timestamp. Inside a week, the weekday IS the clearest
// wording; beyond that it needs a date.
//
// The weekday and the date are both the ET ones: the promotion's window is
// evaluated in ET on the server, so a Sunday 11 PM ET close that read as
// "Monday" to a fan in London would be a deadline named wrong. No zone label —
// this is a bare day, and the wording carries no clock to attach it to.
function promoEndsLabel(iso: string): string {
  const end = new Date(iso);
  if (Number.isNaN(end.getTime())) return '';
  const daysOut = (end.getTime() - Date.now()) / 86_400_000;
  return daysOut < 7 && daysOut >= 0
    ? etWeekday(iso)
    : etDateTime(iso, { month: 'short', day: 'numeric' });
}

// The progress line under an action. Three genuinely different states, and the
// wording has to keep them apart:
//   uncapped (dailyCap 0) -> no limit to report at all
//   room left             -> "1/3 today"
//   done                  -> "3/3 today", with the row muted
function ProgressLine({ item }: { item: EarnMenuItem }) {
  if (item.dailyCap <= 0) {
    return <span className="earnmenu-row__progress">No daily limit</span>;
  }
  const done = item.remainingToday === 0;
  return (
    <span
      className={`earnmenu-row__progress${done ? ' earnmenu-row__progress--done' : ''}`}
    >
      {done && (
        <span className="earnmenu-row__check" aria-hidden="true">
          ✓
        </span>
      )}
      {item.usedToday}/{item.dailyCap} today
    </span>
  );
}

function EarnRow({ item }: { item: EarnMenuItem }) {
  const boosted = item.promotion !== null && item.points !== item.basePoints;
  const done = item.dailyCap > 0 && item.remainingToday === 0;

  return (
    <li className={`earnmenu-row${done ? ' earnmenu-row--done' : ''}`}>
      <div className="earnmenu-row__main">
        <span className="earnmenu-row__label">{item.label}</span>
        {item.description && (
          <span className="earnmenu-row__desc">{item.description}</span>
        )}
      </div>
      <div className="earnmenu-row__side">
        <span className="earnmenu-row__value">
          {/* Strike the BASE value rather than just showing a bigger number: a
              promotion the fan can't see they're getting isn't a promotion. */}
          {boosted && (
            <span className="earnmenu-row__base">+{points(item.basePoints)}</span>
          )}
          <span
            className={`earnmenu-row__pts${boosted ? ' earnmenu-row__pts--boosted' : ''}`}
          >
            +{points(item.points)}
          </span>
        </span>
        <ProgressLine item={item} />
      </div>
    </li>
  );
}

export function WaysToEarn({ token }: { token: string }) {
  const [menu, setMenu] = useState<EarnMenu | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    getEarnMenu(token)
      .then((next) => {
        if (!cancelled) setMenu(next);
      })
      .catch(() => {
        // Best-effort, like every other section on this page: a failed read
        // leaves whatever's on screen (or hides the panel on first load). The
        // 401 path inside the client tears the session down.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => load(), [load]);

  // The refetch trigger. `focus` alone misses the tab-switch case in some
  // browsers, and visibilitychange alone misses window-to-window focus on
  // desktop, so both fire the same reload — a duplicate read costs one request.
  useEffect(() => {
    function onFocus() {
      load();
    }
    function onVisible() {
      if (document.visibilityState === 'visible') load();
    }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Self-hides until there's something to say. Every action being disabled is a
  // real (if unlikely) admin state, and an empty "Ways to earn" heading over
  // nothing is worse than no heading.
  if (!menu || menu.items.length === 0) return null;

  return (
    <section className="earnmenu">
      <div className="earnmenu__head">
        <h2 className="game-articles__head earnmenu__title">Ways to earn</h2>
        <span className="earnmenu__sub">Points only · no cash value</span>
      </div>

      {/* The banner strip leads, because a live 2x is the reason the numbers
          below look unusual. appliesTo null = the platform-wide case, which is
          worded as "on everything" rather than listing six actions. */}
      {menu.promotions.length > 0 && (
        <div className="earnmenu-promos">
          {menu.promotions.map((p) => (
            <div key={`${p.name}-${p.endsAt}`} className="earnmenu-promo">
              <span className="earnmenu-promo__bolt" aria-hidden="true">
                ⚡
              </span>
              <span className="earnmenu-promo__name">{p.name}</span>
              <span className="earnmenu-promo__terms">
                {formatMultiplier(p.multiplier)}x
                {p.appliesTo === null ? ' on everything' : ''} through{' '}
                {promoEndsLabel(p.endsAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      <ul className="earnmenu-list">
        {menu.items.map((item) => (
          <EarnRow key={item.actionType} item={item} />
        ))}
      </ul>
    </section>
  );
}
