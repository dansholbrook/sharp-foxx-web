'use client';

// Type-ahead school picker for the inline "+ New team" flow on Add Game.
// Mirrors team-picker.tsx (same debounce, same 2-char minimum, same
// cancelled-flag idiom) because it is the same affordance one row down.
//
// WHY IT EXISTS. POST /teams used to accept only { name, sport, level }, so a
// team created inline was permanently orphaned from the school graph: it never
// appeared on its school's page, never counted toward that school's coverage,
// and no route could attach it afterwards. The column existed the whole time.
// This picker is the field that fills it.
//
// activeOnly is NOT SENT, and that is the whole trick. GET /institutions
// defaults it FALSE (the opposite of GET /teams), which is what we want here:
// 2,009 of the 2,012 imported schools are inactive, so a picker that asked for
// active-only would show three schools and send every correspondent straight
// back to inventing a duplicate. This is the same trap the team picker fell
// into and climbed out of -- see its header. Inactive schools are perfectly
// valid to attach a team to; the backend stages the new team inactive to match
// (see add-game-form.tsx), and they are tagged rather than hidden below.

import { useEffect, useRef, useState } from 'react';
import { getInstitutions, InstitutionSummary } from './api';

// Below this the backend ignores the search term and returns an arbitrary
// alphabetical slice rather than matches.
const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
const RESULT_LIMIT = 25;

// "Springfield, IL" / "Springfield" / "IL" — whichever parts the row actually
// has. Both are nullable on the directory row, and this is the line that tells
// two identically-named schools apart, so it must not render as ", " or "undefined".
export function schoolLocation(school: InstitutionSummary): string {
  return [school.city, school.stateCode].filter(Boolean).join(', ');
}

export function SchoolPicker({
  token,
  inputId,
  selected,
  onSelect,
  disabled,
}: {
  token: string;
  inputId: string;
  selected: InstitutionSummary | null;
  onSelect: (school: InstitutionSummary | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<InstitutionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search. The `cancelled` flag is this repo's async-cancellation
  // idiom: a slow response from an earlier keystroke can't overwrite a newer one.
  const term = selected ? '' : query.trim();
  useEffect(() => {
    if (term.length < MIN_QUERY) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        // The directory is paged ({ items, total }); a type-ahead only ever
        // wants the first page, so the count is discarded. activeOnly is
        // deliberately absent -- see the header note.
        const page = await getInstitutions(token, {
          search: term,
          limit: RESULT_LIMIT,
        });
        if (!cancelled) {
          setResults(page.items);
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
  }, [token, term]);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  function choose(school: InstitutionSummary) {
    onSelect(school);
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open || results.length === 0) return;
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((i) => {
        const next = i + delta;
        if (next < 0) return results.length - 1;
        if (next >= results.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === 'Enter') {
      // This picker sits inside the Add Game <form>. Enter must never reach it:
      // the game itself isn't filled in yet, and a stray submit would blow away
      // the half-finished team.
      e.preventDefault();
      if (open && activeIndex >= 0 && results[activeIndex]) {
        choose(results[activeIndex]);
      }
    }
  }

  const showDropdown = open && !disabled && !selected;
  const tooShort = term.length > 0 && term.length < MIN_QUERY;
  const noMatches =
    !loading && !error && !tooShort && term.length >= MIN_QUERY && results.length === 0;

  return (
    <div className="school-picker">
      <input
        id={inputId}
        className="school-picker__input"
        value={selected ? selected.name : query}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        aria-label="School"
        placeholder="Search schools…"
        onChange={(e) => {
          // Typing over a selection clears it — the input can't show a school
          // that no longer matches what's committed.
          if (selected) onSelect(null);
          setQuery(e.target.value);
          setOpen(true);
        }}
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
          className="link-btn school-picker__clear"
          onClick={() => {
            onSelect(null);
            setQuery('');
          }}
        >
          Clear
        </button>
      )}

      {showDropdown && (
        <div className="school-picker__menu">
          {loading && <div className="school-picker__hint">Searching…</div>}
          {!loading && term.length === 0 && (
            <div className="school-picker__hint">Type a school name…</div>
          )}
          {!loading && tooShort && (
            <div className="school-picker__hint">
              Keep typing — {MIN_QUERY} characters minimum.
            </div>
          )}
          {!loading && error && (
            <div className="school-picker__hint school-picker__hint--error">{error}</div>
          )}
          {noMatches && (
            <div className="school-picker__hint">
              No school matches “{term}”. Only the name is searched, so try the
              full name rather than initials.
            </div>
          )}

          {!loading &&
            results.map((school, i) => (
              <button
                key={school.id}
                type="button"
                className={
                  i === activeIndex
                    ? 'school-picker__option school-picker__option--active'
                    : 'school-picker__option'
                }
                // preventDefault keeps the input focused so onBlur doesn't race
                // the click.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => choose(school)}
              >
                <span className="school-picker__option-name">
                  {school.name}
                  {/* Imported schools are inactive until an admin activates
                      coverage. Still valid to attach a team to, so the flag is
                      shown, not used to hide them. */}
                  {!school.isActive && (
                    <span className="school-picker__option-tag">Not yet covered</span>
                  )}
                </span>
                <span className="school-picker__option-meta">
                  {schoolLocation(school)}
                  {school.teamCount > 0 && (
                    <>
                      {schoolLocation(school) ? ' · ' : ''}
                      {school.teamCount} {school.teamCount === 1 ? 'team' : 'teams'}
                    </>
                  )}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
