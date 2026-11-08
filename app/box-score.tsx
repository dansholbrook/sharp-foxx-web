// ============================================================================
// THE BASKETBALL BOX SCORE -- one table per team, from the stored provider lines
// (GET /events/:id/box-score). Basketball only; other sports have other shapes.
//
// TEAM TOTALS ARE THE TEAM ROW, NEVER A SUM OF THE PLAYERS ABOVE THEM. Team
// rebounds are credited to no player, so the printed rebound total is larger
// than the column above it -- by design, and the footnote says so, because a
// fan adding the column up would otherwise find a "bug". Percentages are the
// team row's made / attempted.
//
// THREE STATES THAT MUST NOT LOOK LIKE BUGS:
//   * playersPublished false: the provider publishes a non-D1 opponent's team
//     totals and no players. One sentence says so; the totals row still shows,
//     because it is real. Never an empty player table.
//   * did not play: stats are NULL, not zero. Those players are named in a line
//     under the table, apart from players who played and scored nothing (0 in
//     the PTS column).
//   * no starter flag in college basketball, so no starters/bench split. The API
//     orders players by minutes, most first.
//
// NO BOX SCORE, NO SECTION: a refused game, one not fetched yet, and every
// other sport render nothing -- not a heading over an empty shell.
// ============================================================================

import { ProviderBoxScore, ProviderBoxSide, ProviderBoxStats } from './api';

const pct = (made: number, att: number) => (att > 0 ? `${((made / att) * 100).toFixed(1)}%` : '—');
const ma = (made: number, att: number) => `${made}-${att}`;

// The columns, in reading order. Player and the totals row share them.
const COLS: { key: string; label: string; title: string; cell: (s: ProviderBoxStats) => string | number }[] = [
  { key: 'min', label: 'MIN', title: 'Minutes', cell: (s) => s.minutes ?? '—' },
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

function SideTable({ side, team }: { side: ProviderBoxSide; team: string }) {
  const played = side.players.filter((p) => p.played && p.stats);
  const dnp = side.players.filter((p) => !p.played);
  const t = side.totals;
  return (
    <div className="boxscore__side">
      <h3 className="boxscore__team">{team}</h3>
      {!side.playersPublished && (
        <p className="boxscore__unpublished">Player stats not published for {team}. Team totals only.</p>
      )}
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
          <tbody>
            {played.map((p, i) => (
              <tr key={`${p.name}-${i}`}>
                <th scope="row" className="boxscore__name">
                  {p.name}
                  {p.position && <span className="boxscore__pos">{p.position}</span>}
                </th>
                {COLS.map((c) => (
                  <td key={c.key}>{c.cell(p.stats!)}</td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="boxscore__totals">
              <th scope="row" className="boxscore__name">Team totals</th>
              {/* MIN is blank on the team row: the provider's team minutes are 0
                  on an unpublished side and the player sum (201 when rounding is
                  off by one) elsewhere -- both read as errors and neither says
                  anything. Drift is recorded as minutes_delta, not shown here. */}
              {COLS.map((c) => (
                <td key={c.key}>{c.key === 'min' ? '' : c.cell(t)}</td>
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
      {dnp.length > 0 && (
        <p className="boxscore__dnp">
          <span className="boxscore__dnplabel">Did not play:</span> {dnp.map((p) => p.name).join(', ')}
        </p>
      )}
    </div>
  );
}

export function BoxScoreSection({ box, away, home }: { box: ProviderBoxScore | null; away: string; home: string }) {
  if (!box) return null;
  const anyPublished = box.away.playersPublished || box.home.playersPublished;
  return (
    <section className="boxscore" aria-labelledby="boxscore-title">
      <h2 id="boxscore-title" className="periods__title">Box score</h2>
      {/* Away first, the order of the scoreboard and the period table above. */}
      <SideTable side={box.away} team={away} />
      <SideTable side={box.home} team={home} />
      {anyPublished && (
        <p className="boxscore__foot">
          Team totals are the team&apos;s own line from the provider, not the players added up. Rebounds
          include team rebounds, which no player is credited with, so the total can exceed the column above it.
        </p>
      )}
    </section>
  );
}
