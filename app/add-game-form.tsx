'use client';

// Shared "Add Game" modal used by both My Games (field_rep) and Field Reps
// (regional_manager/admin). It creates an event via POST /events; when the
// caller is a field_rep (selfClaim) it immediately POST /assignments to claim
// the game so it appears in their list, then hands control back via onCreated.
// For managers/admins it just confirms success and clears the form.

import { useState } from 'react';
import {
  createTeam,
  createEvent,
  createAssignment,
  CreateEventInput,
} from './api';
import { TeamPicker, TeamSelection } from './team-picker';

// The sport enum, matching the values used on the Feed/Search surfaces.
const SPORTS = ['basketball', 'football', 'baseball', 'hockey', 'soccer', 'other'];

// Team levels accepted by POST /teams, with readable labels.
const LEVELS: Array<{ value: 'pro' | 'college' | 'high_school'; label: string }> = [
  { value: 'pro', label: 'Pro' },
  { value: 'college', label: 'College' },
  { value: 'high_school', label: 'High school' },
];

type Side = 'home' | 'away';

export function AddGameForm({
  token,
  selfClaim,
  onCreated,
  onClose,
}: {
  token: string;
  // True when the current user is a field_rep: create then self-claim + refresh.
  selfClaim: boolean;
  // Called after a successful create (and claim) so the parent can refresh its
  // list in place. Only wired up for the field_rep flow.
  onCreated?: () => void;
  onClose: () => void;
}) {
  const [sport, setSport] = useState('');
  // Each side holds the committed selection ({id, label}); TeamPicker owns the
  // query/results and searches the API as you type.
  const [home, setHome] = useState<TeamSelection | null>(null);
  const [away, setAway] = useState<TeamSelection | null>(null);
  const [venue, setVenue] = useState('');
  const [scheduledAt, setScheduledAt] = useState(''); // datetime-local value
  const [isLocalStream, setIsLocalStream] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Inline "new team" state, keyed by the side that opened it.
  const [newTeamFor, setNewTeamFor] = useState<Side | null>(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamLevel, setNewTeamLevel] = useState<'pro' | 'college' | 'high_school'>('pro');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [newTeamError, setNewTeamError] = useState<string | null>(null);

  // Changing sport resets both sides: a team from another sport must not leak
  // through. (TeamPicker clears its own query/results on the same change.)
  function onChangeSport(value: string) {
    setSport(value);
    setHome(null);
    setAway(null);
    setNewTeamFor(null);
    setSuccess(null);
  }

  function onSelectTeam(side: Side, selection: TeamSelection | null) {
    setSuccess(null);
    if (side === 'home') setHome(selection);
    else setAway(selection);
  }

  // The picker's "+ New team" row opens the inline creator for that side,
  // prefilled with whatever was typed.
  function openNewTeam(side: Side, name: string) {
    setSuccess(null);
    setNewTeamFor(side);
    setNewTeamName(name);
    setNewTeamLevel('pro');
    setNewTeamError(null);
    if (side === 'home') setHome(null);
    else setAway(null);
  }

  // Create a team via POST /teams and select it on the side that triggered the
  // creation. A 409 (duplicate name) shows inline. Nothing to splice into a
  // cached list any more — the pickers search the API directly, and a fresh
  // team is active so it turns up on the next search.
  async function submitNewTeam() {
    if (!newTeamFor || !newTeamName.trim()) return;
    setCreatingTeam(true);
    setNewTeamError(null);
    try {
      const team = await createTeam(token, {
        name: newTeamName.trim(),
        sport,
        level: newTeamLevel,
      });
      const selection: TeamSelection = { id: team.id, label: team.name };
      if (newTeamFor === 'home') setHome(selection);
      else setAway(selection);
      setNewTeamFor(null);
      setNewTeamName('');
    } catch (err) {
      setNewTeamError(err instanceof Error ? err.message : 'Failed to create team');
    } finally {
      setCreatingTeam(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);

    if (!sport) {
      setFormError('Pick a sport.');
      return;
    }
    if (!scheduledAt) {
      setFormError('Pick a date and time.');
      return;
    }
    if (home && away && home.id === away.id) {
      setFormError('Home and away teams must be different.');
      return;
    }
    // datetime-local is local wall-clock with no zone; toISOString normalizes it
    // to the UTC instant the API expects.
    const iso = new Date(scheduledAt).toISOString();

    const body: CreateEventInput = {
      sport,
      scheduledAt: iso,
      isLocalStream,
    };
    if (venue.trim()) body.venue = venue.trim();
    if (home) body.homeTeamId = home.id;
    if (away) body.awayTeamId = away.id;

    setSubmitting(true);
    try {
      const event = await createEvent(token, body);
      if (selfClaim) {
        // Claim it so it shows up in My Games, then let the parent refresh.
        await createAssignment(token, { eventId: event.id });
        onCreated?.();
        onClose();
        return;
      }
      // Manager/admin: confirm and clear for the next entry.
      setSuccess('Game added.');
      setHome(null);
      setAway(null);
      setVenue('');
      setScheduledAt('');
      setIsLocalStream(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add game');
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
        aria-label="Add game"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="game-kicker">New game</span>
            <h2 style={{ margin: '2px 0 0' }}>Add a game</h2>
          </div>
          <button type="button" className="link-btn modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        <form onSubmit={onSubmit} className="rep-form">
          <div className="field">
            <label htmlFor="ag-sport">Sport</label>
            <select
              id="ag-sport"
              value={sport}
              onChange={(e) => onChangeSport(e.target.value)}
            >
              <option value="">Choose a sport…</option>
              {SPORTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="ag-venue">Venue (optional)</label>
            <input
              id="ag-venue"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="Foxx Arena"
              autoComplete="off"
            />
          </div>

          {/* ---- Home / away team type-aheads ---- */}
          {/* Each excludes the other side's pick so the same team can't be
              chosen twice. */}
          <TeamPicker
            token={token}
            sport={sport}
            label="Home team"
            inputId="ag-home"
            selected={home}
            onSelect={(s) => onSelectTeam('home', s)}
            excludeId={away?.id ?? ''}
            onCreateNew={(name) => openNewTeam('home', name)}
          />

          <TeamPicker
            token={token}
            sport={sport}
            label="Away team"
            inputId="ag-away"
            selected={away}
            onSelect={(s) => onSelectTeam('away', s)}
            excludeId={home?.id ?? ''}
            onCreateNew={(name) => openNewTeam('away', name)}
          />

          {/* ---- Inline new-team creator (spans both columns) ---- */}
          {newTeamFor && (
            <div className="field field--wide new-team">
              <label>New {newTeamFor} team</label>
              <div className="new-team-row">
                <input
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="Team name"
                  autoComplete="off"
                  aria-label="New team name"
                />
                <select
                  value={newTeamLevel}
                  onChange={(e) =>
                    setNewTeamLevel(e.target.value as 'pro' | 'college' | 'high_school')
                  }
                  aria-label="New team level"
                  className="new-team-level"
                >
                  {LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-inline"
                  disabled={creatingTeam || !newTeamName.trim()}
                  onClick={submitNewTeam}
                >
                  {creatingTeam ? 'Creating…' : 'Create'}
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setNewTeamFor(null);
                    setNewTeamError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
              {newTeamError && <div className="error rep-form-msg">{newTeamError}</div>}
            </div>
          )}

          {/* ---- Date & time ---- */}
          <div className="field">
            <label htmlFor="ag-when">Date &amp; time</label>
            <input
              id="ag-when"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>

          {/* ---- Local stream toggle ---- */}
          <div className="field checkbox-field">
            <label className="checkbox-label" htmlFor="ag-local">
              <input
                id="ag-local"
                type="checkbox"
                checked={isLocalStream}
                onChange={(e) => setIsLocalStream(e.target.checked)}
              />
              Local Sharp Foxx coverage
            </label>
          </div>

          <div className="rep-form-actions">
            <button type="submit" disabled={submitting || !sport || !scheduledAt}>
              {submitting ? 'Adding…' : 'Add game'}
            </button>
          </div>

          {formError && <div className="error rep-form-msg">{formError}</div>}
          {success && <div className="success rep-form-msg">{success}</div>}
        </form>
      </div>
    </div>
  );
}
