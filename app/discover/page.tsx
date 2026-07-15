'use client';

// /discover — one page to search the whole college map: 2,012 schools, 25,833
// teams, 146 conferences. Open to every authenticated role, and deliberately
// two things at once: a fan browse surface ("find my school") and an internal
// territory-planning tool ("which D2 schools in NC don't we cover yet?").
//
// Which is why Active-only defaults OFF. Nearly every imported row is
// is_active=false — the row exists so the school graph resolves, not because we
// cover it. Hiding those would hide the map. Inactive rows carry a subtle
// "Not yet covered" pill instead.
//
// Both tabs filter and page SERVER-side (GET /institutions, GET /teams — each
// returns { items, total }): 25 rows a page, "Show more" fetches the next
// offset and appends. The filter state lives in the URL, so a view is
// shareable — ?tab=teams&state=NC&tier=ncaa_d2 is a real link.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { AppNav, AccessDenied } from '../nav';
import { canAccess } from '../roles';
import { QueueTable, Column } from '../queue-table';
import {
  getConference,
  getConferences,
  getInstitutions,
  searchTeams,
  ConferenceSummary,
  InstitutionSummary,
  InstitutionTier,
  TeamSearchResult,
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

  // The URL seeds the filters once, on mount; from there the page owns them and
  // mirrors back (see the sync effect). Reading them live instead would make
  // every keystroke a navigation.
  const [tab, setTab] = useState<Tab>(
    params.get('tab') === 'teams' ? 'teams' : 'schools',
  );
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [stateCode, setStateCode] = useState(params.get('state') ?? '');
  const [tier, setTier] = useState(params.get('tier') ?? '');
  const [activeOnly, setActiveOnly] = useState(params.get('active') === 'true');
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
    if (activeOnly) qs.set('active', 'true');
    if (tab === 'teams') {
      if (sport) qs.set('sport', sport);
      if (gender) qs.set('gender', gender);
      if (conference) qs.set('conferenceId', conference.id);
    }
    const s = qs.toString();
    router.replace(s ? `/discover?${s}` : '/discover', { scroll: false });
  }, [router, tab, query, stateCode, tier, activeOnly, sport, gender, conference]);

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

  const hasFilters = Boolean(
    term || stateCode || tier || activeOnly ||
    (tab === 'teams' && (sport || gender || conferenceId)),
  );

  function clearFilters() {
    setQuery('');
    setStateCode('');
    setTier('');
    setActiveOnly(false);
    setSport('');
    setGender('');
    setConference(null);
  }

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
    ],
    [],
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
      { key: 'school', header: 'School', cell: (t) => t.institution?.name ?? '—' },
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
    ],
    [],
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
      <div className="header-row">
        <div>
          <span className="wordmark">Sharp Foxx</span>
          <span className="muted">
            Signed in as{' '}
            <span className="mono">{user?.displayName ?? user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <AppNav />
      </div>

      <header className="masthead">
        <span className="masthead-kicker">Discover</span>
        <h1 className="masthead-title">The college map</h1>
        <p className="masthead-standfirst">
          Every school and team in the graph — the ones we cover and the ones we
          don’t yet.
        </p>
      </header>

      {/* Tabs. Chips rather than role="tab": same treatment as the other
          filter chips in the app, and each tab is a filtered view of one page
          (a real tablist would imply panels that persist). */}
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

      <div className="discover-filters">
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
      </div>

      <div className="discover-filters discover-filters--row2">
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

        {/* Off by default — see the file header. */}
        <label className="discover-toggle">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          Covered only
        </label>
      </div>

      {error && <div className="error">{error}</div>}

      {/* Only blank the results when there's nothing to keep: a refiltered
          search dims the rows it already has instead of flashing them out and
          back on every keystroke. */}
      {showSkeleton && <div className="card muted">Loading the map…</div>}

      {!showSkeleton && !error && (
        <div className={busy ? 'discover-results discover-results--busy' : 'discover-results'}>
          <p className="result-count">
            {total.toLocaleString()} {total === 1 ? noun : `${noun}s`}
            {hasFilters ? ' match your filters' : ' in the graph'}
          </p>

          {rowCount === 0 ? (
            <div className="results-empty">
              <p className="results-empty__title">
                No {noun}s match these filters
              </p>
              <p className="results-empty__hint">
                {hasFilters ? (
                  <>
                    Try a broader search —{' '}
                    <button type="button" className="link-btn" onClick={clearFilters}>
                      clear all filters
                    </button>
                    {activeOnly && ' (most of the map isn’t covered yet, so “Covered only” hides a lot)'}
                    .
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
