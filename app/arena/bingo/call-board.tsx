'use client';

// ============================================================================
// THE BOARD — all seventy-five numbers, and which of them are gone.
//
// THE HALL BOARD, ROTATED, AND THE ROTATION IS WHY IT FITS A PHONE. A bingo hall
// hangs its board wide: fifteen numbers across, five rows deep. Fifteen columns
// at 390px is ~19px a cell, which is unreadable and untappable. So the board
// turns ninety degrees — five COLUMNS (B I N G O), fifteen rows each — and lands
// on the same five tracks the card above it uses. Same widths, same letters,
// directly below, so the two objects rhyme and "the O column is filling up" is
// legible without reading a single number.
//
// FLAT CELLS, ON PURPOSE. The card's squares are 1:1 and ~58px; these are the
// same width but half the height and carry no aspect-ratio. A board drawn at the
// card's weight would be a second, larger grid competing with the object that
// has to dominate the screen — the fan's own card. Flat cells read as a list,
// which is what a reference table should read as.
//
// IT IS A LOOKUP, NOT THE HEARTBEAT, WHICH IS WHY IT SITS LAST. "Has 47 gone?"
// is the only question it answers; "what just happened" and "how far through are
// we" are both the caller's job, up at the top. Two objects, two jobs, and
// neither duplicates the other.
//
// THE UNCALLED NUMBERS ARE NOT A SECRET AND SHOWING THEM LEAKS NOTHING. What
// would be a secret is the ORDER they are coming in, and that lives in
// bingo_night_draw_order, is read by the draw job alone, and is not reachable
// from any fan payload — GET today reads the bingo_draws_called VIEW, which
// cannot return an unrevealed slot. This board renders the complement of public
// information, which is itself public information.
// ============================================================================

import { BingoBall, BINGO_COLUMNS } from '../../api';

// 15 rows x 5 columns. Built column-major (B holds 1-15, I holds 16-30, ...) then
// read out row-major, because CSS grid fills across and the columns have to line
// up under their letters.
const ROWS = 15;

export function CallBoard({ balls }: { balls: BingoBall[] }) {
  const called = new Set(balls.map((b) => b.number));

  const cells: number[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < BINGO_COLUMNS.length; col += 1) {
      cells.push(col * ROWS + row + 1);
    }
  }

  return (
    <section className="bingo-board" aria-label="The board">
      <h2 className="bingo-board__title">The board</h2>
      <p className="bingo-board__sub">
        {called.size} of 75 numbers gone.
      </p>

      <div className="bingo-board__grid" role="img"
        aria-label={`${called.size} of 75 numbers called`}>
        {BINGO_COLUMNS.map((letter) => (
          <span key={letter} className="bingo-board__head" aria-hidden="true">
            {letter}
          </span>
        ))}
        {cells.map((n) => (
          <span
            key={n}
            className={`bingo-board__cell${
              called.has(n) ? ' bingo-board__cell--gone' : ''
            }`}
            aria-hidden="true"
          >
            {n}
          </span>
        ))}
      </div>
    </section>
  );
}
