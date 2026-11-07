// ============================================================================
// THE MATCHUP -- the inputs to the game, side by side. Facts, never verdicts.
// All six before and DURING a game (each is true while it is played); three on
// a final -- see below.
//
// Nothing here says who is hot, where an edge is, or what to pick. Every line is
// a count, a score or a date, and every block says where its numbers came from
// and how fresh they are. PARTIAL DATA IS LABELLED: a record over 11 of 14 games
// says "11 of 14", never a bare figure that quietly dropped three.
//
// All wording is decided in pure describe* functions so each case is testable
// without a browser.
//
// ****************************************************************************
// ON A FINAL, THREE OF THE SIX, EACH SAYING WHEN IT IS FROM.
//
//   Shown: against the closing line, season stats, head to head. Each is the
//   season TO DATE, so on a game from three weeks ago it describes the season as
//   of today, not as of that game -- true only if it says so. So on a final each
//   panel OPENS with its "as of" ("…, as of Nov 7, 2026, not as of this game"),
//   where it is read, instead of leaving it in the small footer.
//   Not shown: injuries (who is hurt today says nothing about a game three weeks
//   ago, and no label fixes that) and recent form (it would list games played
//   after this one).
//   And only when the game is IN the season these describe (seasonCoversGame):
//   "this season" is the provider's current one, and last April's final must not
//   be shown this November's numbers.
// ****************************************************************************
// ============================================================================

import { etDateTime, InjuredPlayer, Matchup, TeamForm, TeamGame, TeamInjuries, TeamStats, TeamVsClose } from './api';

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// SportsDataIO names a split-year season by its END year (nba 2027 = 2026-27). A
// fan says "2026–27", so those leagues get the pair; single-year leagues do not.
const SPLIT_YEAR = new Set(['nba', 'nhl', 'cbb', 'cwbb']);
export const seasonLabel = (league: string, season: number) =>
  SPLIT_YEAR.has(league) ? `${season - 1}–${String(season).slice(2)}` : String(season);

// ---------------------------------------------------------------------------
// 1. AGAINST THE CLOSING LINE
// ---------------------------------------------------------------------------
export interface VsCloseRow { label: string; away: string; home: string }
export interface VsCloseCopy { rows: VsCloseRow[]; foot: string[]; lead: string | null }

// The "as of" line a final's panel opens with.
const asOfLead = (what: string, iso: string) =>
  `${what}, as of ${etDateTime(iso, { zone: true })}, not as of this game.`;

const etYmd = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));

// The game falls in the season these sections describe: on or after the
// provider's current regular-season start (after its end is that season's
// postseason). Unknown window -> false: not confirmed is not shown.
export function seasonCoversGame(m: Matchup | null, scheduledAt: string): boolean {
  const w = m?.vsClose.home?.window ?? m?.vsClose.away?.window;
  return !!w && etYmd(scheduledAt) >= w.start;
}

function cells(v: TeamVsClose | null, note: string | null) {
  if (!v) {
    const none = note ? `Not available (${note})` : 'Not available';
    return { season: none, spreadGames: '—', su: '—', ats: '—', totals: '—' };
  }
  const played = v.gamesPlayed;
  const su = v.straightUpInSpreadGames;
  return {
    season: played !== null ? `${count(played, 'game')} played` : '—',
    spreadGames: played !== null ? `${v.withSpread} of ${played}` : String(v.withSpread),
    su: v.withSpread ? `${su.wins}–${su.losses}${su.ties ? `–${su.ties}` : ''}` : '—',
    ats: v.withSpread
      ? `${v.vsSpread.covered} covered · ${v.vsSpread.notCovered} not · ${count(v.vsSpread.pushes, 'push', 'pushes')}`
      : '—',
    totals: v.withTotal
      ? `${v.vsTotal.over} over · ${v.vsTotal.under} under · ${count(v.vsTotal.pushes, 'push', 'pushes')}`
        + (v.withTotal !== v.withSpread ? ` (${count(v.withTotal, 'game')})` : '')
      : '—',
  };
}

export function describeVsClose(m: Matchup | null, home: string, away: string, onFinal = false): VsCloseCopy | null {
  if (!m) return null;
  const { home: h, away: a, homeNote, awayNote } = m.vsClose;
  if (!h && !a) return null;
  const A = cells(a, awayNote); const H = cells(h, homeNote);
  const rows: VsCloseRow[] = [
    { label: 'This season', away: A.season, home: H.season },
    { label: 'With a closing spread', away: A.spreadGames, home: H.spreadGames },
    { label: 'Straight up, those games', away: A.su, home: H.su },
    { label: 'Against the closing spread', away: A.ats, home: H.ats },
    { label: 'Against the closing total', away: A.totals, home: H.totals },
  ];
  const foot = [
    'Closing line: the last pregame median of 3+ independent sportsbooks, vig removed — the same close shown in the line above. Results are our final scores.',
  ];
  for (const [name, v] of [[away, a], [home, h]] as const) {
    if (v?.note) foot.push(`${name}: ${v.note}.`);
  }
  const fetched = h?.recordsFetchedAt ?? a?.recordsFetchedAt;
  const season = h ?? a;
  let lead: string | null = null;
  if (season) {
    const label = `${seasonLabel(season.league, season.season)} regular season`;
    if (onFinal && fetched) lead = asOfLead(`The ${label} to date`, fetched);
    foot.push(`Games played: the provider's ${label}`
      + `${fetched && !lead ? `, as of ${etDateTime(fetched, { zone: true })}` : ''}.`);
  }
  return { rows, foot, lead };
}

function SideBySide({ title, away, home, rows, foot, lead = null }: {
  title: string; away: string; home: string; rows: VsCloseRow[]; foot: string[]; lead?: string | null;
}) {
  return (
    <section className="matchup">
      <h2 className="matchup__title">{title}</h2>
      <div className="matchup__panel">
        {lead && <p className="matchup__asof">{lead}</p>}
        <table className="matchup__table">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Measure</span></th>
              <th scope="col">{away}</th>
              <th scope="col">{home}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{r.away}</td>
                <td>{r.home}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {foot.map((f) => <p key={f} className="matchup__foot">{f}</p>)}
      </div>
    </section>
  );
}

export function VsCloseSection({ matchup, home, away, onFinal = false }: { matchup: Matchup | null; home: string; away: string; onFinal?: boolean }) {
  const copy = describeVsClose(matchup, home, away, onFinal);
  if (!copy) return null;
  return <SideBySide title="This season against the closing line" away={away} home={home} rows={copy.rows} foot={copy.foot} lead={copy.lead} />;
}

// ---------------------------------------------------------------------------
// 2. INJURIES. Shown even when empty: before a game, "nobody out" is information.
// But "no feed" is NOT "nobody out", and says so in words.
// ---------------------------------------------------------------------------
export interface InjuryColumn { team: string; headline: string | null; lines: string[] }

const shortDate = (ymd: string) => etDateTime(`${ymd}T16:00:00Z`, { month: 'short', day: 'numeric' });

export function injuryLine(p: InjuredPlayer): string {
  const detail = [p.bodyPart, p.since ? `since ${shortDate(p.since)}` : null].filter(Boolean).join(', ');
  return `${p.name}${p.position ? ` (${p.position})` : ''} — ${p.status}${detail ? `, ${detail}` : ''}`
    + (p.practice ? `. Practice: ${p.practice}` : '');
}

export function describeInjuryColumn(team: string, t: TeamInjuries): InjuryColumn {
  if (t.status === 'no-feed') {
    return { team, headline: 'No injury report exists for this league', lines: ['We cannot say who is out — this is not the same as nobody being out.'] };
  }
  if (t.status === 'unavailable') return { team, headline: 'Injury report unavailable', lines: [t.note] };
  if (!t.players.length) return { team, headline: 'No injuries reported', lines: [] };
  return { team, headline: null, lines: t.players.map(injuryLine) };
}

export function InjuriesSection({ matchup, home, away }: { matchup: Matchup | null; home: string; away: string }) {
  if (!matchup?.injuries) return null;
  const cols = [describeInjuryColumn(away, matchup.injuries.away), describeInjuryColumn(home, matchup.injuries.home)];
  const fetched = [matchup.injuries.away, matchup.injuries.home]
    .map((t) => (t.status === 'ok' ? t.fetchedAt : null)).filter((x): x is string => !!x).sort()[0];
  return (
    <section className="matchup">
      <h2 className="matchup__title">Injuries</h2>
      <div className="matchup__panel">
        <div className="matchup__cols">
          {cols.map((c) => (
            <div key={c.team} className="matchup__col">
              <h3 className="matchup__colhead">{c.team}</h3>
              {c.headline && <p className="matchup__empty">{c.headline}</p>}
              {c.lines.length > 0 && (
                <ul className="matchup__list">
                  {c.lines.map((l) => <li key={l}>{l}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
        {fetched && <p className="matchup__foot">From the SportsDataIO injury report, as of {etDateTime(fetched, { zone: true })}.</p>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. SEASON STATS, side by side. The same handful per sport for both teams; a
// value the provider does not publish says so in its cell.
// ---------------------------------------------------------------------------
export function describeTeamStats(m: Matchup | null, home: string, away: string, onFinal = false): VsCloseCopy | null {
  const h = m?.teamStats?.home; const a = m?.teamStats?.away;
  if (!h || !a) return null;
  const ok = (t: TeamStats) => (t.status === 'ok' ? t : null);
  const H = ok(h); const A = ok(a);
  const base = H ?? A;
  if (!base) return null;
  const rows: VsCloseRow[] = [
    { label: 'Games played', away: A ? String(A.games) : '—', home: H ? String(H.games) : '—' },
    ...base.stats.map((s) => ({
      label: s.label,
      away: A?.stats.find((x) => x.key === s.key)?.display ?? '—',
      home: H?.stats.find((x) => x.key === s.key)?.display ?? '—',
    })),
  ];
  const foot = [`The provider's ${seasonLabel(base.league, base.season)} regular season to date. Per-game figures are season totals divided by games played.`];
  for (const [name, t] of [[away, a], [home, h]] as const) if (t.status !== 'ok') foot.push(`${name}: ${t.note}.`);
  if (base.stats.some((s) => s.value === null) || (A && A.stats.some((s) => s.value === null))) {
    foot.push('"Not published" means SportsDataIO does not report that figure for this league.');
  }
  const lead = onFinal ? asOfLead(`The ${seasonLabel(base.league, base.season)} regular season to date`, base.fetchedAt) : null;
  foot.push(lead ? 'From SportsDataIO team season stats.' : `From SportsDataIO team season stats, as of ${etDateTime(base.fetchedAt, { zone: true })}.`);
  return { rows, foot, lead };
}

export function TeamStatsSection({ matchup, home, away, onFinal = false }: { matchup: Matchup | null; home: string; away: string; onFinal?: boolean }) {
  const copy = describeTeamStats(matchup, home, away, onFinal);
  if (!copy) return null;
  return <SideBySide title="Season stats" away={away} home={home} rows={copy.rows} foot={copy.foot} lead={copy.lead} />;
}

// ---------------------------------------------------------------------------
// 5. RECENT FORM -- the most recent finals WE HOLD, each against its own close.
// "W 4–2, covered" is a different sentence from "W 4–2". The column says how many
// we hold of how many were played, so an archive gap cannot pass for a team's
// actual last five.
// ---------------------------------------------------------------------------
const signedLine = (n: number) => (n === 0 ? 'pick’em' : n > 0 ? `+${n}` : `−${Math.abs(n)}`);

export function formLine(g: TeamGame): string {
  const score = `${g.result} ${g.teamScore}–${g.opponentScore}`;
  // A neutral site has no home team: "vs X (neutral site)", never "at X".
  const where = g.neutralSite ? `vs ${g.opponent} (neutral site)` : `${g.isHome ? 'vs' : 'at'} ${g.opponent}`;
  const close = g.vsSpread
    ? `closed ${signedLine(g.closeSpread!)}, ${g.vsSpread}`
    : 'no closing spread held';
  const total = g.vsTotal ? ` · total ${g.closeTotal}, ${g.vsTotal}` : '';
  return `${score} ${where} · ${shortDate(g.date)} · ${close}${total}`;
}

export function describeFormColumn(team: string, f: TeamForm | null, note: string | null): InjuryColumn {
  if (!f) return { team, headline: 'Not available', lines: note ? [note] : [] };
  if (!f.games.length) return { team, headline: 'No finals held for this season yet', lines: [] };
  const lines = f.games.map(formLine);
  const n = f.games.length;
  const held = f.gamesPlayed !== null
    ? `Most recent ${n} of the ${f.finalsHeld} finals we hold; ${count(f.gamesPlayed, 'game')} played this season.`
    : `Most recent ${n} of the ${f.finalsHeld} finals we hold.`;
  const gap = f.gamesPlayed !== null && f.finalsHeld < f.gamesPlayed
    ? ' Because we do not hold every game, these may not be the last games actually played.'
    : '';
  lines.push(held + gap);
  return { team, headline: null, lines };
}

export function FormSection({ matchup, home, away }: { matchup: Matchup | null; home: string; away: string }) {
  if (!matchup?.form || (!matchup.form.home && !matchup.form.away)) return null;
  const cols = [
    describeFormColumn(away, matchup.form.away, matchup.form.awayNote),
    describeFormColumn(home, matchup.form.home, matchup.form.homeNote),
  ];
  return (
    <section className="matchup">
      <h2 className="matchup__title">Recent form</h2>
      <div className="matchup__panel">
        <div className="matchup__cols">
          {cols.map((c) => (
            <div key={c.team} className="matchup__col">
              <h3 className="matchup__colhead">{c.team}</h3>
              {c.headline && <p className="matchup__empty">{c.headline}</p>}
              {c.lines.length > 0 && (
                <ul className="matchup__list">
                  {c.lines.map((l, i) => <li key={l} className={i === c.lines.length - 1 && !c.headline ? 'matchup__listfoot' : undefined}>{l}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
        <p className="matchup__foot">Our final scores, each against its closing line (median of 3+ independent sportsbooks, the same close as above).</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 6. HEAD TO HEAD -- this season's other meetings, with scores; never the game
// being viewed (the API leaves it out). ABSENT when there are none: an empty
// block on most games would say nothing. When a side's archive is incomplete,
// the foot says a meeting could be missing. Before a game every held meeting is
// an earlier one; on an old final a later rematch can be listed too, so a final
// says "other meetings" and when they were read, not "earlier".
// ---------------------------------------------------------------------------
export function describeHeadToHead(m: Matchup | null, home: string, away: string, onFinal = false): { lines: string[]; foot: string[]; lead: string | null } | null {
  const h = m?.headToHead;
  if (!h || !h.meetings.length) return null;
  const lines = h.meetings.map((g) => {
    // g is from THIS game's home team's side.
    const [hs, as] = [g.teamScore, g.opponentScore];
    const winner = hs > as ? `${home} ${hs}, ${away} ${as}` : as > hs ? `${away} ${as}, ${home} ${hs}` : `${home} ${hs}, ${away} ${as} (tied)`;
    const venue = g.neutralSite ? 'neutral site' : g.isHome ? `at ${home}` : `at ${away}`;
    const close = g.vsSpread ? ` · ${home} closed ${signedLine(g.closeSpread!)}, ${g.vsSpread}` : '';
    return `${shortDate(g.date)} · ${winner} · ${venue}${close}`;
  });
  const foot = [onFinal
    ? 'Our final scores for the other meetings between these teams this regular season.'
    : 'Our final scores for earlier meetings this regular season.'];
  const gaps = (['away', 'home'] as const).filter((k) => {
    const c = h.coverage[k]; return c && c.gamesPlayed !== null && c.finalsHeld < c.gamesPlayed;
  });
  if (gaps.length) foot.push(`We do not hold every game these teams have played, so ${onFinal ? 'a' : 'an earlier'} meeting could be missing.`);
  const lead = onFinal ? asOfLead('This regular season', h.asOf) : null;
  return { lines, foot, lead };
}

export function HeadToHeadSection({ matchup, home, away, onFinal = false }: { matchup: Matchup | null; home: string; away: string; onFinal?: boolean }) {
  const copy = describeHeadToHead(matchup, home, away, onFinal);
  if (!copy) return null;
  return (
    <section className="matchup">
      <h2 className="matchup__title">Head to head this season</h2>
      <div className="matchup__panel">
        {copy.lead && <p className="matchup__asof">{copy.lead}</p>}
        <ul className="matchup__list">{copy.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        {copy.foot.map((f) => <p key={f} className="matchup__foot">{f}</p>)}
      </div>
    </section>
  );
}
