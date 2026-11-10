// ============================================================================
// A TEAM'S SEASON on the team page -- record, season stats and the four
// factors, schedule and results, leaders. From GET /teams/:id/season; the
// numbers are the API's stats library over stored TEAM rows. NOTHING IS
// COMPUTED HERE beyond formatting: no sums, no rates, no rounding of a total.
//
// EVERY BLOCK SAYS WHAT IT IS COMPUTED FROM. Three counts, as the matchup
// sections state theirs: games the provider counts, finals we hold, and the
// games with a usable box score. A gap between them is named ("we hold 3 of 4
// games played"; "not included: 1 box score that did not add up"), never
// silently dropped.
//
// A SMALL SAMPLE SAYS SO. The stats block opens with how many games it is
// computed from, and under 10 adds that early numbers move a lot game to game.
//
// NO VERDICTS. Numbers and their context -- nothing about whether a team is good.
//
// All wording is in pure describe* functions, testable without a browser.
// ============================================================================
import Link from 'next/link';
import { etDateTime, startLabel, TeamLeaderBoard, TeamScheduleGame, TeamSeasonStats, TeamSeasonView } from './api';
import { seasonLabel } from './matchup';

type Available = Extract<TeamSeasonView, { available: true }>;

const n1 = (x: number | null, dp = 1) => (x === null ? '—' : x.toFixed(dp));
const pct = (x: number | null) => (x === null ? '—' : `${x.toFixed(1)}%`);
const signed = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`);
const wl = (r: { wins: number; losses: number }) => `${r.wins}–${r.losses}`;
const games = (n: number) => `${n} game${n === 1 ? '' : 's'}`;
// "Huskies'" and "Grace's": a name ending in s takes the bare apostrophe.
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
// "the 1 game", "both games", "all 5 games".
const allOf = (n: number) => (n === 1 ? 'the 1 game' : n === 2 ? 'both games' : `all ${n} games`);
const shortDate = (ymd: string) => etDateTime(`${ymd}T16:00:00Z`, { month: 'short', day: 'numeric' });

// ---- coverage: what everything below is computed from ------------------------
export function describeCoverage(v: Available, team: string): string[] {
  const c = v.coverage;
  const out: string[] = [];
  const season = v.season !== null ? `${seasonLabel(v.league, v.season)} regular season` : 'This season';
  if (c.gamesPlayed === null) {
    out.push(`${season}. The provider publishes no season record for ${team}; we hold ${c.finalsHeld === 1 ? 'the final for 1 game' : `finals for ${games(c.finalsHeld)}`}.`);
  } else if (c.finalsHeld === c.gamesPlayed) {
    out.push(`${season}: we hold the final${c.finalsHeld === 1 ? '' : 's'} for ${allOf(c.gamesPlayed)} ${team} has played.`);
  } else if (c.finalsHeld < c.gamesPlayed) {
    out.push(`${season}: we hold finals for ${c.finalsHeld} of the ${games(c.gamesPlayed)} ${team} has played. Everything below covers those ${c.finalsHeld}.`);
  } else {
    out.push(`${season}: we hold ${c.finalsHeld} finals; the provider's season record, as of ${etDateTime(c.recordsFetchedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, counts ${games(c.gamesPlayed)}.`);
  }
  if (!v.window && v.windowNote) out.push(`The provider gave no season dates, so this lists every game we hold for ${team}.`);
  return out;
}

// ---- record ------------------------------------------------------------------
export function describeRecord(v: Available): { rows: [string, string][]; note: string | null } {
  const r = v.record;
  const rows: [string, string][] = [['Overall', wl(r.overall)], ['Home', wl(r.home)], ['Away', wl(r.away)]];
  if (r.neutral.wins + r.neutral.losses > 0) rows.push(['Neutral site', wl(r.neutral)]);
  const playedN = r.overall.wins + r.overall.losses;
  rows.push([playedN > r.lastN.games ? `Last ${r.lastN.games}` : `Last ${r.lastN.games} (all)`, wl(r.lastN)]);
  rows.push(['Streak', r.streak ? `${r.streak.kind === 'W' ? 'Won' : 'Lost'} ${r.streak.length}` : '—']);
  const c = v.coverage;
  // The provider's record beside ours whenever the two differ -- they count
  // different things (theirs: every game; ours: the finals listed below).
  const note = c.providerRecord && c.providerRecord !== wl(r.overall)
    ? `From the ${games(playedN)} we hold. The provider's season record is ${c.providerRecord} as of ${etDateTime(c.recordsFetchedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`
    : `From the ${games(playedN)} we hold.`;
  return { rows, note };
}

// ---- season stats ------------------------------------------------------------
export function describeStatsBasis(v: Available, team: string): { lead: string | null; excluded: string | null } {
  const c = v.coverage; const s = v.stats;
  const x = c.excluded;
  const parts: string[] = [];
  if (x.refused) parts.push(`${x.refused === 1 ? '1 game whose box score did not add up' : `${x.refused} games whose box scores did not add up`} (refused, retried later)`);
  if (x.notFetched) parts.push(`${x.notFetched === 1 ? '1 game whose box score we have not fetched yet' : `${x.notFetched} games whose box scores we have not fetched yet`}`);
  if (x.opponentTotalsMissing) parts.push(`${x.opponentTotalsMissing === 1 ? '1 game' : `${x.opponentTotalsMissing} games`} where the provider published only the opponent's score`);
  if (x.ownTotalsMissing) parts.push(`${x.ownTotalsMissing === 1 ? '1 game' : `${x.ownTotalsMissing} games`} where the provider published only ${possessive(team)} score`);
  const excluded = parts.length ? `Not included: ${parts.join('; ')}.` : null;
  if (!s) return { lead: null, excluded };
  const of = c.finalsHeld > s.games ? ` of the ${c.finalsHeld} finals we hold` : '';
  const lead = s.smallSample
    ? `Computed from ${games(s.games)}${of}, a small sample: early-season figures move a lot with each game.`
    : `Computed from ${games(s.games)}${of}.`;
  return { lead, excluded };
}

export function statRows(s: TeamSeasonStats): [string, string, string?][] {
  return [
    ['Points per game', n1(s.pointsPerGame), `allowed ${n1(s.opponentPointsPerGame)}`],
    ['Pace', n1(s.pace), `possessions per ${s.paceBasisMinutes} minutes`],
    ['Offensive rating', n1(s.offensiveRating), 'points per 100 possessions'],
    ['Defensive rating', n1(s.defensiveRating), 'points allowed per 100 possessions'],
    ['Net rating', signed(s.netRating), 'per 100 possessions'],
    ['Field goals', pct(s.fieldGoalPct)],
    ['Three-pointers', pct(s.threePointPct), `${pct(s.threePointRate)} of shots are threes`],
    ['Free throws', pct(s.freeThrowPct)],
    ['True shooting', pct(s.trueShootingPct)],
  ];
}

export const FACTORS: { key: keyof TeamSeasonStats['offense']; label: string; plain: string }[] = [
  { key: 'effectiveFgPct', label: 'Effective FG%', plain: 'shooting, a three counted as one and a half baskets' },
  { key: 'turnoverPct', label: 'Turnover %', plain: 'share of possessions ending in a turnover' },
  { key: 'offensiveReboundPct', label: 'Offensive rebound %', plain: 'share of its own misses rebounded' },
  { key: 'freeThrowRate', label: 'Free throw rate', plain: 'free-throw attempts per field-goal attempt' },
];

// ---- schedule ----------------------------------------------------------------
export function scheduleLine(g: TeamScheduleGame): { when: string; vs: string; result: string; note: string | null } {
  const vs = `${g.site === 'away' ? 'at' : 'vs'} ${g.opponent}${g.site === 'neutral' ? ' (neutral site)' : ''}`;
  const when = shortDate(g.date);
  let result: string;
  if (g.result) result = `${g.result} ${g.teamScore}–${g.opponentScore}`;
  else if (g.status === 'live') result = 'In progress';
  else if (g.status === 'postponed') result = 'Postponed';
  else if (g.status === 'canceled') result = 'Called off';
  else if (g.status === 'final') result = 'Final';
  else result = startLabel(g.scheduledAt, g.startTimeTba, (iso) => etDateTime(iso, { hour: 'numeric', minute: '2-digit' }));
  const note = g.boxScore === 'refused' ? 'box score did not add up; not in the stats'
    : g.boxScore === 'not fetched' ? 'no box score yet'
    : g.boxScore === 'opponent totals not published' ? "opponent's totals not published; not in the stats"
    : g.boxScore === 'team totals not published' ? 'team totals not published'
    : null;
  return { when, vs, result, note };
}

// ---- leaders -----------------------------------------------------------------
export function leaderValue(b: TeamLeaderBoard, v: number) {
  return b.unit === '%' ? `${v.toFixed(1)}%` : v.toFixed(1);
}

// What the leaders rest on, in the section's own words. Null when they rest on
// every final held. The gap is itemised by the API (leadersMissing), so each
// clause names a real reason: a provider that published no players, a box score
// that did not add up, or one not fetched yet. Team stats read the team row and
// carry no such sentence.
export function describeLeadersBasis(v: Extract<TeamSeasonView, { available: true }>): string | null {
  const { leadersFromGames: n, seasonGames: of, leadersMissing: m } = v;
  if (n === of) return null;
  const parts: string[] = [];
  const only = m.playersNotPublished === of - n;
  if (m.playersNotPublished) parts.push(`no player lines published for ${only ? `the other ${m.playersNotPublished}` : m.playersNotPublished}`);
  if (m.refused) parts.push(`${m.refused} box score${m.refused === 1 ? '' : 's'} refused because ${m.refused === 1 ? 'it' : 'they'} did not add up`);
  if (m.notFetched) parts.push(`${m.notFetched} not fetched yet`);
  const why = parts.join(', ');
  return `Leaders from ${n} of ${games(of)}: ${why}.`;
}

// ============================================================================
export function TeamSeason({ view, team }: { view: TeamSeasonView | null; team: string }) {
  if (!view) return null;
  if (!view.available) {
    return (
      <section className="card team-section">
        <span className="game-kicker">Season</span>
        <p className="tseason__note">No season stats for {team}: {view.why}.</p>
      </section>
    );
  }
  const coverage = describeCoverage(view, team);
  const rec = describeRecord(view);
  const basis = describeStatsBasis(view, team);
  const s = view.stats;
  const finals = view.schedule.filter((g) => g.result !== null).length;
  return (
    <>
      <section className="card team-section">
        <span className="game-kicker">Season</span>
        <h2 className="team-section__title">Record</h2>
        {coverage.map((l, i) => <p key={i} className="tseason__lead">{l}</p>)}
        {finals > 0 ? (
          <>
            <dl className="tseason__record">
              {rec.rows.map(([k, val]) => (
                <div key={k} className="tseason__recitem"><dt>{k}</dt><dd>{val}</dd></div>
              ))}
            </dl>
            {rec.note && <p className="tseason__foot">{rec.note}</p>}
          </>
        ) : <p className="tseason__note">No finals yet this season.</p>}
      </section>

      <section className="card team-section">
        <span className="game-kicker">Season</span>
        <h2 className="team-section__title">Team stats and the four factors</h2>
        {s ? (
          <>
            <p className="tseason__lead">{basis.lead}</p>
            <table className="tseason__table">
              <tbody>
                {statRows(s).map(([k, val, ctx]) => (
                  <tr key={k}><th scope="row">{k}</th><td className="tseason__num">{val}</td><td className="tseason__ctx">{ctx ?? ''}</td></tr>
                ))}
              </tbody>
            </table>
            <h3 className="tseason__sub">The four factors</h3>
            <table className="tseason__table tseason__table--factors">
              <thead>
                <tr><th scope="col"><span className="sr-only">Factor</span></th><th scope="col" className="tseason__num">{team}</th><th scope="col" className="tseason__num">Opponents</th></tr>
              </thead>
              <tbody>
                {FACTORS.map((f) => (
                  <tr key={f.key}>
                    <th scope="row">{f.label}<span className="tseason__plain">{f.plain}</span></th>
                    <td className="tseason__num">{pct(s.offense[f.key])}</td>
                    <td className="tseason__num">{pct(s.defense[f.key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tseason__foot">
              {possessive(team)} column is its offense; the opponents&apos; column is what opponents did against it. From the team rows of each box score
              (season totals, not an average of games), possessions by Dean Oliver&apos;s formula.
            </p>
            {basis.excluded && <p className="tseason__foot">{basis.excluded}</p>}
          </>
        ) : (
          <p className="tseason__note">
            {basis.excluded ? `No season stats for ${team}. ${basis.excluded}` : `No season stats for ${team} yet: none of its finals has a box score.`}
          </p>
        )}
      </section>

      <section className="card team-section">
        <span className="game-kicker">Season</span>
        <h2 className="team-section__title">Leaders</h2>
        {view.seasonGames === 0 ? (
          <p className="tseason__note">No finals held for this season yet.</p>
        ) : view.leadersFromGames === 0 ? (
          <p className="tseason__note">No player lines published for this team yet.</p>
        ) : (
          <>
            <p className="tseason__lead">{describeLeadersBasis(view) ?? (view.seasonGames === 1 ? 'From its 1 game.' : view.seasonGames === 2 ? 'From both games.' : `From all ${view.seasonGames} games.`)}</p>
            <div className="tseason__leaders">
              {view.leaders.map((b) => (
                <div key={b.key} className="tseason__board">
                  <h3 className="tseason__boardtitle">{b.label}<span className="tseason__unit">{b.unit === '%' ? '' : ' per game'}</span></h3>
                  {b.leaders.length ? (
                    <ol className="tseason__boardlist">
                      {b.leaders.map((l) => (
                        <li key={l.playerId}><span className="tseason__pname"><Link href={`/players/${l.playerId}`}>{l.name}</Link></span><span className="tseason__pval" title={l.detail}>{leaderValue(b, l.value)}</span></li>
                      ))}
                    </ol>
                  ) : <p className="tseason__none">Nobody qualifies yet.</p>}
                  <p className="tseason__min">Minimum: {b.minimum}.</p>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card team-section">
        <span className="game-kicker">Season</span>
        <h2 className="team-section__title">Schedule and results</h2>
        {view.schedule.length === 0 ? <p className="tseason__note">No games held for this season yet.</p> : (
          <ul className="tseason__sched">
            {view.schedule.map((g) => {
              const l = scheduleLine(g);
              return (
                <li key={g.eventId}>
                  <Link href={`/games/${g.eventId}`} className="tseason__game">
                    <span className="tseason__when">{l.when}</span>
                    <span className="tseason__vs">{l.vs}{l.note && <span className="tseason__gnote">{l.note}</span>}</span>
                    <span className={`tseason__res${g.result ? ` tseason__res--${g.result.toLowerCase()}` : ''}`}>{l.result}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <p className="tseason__foot">Every game we hold for {team} this season.</p>
      </section>
    </>
  );
}
