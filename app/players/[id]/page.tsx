'use client';

// ============================================================================
// A PROVIDER PLAYER'S PAGE (/players/[id]) -- from GET /players/:id. The id is
// provider_players.id, reached from a name in a box score. NOT an athlete page:
// /athletes/:id is the consent and NIL entity, and a provider player agreed to
// nothing. The two never link.
//
// NOTHING IS COMPUTED HERE beyond formatting. Every rate is the API's stats library
// over stored lines; this file chooses words and decimal places.
//
// THE HONESTY RULES, each with its own sentence (all in describe* below; not
// exported, because a Next page file may export only the page):
//   * a game with no line for the player -- the side unpublished, the box score
//     refused or not fetched, no row -- is ABSENT, not a zero row, and the coverage
//     lines say how many and why;
//   * per-game figures say what they are over when that differs from the team's
//     finals;
//   * a row whose minutes are withheld says so ON THE ROW, with the provider's
//     number, rather than leaving a blank cell; the season's minute-based figures
//     say how many games they are over;
//   * a stat-less row on an unreconciled side is in the log, marked, and is not a
//     game played;
//   * preseason games are in the log, not the season line, and the page says so.
// NO VERDICTS: numbers and their context.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../auth-context';
import { AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import { etDateTime, getPlayer, PlayerGameRow, PlayerSeason, PlayerView, ProviderBoxStats } from '../../api';

const LEAGUE_LABEL: Record<string, string> = { cbb: 'College basketball', nba: 'NBA' };
const n1 = (x: number | null) => (x === null ? '—' : x.toFixed(1));
const pct = (x: number | null) => (x === null ? '—' : `${x.toFixed(1)}%`);
const games = (n: number) => `${n} game${n === 1 ? '' : 's'}`;
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
const shortDate = (ymd: string) => etDateTime(`${ymd}T16:00:00Z`, { month: 'short', day: 'numeric' }) || ymd;

// ---- coverage: what the season line is computed from -----------------------------
function describeCoverage(v: PlayerView, s: PlayerSeason): string[] {
  const name = v.player.name;
  const c = s.coverage;
  const team = c.team?.name ?? 'the team';
  const out: string[] = [];
  const m = c.missing;
  const gap = c.teamFinals - c.gamesForTeam;
  if (c.team && gap === 0) {
    out.push(`${s.season} season: ${name} played in ${c.teamFinals === 1 ? 'the 1' : `all ${c.teamFinals}`} ${team} final${c.teamFinals === 1 ? '' : 's'} we hold.`);
  } else if (c.team) {
    out.push(`${s.season} season: ${name} played in ${c.gamesForTeam} of the ${c.teamFinals} ${team} finals we hold. Per-game figures are over the ${games(s.games)} played, not ${c.teamFinals}.`);
    const why: string[] = [];
    if (m.sideUnpublished) why.push(`${m.sideUnpublished} where ${v.player.provider} published no player lines for ${team} (absent here, not zeros)`);
    if (m.refused) why.push(`${m.refused} whose box score did not add up and is not stored`);
    if (m.notFetched) why.push(`${m.notFetched} whose box score we have not fetched yet`);
    if (m.notOnBoxScore) why.push(`${m.notOnBoxScore} where the box score has no line for ${name}`);
    if (m.didNotPlay) why.push(`${m.didNotPlay} listed as did not play`);
    if (m.statLessRow) why.push(`${m.statLessRow} with a row that has no stats on a side whose minutes do not add up, so not counted as a game`);
    out.push(`The other ${games(gap)}: ${why.join('; ')}.`);
  }
  for (const o of c.otherTeams) out.push(`Also ${games(o.games)} for ${o.name} this season, included in the season line.`);
  const x = s.excludedFromSeason;
  const ex: string[] = [];
  if (x.preseason) ex.push(`${x.preseason} preseason`);
  if (x.noSeasonType) ex.push(`${x.noSeasonType} the provider gave no season type`);
  if (x.otherSeasons) ex.push(`${x.otherSeasons} from other seasons`);
  if (ex.length) out.push(`In the game log but not the season line: ${ex.join(', ')}.`);
  return out;
}

function describeMinutes(v: PlayerView, s: PlayerSeason): string | null {
  const a = s.advanced;
  const basis = a.perRate.basisMinutes;
  const parts: string[] = [];
  if (a.minutesWithheldGames > 0) {
    parts.push(`Minutes, per-${basis} and usage are over ${a.minutesGames} of the ${games(s.games)}: in ${a.minutesWithheldGames}, ${v.player.provider}'s player minutes for the team do not add up, so minutes are withheld (marked in the game log).`);
  }
  if (a.usageGames < a.minutesGames) {
    parts.push(`Usage is over ${a.usageGames} of those: ${a.minutesGames - a.usageGames} ${a.minutesGames - a.usageGames === 1 ? 'game has' : 'games have'} no period scores, so the overtime count is unknown.`);
  }
  return parts.length ? parts.join(' ') : null;
}

// What the log row says beside its numbers, or null.
function describeRow(v: PlayerView, g: PlayerGameRow): string | null {
  const notes: string[] = [];
  if (!g.inSeasonLine) {
    notes.push(g.seasonType === 'preseason' ? 'Preseason: not in the season line.'
      : g.seasonType === null ? 'No season type from the provider: not in the season line.'
      : `${g.season}: not in this season's line.`);
  }
  if (g.played && !g.countsAsGame) {
    notes.push('No stats on this row, on a side whose minutes do not add up: not counted as a game played.');
  }
  if (g.minutesWithheld) {
    notes.push(g.sideMinutesSum === 0
      ? `Minutes withheld: ${v.player.provider} published no minutes for ${g.teamName} in this game.`
      : `Minutes withheld: ${v.player.provider}'s player minutes for ${g.teamName} add up to ${g.sideMinutesSum}, not ${g.sideMinutesExpected}.`);
  }
  return notes.length ? notes.join(' ') : null;
}

const minutesCell = (s: ProviderBoxStats, display: PlayerView['minutesDisplay']) =>
  s.minutes === null ? '—'
    : display === 'clock' && s.seconds !== null ? `${s.minutes}:${String(s.seconds).padStart(2, '0')}`
    : String(s.minutes);
const ma = (m: number, a: number) => `${m}-${a}`;
const COLS: { key: string; label: string; title: string; cell: (s: ProviderBoxStats, d: PlayerView['minutesDisplay']) => string | number }[] = [
  { key: 'min', label: 'MIN', title: 'Minutes', cell: minutesCell },
  { key: 'pts', label: 'PTS', title: 'Points', cell: (s) => s.points },
  { key: 'fg', label: 'FG', title: 'Field goals made-attempted', cell: (s) => ma(s.fgm, s.fga) },
  { key: '3pt', label: '3PT', title: 'Three-pointers made-attempted', cell: (s) => ma(s.tpm, s.tpa) },
  { key: 'ft', label: 'FT', title: 'Free throws made-attempted', cell: (s) => ma(s.ftm, s.fta) },
  { key: 'oreb', label: 'OREB', title: 'Offensive rebounds', cell: (s) => s.orb },
  { key: 'dreb', label: 'DREB', title: 'Defensive rebounds', cell: (s) => s.drb },
  { key: 'reb', label: 'REB', title: 'Total rebounds', cell: (s) => s.reb },
  { key: 'ast', label: 'AST', title: 'Assists', cell: (s) => s.ast },
  { key: 'stl', label: 'STL', title: 'Steals', cell: (s) => s.stl },
  { key: 'blk', label: 'BLK', title: 'Blocks', cell: (s) => s.blk },
  { key: 'to', label: 'TO', title: 'Turnovers', cell: (s) => s.tov },
  { key: 'pf', label: 'PF', title: 'Personal fouls', cell: (s) => s.pf },
];
const opponentLabel = (g: PlayerGameRow) => `${g.site === 'away' ? '@' : 'vs'} ${g.opponent}${g.site === 'neutral' ? ' (neutral)' : ''}`;
const resultLabel = (g: PlayerGameRow) =>
  g.result === null || g.teamScore === null || g.opponentScore === null ? 'Final' : `${g.result} ${g.teamScore}–${g.opponentScore}`;

function SeasonSection({ v, s }: { v: PlayerView; s: PlayerSeason }) {
  const a = s.advanced;
  const basis = a.perRate.basisMinutes;
  const minutesNote = describeMinutes(v, s);
  const split = (k: 'fg' | 'threes' | 'ft') => `${ma(s.shooting[k].made, s.shooting[k].attempted)} (${pct(s.shooting[k].pct)})`;
  return (
    <>
      <section className="card team-section">
        <span className="game-kicker">Season</span>
        <h2 className="team-section__title">Season line</h2>
        {describeCoverage(v, s).map((l, i) => <p key={i} className="tseason__lead">{l}</p>)}
        {s.games === 0 ? <p className="tseason__note">No games played in the season line yet.</p> : (
          <table className="tseason__table">
            <tbody>
              <tr><th scope="row">Games played</th><td className="tseason__num">{s.games}</td><td className="tseason__ctx" /></tr>
              <tr><th scope="row">Points per game</th><td className="tseason__num">{n1(s.perGame.points)}</td><td className="tseason__ctx">{s.totals.points} total</td></tr>
              <tr><th scope="row">Rebounds per game</th><td className="tseason__num">{n1(s.perGame.rebounds)}</td><td className="tseason__ctx">{s.totals.reb} total</td></tr>
              <tr><th scope="row">Assists per game</th><td className="tseason__num">{n1(s.perGame.assists)}</td><td className="tseason__ctx">{s.totals.ast} total</td></tr>
              <tr><th scope="row">Field goals</th><td className="tseason__num">{split('fg')}</td><td className="tseason__ctx" /></tr>
              <tr><th scope="row">Three-pointers</th><td className="tseason__num">{split('threes')}</td><td className="tseason__ctx" /></tr>
              <tr><th scope="row">Free throws</th><td className="tseason__num">{split('ft')}</td><td className="tseason__ctx" /></tr>
            </tbody>
          </table>
        )}
      </section>

      {s.games > 0 && (
        <section className="card team-section">
          <span className="game-kicker">Season</span>
          <h2 className="team-section__title">Advanced</h2>
          {minutesNote && <p className="tseason__lead">{minutesNote}</p>}
          <table className="tseason__table">
            <tbody>
              <tr><th scope="row">True shooting</th><td className="tseason__num">{pct(a.trueShootingPct)}</td><td className="tseason__ctx">points per shooting attempt, free throws included</td></tr>
              <tr><th scope="row">Effective FG%</th><td className="tseason__num">{pct(a.effectiveFgPct)}</td><td className="tseason__ctx">a three counts as 1.5 field goals</td></tr>
              <tr><th scope="row">Usage</th><td className="tseason__num">{pct(a.usagePct)}</td><td className="tseason__ctx">share of the team&apos;s possessions used while on the floor</td></tr>
              <tr><th scope="row">Minutes per game</th><td className="tseason__num">{n1(a.minutesPerGame)}</td><td className="tseason__ctx">{a.minutesWithheldGames ? `over ${games(a.minutesGames)}` : ''}</td></tr>
              <tr><th scope="row">Points per {basis}</th><td className="tseason__num">{n1(a.perRate.points)}</td><td className="tseason__ctx">per {basis} minutes played</td></tr>
              <tr><th scope="row">Rebounds per {basis}</th><td className="tseason__num">{n1(a.perRate.rebounds)}</td><td className="tseason__ctx" /></tr>
              <tr><th scope="row">Assists per {basis}</th><td className="tseason__num">{n1(a.perRate.assists)}</td><td className="tseason__ctx" /></tr>
              <tr><th scope="row">Double-doubles</th><td className="tseason__num">{a.doubleDoubles}</td><td className="tseason__ctx">10 or more in two of points, rebounds, assists, steals, blocks</td></tr>
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function GameLog({ v }: { v: PlayerView }) {
  const width = COLS.length + 3;
  return (
    <section className="card team-section">
      <span className="game-kicker">Games</span>
      <h2 className="team-section__title">Game log</h2>
      {v.games.length === 0 ? <p className="tseason__note">No box score lines for {v.player.name}.</p> : (
        <div className="boxscore__scroll">
          <table className="boxscore__table">
            <thead>
              <tr>
                <th scope="col" className="boxscore__name">Date</th>
                <th scope="col" className="boxscore__name">Opponent</th>
                <th scope="col" className="boxscore__name">Result</th>
                {COLS.map((c) => <th scope="col" key={c.key} title={c.title}><abbr title={c.title}>{c.label}</abbr></th>)}
              </tr>
            </thead>
            {v.games.map((g) => {
              const note = describeRow(v, g);
              return (
                <tbody key={g.eventId}>
                  <tr>
                    <th scope="row" className="boxscore__name">{shortDate(g.date)}</th>
                    <td className="boxscore__name">{opponentLabel(g)}</td>
                    <td className="boxscore__name"><Link href={`/games/${g.eventId}`}>{resultLabel(g)}</Link></td>
                    {g.line
                      ? COLS.map((c) => <td key={c.key}>{c.cell(g.line!, v.minutesDisplay)}</td>)
                      : <td colSpan={COLS.length} className="boxscore__name">Did not play</td>}
                  </tr>
                  {note && (
                    <tr className="boxscore__group">
                      <td colSpan={width} className="boxscore__name"><span className="tseason__note">{note}</span></td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
      <p className="tseason__foot">
        Lines are {possessive(v.player.provider)} box scores as stored. A game with no line for {v.player.name} is not listed; the season line above says how many and why.
      </p>
    </section>
  );
}

export default function PlayerPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);
  const [view, setView] = useState<PlayerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) router.replace('/');
  }, [token, router]);

  const load = useCallback(async (t: string) => {
    setLoading(true); setError(null); setNotFound(false);
    try {
      setView(await getPlayer(t, id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load player';
      if (msg.startsWith('404') || msg.startsWith('400')) setNotFound(true); else setError(msg);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (token && allowed) load(token);
  }, [token, allowed, load]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;
  if (loading) return <main className="feed-home team-page"><p className="tseason__note">Loading…</p></main>;
  if (notFound) return <main className="feed-home team-page"><p className="tseason__note">No such player.</p></main>;
  if (error || !view) return <main className="feed-home team-page"><p className="tseason__note">Could not load this player: {error}</p></main>;

  const p = view.player;
  return (
    <main className="feed-home team-page">
      <section className="card team-section">
        <span className="game-kicker">{LEAGUE_LABEL[p.league] ?? p.league}</span>
        <h1 className="team-section__title">{p.name}</h1>
        <p className="tseason__lead">
          {[p.position, LEAGUE_LABEL[p.league] ?? p.league].filter(Boolean).join(' · ')}
          {view.team && <> · <Link href={`/teams/${view.team.id}`}>{view.team.name}</Link></>}
        </p>
        {view.season?.coverage.otherTeams.length ? (
          <p className="tseason__foot">Team shown is the team of the most recent game.</p>
        ) : null}
      </section>
      {view.season ? <SeasonSection v={view} s={view.season} /> : (
        <section className="card team-section">
          <span className="game-kicker">Season</span>
          <p className="tseason__note">{view.seasonNote}</p>
        </section>
      )}
      <GameLog v={view} />
    </main>
  );
}
