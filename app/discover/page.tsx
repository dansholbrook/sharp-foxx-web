'use client';

// /discover — one page to search schools and teams: 2,012 schools, 25,833
// teams, 146 conferences. Open to every authenticated role, and deliberately
// two things at once: a fan browse surface ("find my school") and an internal
// territory-planning tool ("which D2 schools in NC don't we cover yet?").
//
// Which is why "Covered only" DEFAULTS BY ROLE, opposite ways, and why the
// toggle exists at all rather than the page just picking one:
//
//   staff (admin, regional_manager, field_rep) -> OFF. Nearly every imported row
//     is is_active=false — the row exists so the school graph resolves, not
//     because we cover it. Defaulting these users to covered-only would hide the
//     map, which is the half of the page that is a territory-planning tool.
//   fans (athlete, viewer) -> ON. "Which D2 schools in NC don't we cover yet?"
//     is not a fan question. A fan landing on 2,012 mostly-uncovered schools is
//     being shown an import artifact and asked to tell it apart from the
//     product; the "Not yet covered" pill explains the row but does not justify
//     leading with 25.8k of them.
//
// Either default is one click from the other, and the choice is carried in the
// URL in BOTH directions (?active=true / ?active=false) — see the sync effect.
// A shared link therefore shows the sharer's view rather than re-deriving from
// the opener's role, and a fan who unchecks the box does not silently get it
// back on the next reload.
//
// Both tabs filter and page SERVER-side (GET /institutions, GET /teams — each
// returns { items, total }): 25 rows a page, "Show more" fetches the next
// offset and appends. The filter state lives in the URL, so a view is
// shareable — ?tab=teams&state=NC&tier=ncaa_d2 is a real link.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { AccessDenied } from '../nav';
import { canAccess } from '../roles';
import { QueueTable, Column, SlideOver } from '../queue-table';
import {
  getConference,
  getConferences,
  getInstitution,
  getInstitutions,
  searchTeams,
  updateInstitution,
  updateTeam,
  ConferenceSummary,
  InstitutionSummary,
  InstitutionTier,
  TeamSearchResult,
  UpdatedInstitution,
} from '../api';

const PAGE_SIZE = 25;
// The backend ignores a search under 2 chars (it would match most of the
// table), so don't fire until then.
const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;

type Tab = 'schools' | 'teams';

// ---- Filter vocabularies -------------------------------------------------

// The tiers worth browsing. institution_tier also carries 'high_school', which
// is deliberately absent: this is the college map, and no imported row uses it.
const TIERS: Array<{ value: InstitutionTier; label: string }> = [
  { value: 'ncaa_d1', label: 'D1' },
  { value: 'ncaa_d2', label: 'D2' },
  { value: 'ncaa_d3', label: 'D3' },
  { value: 'naia', label: 'NAIA' },
  { value: 'juco', label: 'JUCO' },
  { value: 'unclassified', label: 'Unclassified' },
];

// The roles that browse the UNCOVERED map as part of their job. Everyone else
// gets "Covered only" on by default. Listed positively (staff, not "not a fan")
// so a role added later defaults to the fan view, which is the safe side to be
// wrong on: a new role seeing the covered map is a narrower view than intended,
// a new role seeing 25.8k staged rows is a broken page.
const MAP_PLANNING_ROLES = ['admin', 'regional_manager', 'field_rep'];

const coveredOnlyDefault = (roles: string[]): boolean =>
  !roles.some((r) => MAP_PLANNING_ROLES.includes(r));

const TIER_LABEL = new Map(TIERS.map((t) => [t.value, t.label]));
// A tier the pills don't cover ('high_school', or anything a later import adds)
// still has to render as something rather than blank.
function tierLabel(tier: InstitutionTier | null): string {
  if (!tier) return '—';
  return TIER_LABEL.get(tier) ?? tier.replace(/_/g, ' ');
}

// The sport pg enum, verbatim.
const SPORTS = ['basketball', 'football', 'baseball', 'hockey', 'soccer', 'other'];

// teams.gender is CHECK-constrained text, not an enum.
const GENDERS: Array<{ value: string; label: string }> = [
  { value: 'mens', label: "Men's" },
  { value: 'womens', label: "Women's" },
  { value: 'coed', label: 'Coed' },
];
const GENDER_LABEL = new Map(GENDERS.map((g) => [g.value, g.label]));

// Static on purpose: the 50 states + DC. The imported set covers 51 of these,
// but deriving the list would cost a distinct-scan on every page load to save
// nothing — the list hasn't changed since 1959.
const STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO',
  'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

// ---- Shared row bits -----------------------------------------------------

// Coverage, not availability: an inactive row is a real school we haven't
// signed yet, so it reads as a status rather than an error.
function CoveragePill({ active }: { active: boolean }) {
  return active ? (
    <span className="pill discover-pill--on">Covered</span>
  ) : (
    <span className="pill discover-pill--off">Not yet covered</span>
  );
}

// ---- Admin mode ----------------------------------------------------------
// Everything below renders only for an admin. /discover is the browse surface
// for every role, and it stays byte-identical for the other four — the actions
// column isn't in `columns` at all unless the viewer is an admin.
//
// The activation switch itself: this is what moves a staged import row into the
// covered map (the Add Game picker filters on it, and the "Not yet covered" pill
// is its other face).

// Rows navigate (onRowActivate pushes the school/team page), so every control in
// here stops both click and keydown from reaching the row — the same guard the
// rep roster's row buttons use. Without it, activating a row would also leave the
// page. The label follows the optimistic state, so it flips the moment it's
// clicked and stays disabled until the PATCH lands.
function RowActions({
  name,
  active,
  busy,
  onToggle,
  onEdit,
}: {
  name: string;
  active: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit?: () => void;
}) {
  return (
    <div
      className="discover-actions"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* btn-inline is the in-row button reset (it drops the global button
          margin-top); btn-ghost keeps it quiet next to the row's own click
          target. Same pairing as the roster's Activate. */}
      <button
        type="button"
        className="btn-ghost btn-inline discover-action"
        disabled={busy}
        aria-label={`${active ? 'Deactivate' : 'Activate'} ${name}`}
        onClick={onToggle}
      >
        {active ? 'Deactivate' : 'Activate'}
      </button>
      {onEdit && (
        <button
          type="button"
          className="link-btn discover-action__edit"
          aria-label={`Edit ${name}`}
          onClick={onEdit}
        >
          Edit
        </button>
      )}
    </div>
  );
}

// The backfill surface. Activation is exactly when an admin fills in what the
// EADA import couldn't give us (it carries no mascot, and website only
// sometimes), so the mascot/website fields and the isActive toggle live in one
// panel rather than a separate edit page.
//
// The directory row is lean (no mascot/website), so the panel reads the detail
// on open and edits from that.
function SchoolEditPanel({
  token,
  school,
  onClose,
  onSaved,
}: {
  token: string;
  school: InstitutionSummary;
  onClose: () => void;
  onSaved: (row: UpdatedInstitution) => void;
}) {
  const [mascot, setMascot] = useState('');
  const [website, setWebsite] = useState('');
  const [isActive, setIsActive] = useState(school.isActive);
  // Null until the detail lands; also the "is the form ready" flag and the
  // baseline the save diffs against.
  const [initial, setInitial] = useState<
    { mascot: string; website: string; isActive: boolean } | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detail = await getInstitution(token, school.id);
        if (cancelled) return;
        setMascot(detail.mascot ?? '');
        setWebsite(detail.website ?? '');
        setIsActive(detail.isActive);
        setInitial({
          mascot: detail.mascot ?? '',
          website: detail.website ?? '',
          isActive: detail.isActive,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load school');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, school.id]);

  const dirty = Boolean(
    initial &&
      (mascot.trim() !== initial.mascot ||
        website.trim() !== initial.website ||
        isActive !== initial.isActive),
  );

  async function onSave() {
    if (!initial) return;
    // Only what changed. '' is a real value here — it clears the column — so
    // every field diffs against the baseline rather than testing truthiness.
    const patch: Parameters<typeof updateInstitution>[2] = {};
    if (mascot.trim() !== initial.mascot) patch.mascot = mascot.trim();
    if (website.trim() !== initial.website) patch.website = website.trim();
    if (isActive !== initial.isActive) patch.isActive = isActive;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateInstitution(token, school.id, patch));
    } catch (err) {
      // A bad website is a 400 from the backend's zod schema, which surfaces as
      // "400 <message>" like the rest of the app's writes.
      setError(err instanceof Error ? err.message : 'Failed to save school');
      setSaving(false);
    }
  }

  return (
    <SlideOver
      onClose={onClose}
      kicker={[school.city, school.stateCode].filter(Boolean).join(', ')}
      title={school.name}
      label={`Edit ${school.name}`}
      footer={
        <>
          <button
            type="button"
            disabled={saving || loading || !dirty}
            onClick={onSave}
          >
            {saving ? 'Saving…' : 'Save school'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
        </>
      }
    >
      {loading ? (
        <p className="muted">Loading school…</p>
      ) : (
        <div className="discover-edit">
          {error && <div className="error">{error}</div>}

          <div className="field field--wide">
            <label htmlFor="school-mascot">Mascot</label>
            <input
              id="school-mascot"
              value={mascot}
              maxLength={60}
              placeholder="e.g. Tar Heels"
              disabled={saving}
              onChange={(e) => setMascot(e.target.value)}
            />
            <span className="game-hint">
              The import doesn’t carry mascots — this is where they come from.
              Clear the field to remove it.
            </span>
          </div>

          <div className="field field--wide">
            <label htmlFor="school-website">Website</label>
            <input
              id="school-website"
              type="url"
              value={website}
              placeholder="https://example.edu"
              disabled={saving}
              onChange={(e) => setWebsite(e.target.value)}
            />
            <span className="game-hint">
              Full URL including https://. Clear the field to remove it.
            </span>
          </div>

          {/* The same switch as the row button, in the place an admin is
              already standing when they finish the backfill. */}
          <div className="field field--wide">
            <label>Coverage</label>
            <label className="discover-toggle discover-edit__toggle">
              <input
                type="checkbox"
                checked={isActive}
                disabled={saving}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Covered
            </label>
            <span className="game-hint">
              Covered schools appear in the Add Game picker and lose the “Not yet
              covered” pill. Turning this off only hides the school from covered
              views — its teams, games, and assignments are untouched.
            </span>
          </div>
        </div>
      )}
    </SlideOver>
  );
}

// ---- Conference type-ahead -----------------------------------------------
// A trimmed sibling of team-picker.tsx: same debounce + `cancelled` idiom and
// the same blur-timer trick, minus the create-new affordance and the sport
// scoping. Selection is controlled by the page so the URL can seed it.
function ConferenceFilter({
  token,
  selected,
  onSelect,
}: {
  token: string;
  selected: { id: string; name: string } | null;
  onSelect: (conference: { id: string; name: string } | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ConferenceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        const list = await getConferences(token, { search: term, limit: 10 });
        if (!cancelled) setResults(list);
      } catch {
        // A failed lookup just means no suggestions — the rest of the filter
        // bar still works, so this stays quiet rather than erroring the page.
        if (!cancelled) setResults([]);
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

  const showDropdown = open && !selected && term.length >= MIN_QUERY;

  return (
    <div className="discover-field discover-field--typeahead">
      <label htmlFor="discover-conference">Conference</label>
      <input
        id="discover-conference"
        className="discover-input"
        value={selected ? selected.name : query}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        placeholder="Any conference"
        onChange={(e) => {
          if (selected) onSelect(null);
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
      />
      {selected && (
        <button
          type="button"
          className="link-btn discover-field__clear"
          onClick={() => {
            onSelect(null);
            setQuery('');
          }}
        >
          Clear
        </button>
      )}

      {showDropdown && (
        <div className="discover-menu">
          {loading && <div className="discover-menu__hint">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="discover-menu__hint">No conferences match “{term}”.</div>
          )}
          {!loading &&
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                className="discover-menu__option"
                // preventDefault keeps the input focused so onBlur doesn't race
                // the click.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect({ id: c.id, name: c.name });
                  setQuery('');
                  setOpen(false);
                }}
              >
                <span className="discover-menu__option-name">{c.name}</span>
                <span className="discover-menu__option-meta">
                  {c.memberCount} {c.memberCount === 1 ? 'team' : 'teams'}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function Discover() {
  const router = useRouter();
  const params = useSearchParams();
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], '/discover');
  // The admin-mode gate. Everything it unlocks is additive — for every other
  // role this page renders exactly as it did before.
  const isAdmin = (user?.roles ?? []).includes('admin');

  // The URL seeds the filters once, on mount; from there the page owns them and
  // mirrors back (see the sync effect). Reading them live instead would make
  // every keystroke a navigation.
  const [tab, setTab] = useState<Tab>(
    params.get('tab') === 'teams' ? 'teams' : 'schools',
  );
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [stateCode, setStateCode] = useState(params.get('state') ?? '');
  const [tier, setTier] = useState(params.get('tier') ?? '');
  // Tri-state on purpose: absent means "use my role's default", and the two
  // spellings are both explicit. Reading it as `=== 'true'` (as this did when
  // the default was OFF for everyone) would make an unchecked box indis-
  // tinguishable from an absent param, so a fan turning coverage off would get
  // it back on the next reload — the default has to be overridable downward as
  // well as upward once it isn't the same for everyone.
  //
  // AuthProvider renders a placeholder until rehydration finishes, so this page
  // never mounts with a null user; reading roles in an initialiser is safe.
  const roleDefault = coveredOnlyDefault(user?.roles ?? []);
  const [activeOnly, setActiveOnly] = useState(() => {
    const seeded = params.get('active');
    if (seeded === 'true') return true;
    if (seeded === 'false') return false;
    return roleDefault;
  });
  const [sport, setSport] = useState(params.get('sport') ?? '');
  const [gender, setGender] = useState(params.get('gender') ?? '');
  const [conference, setConference] = useState<{ id: string; name: string } | null>(
    // The name isn't in the URL (an id is enough to link), so a seeded
    // conference shows its id until the hydrate effect below resolves it.
    params.get('conferenceId')
      ? { id: params.get('conferenceId') as string, name: '…' }
      : null,
  );

  const [schools, setSchools] = useState<InstitutionSummary[]>([]);
  const [schoolsTotal, setSchoolsTotal] = useState(0);
  const [teams, setTeams] = useState<TeamSearchResult[]>([]);
  const [teamsTotal, setTeamsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Admin mode state (inert for every other role) ----
  // Rows with a PATCH in flight, keyed by id: the button disables and a second
  // click can't race the first.
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  // A failed activation reports here rather than through `error`, which would
  // blank the results the failed row is sitting in.
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<InstitutionSummary | null>(null);

  // Debounce the text box so typing doesn't fire a request per keystroke. A
  // 1-char term is dropped rather than sent: the backend would ignore it and
  // return an arbitrary alphabetical slice that looks like wrong results.
  const [term, setTerm] = useState(() => {
    const q = (params.get('q') ?? '').trim();
    return q.length >= MIN_QUERY ? q : '';
  });
  useEffect(() => {
    const trimmed = query.trim();
    const next = trimmed.length >= MIN_QUERY ? trimmed : '';
    const timer = setTimeout(() => setTerm(next), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!token) router.replace('/');
  }, [token, router]);

  // Resolve a URL-seeded conference id into its name, so an arriving link shows
  // "Big Ten Conference" rather than a uuid. Runs once per unseen id.
  useEffect(() => {
    if (!token || !conference || conference.name !== '…') return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await getConference(token, conference.id);
        if (!cancelled) setConference({ id: detail.id, name: detail.name });
      } catch {
        // A dead id in a stale link shouldn't wedge the page: drop the filter
        // and show the unfiltered map.
        if (!cancelled) setConference(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, conference]);

  // Mirror the live filters into the URL so the view is shareable and the back
  // button works. replace(), not push(): typing shouldn't build history.
  useEffect(() => {
    const qs = new URLSearchParams();
    if (tab !== 'schools') qs.set('tab', tab);
    if (query.trim()) qs.set('q', query.trim());
    if (stateCode) qs.set('state', stateCode);
    if (tier) qs.set('tier', tier);
    // Written whenever it differs from this viewer's default, in either
    // direction, so the link carries the view actually on screen.
    if (activeOnly !== roleDefault) qs.set('active', String(activeOnly));
    if (tab === 'teams') {
      if (sport) qs.set('sport', sport);
      if (gender) qs.set('gender', gender);
      if (conference) qs.set('conferenceId', conference.id);
    }
    const s = qs.toString();
    router.replace(s ? `/discover?${s}` : '/discover', { scroll: false });
  }, [router, tab, query, stateCode, tier, activeOnly, roleDefault, sport, gender, conference]);

  // The team-only filters are meaningless on the schools tab, and leaving them
  // set would silently narrow a later switch back. They're kept in state (so
  // toggling tabs doesn't lose them) but excluded from the schools query.
  const conferenceId = conference?.id ?? '';

  // Requests overlap here by design — a debounced keystroke and a tier click can
  // be in flight together, over tables big enough for the older query to be the
  // slower one. This is the `cancelled` idiom from the rest of the app, widened
  // to a counter because load() is called from two places (the filter effect and
  // "Show more") and so can't hang its flag off a single effect's cleanup: only
  // the newest request may touch state, whatever order the responses land in.
  const reqSeq = useRef(0);

  // One fetch for both tabs and both pages (first + "Show more"): offset 0
  // replaces, anything else appends. Everything the query depends on is in the
  // dep list, so any filter change re-runs it at offset 0.
  const load = useCallback(
    async (offset: number) => {
      if (!token) return;
      const seq = ++reqSeq.current;
      const current = () => seq === reqSeq.current;
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        if (tab === 'schools') {
          const page = await getInstitutions(token, {
            search: term || undefined,
            state: stateCode || undefined,
            tier: (tier as InstitutionTier) || undefined,
            activeOnly,
            limit: PAGE_SIZE,
            offset,
          });
          if (!current()) return;
          setSchools((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
          setSchoolsTotal(page.total);
        } else {
          const page = await searchTeams(token, {
            search: term || undefined,
            state: stateCode || undefined,
            tier: (tier as InstitutionTier) || undefined,
            sport: sport || undefined,
            gender: gender || undefined,
            conferenceId: conferenceId || undefined,
            activeOnly,
            limit: PAGE_SIZE,
            offset,
          });
          if (!current()) return;
          setTeams((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
          setTeamsTotal(page.total);
        }
      } catch (err) {
        if (!current()) return;
        setError(err instanceof Error ? err.message : 'Failed to load results');
      } finally {
        // A superseded request must not clear the spinner the newer one set.
        if (current()) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [token, tab, term, stateCode, tier, activeOnly, sport, gender, conferenceId],
  );

  // Refetch from the top whenever the query changes (`load`'s identity is the
  // filter set). Show-more calls load(offset) directly and doesn't come through
  // here.
  useEffect(() => {
    if (!token || !allowed) return;
    load(0);
  }, [token, allowed, load]);

  // "Filtered" means narrowed FROM THIS VIEWER'S DEFAULT, not from the unfiltered
  // graph. Comparing activeOnly against `true` instead would tell every fan they
  // had filters applied the moment the page opened, and make "clear all filters"
  // a control that changes what they see without them having set anything.
  const hasFilters = Boolean(
    term || stateCode || tier || activeOnly !== roleDefault ||
    (tab === 'teams' && (sport || gender || conferenceId)),
  );

  function clearFilters() {
    setQuery('');
    setStateCode('');
    setTier('');
    setActiveOnly(roleDefault);
    setSport('');
    setGender('');
    setConference(null);
  }

  // ---- Activation (admin) ------------------------------------------------
  // Both toggles are optimistic: the pill flips on click and the PATCH catches
  // up. A failure puts the row back exactly as it was (the captured row object)
  // and says so — a silent revert would read as a click that didn't land.
  //
  // Neither toggle re-runs the query. A deactivated row under "Covered only"
  // stays on screen until the next fetch on purpose: yanking the row out from
  // under the cursor mid-sweep is worse than one stale row.
  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((prev) => {
      if (busy) return { ...prev, [id]: true };
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);

  const toggleSchool = useCallback(
    async (school: InstitutionSummary) => {
      if (!token || busyIds[school.id]) return;
      const next = !school.isActive;
      setBusy(school.id, true);
      setActionError(null);
      setSchools((prev) =>
        prev.map((s) => (s.id === school.id ? { ...s, isActive: next } : s)));
      try {
        await updateInstitution(token, school.id, { isActive: next });
      } catch (err) {
        setSchools((prev) => prev.map((s) => (s.id === school.id ? school : s)));
        setActionError(
          err instanceof Error
            ? `${school.name}: ${err.message}`
            : `Failed to update ${school.name}`,
        );
      } finally {
        setBusy(school.id, false);
      }
    },
    [token, busyIds, setBusy],
  );

  const toggleTeam = useCallback(
    async (team: TeamSearchResult) => {
      if (!token || busyIds[team.id]) return;
      const next = !team.isActive;
      const school = team.institution;
      setBusy(team.id, true);
      setActionError(null);
      // Activating a team activates its school server-side — a covered team
      // implies a covered school — so the optimistic patch mirrors both. The
      // rule is unconditional, so there's no response flag to wait on.
      setTeams((prev) =>
        prev.map((t) => (t.id === team.id
          ? {
            ...t,
            isActive: next,
            institution: next && t.institution
              ? { ...t.institution, isActive: true }
              : t.institution,
          }
          : t)));
      try {
        await updateTeam(token, team.id, { isActive: next });
        // The school that just came along is also a row on the Schools tab, and
        // the school cell of every other loaded team it fields. Patch both so
        // switching tabs doesn't show a stale "Not yet covered".
        if (next && school) {
          setSchools((prev) =>
            prev.map((s) => (s.id === school.id ? { ...s, isActive: true } : s)));
          setTeams((prev) =>
            prev.map((t) => (t.institution && t.institution.id === school.id
              ? { ...t, institution: { ...t.institution, isActive: true } }
              : t)));
        }
      } catch (err) {
        setTeams((prev) => prev.map((t) => (t.id === team.id ? team : t)));
        setActionError(
          err instanceof Error
            ? `${team.name}: ${err.message}`
            : `Failed to update ${team.name}`,
        );
      } finally {
        setBusy(team.id, false);
      }
    },
    [token, busyIds, setBusy],
  );

  const schoolColumns: Column<InstitutionSummary>[] = useMemo(
    () => [
      { key: 'name', header: 'School', cell: (s) => s.name },
      {
        key: 'where',
        header: 'City, ST',
        cell: (s) =>
          [s.city, s.stateCode].filter(Boolean).join(', ') || '—',
      },
      {
        key: 'tier',
        header: 'Tier',
        cell: (s) => <span className="pill">{tierLabel(s.tier)}</span>,
      },
      { key: 'teams', header: 'Teams', align: 'right', cell: (s) => s.teamCount },
      {
        key: 'active',
        header: 'Status',
        cell: (s) => <CoveragePill active={s.isActive} />,
      },
      // Admin only — the column doesn't exist for anyone else.
      ...(isAdmin
        ? [{
          key: 'admin',
          header: '',
          cell: (s: InstitutionSummary) => (
            <RowActions
              name={s.name}
              active={s.isActive}
              busy={Boolean(busyIds[s.id])}
              onToggle={() => toggleSchool(s)}
              onEdit={() => setEditing(s)}
            />
          ),
        }]
        : []),
    ],
    [isAdmin, busyIds, toggleSchool],
  );

  const teamColumns: Column<TeamSearchResult>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Team',
        cell: (t) => (
          <>
            {t.name}
            {t.gender && (
              <span className="discover-cell__sub">
                {GENDER_LABEL.get(t.gender) ?? t.gender}
              </span>
            )}
          </>
        ),
      },
      {
        key: 'school',
        header: 'School',
        cell: (t) => {
          if (!t.institution) return '—';
          return (
            <>
              {t.institution.name}
              {/* Admin only: the SCHOOL's coverage, which is not the team's.
                  It's here because activating a team drags its school active —
                  this line is what disappears when that happens. */}
              {isAdmin && !t.institution.isActive && (
                <span className="discover-cell__sub">Not yet covered</span>
              )}
            </>
          );
        },
      },
      { key: 'sport', header: 'Sport', cell: (t) => t.sport },
      { key: 'division', header: 'Division', cell: (t) => t.division ?? '—' },
      {
        key: 'conference',
        header: 'Conference',
        cell: (t) => t.conference?.name ?? '—',
      },
      {
        key: 'active',
        header: 'Status',
        cell: (t) => <CoveragePill active={t.isActive} />,
      },
      // Admin only. No Edit here: a team's only editable surface is its social
      // links, which already has its stand-in on the team page.
      ...(isAdmin
        ? [{
          key: 'admin',
          header: '',
          cell: (t: TeamSearchResult) => (
            <RowActions
              name={t.name}
              active={t.isActive}
              busy={Boolean(busyIds[t.id])}
              onToggle={() => toggleTeam(t)}
            />
          ),
        }]
        : []),
    ],
    [isAdmin, busyIds, toggleTeam],
  );

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const total = tab === 'schools' ? schoolsTotal : teamsTotal;
  const noun = tab === 'schools' ? 'school' : 'team';
  const rowCount = tab === 'schools' ? schools.length : teams.length;
  // Nothing to show yet (first load, or a tab opened for the first time) vs.
  // refiltering rows we already have.
  const showSkeleton = loading && rowCount === 0;
  const busy = loading && rowCount > 0;

  return (
    <main className="feed-home discover-page">
      {/* ---- Title and the Schools/Teams tabs on one row. The masthead
          wrapper and its kicker are gone; the tabs row's own `margin: 24px 0
          18px` went with it -- 42px of margin around a 34px control, the same
          rule already cut from /games.

          NOT "The college map", which the Teams tab makes untrue: GET /teams is
          not filtered to institutions, so pro teams come back with it -- their
          institution cell renders "-" precisely because they have none. The
          title says what the two tabs are and nothing more.

          Still no standfirst: "every school and team in the graph" described
          the tabs beneath it, same as /games did. ---- */}
      <div className="page-head">
        <h1 className="row-title page-head__title">Schools and teams</h1>
        <div className="discover-tabs" role="group" aria-label="Browse schools or teams">
        {(['schools', 'teams'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`chip${tab === t ? ' chip--on' : ''}`}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t === 'schools' ? 'Schools' : 'Teams'}
          </button>
        ))}
        </div>
      </div>

      {/* ---- ONE CONTROLS ROW, NO PANEL. It was two bordered panels stacked --
          fields on top, tier pills + the covered-only toggle hanging off the
          bottom with `border-top: 0` so they read as one bar. The bar cost 34px
          of padding and border per panel and stacked its fields to a column
          below 720px: 299px of filters on a phone, for four controls.

          The flex row, its 14px gap and `align-items: flex-end` survive -- that
          alignment is what lines label-over-control fields up with the pills
          beside them. The padding, border, panel background and radius do not.

          BOTH role="group" WRAPPERS SURVIVE INTACT ("Filter by tier" below, and
          the tabs up in the head row), and so does every <label>. The merge is
          layout; the semantics are untouched. ---- */}
      <div className="page-controls">
        <div className="discover-field discover-field--search">
          <label htmlFor="discover-q">Search</label>
          <input
            id="discover-q"
            className="discover-input"
            type="search"
            value={query}
            placeholder={tab === 'schools' ? 'Search schools…' : 'Search teams…'}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="discover-field">
          <label htmlFor="discover-state">State</label>
          <select
            id="discover-state"
            className="discover-input"
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value)}
          >
            <option value="">All states</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {tab === 'teams' && (
          <>
            <div className="discover-field">
              <label htmlFor="discover-sport">Sport</label>
              <select
                id="discover-sport"
                className="discover-input"
                value={sport}
                onChange={(e) => setSport(e.target.value)}
              >
                <option value="">All sports</option>
                {SPORTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="discover-field">
              <label htmlFor="discover-gender">Gender</label>
              <select
                id="discover-gender"
                className="discover-input"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
              >
                <option value="">All</option>
                {GENDERS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>

            <ConferenceFilter
              token={token}
              selected={conference}
              onSelect={setConference}
            />
          </>
        )}

        <div className="filter-row" role="group" aria-label="Filter by tier">
          <button
            type="button"
            className={`chip${tier === '' ? ' chip--on' : ''}`}
            aria-pressed={tier === ''}
            onClick={() => setTier('')}
          >
            All tiers
          </button>
          {TIERS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`chip${tier === t.value ? ' chip--on' : ''}`}
              aria-pressed={tier === t.value}
              onClick={() => setTier(tier === t.value ? '' : t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Defaults by role — on for fans, off for staff. See the file header.
            NOT collapsed into a chip: the role-based default is twenty lines of
            reasoning in that header, and a chip would lose the label that says
            what the box means. */}
        <label className="discover-toggle">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          Covered only
        </label>

        {/* THE COUNT, on the row that produced it rather than a band of its
            own. Its copy branches are unchanged and deliberately so: an
            unfiltered fan's view is already narrowed to the covered map, so the
            old wording reported 34 covered schools as though they were the whole
            2,012-row graph. Moved, not rewritten. */}
        {!showSkeleton && !error && (
          <p className="result-count">
            {total.toLocaleString()} {total === 1 ? noun : `${noun}s`}
            {hasFilters
              ? ' match your filters'
              : activeOnly
                ? ' we cover'
                : ' in the graph'}
          </p>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {/* A failed activation — kept separate from `error` so the row it came
          from stays on screen. */}
      {actionError && <div className="error">{actionError}</div>}

      {/* Only blank the results when there's nothing to keep: a refiltered
          search dims the rows it already has instead of flashing them out and
          back on every keystroke. */}
      {showSkeleton && <div className="card muted">Loading the map…</div>}

      {!showSkeleton && !error && (
        <div className={busy ? 'discover-results discover-results--busy' : 'discover-results'}>
          {/* The count moved UP to the controls row -- see the note there. */}

          {rowCount === 0 ? (
            <div className="results-empty">
              <p className="results-empty__title">
                No {noun}s match these filters
              </p>
              <p className="results-empty__hint">
                {/* "Clear all filters" returns to the viewer's DEFAULT, which
                    for a fan still has "Covered only" on — so when that's the
                    thing hiding the rows, the escape hatch has to be offered
                    separately or the hint points at a button that won't help. */}
                {hasFilters ? (
                  <>
                    Try a broader search —{' '}
                    <button type="button" className="link-btn" onClick={clearFilters}>
                      clear all filters
                    </button>
                    {activeOnly && (
                      <>
                        , or{' '}
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => setActiveOnly(false)}
                        >
                          show the whole map
                        </button>{' '}
                        (most of it isn’t covered yet, so “Covered only” hides a
                        lot)
                      </>
                    )}
                    .
                  </>
                ) : activeOnly ? (
                  <>
                    We don’t cover any {noun}s here yet —{' '}
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setActiveOnly(false)}
                    >
                      show the whole map
                    </button>{' '}
                    to see what’s out there.
                  </>
                ) : (
                  <>
                    The graph looks empty — that’s unexpected. Try the{' '}
                    <Link href="/feed">feed</Link> instead.
                  </>
                )}
              </p>
            </div>
          ) : tab === 'schools' ? (
            <QueueTable
              columns={schoolColumns}
              rows={schools}
              rowKey={(s) => s.id}
              onRowActivate={(s) => router.push(`/schools/${s.id}`)}
              totalCount={schoolsTotal}
              onShowMore={() => load(schools.length)}
              loadingMore={loadingMore}
              ariaLabel="Schools"
            />
          ) : (
            <QueueTable
              columns={teamColumns}
              rows={teams}
              rowKey={(t) => t.id}
              onRowActivate={(t) => router.push(`/teams/${t.id}`)}
              totalCount={teamsTotal}
              onShowMore={() => load(teams.length)}
              loadingMore={loadingMore}
              ariaLabel="Teams"
            />
          )}
        </div>
      )}

      {/* The school backfill panel. Mounting it opens it; a save patches the
          loaded rows in place rather than refetching the page the admin is
          working through. */}
      {editing && (
        <SchoolEditPanel
          token={token}
          school={editing}
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            setSchools((prev) =>
              prev.map((s) => (s.id === row.id ? { ...s, isActive: row.isActive } : s)));
            // The same school is the school cell of any loaded team row.
            setTeams((prev) =>
              prev.map((t) => (t.institution && t.institution.id === row.id
                ? { ...t, institution: { ...t.institution, isActive: row.isActive } }
                : t)));
            setEditing(null);
          }}
        />
      )}
    </main>
  );
}

// useSearchParams must render inside a Suspense boundary (Next.js App Router).
export default function DiscoverPage() {
  return (
    <Suspense
      fallback={
        <main className="feed-home">
          <div className="card muted">Loading discover…</div>
        </main>
      }
    >
      <Discover />
    </Suspense>
  );
}
