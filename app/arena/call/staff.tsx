'use client';

// ============================================================================
// Shared shell for the Call's three STAFF surfaces — the desk, the compose tool
// and the grade tool.
//
// A shared shell rather than three copies of the same header, which is the usual
// pattern on this site, because these three are siblings in a way the other
// staff pages are not: a correspondent moves between them inside one job, and a
// masthead that drifted between them would read as three different products. The
// shell is layout only — every page owns its own reads, state and actions.
// ============================================================================

import { ReactNode } from 'react';
import Link from 'next/link';
import { useAuth } from '../../auth-context';
import { AppNav } from '../../nav';

export function CallStaffShell({
  kicker,
  title,
  standfirst,
  // Top-right link (usually back to the desk, or to the fan card).
  actions,
  children,
}: {
  kicker: string;
  title: string;
  standfirst?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user } = useAuth();

  return (
    <main className="feed-home callstaff-page">
      <div className="header-row">
        <div>
          <span className="wordmark">Sharp Foxx</span>
          <span className="muted">
            Signed in as <span className="mono">{user?.displayName ?? user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <AppNav />
      </div>

      <div className="masthead masthead-head">
        <div>
          <span className="masthead-kicker">{kicker}</span>
          <h1 className="masthead-title">{title}</h1>
          {standfirst && <p className="masthead-standfirst">{standfirst}</p>}
        </div>
        {actions && <div className="masthead-actions">{actions}</div>}
      </div>

      {children}
    </main>
  );
}

// ---------------------------------------------------------------------------
// THE 403 STATE, and why it is a state rather than an error.
//
// /arena/call/compose/:id and /grade/:id are gated on CALL_COMPOSE_ROLES, which
// admits every field_rep — because "is this rep the named correspondent, and are
// they still assigned to the game" is a fact about two rows and cannot live in a
// route guard. So a rep who follows a colleague's link, or who was unassigned
// from the game since the Call was created, reaches this page legitimately and
// is refused by CallService.assertCanCompose.
//
// That is not a failure to report. Nothing is broken, nothing will succeed on
// retry, and a red error box would read as "the tool is down" on a night when
// the tool is fine. The two sentences the backend can produce are:
//
//   "Only the named correspondent, their manager, or an admin may write this Call"
//   "You are no longer assigned to this game, so you can no longer write its Call"
//
// Both are shown VERBATIM under the heading, because the second one is
// actionable (get reassigned) and the first one is not, and only the server
// knows which happened.
// ---------------------------------------------------------------------------
export function NotYourCall({ detail }: { detail: string }) {
  return (
    <div className="results-empty">
      <p className="results-empty__title">This isn&apos;t your Call</p>
      <p className="results-empty__hint">{detail}</p>
      <p className="results-empty__hint">
        A Call can only be written or graded by the correspondent it was assigned
        to, their manager, or an admin. If this is your game,{' '}
        <Link href="/my-games" className="callstaff-inline-link">
          My Games
        </Link>{' '}
        will show what you are actually assigned to.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting. Both of these exist elsewhere on the site in the same shape; they
// are re-stated here rather than exported from a page module, which is what the
// rest of the repo does too.
// ---------------------------------------------------------------------------

// "Sat, Nov 8, 7:30 PM" — kickoff, in the reader's own zone. A correspondent
// checking whether a card locks tonight wants their own clock, not ET.
export function formatKickoff(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

// How long until (or since) a moment, in the coarsest useful unit. Used for the
// lock countdown on the compose tool and the "graded N hours after kickoff"
// reading on the grade tool. Deliberately coarse: nothing on these two screens
// turns on a second, and a ticking clock would be a timer running for no reason.
export function relativeTo(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.round((t - now) / 60000);
  const abs = Math.abs(mins);
  const unit =
    abs < 60
      ? `${abs} min`
      : abs < 60 * 24
        ? `${Math.round(abs / 60)} hr`
        : `${Math.round(abs / (60 * 24))} day${Math.round(abs / (60 * 24)) === 1 ? '' : 's'}`;
  return mins >= 0 ? `in ${unit}` : `${unit} ago`;
}
