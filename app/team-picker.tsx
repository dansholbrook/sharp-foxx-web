'use client';

// Type-ahead team picker for the Add Game form. Replaces the old <select> that
// loaded every team for a sport up front: after the college import that list is
// ~25.8k rows, which no dropdown should hold.
//
// Instead it queries GET /teams?search=&activeOnly=true as you type (debounced),
// so the backend does the filtering and only the matches cross the wire.
// activeOnly is pinned true — the imported rows exist so the school graph
// resolves, not so they can be scheduled as games.
//
// Controlled: the parent owns the selection ({id, label}) so it can also set it
// after creating a team inline. Typing clears the selection and searches again.

import { useEffect, useMemo, useRef, useState } from 'react';
import { searchTeams, TeamSearchResult } from './api';

// Below this, the backend ignores the search term, so firing would return an
// arbitrary alphabetical slice rather than matches.
const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
const RESULT_LIMIT = 25;

export interface TeamSelection {
  id: string;
  label: string;
}

// "Team Name — School (ST)". Imported team names are already school-prefixed
// ("Abilene Christian University Basketball (M)"), so the school suffix mainly
// earns its keep on hand-made rows ("Tigers" — Clemson University (SC)).
export function teamLabel(team: TeamSearchResult): string {
  if (!team.institution) return team.name;
  const state = team.institution.stateCode ? ` (${team.institution.stateCode})` : '';
  return `${team.name} — ${team.institution.name}${state}`;
}

export function TeamPicker({
  token,
  sport,
  label,
  inputId,
  selected,
  onSelect,
  excludeId,
  onCreateNew,
}: {
  token: string;
  // Searches are scoped to the chosen sport; empty disables the picker.
  sport: string;
  label: string;
  inputId: string;
  selected: TeamSelection | null;
  onSelect: (selection: TeamSelection | null) => void;
  // The team picked on the other side — filtered out so the same team can't be
  // chosen twice.
  excludeId: string;
  // Opens the parent's inline team creator, prefilled with what was typed.
  onCreateNew: (name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TeamSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const disabled = !sport;
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear a stale selection/query when the sport changes — a team from another
  // sport must not survive into the new one.
  useEffect(() => {
    setQuery('');
    setResults([]);
    setOpen(false);
  }, [sport]);

  // Debounced search. The `cancelled` flag is this repo's async-cancellation
  // idiom: a slow response from an earlier keystroke can't overwrite a newer one.
  const term = selected ? '' : query.trim();
  useEffect(() => {
    if (!sport || term.length < MIN_QUERY) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const list = await searchTeams(token, {
          search: term,
          sport,
          activeOnly: true,
          limit: RESULT_LIMIT,
        });
        if (!cancelled) {
          setResults(list);
          setError(null);
          setActiveIndex(-1);
        }
      } catch (err) {
        if (!cancelled) {
          setResults([]);
          setError(err instanceof Error ? err.message : 'Search failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, sport, term]);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  const visible = useMemo(
    () => results.filter((t) => t.id !== excludeId),
    [results, excludeId],
  );

  function choose(team: TeamSearchResult) {
    onSelect({ id: team.id, label: teamLabel(team) });
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  }

  function onChange(value: string) {
    // Typing over a selection clears it — the input can't show a label that no
    // longer matches what's committed.
    if (selected) onSelect(null);
    setQuery(value);
    setOpen(true);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open || visible.length === 0) return;
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((i) => {
        const next = i + delta;
        if (next < 0) return visible.length - 1;
        if (next >= visible.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === 'Enter') {
      // Don't submit the form while the dropdown is doing the work.
      if (open && activeIndex >= 0 && visible[activeIndex]) {
        e.preventDefault();
        choose(visible[activeIndex]);
      }
    }
  }

  const showDropdown = open && !disabled && !selected;
  const tooShort = term.length > 0 && term.length < MIN_QUERY;

  return (
    <div className="field team-picker">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className="team-picker__input"
        value={selected ? selected.label : query}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        placeholder={sport ? 'Search teams…' : 'Pick a sport first'}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        // Let a click on an option land before the dropdown unmounts.
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={onKeyDown}
      />

      {selected && (
        <button
          type="button"
          className="link-btn team-picker__clear"
          onClick={() => {
            onSelect(null);
            setQuery('');
          }}
        >
          Clear
        </button>
      )}

      {showDropdown && (
        <div className="team-picker__menu">
          {loading && <div className="team-picker__hint">Searching…</div>}
          {!loading && tooShort && (
            <div className="team-picker__hint">
              Keep typing — {MIN_QUERY} characters minimum.
            </div>
          )}
          {!loading && error && (
            <div className="team-picker__hint team-picker__hint--error">{error}</div>
          )}
          {!loading && !error && !tooShort && term.length >= MIN_QUERY && visible.length === 0 && (
            <div className="team-picker__hint">No active teams match “{term}”.</div>
          )}

          {!loading &&
            visible.map((team, i) => (
              <button
                key={team.id}
                type="button"
                className={
                  i === activeIndex
                    ? 'team-picker__option team-picker__option--active'
                    : 'team-picker__option'
                }
                // preventDefault keeps the input focused so onBlur doesn't race
                // the click.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => choose(team)}
              >
                <span className="team-picker__option-name">{team.name}</span>
                {team.institution && (
                  <span className="team-picker__option-school">
                    {team.institution.name}
                    {team.institution.stateCode ? ` (${team.institution.stateCode})` : ''}
                  </span>
                )}
              </button>
            ))}

          {/* Parity with the old select's "+ New team…" sentinel option. */}
          <button
            type="button"
            className="team-picker__option team-picker__option--new"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onCreateNew(query.trim());
              setOpen(false);
            }}
          >
            + New team{query.trim() ? ` “${query.trim()}”` : '…'}
          </button>
        </div>
      )}
    </div>
  );
}
