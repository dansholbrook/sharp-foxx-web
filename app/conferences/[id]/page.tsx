'use client';

// The conference hub (/conferences/[id]). Open to every authenticated role incl.
// viewers/fans (see roles.ts); reached by links (a team hero's conference line,
// a school page's team card), never a nav item.
//
// Single read: GET /conferences/:id carries identity + members with their
// schools already joined.
//
// Members are TEAMS, not schools: a school sits in different conferences per
// sport, so the conference hangs off the team. That's why a school can appear
// once here with only its basketball teams while its football team lives in
// another conference — the grouping below makes that legible.

import { useEffect, useMemo, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../auth-context';
import { AppNav, AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import { tierLabel, genderLabel } from '../../tiers';
import { getConference, ConferenceDetail, ConferenceMember } from '../../api';

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

// Members with no school (a data bug — a team carrying a conference but no
// institution) are bucketed under this key so they still render.
const NO_SCHOOL = '__no_school__';

export default function ConferencePage() {
  const { token, user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();

  const [conference, setConference] = useState<ConferenceDetail | null>(null);
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
        const detail = await getConference(token, id);
        if (!cancelled) setConference(detail);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to load conference';
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

  // Members grouped by school, preserving the backend's institution-name-then-
  // sport order (a Map keeps insertion order, so no second sort).
  const schoolGroups = useMemo(() => {
    const groups = new Map<
      string,
      { id: string | null; name: string; stateCode: string | null; members: ConferenceMember[] }
    >();
    for (const member of conference?.members ?? []) {
      const key = member.institution?.id ?? NO_SCHOOL;
      const existing = groups.get(key);
      if (existing) {
        existing.members.push(member);
      } else {
        groups.set(key, {
          id: member.institution?.id ?? null,
          name: member.institution?.name ?? 'Unaffiliated',
          stateCode: member.institution?.stateCode ?? null,
          members: [member],
        });
      }
    }
    return Array.from(groups.values());
  }, [conference]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  return (
    <main className="feed-home conf-page">
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

      {loading && <div className="card muted">Loading conference…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && notFound && (
        <div className="results-empty">
          <p className="results-empty__title">Conference not found</p>
          <p className="results-empty__hint">
            This conference may have been removed. Head back to the{' '}
            <Link href="/feed">homepage</Link> to browse what&apos;s on.
          </p>
        </div>
      )}

      {!loading && !error && conference && (
        <>
          {/* ---- HERO ---- */}
          <section className="conf-hero">
            <div className="conf-banner conf-banner--fallback">
              <span className="conf-banner__monogram" aria-hidden="true">
                {initialsOf(conference.name)}
              </span>
            </div>
            <div className="conf-identity">
              <h1 className="conf-name">{conference.name}</h1>
              <div className="conf-badges">
                {/* Conference tier is NULL for every imported conference (the
                    import sets tier per school, not per conference), so the
                    badge is hidden rather than rendered empty. */}
                {conference.tier && (
                  <span className="pill conf-tier">{tierLabel(conference.tier)}</span>
                )}
                <span className="conf-count">
                  {conference.members.length}{' '}
                  {conference.members.length === 1 ? 'member team' : 'member teams'}
                  {schoolGroups.length > 0 &&
                    ` · ${schoolGroups.length} ${
                      schoolGroups.length === 1 ? 'school' : 'schools'
                    }`}
                </span>
              </div>
            </div>
          </section>

          {/* ---- MEMBERS, grouped by school ---- */}
          <section className="card conf-section">
            <span className="game-kicker">Members</span>
            <h2 className="conf-section__title">Schools &amp; teams</h2>

            {conference.members.length === 0 && (
              <p className="muted">No member teams on record for this conference yet.</p>
            )}

            {schoolGroups.map((group) => (
              <div key={group.id ?? NO_SCHOOL} className="conf-school">
                <h3 className="conf-school__title">
                  {group.id ? (
                    <Link href={`/schools/${group.id}`} className="conf-school__link">
                      {group.name}
                    </Link>
                  ) : (
                    group.name
                  )}
                  {group.stateCode && (
                    <span className="conf-school__state">{group.stateCode}</span>
                  )}
                </h3>
                <div className="conf-teams">
                  {group.members.map((member) => (
                    <Link
                      key={member.teamId}
                      href={`/teams/${member.teamId}`}
                      className="conf-teamrow"
                    >
                      <span className="conf-teamrow__name">{member.teamName}</span>
                      <span className="conf-teamrow__tags">
                        <span className="school-tag">{titleCase(member.sport)}</span>
                        {member.gender && (
                          <span className="school-tag">{genderLabel(member.gender)}</span>
                        )}
                        {member.division && (
                          <span className="school-tag">{member.division}</span>
                        )}
                        {!member.isActive && (
                          <span className="school-tag school-tag--off">Inactive</span>
                        )}
                      </span>
                    </Link>
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
