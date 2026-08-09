'use client';

// ============================================================================
// THE STREAK CHIP — one game's streak, its win streak, and its banked freezes,
// as a single pill. Lifted out of /arena when the profile page needed the same
// row: the Arena hub's strip and the profile's Arena section must not be able
// to disagree about what a streak looks like, and the freeze cap in particular
// is a number that has to match the backend in exactly one place.
//
// PER-GAME, NOT SUMMED. The backend keeps one streak row per (user, game) and a
// combined "🔥 7" would be a number that exists nowhere and that no game would
// ever agree with. Two chips that each say which game they belong to is both
// honest and better copy: "🔥 4 Oracle · 🔥 2 Trail" is a fan with two habits.
//
// FREEZES RIDE ON THEIR OWN GAME'S CHIP for the same reason — a freeze earned on
// the Trail cannot save an Oracle streak.
//
// IT SELF-HIDES on a game the fan has never touched, rather than rendering a
// chip full of zeroes. Both callers rely on that: it's how each decides whether
// it has anything true to say at all.
// ============================================================================

import { ArenaStreaks } from './api';

// The freeze cap, mirroring MAX_FREEZES in arena-streak.service.ts. Only used to
// draw the empty ❄️ slot — the earned count always comes from the server.
export const MAX_FREEZES = 2;

export function StreakChip({
  game,
  icon,
  streaks,
}: {
  game: string;
  icon: string;
  streaks: ArenaStreaks;
}) {
  // "Where active" — a game the fan has never touched contributes nothing to
  // the row rather than a chip full of zeroes.
  const active =
    streaks.playStreak > 0 || streaks.winStreak > 0 || streaks.freezes > 0;
  if (!active) return null;

  return (
    <span className="arena-chip">
      <span className="arena-chip__game">
        <span aria-hidden="true">{icon}</span> {game}
      </span>
      {streaks.playStreak > 0 && (
        <span className="arena-chip__stat" title={`${game} play streak`}>
          <span aria-hidden="true">🔥</span> {streaks.playStreak}
        </span>
      )}
      {streaks.winStreak > 0 && (
        <span className="arena-chip__stat" title={`${game} win streak`}>
          <span aria-hidden="true">🎯</span> {streaks.winStreak}
        </span>
      )}
      <span
        className="arena-chip__freezes"
        title={`${streaks.freezes} of ${MAX_FREEZES} freezes banked on ${game}`}
      >
        {Array.from({ length: MAX_FREEZES }, (_, i) => (
          <span
            key={i}
            className={`arena-freeze${
              i < streaks.freezes ? ' arena-freeze--on' : ''
            }`}
            aria-hidden="true"
          >
            ❄️
          </span>
        ))}
        <span className="sr-only">
          {streaks.freezes} of {MAX_FREEZES} freezes
        </span>
      </span>
    </span>
  );
}

// Is there anything true to say about this fan's streaks? Shared so the hub's
// strip and the profile's Arena section agree about the empty case — a fan who
// has played nothing gets an invitation, never a row of zeroes.
export function anyStreakActive(streaks: Array<ArenaStreaks | undefined | null>): boolean {
  return streaks.some(
    (s) => s && (s.playStreak > 0 || s.winStreak > 0 || s.freezes > 0),
  );
}
