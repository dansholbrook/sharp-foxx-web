'use client';

// Shared "Add Game" modal used by both My Games (field_rep) and Field Reps
// (regional_manager/admin). It creates an event via POST /events; when the
// caller is a field_rep (selfClaim) it immediately POST /assignments to claim
// the game so it appears in their list, then hands control back via onCreated.
// For managers/admins it just confirms success and clears the form.

import { useEffect, useState } from 'react';
import {
  createTeam,
  createEvent,
  createAssignment,
  etWallClockToIso,
  CreateEventInput,
  CreateTeamInput,
  InstitutionSummary,
  InstitutionTier,
} from './api';
import { TeamPicker, TeamSelection } from './team-picker';
import { SchoolPicker, schoolLocation } from './school-picker';
import { DateEcho } from './date-echo';

// The sport enum, matching the values used on the Feed/Search surfaces.
const SPORTS = ['basketball', 'football', 'baseball', 'hockey', 'soccer', 'other'];

type TeamLevel = 'pro' | 'college' | 'high_school';

// Team levels accepted by POST /teams, with readable labels. Only reachable on
// the no-school path now -- with a school chosen the level is DERIVED, see
// levelForTier.
const LEVELS: Array<{ value: TeamLevel; label: string }> = [
  { value: 'pro', label: 'Pro' },
  { value: 'college', label: 'College' },
  { value: 'high_school', label: 'High school' },
];

// A school's tier already answers "what level does this team play at", so
// asking a correspondent to restate it is a question with a known answer -- and
// the old default answered it WRONG. `level` was hardcoded to 'pro' here, which
// is why Lincoln Lions, Central Tigers, Eastside Eagles, Westfield Warriors and
// Northgate Knights are all stored in the database as professional franchises.
//
// 'unclassified' maps to college on purpose: it is what the college import
// assigns an NCAA school with a missing or odd division, so it is a college
// with a data gap, not an unknown kind of institution.
function levelForTier(tier: InstitutionTier): TeamLevel {
  return tier === 'high_school' ? 'high_school' : 'college';
}

// The label the picker would have shown had this team already existed, so a
// freshly created team reads identically to a chosen one. Mirrors teamLabel()
// in team-picker.tsx.
function createdTeamLabel(name: string, school: InstitutionSummary | null): string {
  if (!school) return name;
  const state = school.stateCode ? ` (${school.stateCode})` : '';
  return `${name} — ${school.name}${state}`;
}

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
  // Only used on the no-school path; with a school chosen, levelForTier decides.
  // Defaults to high_school, NOT pro -- this flow reaches a correspondent
  // covering a school, and the old 'pro' default silently mislabelled every
  // team it created.
  const [newTeamLevel, setNewTeamLevel] = useState<TeamLevel>('high_school');
  const [newTeamSchool, setNewTeamSchool] = useState<InstitutionSummary | null>(null);
  // The deliberate escape hatch from the school requirement -- see the note on
  // the checkbox itself.
  const [newTeamNoSchool, setNewTeamNoSchool] = useState(false);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [newTeamError, setNewTeamError] = useState<string | null>(null);
  // Not an error: a team created under a school we don't cover yet is staged
  // inactive by the backend. Kept separate from newTeamError so it can't be
  // styled or read as a failure.
  const [newTeamNotice, setNewTeamNotice] = useState<string | null>(null);

  // Lock the page behind the modal from scrolling while it's open. Mounting
  // this component means it's open, so there's no condition to guard on.
  //
  // Adding a game is the FIRST thing a correspondent does, and on a phone the
  // page underneath scrolled freely behind the sheet: tapping a team field,
  // dismissing the keyboard, or flicking a picker that had reached its end all
  // moved the schedule behind the modal instead. The same few lines already
  // guard SlideOver (see queue-table.tsx) -- this modal simply never got them.
  //
  // Restores the PREVIOUS value rather than clearing it, so closing this modal
  // can't unlock a page some other overlay still wants locked.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Changing sport resets both sides: a team from another sport must not leak
  // through. (TeamPicker clears its own query/results on the same change.)
  function onChangeSport(value: string) {
    setSport(value);
    setHome(null);
    setAway(null);
    setNewTeamFor(null);
    setSuccess(null);
    // The notice names a team that is no longer selected on either side.
    setNewTeamNotice(null);
  }

  function onSelectTeam(side: Side, selection: TeamSelection | null) {
    setSuccess(null);
    setNewTeamNotice(null);
    if (side === 'home') setHome(selection);
    else setAway(selection);
  }

  // The picker's "+ New team" row opens the inline creator for that side,
  // prefilled with whatever was typed.
  function openNewTeam(side: Side, name: string) {
    setSuccess(null);
    setNewTeamFor(side);
    setNewTeamName(name);
    setNewTeamLevel('high_school');
    setNewTeamSchool(null);
    setNewTeamNoSchool(false);
    setNewTeamError(null);
    setNewTeamNotice(null);
    if (side === 'home') setHome(null);
    else setAway(null);
  }

  // A school is REQUIRED unless the correspondent explicitly says there isn't
  // one. See the checkbox below for the argument; the short version is that a
  // silently-optional field is what produced the orphans in the first place,
  // but a hard requirement would dead-end the exact person this flow is for.
  const newTeamLevelResolved: TeamLevel = newTeamSchool
    ? levelForTier(newTeamSchool.tier)
    : newTeamLevel;
  const newTeamReady = !!newTeamName.trim() && (!!newTeamSchool || newTeamNoSchool);

  // Create a team via POST /teams and select it on the side that triggered the
  // creation. A 409 (duplicate name at that school) or a 404 (unknown school)
  // shows inline. Nothing to splice into a cached list — the pickers search the
  // API directly, and the new team turns up on the next search.
  async function submitNewTeam() {
    if (!newTeamFor || !newTeamReady) return;
    setCreatingTeam(true);
    setNewTeamError(null);
    setNewTeamNotice(null);
    try {
      const body: CreateTeamInput = {
        name: newTeamName.trim(),
        sport,
        level: newTeamLevelResolved,
      };
      // Omitted entirely rather than sent as null — the field is optional on
      // the wire and the backend treats absent as "no school".
      if (newTeamSchool) body.institutionId = newTeamSchool.id;

      const team = await createTeam(token, body);
      const selection: TeamSelection = {
        id: team.id,
        label: createdTeamLabel(team.name, newTeamSchool),
      };
      if (newTeamFor === 'home') setHome(selection);
      else setAway(selection);

      // EXPECTED, NOT A FAILURE. A team created under a school we don't cover
      // yet comes back is_active=false: activating a school is an admin
      // coverage decision, and a correspondent scheduling one game must not
      // flip a school into the covered map as a side effect. Say so plainly —
      // the team is real, it is selected, and the game will schedule against it
      // (POST /events validates only that the team exists). Silence here would
      // read as "it worked" right up until someone noticed the team missing
      // from every covered-only list.
      if (!team.isActive) {
        setNewTeamNotice(
          `Created “${team.name}” and selected it — this game will schedule normally. ` +
            'It’s marked “not yet covered” because we don’t cover ' +
            `${newTeamSchool ? newTeamSchool.name : 'this school'} yet; an admin ` +
            'turns coverage on from Discover.',
        );
      }

      setNewTeamFor(null);
      setNewTeamName('');
      setNewTeamSchool(null);
      setNewTeamNoSchool(false);
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
    // Both sides are required. They used to be optional, which let a
    // correspondent file "basketball, Sep 5, 7 PM" -- a row with no matchup,
    // which no school page, contest or recap can ever reconcile.
    if (!home || !away) {
      setFormError('Pick both teams — a game without a matchup can’t be covered.');
      return;
    }
    if (home.id === away.id) {
      setFormError('Home and away teams must be different.');
      return;
    }
    // datetime-local is a wall clock with no zone, and the field says that clock
    // is EASTERN — so it converts through the ET crossing, not through the
    // browser's offset. A correspondent adding a 7:00 PM game from Denver used
    // to write 01:00Z instead of 23:00Z, and every lock, grade and countdown on
    // that game inherited the two hours.
    const iso = etWallClockToIso(scheduledAt);
    if (!iso) {
      setFormError('Pick a valid date and time.');
      return;
    }

    const body: CreateEventInput = {
      sport,
      scheduledAt: iso,
      isLocalStream,
      homeTeamId: home.id,
      awayTeamId: away.id,
    };
    if (venue.trim()) body.venue = venue.trim();

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
      // Manager/admin: confirm and clear for the next entry. Say plainly that
      // the game is UNCLAIMED -- selfClaim is false for anyone without the
      // field_rep role, so this game is in no one's My Games and its workspace
      // access-denies the person who just made it. "Game added." on its own read
      // as success and left them hunting for a game they could never open.
      setSuccess(
        'Game added — but not assigned to anyone yet. It won’t appear in My Games ' +
          'until a correspondent claims it or a manager assigns it from their roster.',
      );
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
              // A placeholder, never a default -- an empty venue is omitted from
              // the body entirely. It reads as a real example so nobody mistakes
              // it for a prefilled value and submits it verbatim, which is what
              // the old "Foxx Arena" invited.
              placeholder="e.g. Lincoln High School gym"
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
                {/* The level <select> only survives on the no-school path. With
                    a school chosen its answer is already known — see
                    levelForTier — and asking twice is how the answer got to be
                    wrong in five rows. */}
                {newTeamNoSchool && (
                  <select
                    value={newTeamLevel}
                    onChange={(e) => setNewTeamLevel(e.target.value as TeamLevel)}
                    aria-label="New team level"
                    className="new-team-level"
                  >
                    {LEVELS.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="btn-inline"
                  disabled={creatingTeam || !newTeamReady}
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

              {/* ---- School: the field this whole change exists for ---- */}
              {!newTeamNoSchool && (
                <div className="new-team-school">
                  <SchoolPicker
                    token={token}
                    inputId="ag-new-team-school"
                    selected={newTeamSchool}
                    onSelect={setNewTeamSchool}
                    disabled={creatingTeam}
                  />
                  {newTeamSchool ? (
                    <div className="new-team-hint">
                      {[schoolLocation(newTeamSchool), `${newTeamLevelResolved.replace('_', ' ')} team`]
                        .filter(Boolean)
                        .join(' · ')}
                      {!newTeamSchool.isActive && ' · not yet covered'}
                    </div>
                  ) : (
                    <div className="new-team-hint">
                      Attaching the school is what puts this team on that school’s
                      page and counts it toward their coverage. Without it the team
                      is a floating row.
                    </div>
                  )}
                </div>
              )}

              {/* THE ESCAPE HATCH, and why it exists rather than a hard block.
                  The school is required by default because a silently optional
                  field is exactly what produced the orphans this change is
                  fixing. But there is no POST /institutions anywhere in the API,
                  so a correspondent covering a school genuinely outside the
                  2,012 imported ones cannot add it — and a hard requirement
                  would leave that person, the person this flow is FOR, unable
                  to file their game at all. A schoolless team is recoverable
                  (an admin can attach one later via PATCH /teams/:id); a
                  correspondent who can't enter the game is not.
                  So: opt out, deliberately, and be told what it costs. */}
              <label className="checkbox-label new-team-noschool">
                <input
                  type="checkbox"
                  checked={newTeamNoSchool}
                  onChange={(e) => {
                    setNewTeamNoSchool(e.target.checked);
                    if (e.target.checked) setNewTeamSchool(null);
                  }}
                />
                This school isn’t listed (or it’s a pro team)
              </label>
              {newTeamNoSchool && (
                <div className="new-team-hint new-team-hint--warn">
                  This team won’t belong to any school: it won’t show on a school
                  page or count toward anyone’s coverage until an admin attaches
                  one. Fine for a pro team — for a school, please search again
                  before ticking this.
                </div>
              )}

              {newTeamError && <div className="error rep-form-msg">{newTeamError}</div>}
            </div>
          )}

          {/* Outlives the creator panel: the team is already created and
              selected by the time this shows, so it hangs below the pickers. */}
          {newTeamNotice && <div className="notice rep-form-msg">{newTeamNotice}</div>}

          {/* ---- Date & time ---- */}
          <div className="field">
            <label htmlFor="ag-when">
              Date &amp; time <span className="muted">(Eastern Time)</span>
            </label>
            <input
              id="ag-when"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            {/* The box above is drawn in the BROWSER'S locale, so a
                European-locale laptop shows dd.mm.yyyy and turns "Sep 5" into
                "May 9" without a word. We can't restyle it and we're not
                replacing it (that would cost the mobile date wheel) -- we echo
                it back instead. See date-echo.tsx before changing this. */}
            <DateEcho value={scheduledAt} />
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
            <button
              type="submit"
              disabled={submitting || !sport || !scheduledAt || !home || !away}
            >
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
