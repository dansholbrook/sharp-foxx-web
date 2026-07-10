'use client';

// Shared "Add Game" modal used by both My Games (field_rep) and Field Reps
// (regional_manager/admin). It creates an event via POST /events; when the
// caller is a field_rep (selfClaim) it immediately POST /assignments to claim
// the game so it appears in their list, then hands control back via onCreated.
// For managers/admins it just confirms success and clears the form.

import { useEffect, useState } from 'react';
import {
  getTeams,
  createTeam,
  createEvent,
  createAssignment,
  Team,
  CreateEventInput,
} from './api';

// The sport enum, matching the values used on the Feed/Search surfaces.
const SPORTS = ['basketball', 'football', 'baseball', 'hockey', 'soccer', 'other'];

// Team levels accepted by POST /teams, with readable labels.
const LEVELS: Array<{ value: 'pro' | 'college' | 'high_school'; label: string }> = [
  { value: 'pro', label: 'Pro' },
  { value: 'college', label: 'College' },
  { value: 'high_school', label: 'High school' },
];

// Sentinel option value that reveals the inline "new team" inputs.
const NEW_TEAM = '__new__';

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
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [homeTeamId, setHomeTeamId] = useState('');
  const [awayTeamId, setAwayTeamId] = useState('');
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

  // Load teams whenever the sport changes; reset the team pickers so a stale
  // selection from another sport can't leak through.
  useEffect(() => {
    if (!sport) {
      setTeams([]);
      return;
    }
    let cancelled = false;
    setTeamsLoading(true);
    setHomeTeamId('');
    setAwayTeamId('');
    setNewTeamFor(null);
    (async () => {
      try {
        const list = await getTeams(token, sport);
        if (!cancelled) setTeams(list);
      } catch (err) {
        if (!cancelled) {
          setTeams([]);
          setFormError(err instanceof Error ? err.message : 'Failed to load teams');
        }
      } finally {
        if (!cancelled) setTeamsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, sport]);

  // Selecting a team dropdown: the sentinel opens the inline creator for that
  // side (and clears its current pick); any other value is a real selection.
  function onSelectTeam(side: Side, value: string) {
    setSuccess(null);
    if (value === NEW_TEAM) {
      setNewTeamFor(side);
      setNewTeamName('');
      setNewTeamLevel('pro');
      setNewTeamError(null);
      if (side === 'home') setHomeTeamId('');
      else setAwayTeamId('');
      return;
    }
    if (side === 'home') setHomeTeamId(value);
    else setAwayTeamId(value);
  }

  // Create a team via POST /teams, add it to both dropdowns, and select it in
  // the side that triggered the creation. A 409 (duplicate name) shows inline.
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
      setTeams((prev) =>
        [...prev, team].sort((a, b) => a.name.localeCompare(b.name)),
      );
      if (newTeamFor === 'home') setHomeTeamId(team.id);
      else setAwayTeamId(team.id);
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
    if (homeTeamId && awayTeamId && homeTeamId === awayTeamId) {
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
    if (homeTeamId) body.homeTeamId = homeTeamId;
    if (awayTeamId) body.awayTeamId = awayTeamId;

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
      setHomeTeamId('');
      setAwayTeamId('');
      setVenue('');
      setScheduledAt('');
      setIsLocalStream(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add game');
    } finally {
      setSubmitting(false);
    }
  }

  // Options for one side, excluding the team already picked on the other side so
  // the same team can't be chosen twice.
  function teamOptions(otherId: string) {
    return teams.filter((t) => t.id !== otherId || otherId === '');
  }

  const teamSelectDisabled = !sport || teamsLoading;

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
              onChange={(e) => setSport(e.target.value)}
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

          {/* ---- Home team ---- */}
          <div className="field">
            <label htmlFor="ag-home">Home team</label>
            <select
              id="ag-home"
              value={homeTeamId}
              disabled={teamSelectDisabled}
              onChange={(e) => onSelectTeam('home', e.target.value)}
            >
              <option value="">
                {sport ? (teamsLoading ? 'Loading teams…' : 'Choose home team…') : 'Pick a sport first'}
              </option>
              {teamOptions(awayTeamId).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              {sport && !teamsLoading && <option value={NEW_TEAM}>+ New team…</option>}
            </select>
          </div>

          {/* ---- Away team ---- */}
          <div className="field">
            <label htmlFor="ag-away">Away team</label>
            <select
              id="ag-away"
              value={awayTeamId}
              disabled={teamSelectDisabled}
              onChange={(e) => onSelectTeam('away', e.target.value)}
            >
              <option value="">
                {sport ? (teamsLoading ? 'Loading teams…' : 'Choose away team…') : 'Pick a sport first'}
              </option>
              {teamOptions(homeTeamId).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              {sport && !teamsLoading && <option value={NEW_TEAM}>+ New team…</option>}
            </select>
          </div>

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
