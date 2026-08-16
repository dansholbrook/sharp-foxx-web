'use client';

// ============================================================================
// FILING THE BOX SCORE — the screen Scout Book has been waiting for.
//
// !! THIS IS THE FIRST CODE PATH THAT CALLS POST /events/:id/stat-lines AGAINST
// LIVE DATA. !!
//
// The endpoint shipped months ago, the scorer was proven against fixtures, and
// no screen has ever called it. The 24 stat lines sitting on cloud were written
// by scripts/seed-scout-demo.ts with a raw `INSERT INTO game_stat_lines`, which
// went around the service entirely — so the sport-family validator and the
// roster-minting path have each run exactly once, inside one proof script.
//
// Expect the first real filing to be the first time that code meets a human.
// Which is why the two things below are not decoration:
//
//   * EVERY SERVER MESSAGE IS RENDERED, never swallowed. Those sentences were
//     written to be read — "completions cannot exceed passAttempts", innings
//     pitched in thirds, threes being a subset of field goals. A generic
//     "Failed to file" would throw away the only thing standing between a
//     correspondent and a wrong number.
//   * The screen re-reads the box score after every filing, so what it shows is
//     what the server stored rather than what this component believed it sent.
//
// ----------------------------------------------------------------------------
// WHERE THIS LIVES, AND WHY IT IS NOT A CONSOLE.
//
// In the correspondent's own workspace, under the game they just covered. The
// missing-line nudge used to deep-link to `/console/events/:id/stat-lines` — a
// route that never existed in any build — and it now points here. The spec's
// in-flow prompt ("any of your prospects play? enter their line, 60 seconds")
// was always aimed at this moment: the rep is in the gym, the game just ended,
// and they are already on this page.
// ----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fileStatLines,
  getBoxScore,
  getRoster,
  BoxScore,
  BoxScoreLine,
  RosterPlayer,
  StatLineInput,
} from '../../api';
import { GROUPS_BY_FAMILY, StatGroup, positionOpens } from './stat-groups';

// Who a line is being filed for: either a roster row the picker offered, or a
// player nobody has seen before, identified by whatever the correspondent has.
type Subject =
  | { kind: 'roster'; player: RosterPlayer }
  | { kind: 'new'; jerseyNumber: string; name: string; position: string };

function subjectLabel(s: Subject): string {
  if (s.kind === 'roster') {
    const num = s.player.jerseyNumber ? `#${s.player.jerseyNumber} ` : '';
    return `${num}${s.player.displayName ?? 'Unnamed player'}`;
  }
  const num = s.jerseyNumber ? `#${s.jerseyNumber} ` : '';
  return `${num}${s.name || 'New player'}`;
}

function subjectPosition(s: Subject): string | null {
  return s.kind === 'roster' ? s.player.position : s.position || null;
}

export function StatLinesPanel({
  token,
  eventId,
  homeLabel,
  awayLabel,
}: {
  token: string;
  eventId: string;
  homeLabel: string;
  awayLabel: string;
}) {
  const [box, setBox] = useState<BoxScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [side, setSide] = useState<'home' | 'away'>('home');
  const [roster, setRoster] = useState<RosterPlayer[] | null>(null);
  const [subject, setSubject] = useState<Subject | null>(null);

  // Keyed by field key; the raw string the correspondent typed. Kept as strings
  // so an empty box stays ABSENT rather than becoming 0 — see toStats.
  const [values, setValues] = useState<Record<string, string>>({});
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [didNotPlay, setDidNotPlay] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setBox(await getBoxScore(token, eventId));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load the box score');
    } finally {
      setLoading(false);
    }
  }, [token, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const teamId = box ? (side === 'home' ? box.home.teamId : box.away.teamId) : null;

  // The roster for whichever bench is selected. Best-effort: a team with no
  // roster rows yet is NORMAL (nobody has filed for them), and the correspondent
  // falls through to the new-player path.
  useEffect(() => {
    if (!box || !teamId) { setRoster(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getRoster(token, teamId, box.season);
        if (!cancelled) setRoster(rows);
      } catch {
        if (!cancelled) setRoster([]);
      }
    })();
    return () => { cancelled = true; };
  }, [token, box, teamId]);

  const groups: StatGroup[] = useMemo(
    () => (box?.statKind ? GROUPS_BY_FAMILY[box.statKind] ?? [] : []),
    [box?.statKind],
  );

  // stat key -> human label, for the filed-so-far receipt. Without it the
  // receipt reads "12 fgAtt · 7 fgMade", which is the raw column name leaking
  // onto a correspondent's screen.
  const labelFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const f of g.fields) m.set(f.key, f.label.toLowerCase());
    return (k: string) => m.get(k) ?? k;
  }, [groups]);

  // Pick a subject: reset the form, and pre-open the block their position
  // suggests. A position we cannot read opens nothing and shows the chooser —
  // see the rule at the top of stat-groups.ts.
  function choose(s: Subject | null) {
    setSubject(s);
    setValues({});
    setDidNotPlay(false);
    setSaveError(null);
    setSaved(null);
    setOpenGroup(s ? positionOpens(groups, subjectPosition(s)) : null);
  }

  // An empty box is ABSENT, not zero. "0 rebounds" asserts he was on the floor
  // and got none; a missing key asserts nothing at all, which is what a
  // correspondent who did not watch the glass actually means.
  function toStats(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, raw] of Object.entries(values)) {
      const t = raw.trim();
      if (t === '') continue;
      const v = Number(t);
      if (Number.isFinite(v)) out[k] = v;
    }
    return out;
  }

  const filedRosterIds = useMemo(() => {
    const all = [...(box?.home.lines ?? []), ...(box?.away.lines ?? [])];
    return new Set(all.map((l) => l.rosterPlayerId));
  }, [box]);

  async function onFile() {
    if (!subject || !teamId) return;
    setSaving(true);
    setSaveError(null);
    setSaved(null);
    try {
      const player: StatLineInput['player'] =
        subject.kind === 'roster'
          ? { rosterPlayerId: subject.player.id }
          : {
              ...(subject.jerseyNumber.trim() ? { jerseyNumber: subject.jerseyNumber.trim() } : {}),
              ...(subject.name.trim() ? { name: subject.name.trim() } : {}),
              ...(subject.position.trim() ? { position: subject.position.trim() } : {}),
            };
      const stats = toStats();
      await fileStatLines(token, eventId, [
        didNotPlay
          ? { player, teamId, didNotPlay: true }
          : { player, teamId, stats },
      ]);
      setSaved(`Filed for ${subjectLabel(subject)}.`);
      choose(null);
      // Re-read rather than patching local state: what the screen shows should
      // be what the server stored, not what this component believed it sent.
      await load();
    } catch (err) {
      // THE SERVER'S SENTENCE, VERBATIM. The family validators say things like
      // "completions cannot exceed passAttempts" and explain baseball's thirds
      // notation; a generic message would discard the only guard between a
      // correspondent and a wrong number.
      setSaveError(err instanceof Error ? err.message : 'Failed to file the line');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="muted">Loading the box score…</p>;
  if (loadError) return <div className="error">{loadError}</div>;
  if (!box) return null;

  // No family for this sport: the game genuinely cannot take stat lines, and
  // saying so is better than an empty form that 400s on submit.
  if (!box.statKind || groups.length === 0) {
    return (
      <p className="game-hint">
        Stat lines aren&apos;t defined for {box.sport} yet, so this game can&apos;t take a
        box score. Adding a sport is a new family on the backend, not a setting.
      </p>
    );
  }

  const lines = side === 'home' ? box.home.lines : box.away.lines;
  const hasEnteredSomething = Object.values(values).some((v) => v.trim() !== '');

  return (
    <div className="statfile">
      {/* ---- WHICH BENCH. Required per line and never inferred: a line that
          mints a new roster player has no existing row to read a team off. ---- */}
      <div className="statfile__sides" role="group" aria-label="Which team">
        <button
          type="button"
          className={`chip${side === 'home' ? ' chip--on' : ''}`}
          onClick={() => { setSide('home'); choose(null); }}
        >
          {homeLabel}
        </button>
        <button
          type="button"
          className={`chip${side === 'away' ? ' chip--on' : ''}`}
          onClick={() => { setSide('away'); choose(null); }}
        >
          {awayLabel}
        </button>
      </div>

      {!teamId && (
        <p className="game-hint">
          This side has no team on the event, so there&apos;s no bench to file
          against. Set the teams on the game first.
        </p>
      )}

      {/* ---- ALREADY FILED, so a correspondent can see what is done without
          reading it as what was played. ---- */}
      {lines.length > 0 && (
        <div className="statfile__filed">
          <span className="statfile__filed-label">Filed so far</span>
          <ul className="statfile__filed-list">
            {lines.map((l) => (
              <li key={l.id} className="statfile__filed-row">
                <span>
                  {l.jerseyNumber ? `#${l.jerseyNumber} ` : ''}
                  {l.displayName ?? 'Unnamed player'}
                </span>
                <span className="muted">{summarise(l, labelFor, box.headlineStat)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {teamId && !subject && (
        <>
          <p className="statfile__prompt">Who are you filing for?</p>
          {roster === null && <p className="muted">Loading the roster…</p>}
          {roster !== null && (
            <div className="statfile__roster">
              {roster
                .filter((p) => !filedRosterIds.has(p.id))
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="chip statfile__pick"
                    onClick={() => choose({ kind: 'roster', player: p })}
                  >
                    {p.jerseyNumber ? `#${p.jerseyNumber} ` : ''}
                    {p.displayName ?? 'Unnamed'}
                    {p.position ? <span className="muted"> · {p.position}</span> : null}
                  </button>
                ))}
              <button
                type="button"
                className="chip statfile__pick statfile__pick--new"
                onClick={() => choose({ kind: 'new', jerseyNumber: '', name: '', position: '' })}
              >
                + Someone not on this list
              </button>
            </div>
          )}
          {roster !== null && roster.length === 0 && (
            <p className="game-hint">
              No roster yet for this team this season — that&apos;s normal before the
              first filing. Add players as you go and they&apos;ll be here next time.
            </p>
          )}
        </>
      )}

      {teamId && subject && (
        <div className="statfile__form">
          <div className="statfile__who">
            <strong>{subjectLabel(subject)}</strong>
            <button type="button" className="link-btn" onClick={() => choose(null)}>
              Change
            </button>
          </div>

          {subject.kind === 'new' && (
            <div className="statfile__newplayer">
              <label className="field">
                <span>Jersey</span>
                <input
                  value={subject.jerseyNumber}
                  onChange={(e) => setSubject({ ...subject, jerseyNumber: e.target.value })}
                  inputMode="numeric"
                  maxLength={4}
                />
              </label>
              <label className="field">
                <span>Name</span>
                <input
                  value={subject.name}
                  onChange={(e) => setSubject({ ...subject, name: e.target.value })}
                  maxLength={120}
                />
              </label>
              <label className="field">
                <span>Position</span>
                <input
                  value={subject.position}
                  onChange={(e) => {
                    const next = { ...subject, position: e.target.value };
                    setSubject(next);
                    // Re-run the pre-open as they type: a position typed here is
                    // exactly as good a hint as one already on the roster row.
                    setOpenGroup(positionOpens(groups, next.position));
                  }}
                  maxLength={40}
                  placeholder="QB, RB, P…"
                />
              </label>
              <p className="game-hint">
                A jersey number or a name is enough — the roster row is created
                for you and can be linked to an athlete later.
              </p>
            </div>
          )}

          <label className="statfile__dnp">
            <input
              type="checkbox"
              checked={didNotPlay}
              onChange={(e) => setDidNotPlay(e.target.checked)}
            />
            <span>Didn&apos;t play</span>
          </label>

          {!didNotPlay && (
            <>
              {/* ---- THE BLOCKS. Every one reachable; at most one pre-opened
                  from the position. Nothing here is required — see the rule at
                  the head of stat-groups.ts for why over-showing is the safe
                  direction. ---- */}
              {groups.length > 1 && (
                <div className="statfile__groups" role="group" aria-label="What did they do?">
                  {groups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className={`chip${openGroup === g.id ? ' chip--on' : ''}`}
                      aria-expanded={openGroup === g.id}
                      onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              )}

              {groups.length > 1 && openGroup === null && (
                <p className="game-hint">
                  Pick what they did. You can open more than one — a quarterback
                  who runs needs Passing and Rushing.
                </p>
              )}

              {groups
                .filter((g) => groups.length === 1 || g.id === openGroup)
                .map((g) => (
                  <div key={g.id} className="statfile__fields">
                    {g.fields.map((f) => (
                      <label key={f.key} className="field statfile__field">
                        <span>{f.label}</span>
                        <input
                          value={values[f.key] ?? ''}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [f.key]: e.target.value }))
                          }
                          inputMode="decimal"
                          placeholder="—"
                        />
                        {f.hint && <span className="statfile__hint">{f.hint}</span>}
                      </label>
                    ))}
                  </div>
                ))}
            </>
          )}

          {saveError && <div className="error statfile__error">{saveError}</div>}

          <div className="rep-form-actions">
            <button
              type="button"
              onClick={() => void onFile()}
              disabled={saving || (!didNotPlay && !hasEnteredSomething)}
            >
              {saving ? 'Filing…' : 'File this line'}
            </button>
          </div>
          {!didNotPlay && !hasEnteredSomething && (
            <p className="game-hint">
              Enter at least one number, or mark them as didn&apos;t play.
            </p>
          )}
        </div>
      )}

      {saved && (
        <p className="statfile__saved" role="status">
          {saved}
        </p>
      )}
    </div>
  );
}

// A one-clause summary of a filed line, for the "filed so far" list — a
// RECEIPT, not a box score, so it shows the headline stat and the next two
// rather than the whole payload.
//
// Labels, never raw keys: the payload's keys are column names ("fgAtt"), and
// the receipt is read by the person who just typed the numbers.
function summarise(
  l: BoxScoreLine,
  labelFor: (k: string) => string,
  headlineStat: string | null,
): string {
  if (l.didNotPlay) return 'DNP';
  const entries = Object.entries(l.stats).filter(([, v]) => v > 0);
  if (entries.length === 0) return 'no stats';
  // The family's headline first when present -- "18 points" is what the line is
  // about, whatever else happens to be a bigger number.
  entries.sort((a, b) => {
    if (a[0] === headlineStat) return -1;
    if (b[0] === headlineStat) return 1;
    return b[1] - a[1];
  });
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${v} ${labelFor(k)}`)
    .join(' · ');
}
