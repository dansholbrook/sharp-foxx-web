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
//
// ONE ROW IS FILTERED OUT, AND IT IS NOT A DISPLAY PREFERENCE — see
// EARNABLE_BY_REPS_ONLY below. GET /points/earn-menu returns every enabled
// action to every caller (economy.service.ts earnMenu() takes `caller` only to
// count today's usage, never to narrow the list), and `referral_bonus` — the
// biggest number on the panel at 100 points, uncapped — is paid to a REP's
// wallet when someone signs up through their code. A fan has no code and no way
// to get one, so for a fan that row is the panel's largest advertised earn and
// the one they cannot reach. This is a statement panel; a line it cannot back up
// is the whole failure mode.
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

// Actions only a rep can actually cause, keyed to the roles that can cause them.
// referral_bonus fires in auth.service.ts when a signup's ?ref=CODE resolves to
// a field_reps row, and pays that rep — the referral graph is rep-shaped all the
// way down (the code lives on field_reps.referral_code, and the edge recorded on
// the new user is users.referred_by_rep_id, an FK to field_reps). There is no
// user-to-user referral edge in the schema, so this is not a permissions gap a
// client can route around.
//
// SUPPRESSING THE ROW IS NOT THE FIX, it is the honest half of a fix that needs
// the API: either fans get referral codes of their own (new endpoint + a schema
// change to hold a fan→fan edge) or the action stops being advertised platform-
// wide. Until one of those lands, showing a rep-only earn to fans is the version
// that is actually wrong on screen, so this hides it there and nowhere else —
// the line is TRUE for a rep, who sees it unchanged.
const EARNABLE_BY_REPS_ONLY: Record<string, string[]> = {
  referral_bonus: ['regional_manager', 'field_rep'],
};

function canEarn(actionType: string, roles: string[]): boolean {
  const required = EARNABLE_BY_REPS_ONLY[actionType];
  return !required || required.some((r) => roles.includes(r));
}

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

export function WaysToEarn({ token, roles }: { token: string; roles: string[] }) {
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
  // nothing is worse than no heading. Counted on the VISIBLE list, so a viewer
  // whose only remaining row was filtered out gets no heading either.
  const items = (menu?.items ?? []).filter((i) => canEarn(i.actionType, roles));
  // A promotion targeting ONLY rows this viewer can't earn is the same false
  // statement one line higher up — "2x on referral bonus" over a list with no
  // referral bonus in it. appliesTo null stays: it really is on everything.
  const promotions = (menu?.promotions ?? []).filter(
    (p) => p.appliesTo === null || p.appliesTo.some((a) => canEarn(a, roles)),
  );
  if (!menu || items.length === 0) return null;

  return (
    <section className="earnmenu">
      <div className="earnmenu__head">
        <h2 className="game-articles__head earnmenu__title">Ways to earn</h2>
        <span className="earnmenu__sub">Points only · no cash value</span>
      </div>

      {/* The banner strip leads, because a live 2x is the reason the numbers
          below look unusual. appliesTo null = the platform-wide case, which is
          worded as "on everything" rather than listing six actions. */}
      {promotions.length > 0 && (
        <div className="earnmenu-promos">
          {promotions.map((p) => (
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
        {items.map((item) => (
          <EarnRow key={item.actionType} item={item} />
        ))}
      </ul>
    </section>
  );
}
