'use client';

// Shared "Assign game" modal used on the manager roster page. It lists games
// via GET /events (final games excluded -- you can't newly assign a wrapped
// game) and POSTs /assignments. Given a rep it assigns that rep (body.repId);
// with rep === null it omits repId so the backend treats it as a manager
// self-claim, landing the game in the manager's own My Games. Reuses the
// modal/form patterns from add-game-form.tsx (.modal-overlay/.rep-form/etc.).

import { useEffect, useState } from 'react';
import {
  getEvents,
  createAssignment,
  etDateTime,
  EventListItem,
  CreateAssignmentInput, teamLabel } from './api';

// "Home vs Away — venue — date" for one game, falling back to the sport when
// either team name is missing (no raw UUIDs), and dropping an absent venue.
// Labelled ET: this is a kickoff, and picking the wrong night out of the list is
// the mistake the label is here to prevent.
function eventLabel(e: EventListItem): string {
  const matchup =
    e.homeTeam && e.awayTeam
      ? `${teamLabel(e.homeInstitution, e.homeTeam)} vs ${teamLabel(e.awayInstitution, e.awayTeam)}`
      : e.sport;
  const when = etDateTime(e.scheduledAt, { zone: true });
  return [matchup, e.venue, when].filter(Boolean).join(' — ');
}

export function AssignGameForm({
  token,
  rep,
  onClose,
  onAssigned,
}: {
  token: string;
  // The rep to assign, or null to self-claim for the calling manager.
  rep: { id: string; name: string } | null;
  onClose: () => void;
  // Called after a successful assign/claim so the parent can refresh if it
  // shows assignment state (the roster doesn't, so this is optional).
  onAssigned?: () => void;
}) {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventId, setEventId] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load games once; drop final games -- they're done, not assignable.
  useEffect(() => {
    let cancelled = false;
    setEventsLoading(true);
    (async () => {
      try {
        const list = await getEvents(token);
        if (!cancelled) setEvents(list.filter((e) => e.status !== 'final'));
      } catch (err) {
        if (!cancelled) {
          setFormError(err instanceof Error ? err.message : 'Failed to load games');
        }
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);
    if (!eventId) {
      setFormError('Pick a game.');
      return;
    }

    const body: CreateAssignmentInput = { eventId };
    if (rep) body.repId = rep.id;
    if (notes.trim()) body.notes = notes.trim();

    setSubmitting(true);
    try {
      await createAssignment(token, body);
      setSuccess(
        rep ? `Game assigned to ${rep.name}.` : 'Game claimed — see it in My Games.',
      );
      setEventId('');
      setNotes('');
      onAssigned?.();
    } catch (err) {
      // A duplicate assignment (already on this game) comes back 409, surfaced
      // as "409 <message>"; a bad body/id as 400/404 -- all shown inline.
      setFormError(err instanceof Error ? err.message : 'Failed to assign game');
    } finally {
      setSubmitting(false);
    }
  }

  const title = rep ? 'Assign a game' : 'Claim a game for myself';
  const kicker = rep ? `To ${rep.name}` : 'Self-claim';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="game-kicker">{kicker}</span>
            <h2 style={{ margin: '2px 0 0' }}>{title}</h2>
          </div>
          <button type="button" className="link-btn modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        <form onSubmit={onSubmit} className="rep-form">
          <div className="field field--wide">
            <label htmlFor="assign-game">Game</label>
            <select
              id="assign-game"
              value={eventId}
              disabled={eventsLoading}
              onChange={(e) => {
                setEventId(e.target.value);
                setSuccess(null);
              }}
            >
              <option value="">
                {eventsLoading
                  ? 'Loading games…'
                  : events.length
                    ? 'Choose a game…'
                    : 'No assignable games'}
              </option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {eventLabel(e)}
                </option>
              ))}
            </select>
          </div>

          <div className="field field--wide">
            <label htmlFor="assign-notes">Notes (optional)</label>
            <input
              id="assign-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the rep should know…"
              autoComplete="off"
            />
          </div>

          <div className="rep-form-actions">
            <button type="submit" disabled={submitting || eventsLoading || !eventId}>
              {submitting
                ? rep
                  ? 'Assigning…'
                  : 'Claiming…'
                : rep
                  ? 'Assign game'
                  : 'Claim game'}
            </button>
          </div>

          {formError && <div className="error rep-form-msg">{formError}</div>}
          {success && <div className="success rep-form-msg">{success}</div>}
        </form>
      </div>
    </div>
  );
}
