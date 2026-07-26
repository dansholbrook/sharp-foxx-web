'use client';

// ============================================================================
// /arena/call/desk — THE EDITORIAL DESK. admin + regional_manager.
//
// Two jobs, in the order they happen on a Thursday: designate the week's game
// and name its correspondent, then watch the card move draft -> published ->
// graded. Nothing on this page composes or grades — a row routes to whichever
// tool the card is actually waiting on (callStaffRoute), so the desk never
// becomes a third place those tools live.
//
// THE QUEUE PATTERN IN NAVIGATION MODE, the way My Games uses it: rows are links
// to a full workspace, not slide-over triggers. A Call has a whole screen's worth
// of work behind it, and a detail panel over a table would be a step in front of
// the tool rather than a view of the row.
//
// SPLIT ON THE WEEK, NOT ON STATUS. `upcoming` is this ET week and later in
// whatever state, `past` is everything before it — the backend's split, and
// this client does not re-derive the week boundary (a browser in another zone
// would disagree about which Monday it is; `thisWeek` comes down the wire).
//
// ONE READ PER SCOPE, NO POLLING. Nothing on a Call moves on a timescale a desk
// would watch: cards publish on Thursdays and grade on Saturday nights. The
// entrant count ticks over days.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../../../auth-context';
import { AccessDenied } from '../../../nav';
import { canAccess } from '../../../roles';
import { QueueTable, Column } from '../../../queue-table';
import { CallStaffShell, formatKickoff } from '../staff';
import {
  createCall,
  getCallEvents,
  getEvents,
  getFieldReps,
  callPurse,
  callStaffRoute,
  callStatusLabel,
  callWeekLabel,
  isCoveredEvent,
  points,
  CallList,
  CallListItem,
  EventListItem,
  FieldRep,
} from '../../../api';

// ---------------------------------------------------------------------------
// NEW CALL — the create modal.
//
// Reuses the .modal-overlay / .rep-form shell from Add Game and Assign Game, so
// the third "pick a game and a person" form on this site reads like the first
// two.
//
// EVERY REFUSAL IS SURFACED VERBATIM, and there are six of them (feed game, not
// scheduled, already started, correspondent not assigned, week taken, game
// taken). They are the only place an editor learns the rules, each one names a
// different fix, and rewriting them here would mean maintaining a second copy of
// a list that lives on the backend.
// ---------------------------------------------------------------------------
function NewCallForm({
  token,
  onCreated,
  onClose,
}: {
  token: string;
  // Handed the new Call's id so the desk can route straight into compose — the
  // create response is the ONLY place a draft's id appears for anyone, so it
  // must not be dropped on the floor.
  onCreated: (callId: string) => void;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [reps, setReps] = useState<FieldRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventId, setEventId] = useState('');
  const [repId, setRepId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [list, staff] = await Promise.all([
          getEvents(token, 'scheduled'),
          // The correspondent picker. Cannot be narrowed to reps ASSIGNED to the
          // chosen game — there is no assignments-by-event read — so it lists
          // every rep and the backend's 409 is what teaches. See the hint below
          // the field, which says so before the tap rather than after it.
          getFieldReps(token).catch(() => [] as FieldRep[]),
        ]);
        if (cancelled) return;
        // COVERED GAMES ONLY, and future ones. A feed row has no correspondent in
        // the stands and create refuses it outright; offering it and then
        // reporting the refusal would be a worse version of not offering it.
        const now = Date.now();
        setEvents(
          list
            .filter((e) => isCoveredEvent(e.source))
            .filter((e) => new Date(e.scheduledAt).getTime() > now)
            .sort(
              (a, b) =>
                new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
            ),
        );
        setReps(staff);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load games');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const chosen = events.find((e) => e.id === eventId);
  // Both team names are needed to RENDER the questions (contextFor 409s on the
  // whole save without them), so a game missing one is a card that cannot be
  // composed. Create would accept it; flag it here instead of letting a
  // correspondent find out five slots in.
  const missingTeams = Boolean(chosen && (!chosen.homeTeam || !chosen.awayTeam));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!eventId || !repId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createCall(token, {
        eventId,
        correspondentRepId: repId,
      });
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the Call');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card card"
        role="dialog"
        aria-modal="true"
        aria-label="New Call"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="game-kicker">This week&apos;s game</span>
            <h2 style={{ margin: '2px 0 0' }}>New Call</h2>
          </div>
          <button type="button" className="link-btn modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        <form onSubmit={submit} className="rep-form">
          <div className="field field--wide">
            <label htmlFor="nc-event">Game</label>
            <select
              id="nc-event"
              value={eventId}
              disabled={loading || submitting}
              onChange={(e) => setEventId(e.target.value)}
            >
              <option value="">
                {loading ? 'Loading games…' : 'Choose a covered game…'}
              </option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.homeTeam && e.awayTeam
                    ? `${e.awayTeam} at ${e.homeTeam}`
                    : e.sport}{' '}
                  — {formatKickoff(e.scheduledAt)}
                </option>
              ))}
            </select>
            <span className="callstaff-help">
              Covered games only — a Call needs a correspondent in the building,
              so feed games are not offered. The game must still be ahead of
              kickoff.
            </span>
          </div>

          {missingTeams && (
            <div className="error rep-form-msg">
              This game does not have both teams set. Its questions have no team
              names to render, so the card cannot be composed — set the teams on
              the game first.
            </div>
          )}

          <div className="field field--wide">
            <label htmlFor="nc-rep">Correspondent</label>
            <select
              id="nc-rep"
              value={repId}
              disabled={loading || submitting}
              onChange={(e) => setRepId(e.target.value)}
            >
              <option value="">Choose a correspondent…</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.displayName ?? r.email ?? r.id}
                  {r.kind === 'regional_manager' ? ' (manager)' : ''}
                </option>
              ))}
            </select>
            <span className="callstaff-help">
              They must already be <strong>assigned to this game</strong> — the
              Call is refused otherwise. Assign them from the roster first if
              they aren&apos;t.
            </span>
          </div>

          <div className="rep-form-actions">
            <button
              className="btn-inline"
              type="submit"
              disabled={!eventId || !repId || submitting}
            >
              {submitting ? 'Creating…' : 'Create the Call'}
            </button>
          </div>

          {error && <div className="error rep-form-msg">{error}</div>}
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE PAGE
// ---------------------------------------------------------------------------
export default function CallDeskPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [list, setList] = useState<CallList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(
    async (t: string, which: 'upcoming' | 'past') => {
      setLoading(true);
      setError(null);
      try {
        setList(await getCallEvents(t, which));
      } catch (err) {
        // A regional_manager with no manager rep profile gets
        // "403 No regional manager profile for this user" — a real answer, shown
        // as written rather than translated into a generic failure.
        setError(err instanceof Error ? err.message : 'Failed to load the schedule');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    void load(token, scope);
  }, [token, router, allowed, scope, load]);

  const columns: Column<CallListItem>[] = [
    { key: 'week', header: 'Week', cell: (c) => callWeekLabel(c.weekStart) },
    { key: 'matchup', header: 'Game', cell: (c) => c.matchup },
    {
      key: 'kick',
      header: 'Kickoff',
      cell: (c) => formatKickoff(c.event.scheduledAt),
    },
    {
      key: 'who',
      header: 'Correspondent',
      cell: (c) =>
        c.correspondent.displayName ?? (
          <span className="muted mono">{c.correspondent.repId.slice(0, 8)}</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (c) => (
        <span className={`pill${c.status === 'draft' ? ' pill--review' : ''}`}>
          {callStatusLabel(c.status)}
        </span>
      ),
    },
    {
      // The drafting progress, and the single most useful cell on the page on a
      // Thursday: 5/5 is a card that can publish, anything less is one that
      // cannot.
      key: 'qs',
      header: 'Questions',
      align: 'right',
      cell: (c) => `${c.questionCount}/5`,
    },
    { key: 'entries', header: 'Cards', align: 'right', cell: (c) => points(c.entryCount) },
    {
      // DERIVED HERE, NOT SENT. The list's pot is a terms-only projection —
      // base, per-entrant and the band split, with no `points` and no
      // `entrants` (those two belong to the fan read). So the purse is the same
      // arithmetic the backend does, run over the entry count in the row beside
      // it: callPurse(pot, entryCount).
      //
      // A DRAFT'S FIGURE IS NOT A PROMISE — nothing is snapshotted until
      // publish, so the terms are today's house defaults and the number is what
      // the card WOULD play for. Marked muted and said out loud on hover rather
      // than printed as if it were settled.
      key: 'pot',
      header: 'Pot',
      align: 'right',
      cell: (c) => {
        const purse = callPurse(c.pot, c.entryCount);
        return c.pot.snapshotted ? (
          points(purse)
        ) : (
          <span
            className="muted"
            title="Not snapshotted yet — the pot takes these numbers when the card publishes."
          >
            {points(purse)}
          </span>
        );
      },
    },
  ];

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const items = list?.items ?? [];

  return (
    <CallStaffShell
      kicker="The Correspondent's Call"
      title="Call desk"
      standfirst="Designate the week's game, name the correspondent, and follow the card from draft to graded. One published Call per week."
      actions={
        <>
          <button
            type="button"
            className="btn-inline"
            onClick={() => setShowNew(true)}
          >
            + New Call
          </button>
          <Link href="/arena/call" className="link-btn">
            Fan card →
          </Link>
        </>
      }
    >
      <div className="callstaff-scope">
        {(['upcoming', 'past'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`console-chip${scope === s ? ' console-chip--on' : ''}`}
            onClick={() => setScope(s)}
          >
            {s === 'upcoming' ? 'This week and ahead' : 'Past weeks'}
          </button>
        ))}
        {list && (
          <span className="muted callstaff-scope__note">
            Week of {callWeekLabel(list.thisWeek).replace('Week of ', '')}
          </span>
        )}
      </div>

      {showNew && (
        <NewCallForm
          token={token}
          onCreated={(callId) => {
            setShowNew(false);
            // Straight into compose. The draft's id exists nowhere else a field
            // rep can read, so the create response has to become a destination
            // rather than a toast.
            router.push(`/arena/call/compose/${callId}`);
          }}
          onClose={() => setShowNew(false)}
        />
      )}

      {loading && <div className="card muted">Loading the schedule…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && (
        <section className="card game">
          <span className="game-kicker">Schedule</span>
          <h2>{scope === 'upcoming' ? 'This week and ahead' : 'Past weeks'}</h2>
          {items.length > 0 ? (
            <QueueTable
              columns={columns}
              rows={items}
              rowKey={(c) => c.id}
              onRowActivate={(c) => router.push(callStaffRoute(c))}
              resetKey={scope}
              pageSize={12}
              ariaLabel="Correspondent's Call schedule"
            />
          ) : (
            <div className="results-empty">
              <p className="results-empty__title">
                {scope === 'upcoming'
                  ? 'No Call for this week yet'
                  : 'No Calls before this week'}
              </p>
              <p className="results-empty__hint">
                {scope === 'upcoming'
                  ? 'Pick a covered game and name the correspondent who will be in the building. The card is theirs to write and theirs to grade.'
                  : 'Graded and voided cards from earlier weeks will collect here.'}
              </p>
            </div>
          )}
        </section>
      )}
    </CallStaffShell>
  );
}
