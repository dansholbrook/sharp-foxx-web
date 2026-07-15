'use client';

// The school hub (/schools/[id]) — the front door onto the imported college
// dataset (~2k institutions / ~25.8k teams). Open to every authenticated role
// incl. viewers/fans (see roles.ts); reached by links (a team hero's
// institution segment, an athlete's affiliation line), never a nav item.
//
// Single read: GET /institutions/:id carries identity + every team with its own
// conference already joined, so there's no fan-out here.
//
// Almost every school in the dataset is is_active=false: the row exists so the
// graph resolves (a team can name its school, a conference can list members),
// but we don't cover it yet. That's a normal state, not an error — hence the
// subtle "not yet covered" pill rather than an empty/blocked page.

import { useEffect, useMemo, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../auth-context';
import { AppNav, AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import { tierLabel, genderLabel } from '../../tiers';
import { getInstitution, InstitutionDetail, InstitutionTeam } from '../../api';

// ---- formatting helpers (mirror the team / athlete-profile pages) ----
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Monogram for the gradient banner: first letters of the first two words.
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

// "City, ST" — either half can be missing on a sparse row.
function locationLine(city: string | null, stateCode: string | null): string {
  return [city, stateCode].filter(Boolean).join(', ');
}

// Strip the scheme/trailing slash so the hero shows "acu.edu", not
// "https://www.acu.edu/". The href keeps the full URL.
function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

export default function SchoolPage() {
  const { token, user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();

  const [school, setSchool] = useState<InstitutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const allowed = canAccess(user?.roles ?? [], pathname);

  useEffect(() => {
    if (!token) router.replace('/');
  }, [token, router]);

  useEffect(() => {
    if (!token || !allowed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    (async () => {
      try {
        const detail = await getInstitution(token, id);
        if (!cancelled) setSchool(detail);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to load school';
        // The client surfaces errors as "<status> <detail>" (api.ts toError).
        if (msg.startsWith('404')) setNotFound(true);
        else setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, allowed, id]);

  // Teams grouped by sport, preserving the backend's sport-then-gender order.
  // A Map keeps insertion order, so the groups come out in that same order
  // without a second sort.
  const sportGroups = useMemo(() => {
    const groups = new Map<string, InstitutionTeam[]>();
    for (const team of school?.teams ?? []) {
      const bucket = groups.get(team.sport);
      if (bucket) bucket.push(team);
      else groups.set(team.sport, [team]);
    }
    return Array.from(groups, ([sport, teams]) => ({ sport, teams }));
  }, [school]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const location = school ? locationLine(school.city, school.stateCode) : '';

  return (
    <main className="feed-home school-page">
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

      <Link href="/feed" className="game-back">
        ← Back to feed
      </Link>

      {loading && <div className="card muted">Loading school…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && notFound && (
        <div className="results-empty">
          <p className="results-empty__title">School not found</p>
          <p className="results-empty__hint">
            This school may have been removed. Head back to the{' '}
            <Link href="/feed">homepage</Link> to browse what&apos;s on.
          </p>
        </div>
      )}

      {!loading && !error && school && (
        <>
          {/* ---- HERO ---- */}
          {/* No school logos exist yet — a branded gradient banner stands in,
              same recipe as the team hub and athlete profile. */}
          <section className="school-hero">
            <div className="school-banner school-banner--fallback">
              <span className="school-banner__monogram" aria-hidden="true">
                {initialsOf(school.name)}
              </span>
            </div>
            <div className="school-identity">
              <h1 className="school-name">{school.name}</h1>

              <p className="school-meta">
                {location && <span className="school-meta__seg">{location}</span>}
                {school.mascot && (
                  <span className="school-meta__seg">{school.mascot}</span>
                )}
              </p>

              <div className="school-badges">
                <span className="pill school-tier">{tierLabel(school.tier)}</span>
                {/* Almost every imported school is inactive — state the reason
                    plainly rather than looking broken. */}
                {!school.isActive && (
                  <span className="pill school-inactive">
                    Inactive — not yet covered
                  </span>
                )}
              </div>

              {school.website && (
                <p className="school-site">
                  <a
                    href={school.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="school-site__link"
                  >
                    {prettyUrl(school.website)} ↗
                  </a>
                </p>
              )}
            </div>
          </section>

          {/* ---- TEAMS, grouped by sport ---- */}
          <section className="card school-section">
            <span className="game-kicker">Teams</span>
            <h2 className="school-section__title">
              {school.teams.length} {school.teams.length === 1 ? 'team' : 'teams'}
            </h2>

            {school.teams.length === 0 && (
              <p className="muted">No teams on record for this school yet.</p>
            )}

            {sportGroups.map(({ sport, teams }) => (
              <div key={sport} className="school-sport">
                <h3 className="school-sport__title">{titleCase(sport)}</h3>
                <div className="school-teams">
                  {teams.map((team) => (
                    <div key={team.id} className="school-teamcard">
                      <Link
                        href={`/teams/${team.id}`}
                        className="school-teamcard__name"
                      >
                        {team.name}
                      </Link>
                      <div className="school-teamcard__tags">
                        {team.gender && (
                          <span className="school-tag">
                            {genderLabel(team.gender)}
                          </span>
                        )}
                        {team.division && (
                          <span className="school-tag">{team.division}</span>
                        )}
                        {!team.isActive && (
                          <span className="school-tag school-tag--off">
                            Inactive
                          </span>
                        )}
                      </div>
                      {team.conference && (
                        <Link
                          href={`/conferences/${team.conference.id}`}
                          className="school-teamcard__conf"
                        >
                          {team.conference.name}
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
