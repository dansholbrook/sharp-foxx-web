'use client';

// ============================================================================
// THE CORRESPONDENT'S WORK BAND — what this person owes, on the page they
// already open.
//
// ----------------------------------------------------------------------------
// WHY IT EXISTS. A correspondent's job arrives on someone else's schedule: a
// game is assigned to them, a Call is created for them, a result is waited on.
// None of that is visible from /feed, which is where they land and where they
// go by habit. The Call that ran on production sat locked and ungraded for five
// days while its correspondent was never told — the notification for it existed,
// was enabled, and had been sent zero times because nothing scheduled the sweep
// that emits it (fixed 2026-08-14, see call.scheduler.ts).
//
// THIS BAND AND THAT NOTIFICATION ARE THE SAME FACT ON TWO SURFACES, not two
// answers to one question. Both read row state — a card that is locked and
// ungraded, a game past kickoff with no result — rather than a counter or a
// flag that something else has to remember to set. A correspondent who never
// opens the notification tray sees it here; one who never opens the feed gets
// the notification. Neither is the other's fallback.
//
// ----------------------------------------------------------------------------
// WHAT IT IS NOT, and each of these is a refusal rather than an omission:
//
//   NOT A QUEUE. Hard-capped at three rows. /my-games is the queue and it is one
//   tap away; a band that grows with the workload becomes the page on a phone
//   (`.frail`/`.fmain` are `display: contents` below 1024px, so an unbounded
//   band is not bounded by its column — it IS the column).
//
//   NOT A COUNT OF THINGS THEY CANNOT ACT ON. Every row is work this person can
//   do, reachable in one tap. "12 games in your territory" is a dashboard
//   number; this is a to-do list of three.
//
//   NOT SOMEBODY ELSE'S WORK. Both reads are already caller-scoped by the API —
//   /assignments/mine is theirs by definition, and GET /arena/call/events
//   narrows a field_rep to their own cards. An RM or admin gets a wider list
//   from the second one, which is why the Call rows filter on assignment: an
//   admin opening /feed should not be handed every correspondent's homework.
//
//   NOT AN ERROR SURFACE. Both reads are best-effort and independent. A failure
//   costs its own rows and nothing else, and never the feed.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  getMyAssignments,
  getCallEvents,
  callStaffRoute,
  etDateTime,
  CallListItem,
  MyAssignment,
} from './api';
// WHICH rows and in WHAT order lives next door, JSX-free, so it can be driven
// by scripts/proof-work-band.ts instead of only by looking at the page.
import { workRows, matchupOf, WorkRow } from './feed-work-rows';

// The roles that can hold assignments and Calls. A fan never fires either read.
const WORK_ROLES = ['field_rep', 'regional_manager', 'admin'];

export function CorrespondentBand({ token, roles }: { token: string; roles: string[] }) {
  const isStaff = roles.some((r) => WORK_ROLES.includes(r));
  const [assignments, setAssignments] = useState<MyAssignment[] | null>(null);
  const [calls, setCalls] = useState<CallListItem[] | null>(null);

  // TWO BEST-EFFORT READS, EACH INDEPENDENT — the InPlayBand contract. They are
  // deliberately not awaited together: a slow Arena must not hold up the row
  // that says a result is overdue.
  useEffect(() => {
    if (!isStaff) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await getMyAssignments(token);
        if (!cancelled) setAssignments(rows);
      } catch {
        /* the assignment rows just don't appear */
      }
    })();
    (async () => {
      try {
        const list = await getCallEvents(token, 'upcoming');
        if (!cancelled) setCalls(list.items);
      } catch {
        /* ditto — a rep with no Call gets an empty list, not an error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, isStaff]);

  const rows = useMemo(() => workRows(assignments, calls), [assignments, calls]);

  // Nothing owed and nothing coming -> no band at all, rather than a heading
  // over an empty box. This is the common case for most staff most days, and it
  // is why the band can afford to lead the column when it does appear.
  if (!isStaff || rows.length === 0) return null;

  // Is anything actually DUE, or is this just "here's what's next"? Decides the
  // band's tone: a lit rail for work owed, a plain one for work coming.
  const due = rows.some((r) => r.kind !== 'covering');

  return (
    // `card` FOR REAL CHROME, and it is load-bearing rather than decorative.
    // The feed's fan bands (.feedpicks) have NO container — they are a title
    // over a strip — so `.row` alone would leave this with a background and no
    // border to hold it, and nothing to light up when work is due. `.calltile`
    // takes `.card` for the same reason on the workspace, which is also why the
    // two look alike: they are the same card seen from two places.
    <section className={`row card fwork${due ? ' fwork--due' : ''}`}>
      <div className="feedpicks__head">
        <h2 className="row-title">{due ? 'Your work' : "You're covering"}</h2>
        <Link href="/my-games" className="feedpicks__all">
          My games →
        </Link>
      </div>
      <div className="feedpicks__list">
        {rows.map((r) => (
          <WorkCard key={r.key} row={r} />
        ))}
      </div>
    </section>
  );
}

// One row. Every kind carries the same three parts — what it is, which game,
// and the one tap that does it — so the eye lands in the same place down the
// list rather than re-reading each row's shape.
function WorkCard({ row }: { row: WorkRow }) {
  if (row.kind === 'grade') {
    const h = row.hoursLeft;
    // The deadline in the correspondent's terms. Past zero it says so plainly:
    // the sweep runs every ten minutes, so "overdue" is a real state a card can
    // sit in briefly, and rounding it up to "1h left" would be a lie with money
    // behind it.
    const clock =
      h === null
        ? 'Grade it before it washes.'
        : h <= 0
          ? 'Past the deadline — it washes on the next sweep.'
          : h < 1
            ? `Under an hour left before it washes.`
            : `${Math.floor(h)}h left before it washes.`;
    return (
      <Link href={callStaffRoute(row.call)} className="fwork-card fwork-card--due">
        <span className="fwork-card__tag">Needs grading</span>
        <span className="fwork-card__what">{row.matchup}</span>
        <span className="fwork-card__note">
          {row.call.entryCount} card{row.call.entryCount === 1 ? '' : 's'} filed. {clock}
        </span>
      </Link>
    );
  }

  if (row.kind === 'result') {
    return (
      <Link href={`/my-games/${row.assignment.event.id}`} className="fwork-card">
        <span className="fwork-card__tag">Result not filed</span>
        <span className="fwork-card__what">{matchupOf(row.assignment)}</span>
        <span className="fwork-card__note">
          Kicked off {etDateTime(row.assignment.event.scheduledAt)} and still open.
        </span>
      </Link>
    );
  }

  if (row.kind === 'draft') {
    return (
      <Link href={callStaffRoute(row.call)} className="fwork-card">
        <span className="fwork-card__tag">Card to write</span>
        <span className="fwork-card__what">{row.matchup}</span>
        <span className="fwork-card__note">
          {row.call.questionCount} of 5 questions. Publish before kickoff,{' '}
          {etDateTime(row.kickoff)}.
        </span>
      </Link>
    );
  }

  return (
    <Link href={`/my-games/${row.assignment.event.id}`} className="fwork-card">
      <span className="fwork-card__tag">Covering</span>
      <span className="fwork-card__what">{matchupOf(row.assignment)}</span>
      <span className="fwork-card__note">
        {etDateTime(row.assignment.event.scheduledAt)}
        {row.assignment.event.venue ? ` · ${row.assignment.event.venue}` : ''}
      </span>
    </Link>
  );
}
