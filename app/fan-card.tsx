'use client';

// The fan card: the public record behind a leaderboard name. Opens as a
// slide-over from any row on /leaderboard (both scopes) and from the pinned
// "your rank" row.
//
// PUBLIC means public. This card shows STATS — rank, lifetime earned, W-L-R,
// win rate — and deliberately shows neither of these:
//
//   • The spendable balance. It's the one number that feels private, so it
//     stays on /picks behind the caller's own token. The backend won't send it
//     here at all (it sends `balanceHidden: true` instead, so the omission
//     reads as a decision rather than a gap). Don't fetch it from getMyPicks()
//     to fill the space.
//   • The pick log. Pick-by-pick history is caller-only, on /picks. This card
//     is counts, never rows — including on your OWN card, which links to /picks
//     rather than inlining the history, so one component can serve both without
//     ever having a "but only if it's you" branch around real data.
//
// Everything on screen here is already visible on the board, or is an aggregate
// of it. That's the test for anything added later.
//
// ONE CARD, TWO BOARDS. /leaderboard now serves two global measurements —
// "Most earned" (lifetime_earned, engagement included) and "Most won"
// (winnings only). The card must show the pair belonging to the board the name
// was clicked from, which is what the required `board` prop selects: earned →
// globalRank + lifetimeEarned, won → skillRank + lifetimeWon. The prop has no
// default on purpose. A fan sitting at #3 for winnings and #47 for earned is
// ordinary, so a card that quietly picked one would be wrong half the time
// without ever looking wrong.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from './auth-context';
import { SlideOver } from './queue-table';
import {
  getFanPointsSummary,
  points,
  etDateTime,
  FanPointsSummary,
  MyPick,
} from './api';

// The record as the UI needs it. Mirrors FanPointsSummary['record'] plus the
// rate, so the card (which reads it from the API) and the /picks masthead
// (which derives it from picks already in hand) can render through one path.
export interface FanRecord {
  won: number;
  lost: number;
  refunded: number;
  totalResolved: number;
  winRate: number | null;
}

// Derives the same record the summary endpoint returns, from a pick list the
// caller already has. /picks uses this instead of a second network round-trip
// for numbers it's already holding.
//
// This agrees with the backend by construction rather than by coincidence: both
// sides count the SAME server-derived `outcome` field, so neither re-implements
// the won/lost/refunded rule. In particular 'pending' falls through all three
// counters here exactly as it does in the SQL — an open pick is not a result.
export function recordFromPicks(picks: MyPick[]): FanRecord {
  const won = picks.filter((p) => p.outcome === 'won').length;
  const lost = picks.filter((p) => p.outcome === 'lost').length;
  const refunded = picks.filter((p) => p.outcome === 'refunded').length;
  // Refunds are excluded from the denominator to match the backend: a void has
  // no outcome, so a question staff pulled must never dent a fan's win rate.
  const totalResolved = won + lost;
  return {
    won,
    lost,
    refunded,
    totalResolved,
    winRate: totalResolved === 0 ? null : won / totalResolved,
  };
}

// A rate of null is "nothing has resolved yet" — unknown, not 0%. Rendering it
// as "0%" would call a fan with three live picks a loser.
export function formatWinRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

// Month + year only: "Playing since March 2026". The exact day is noise on a
// card whose job is "how long has this one been around".
function formatSince(iso: string | null): string | null {
  return etDateTime(iso, { month: 'long', year: 'numeric' }) || null;
}

// Matches the board's podium treatment so a name carries the same medal on the
// card that it wears on the row it was clicked from.
function rankMedal(rank: number): string | null {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return null;
}

// The W-L-R row. Shared by the card and the /picks masthead so a fan's own
// record reads identically in both places.
export function FanRecordLine({ record }: { record: FanRecord }) {
  return (
    <div className="fancard-record">
      <span className="fancard-record__cell fancard-record__cell--won">
        <span className="fancard-record__num">{record.won}</span>
        <span className="fancard-record__key">W</span>
      </span>
      <span className="fancard-record__cell fancard-record__cell--lost">
        <span className="fancard-record__num">{record.lost}</span>
        <span className="fancard-record__key">L</span>
      </span>
      {/* Refunds are shown but sit outside the win rate — a voided question is
          not a result the fan earned or blew. */}
      <span className="fancard-record__cell fancard-record__cell--refunded">
        <span className="fancard-record__num">{record.refunded}</span>
        <span className="fancard-record__key">R</span>
      </span>
      <span className="fancard-record__rate">
        <span className="fancard-record__num">{formatWinRate(record.winRate)}</span>
        <span className="fancard-record__key">win rate</span>
      </span>
    </div>
  );
}

export function FanCard({
  userId,
  // The name off the row that was clicked. Shows immediately, so the card has a
  // title while the summary is still in flight and keeps one if it 404s.
  fallbackName,
  isMe,
  board,
  onClose,
}: {
  userId: string;
  fallbackName: string | null;
  isMe: boolean;
  // Which board this card was opened from — see the note at the top of the
  // file. Required, so every call site has to answer it.
  board: 'earned' | 'won';
  onClose: () => void;
}) {
  const { token } = useAuth();
  const [summary, setSummary] = useState<FanPointsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // null summary is ambiguous on its own (not loaded yet vs. genuinely no
  // record), so track the 404 explicitly rather than inferring it.
  const [noRecord, setNoRecord] = useState(false);

  useEffect(() => {
    // The card only ever mounts from an authed page, so a missing token means
    // the session just went away underneath it -- that page's own guard does
    // the redirecting; this just declines to fetch.
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNoRecord(false);
    (async () => {
      try {
        const data = await getFanPointsSummary(token, userId);
        if (cancelled) return;
        // null = 404 = this fan has never picked. A real state, not an error:
        // the wallet row is only ever created BY a pick.
        if (data === null) setNoRecord(true);
        else setSummary(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load fan');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, userId]);

  const since = formatSince(summary?.firstPickAt ?? null);
  // The hero pair, chosen by the board this card was opened from. On the
  // winnings board both are null for a fan who has never won — that's "off the
  // board", so it reads as such rather than as rank 0 with 0 points.
  const onWon = board === 'won';
  const rank = summary ? (onWon ? summary.skillRank : summary.globalRank) : null;
  const total = summary
    ? onWon
      ? summary.lifetimeWon
      : summary.lifetimeEarned
    : null;
  const medal = rank === null ? null : rankMedal(rank);

  return (
    <SlideOver
      onClose={onClose}
      kicker={isMe ? 'Your card' : 'Fan card'}
      title={summary?.displayName ?? fallbackName ?? 'Fan'}
      label="Fan points card"
      footer={
        // Only your own card offers the pick log, because only your own pick
        // log is yours to read. On someone else's card there is no such link to
        // hide — /picks is the caller's own history either way.
        isMe ? (
          <Link href="/picks" className="link-btn" onClick={onClose}>
            See my full history →
          </Link>
        ) : undefined
      }
    >
      {loading && <div className="card muted">Loading…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && noRecord && (
        <div className="results-empty">
          <p className="results-empty__title">No record yet</p>
          <p className="results-empty__hint">
            {isMe
              ? "You haven't made a pick yet — open a live game and call it."
              : `${fallbackName ?? 'This fan'} hasn't made a pick yet.`}
          </p>
        </div>
      )}

      {!loading && !error && summary && (
        <div className="fancard">
          {/* The two hero numbers: where they stand, and what got them there.
              Rank leads — it's the thing the board just showed them. */}
          <div className="fancard-hero">
            <div className="fancard-hero__stat">
              <span className="fancard-hero__label">
                {onWon ? 'Skill rank' : 'Global rank'}
              </span>
              {rank === null ? (
                <span className="fancard-hero__value fancard-hero__value--none">
                  No wins yet
                </span>
              ) : (
                <span className="fancard-hero__value">
                  {medal && <span className="fancard-hero__medal">{medal}</span>}
                  #{rank}
                </span>
              )}
            </div>
            <div className="fancard-hero__stat">
              <span className="fancard-hero__label">
                {onWon ? 'Lifetime won' : 'Lifetime earned'}
              </span>
              {total === null ? (
                <span className="fancard-hero__value fancard-hero__value--none">
                  —
                </span>
              ) : (
                <span className="fancard-hero__value">
                  {points(total)}
                  <span className="fancard-hero__unit">pts</span>
                </span>
              )}
            </div>
          </div>

          {/* Predictions only — see the P6 note on FanPointsSummary.record. On
              the winnings board this can look thin beside a large lifetimeWon,
              because Arena, contest and parlay wins aren't counted in it. */}
          <FanRecordLine
            record={{ ...summary.record, winRate: summary.winRate }}
          />

          {since && <p className="fancard-since">Playing since {since}</p>}
        </div>
      )}
    </SlideOver>
  );
}
