'use client';

// Echo line under a native date field: it renders the value the user just
// committed BACK to them in unambiguous en-US ("Sat, Sep 5, 2026 · 7:00 PM ET"),
// plus a soft nudge when the parsed date is in the past or absurdly far out.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS -- AND WHY THE NATIVE INPUT STAYS. READ BEFORE "FIXING".
// ---------------------------------------------------------------------------
// <input type="datetime-local"> and <input type="date"> render their box in the
// BROWSER'S UI LOCALE, not ours. A correspondent on a European-locale laptop
// sees dd.mm.yyyy, types 09/05 meaning the 5th of September, and files a game on
// the 9th of May -- silently, because the form accepted it.
//
// We cannot restyle that box. Not with lang="en" on <html> (already set in
// layout.tsx), not with CSS, not with any attribute: the format comes from the
// user's OS/browser locale and is deliberately outside the page's control. The
// ONLY way to control it is to stop using the native control -- three <select>s
// for month/day/year -- which costs the mobile date wheel on the exact surface
// where a correspondent is working one-handed in a gym or a car park. That is
// the wrong trade, so we don't take it.
//
// Instead of fighting the input, we echo it. A mistyped 09/05 reads back
// "Sat, May 9, 2026" underneath the field before submit, which turns a silent
// data corruption into a visible one. That is the honest fix and the whole of
// what this component claims to do.
//
// DO NOT replace the native inputs with custom pickers to "fix the format".
// ---------------------------------------------------------------------------
//
// The value path itself is already correct and is not what this guards: a
// datetime-local is a zoneless wall clock and etWallClockToIso() crosses it
// through EASTERN (see api.ts), so a rep in Denver typing 7:00 PM writes the
// right instant. This only guards which DAY they meant.

import { etDateTime, etTime, etWallClockToIso, isoToEtWallClock } from './api';

// A game filed more than half a day ago is usually a mistyped month, but a rep
// backfilling tonight's game an hour after tip is legitimate -- so the past
// nudge has a grace window rather than firing on every past instant.
const PAST_GRACE_MS = 12 * 60 * 60 * 1000;
// ~18 months. Beyond this a schedule entry is almost certainly a typo, not a
// season that far out.
const FAR_OUT_MS = 550 * 24 * 60 * 60 * 1000;

// The shared tail on every nudge: name the cause, because the cause is invisible
// to the person reading it (their date box looks normal TO THEM).
const DAY_FIRST_HINT =
  'Check the box above — some browsers show dates day-first (dd/mm).';

// 'datetime' is a datetime-local wall clock ('2026-09-05T19:00') and carries a
// real instant, so it echoes in ET with the zone label. 'date' is a bare
// yyyy-mm-dd with no instant in it (an ad order's start date) and keeps the
// UTC parse the rest of the app uses for bare dates -- echoing "ET" on a date
// that has no time of day would be a lie. See the BARE DATES note in api.ts.
export type DateEchoKind = 'datetime' | 'date';

// Today in ET as 'YYYY-MM-DD', for the bare-date comparison. Whole-day
// granularity is the point: a start date of "today" must never read as past.
function etTodayKey(): string {
  return isoToEtWallClock(new Date().toISOString()).slice(0, 10);
}

// The echoed text plus an optional nudge. Returns null when there's nothing to
// echo (empty or unparseable input) so the caller renders nothing at all.
function describe(
  value: string,
  kind: DateEchoKind,
): { text: string; warning: string | null } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (kind === 'date') {
    // Bare date: parsed as UTC midnight and formatted in UTC, matching how the
    // rest of the app handles date-only strings, so it can't drift a day.
    const ms = new Date(`${trimmed}T00:00:00Z`).getTime();
    if (Number.isNaN(ms)) return null;
    const text = new Date(ms).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
    // String compare on two 'YYYY-MM-DD' keys -- exact, and immune to the
    // hour-of-day skew a millisecond comparison would have here.
    let warning: string | null = null;
    if (trimmed < etTodayKey()) {
      warning = `That date is in the past. ${DAY_FIRST_HINT}`;
    } else if (ms - Date.now() > FAR_OUT_MS) {
      warning = `That date is more than 18 months away. ${DAY_FIRST_HINT}`;
    }
    return { text, warning };
  }

  // Wall clock -> the instant it means in ET, then echoed back in ET.
  const iso = etWallClockToIso(trimmed);
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;

  const day = etDateTime(iso, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const time = etTime(iso, { zone: true });
  if (!day || !time) return null;

  let warning: string | null = null;
  if (ms < Date.now() - PAST_GRACE_MS) {
    warning = `That's in the past. ${DAY_FIRST_HINT}`;
  } else if (ms - Date.now() > FAR_OUT_MS) {
    warning = `That's more than 18 months away. ${DAY_FIRST_HINT}`;
  }

  return { text: `${day} · ${time}`, warning };
}

export function DateEcho({
  value,
  kind = 'datetime',
}: {
  // The raw input value: 'YYYY-MM-DDTHH:mm' for 'datetime', 'YYYY-MM-DD' for
  // 'date'. Empty or half-typed values render nothing.
  value: string;
  kind?: DateEchoKind;
}) {
  const described = describe(value, kind);
  if (!described) return null;
  const { text, warning } = described;
  return (
    // Polite live region: the echo is the correction mechanism, so a screen
    // reader has to hear it change without the focus leaving the input.
    <div
      className={`date-echo${warning ? ' date-echo--warn' : ''}`}
      aria-live="polite"
    >
      <span className="date-echo__value">{text}</span>
      {warning && <span className="date-echo__note">{warning}</span>}
    </div>
  );
}
