// ============================================================================
// THE BASKETBALL BOX SCORE -- one table per team, from the stored provider lines
// (GET /events/:id/box-score). Basketball only; other sports have other shapes.
//
// TEAM TOTALS ARE THE TEAM ROW, NEVER A SUM OF THE PLAYERS ABOVE THEM. Where the
// team row has team rebounds, credited to no player, its total is larger than the
// column above it, and a fan adding the column would otherwise find a "bug". So that
// side gets a sentence giving the number -- gated on the FACT for that side, not the
// league: college rows usually carry team rebounds, NBA rows measured carry none.
// Percentages are the team row's made / attempted.
//
// MINUTES ARE SHOWN THE LEAGUE'S WAY, as the API says (minutesDisplay): whole minutes
// in college, MM:SS in the NBA, where truncated minutes would not add up to 240. With
// MM:SS the team row's 240:00 is exact, so it is shown; whole-minute team rows stay
// blank (a 201 says nothing a reader can use).
//
// COVERAGE COMES FROM THE API, never inferred from an empty array:
//   'full'             -- both teams' player lines; one table each, away first.
//   'partial'          -- one team's. The published side renders normally; the
//                         other is ONE sentence naming the team and the provider,
//                         then that team's totals row. A third of stored games:
//                         buy games, where SportsDataIO has no roster for the
//                         small-school visitor. The data will never arrive.
//   'team-totals-only' -- neither. One sentence for both, then both totals.
// A stated absence reads as the provider's gap; a blank panel reads as our bug.
// So: no empty table, no spinner, no zero-filled roster, no "data unavailable".
//
// OTHER STATES THAT MUST NOT LOOK LIKE BUGS:
//   * totalsPublished false: for some non-D1 opponents the team row is the score
//     and nothing else (Grace, twice). A row with no shots is not a team that
//     took no shots, so NO TABLE -- one sentence, no "0-0" under it. The score
//     is already on the scoreboard above.
//   * did not play: stats are NULL, not zero. Those players are named in a line
//     under the table, apart from players who played and scored nothing (0 in
//     the PTS column).
//   * no starter flag in college basketball (started is null), so no starters/bench
//     split there; the NBA has one, so its table splits. The API orders players by
//     minutes, most first.
//   * minutesReconciled false: the provider's player minutes for this side do not
//     add up, so the API sends them null, MIN shows a dash, and the API orders that
//     side by points. One sentence says whose number it is, what it is, and what is
//     not shown. minutesSum 0 is the provider publishing none.
//
// NO BOX SCORE, NO SECTION: a refused game, one not fetched yet, and every
// other sport render nothing -- not a heading over an empty shell.
// ============================================================================

import { ProviderBoxScore, ProviderBoxSide, ProviderBoxStats } from './api';

const pct = (made: number, att: number) => (att > 0 ? `${((made / att) * 100).toFixed(1)}%` : '—');
const ma = (made: number, att: number) => `${made}-${att}`;

// The columns, in reading order. Player and the totals row share them.
type MinutesDisplay = ProviderBoxScore['minutesDisplay'];
const minutesCell = (s: ProviderBoxStats, display: MinutesDisplay): string | number =>
  s.minutes === null ? '—'
    : display === 'clock' && s.seconds !== null ? `${s.minutes}:${String(s.seconds).padStart(2, '0')}`
    : s.minutes;

const COLS: { key: string; label: string; title: string; cell: (s: ProviderBoxStats, display: MinutesDisplay) => string | number }[] = [
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

function minutesNote(side: ProviderBoxSide, provider: string): string | null {
  if (side.minutesReconciled !== false) return null;
  return side.minutesSum === 0
    ? `${provider} published no minutes for ${side.teamName} in this game.`
    : `${provider}'s player minutes for ${side.teamName} add up to ${side.minutesSum}, not ${side.minutesExpected}, so minutes are not shown and players are ordered by points.`;
}

// note: the sentence above this side's table, or null. The section decides it,
// because in 'team-totals-only' one sentence covers both teams.
function SideTable({ side, provider, note, display }: { side: ProviderBoxSide; provider: string; note: string | null; display: MinutesDisplay }) {
  const team = side.teamName;
  const played = side.players.filter((p) => p.played && p.stats);
  const dnp = side.players.filter((p) => !p.played);
  const t = side.teamTotals;
  const minutes = minutesNote(side, provider);
  // Team rebounds: the team row's total minus what its players are credited with.
  const teamRebounds = side.playersPublished ? t.reb - played.reduce((a, p) => a + p.stats!.reb, 0) : 0;
  // The split comes from the data: a league with no flag has no group rows at all.
  const split = played.some((p) => p.started !== null);
  const groups: { label: string | null; rows: typeof played }[] = split
    ? [{ label: 'Starters', rows: played.filter((p) => p.started) }, { label: 'Bench', rows: played.filter((p) => !p.started) }]
    : [{ label: null, rows: played }];
  if (!side.totalsPublished) {
    return (
      <div className="boxscore__side">
        <h3 className="boxscore__team">{team}</h3>
        <p className="boxscore__unpublished">{provider} published no player lines and no team totals for {team} in this game.</p>
      </div>
    );
  }
  return (
    <div className="boxscore__side">
      <h3 className="boxscore__team">{team}</h3>
      {note && <p className="boxscore__unpublished">{note}</p>}
      {minutes && <p className="boxscore__unpublished">{minutes}</p>}
      <div className="boxscore__scroll">
        <table className="boxscore__table">
          <thead>
            <tr>
              <th scope="col" className="boxscore__name">{side.playersPublished ? 'Player' : <span className="sr-only">Team</span>}</th>
              {COLS.map((c) => (
                <th scope="col" key={c.key} title={c.title}>
                  <abbr title={c.title}>{c.label}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          {groups.filter((g) => g.rows.length > 0).map((g) => (
            <tbody key={g.label ?? 'players'}>
              {g.label && (
                <tr className="boxscore__group">
                  <th scope="rowgroup" colSpan={COLS.length + 1} className="boxscore__name">{g.label}</th>
                </tr>
              )}
              {g.rows.map((p, i) => (
                <tr key={`${p.name}-${i}`}>
                  <th scope="row" className="boxscore__name">
                    {p.name}
                    {p.position && <span className="boxscore__pos">{p.position}</span>}
                  </th>
                  {COLS.map((c) => (
                    <td key={c.key}>{c.cell(p.stats!, display)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
          <tfoot>
            <tr className="boxscore__totals">
              <th scope="row" className="boxscore__name">Team totals</th>
              {/* Whole-minute MIN is blank on the team row: the API sends null on an
                  unpublished side and the player sum (201 when rounding is off by one)
                  elsewhere, which says nothing. MM:SS adds up exactly, so it shows. */}
              {COLS.map((c) => (
                <td key={c.key}>{c.key === 'min' && display !== 'clock' ? '' : c.cell(t, display)}</td>
              ))}
            </tr>
            <tr className="boxscore__pcts">
              <th scope="row" className="boxscore__name">
                <span className="sr-only">Shooting percentages</span>
              </th>
              {COLS.map((c) => (
                <td key={c.key}>
                  {c.key === 'fg' ? pct(t.fgm, t.fga) : c.key === '3pt' ? pct(t.tpm, t.tpa) : c.key === 'ft' ? pct(t.ftm, t.fta) : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {teamRebounds > 0 && (
        <p className="boxscore__foot">
          {team}&apos;s rebound total includes {teamRebounds} team rebound{teamRebounds === 1 ? '' : 's'}, credited to no
          player, so it is larger than the column above it.
        </p>
      )}
      {dnp.length > 0 && (
        <p className="boxscore__dnp">
          <span className="boxscore__dnplabel">Did not play:</span> {dnp.map((p) => p.name).join(', ')}
        </p>
      )}
    </div>
  );
}

export function BoxScoreSection({ box }: { box: ProviderBoxScore | null }) {
  if (!box) return null;
  const [away, home] = box.sides;
  const p = box.provider;
  // A side whose totals are unpublished carries its own sentence (SideTable), so
  // a covering sentence never promises totals "below" that are not there.
  const withTotals = box.sides.filter((s) => s.totalsPublished).map((s) => s.teamName);
  const bothNote = box.coverage === 'team-totals-only'
    ? `${p} published no player lines for either team in this game, ${away.teamName} or ${home.teamName}.`
      + (withTotals.length === 2 ? ' Team totals are below.' : withTotals.length === 1 ? ` ${withTotals[0]}'s team totals are below.` : '')
    : null;
  const noteFor = (s: typeof away): string | null =>
    box.coverage === 'partial' && !s.playersPublished
      ? `${p} published no player lines for ${s.teamName} in this game. Team totals are below.`
      : null;
  return (
    <section className="boxscore" aria-labelledby="boxscore-title">
      <h2 id="boxscore-title" className="periods__title">Box score</h2>
      {bothNote && <p className="boxscore__unpublished">{bothNote}</p>}
      {/* Away first, the order of the scoreboard and the period table above. */}
      <SideTable side={away} provider={p} note={noteFor(away)} display={box.minutesDisplay} />
      <SideTable side={home} provider={p} note={noteFor(home)} display={box.minutesDisplay} />
      {box.coverage !== 'team-totals-only' && (
        <p className="boxscore__foot">
          Team totals are the team&apos;s own line from the provider, not the players added up.
        </p>
      )}
    </section>
  );
}
