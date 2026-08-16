'use client';

// /picks — the fan's points identity: what they're holding, what they've won,
// and every pick they've made. POINTS ONLY: a closed-loop score with no monetary
// value, never bought and never cashed out. Nothing here formats through usd().
//
// Open to every authenticated role (staff can pick too), though only the fan
// roles carry the nav link — see roles.ts.

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { usePoints } from '../points-context';
import { AccessDenied } from '../nav';
import { FanRecordLine, recordFromPicks } from '../fan-card';
import { WaysToEarn } from '../ways-to-earn';
import { canAccess } from '../roles';
import {
  getMyPicks,
  getMyContests,
  getPointsLedger,
  contestCost,
  contestTypeLabel,
  points,
  signedPoints,
  etDateTime,
  MyPick,
  MyPicksReport,
  MyContest,
  ContestStatus,
  PointEvent,
} from '../api';

// ET date + time — a pick is a moment in a game, so the clock matters as much
// as the day.
function formatWhen(iso: string): string {
  return etDateTime(iso) || iso;
}

// The outcome pill's words. 'pending' is the live one and says so — a fan
// scanning this list wants to know what's still in play.
function outcomeLabel(pick: MyPick): string {
  switch (pick.outcome) {
    case 'won':
      return 'Won';
    case 'lost':
      return 'Lost';
    case 'refunded':
      return 'Refunded';
    case 'pending':
      return 'In play';
  }
}

function PickRow({ pick }: { pick: MyPick }) {
  return (
    <li className={`points-row points-row--${pick.outcome}`}>
      <div className="points-row__main">
        {/* A GAME pick links back to the game it was made on — the question only
            means something next to the score.
            A NATIONAL pick has no game to link to (eventId is null by design:
            it's tied to no event we cover), so it renders as plain text and is
            captioned by its context instead. Interpolating the null id into a
            href would have produced a live link to /games/null — TypeScript
            can't catch that, since a template literal stringifies null happily.
            The context label is what a national pick has INSTEAD of a matchup;
            without it the question would sit here with no home at all. */}
        {pick.eventId ? (
          <Link href={`/games/${pick.eventId}`} className="points-row__question">
            {pick.question}
          </Link>
        ) : (
          <span className="points-row__question">{pick.question}</span>
        )}
        <span className="points-row__pick">
          {pick.scope === 'national' && (
            <span className="points-row__ctx">{pick.context ?? 'National'}</span>
          )}
          Your pick: <strong>{pick.pickLabel}</strong>
        </span>
      </div>
      <div className="points-row__side">
        <span className={`pill predict-pill predict-pill--${pick.outcome}`}>
          {outcomeLabel(pick)}
        </span>
        {/* net is what the pick did to the balance: a refund nets 0, and a pick
            still in play reads negative because those points ARE debited now. */}
        <span
          className={`points-row__net points-row__net--${
            pick.net > 0 ? 'up' : pick.net < 0 ? 'down' : 'flat'
          }`}
        >
          {signedPoints(pick.net)}
        </span>
        <span className="points-row__when">{formatWhen(pick.pickedAt)}</span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// MY CONTESTS — the fan's contest entries, with status/score/rank, linking in.
//
// ONE CALL: GET /contests/mine. It used to be 1 + 24 + N — list a bounded page
// of the LOBBY, read all 24 details to find the ones where myEntry was set, then
// read each parlay board again for its ticket tally. That was expensive, and it
// was also quietly incomplete for exactly the fans who'd played most: an entry
// older than the 24-contest scan simply never appeared, with no error and no
// marker. The scan is gone and the horizon with it — this pages over the fan's
// OWN entries, so the only rows missing are the ones past the page below.
//
// THE PARLAY TALLY CAME DOWN WITH IT. `parlay` rides on the row (null on every
// non-parlay type, which is not the same as a zeroed tally), so the second
// fan-out that existed purely to say "3 tickets · 150 staked" is gone too.
// ---------------------------------------------------------------------------

// One page, generous enough that no real fan reaches it (the backend caps at
// 100). Ordered open + live first, then newest — so a fan past this many has
// their live contests at the top and their oldest finals cut, which is the right
// end to lose and is said out loud below rather than being hidden.
const MY_CONTESTS_LIMIT = 50;

function contestStatusLabel(status: ContestStatus): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'locked':
      return 'Locked';
    case 'live':
      return 'Live';
    case 'final':
      return 'Final';
    case 'canceled':
      return 'Canceled';
    case 'draft':
      return 'Draft';
  }
}

function MyContestsSection({ token }: { token: string }) {
  const [entries, setEntries] = useState<MyContest[] | null>(null);
  // What the fan has entered in total, so a page that cuts can say so instead of
  // ending in silence the way the old lobby scan did.
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getMyContests(token, { limit: MY_CONTESTS_LIMIT })
      .then((page) => {
        if (cancelled) return;
        setEntries(page.items);
        setTotal(page.total);
      })
      .catch(() => {
        // Best-effort: the section just doesn't render.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Hide entirely until loaded and only when there's something to show — same
  // rule as the feed bands: a fan who's entered nothing never sees it.
  if (!entries || entries.length === 0) return null;

  return (
    <section className="points-history">
      <h2 className="game-articles__head">My contests</h2>
      <ul className="mycontests-list">
        {entries.map((c) => {
          // Never null on this read — every row IS one of the caller's entries.
          const entry = c.myEntry;
          const score = Math.round(Number(entry.score));
          return (
            <li key={c.id} className="mycontests-row">
              <Link href={`/contests/${c.id}`} className="mycontests-row__main">
                <span className="mycontests-row__title">{c.title}</span>
                <span className="mycontests-row__meta">
                  <span className={`pill contest-pill--${c.status}`}>
                    {contestStatusLabel(c.status)}
                  </span>
                  <span className="mycontests-row__type">
                    {contestTypeLabel(c.type)}
                  </span>
                  {/* THE COST CELL IS OMITTED ON SQUARES AND PARLAY BOARDS, and
                      that is a consequence of the one-call read, stated rather
                      than papered over. Both types enter FREE — the square and
                      the ticket are the buy — so their real price lives in
                      `config` (squareCost, minStake/maxStake), and
                      /contests/mine deliberately doesn't carry config. Rendering
                      contestCost(0) here would print "Free" beside a contest
                      that costs points to play, and squaresPerSquareLabel /
                      parlayStakeRangeLabel fed an empty config would INVENT a
                      figure (the stake range defaults to 25–500). Saying nothing
                      is the only honest option, and it costs least on the one
                      surface where the fan has already paid: a board's own row
                      carries the tickets and points they actually staked, and
                      the contest page has the full terms. */}
                  {c.type !== 'squares' && c.type !== 'parlay_board' && (
                    <span className="mycontests-row__cost">
                      {contestCost(c.entryCost)}
                    </span>
                  )}
                </span>
              </Link>
              <div className="mycontests-row__side">
                {/* Survivor lives or dies rather than accruing a big score, so its
                    standing (Alive/Eliminated off the entry status) is the number
                    that means something — show it alongside the score. */}
                {c.type === 'survivor' && (
                  <span
                    className={`survivor-tag${
                      entry.status === 'eliminated' ? ' survivor-tag--out' : ' survivor-tag--alive'
                    }`}
                  >
                    {entry.status === 'eliminated' ? 'Eliminated' : 'Alive'}
                  </span>
                )}
                {/* A parlay board's score is gross payout WON, which says nothing
                    about how much of the board a fan is actually playing — so the
                    tickets held and the points staked ride alongside it. Off the
                    row itself now; the guard is on `parlay` rather than on the
                    type, because null IS the server's "not a parlay board". */}
                {c.parlay && (
                  <span className="parlay-tag">
                    {c.parlay.myTicketCount}{' '}
                    {c.parlay.myTicketCount === 1 ? 'ticket' : 'tickets'}
                    {c.parlay.staked > 0 && (
                      <span className="parlay-tag__staked">
                        {' '}
                        · {points(c.parlay.staked)} staked
                      </span>
                    )}
                  </span>
                )}
                {entry.rank != null && (
                  <span className="mycontests-row__rank">#{entry.rank}</span>
                )}
                <span className="mycontests-row__score">
                  {points(score)}
                  <span className="mycontests-row__unit">pts</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {/* The cut, said out loud. The old scan lost rows silently; if this page
          ever fills, the fan is told what's below it and where the rest live. */}
      {entries.length < total && (
        <p className="muted">
          Showing your {entries.length} most recent of {total} — older entries are
          in the <Link href="/contests">contest lobby</Link>.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// RECENT ACTIVITY — the immutable points ledger made visible. The last 10 moves
// (action, signed points, when), newest first.
//
// EVERYTHING lands here now, predictions included: the backend writes
// 'prediction_stake' on a pick and 'prediction_payout' on a win (plus the
// 'adjustment' that returns the stake), same as contests, parlays, squares, the
// Arena and the engagement verbs. An older note here said predictions were the
// exception; they aren't, and haven't been since predictions.service.ts started
// writing through PointsLedgerService.
//
// It is still NOT a second pick history, and that distinction is why this
// section and the Pick history below both belong on the page. This is the
// MONEY: what moved, which way, when. The pick list is the CALLS: the question,
// the side taken, what's still live. A fan asking "why is my balance down 400?"
// wants this one; a fan asking "what did I say about the Lions?" wants that one.
// ---------------------------------------------------------------------------

function RecentActivitySection({ token }: { token: string }) {
  const [events, setEvents] = useState<PointEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPointsLedger(token, { limit: 10 })
      .then((page) => {
        if (!cancelled) setEvents(page.items);
      })
      .catch(() => {
        // Best-effort — the section self-hides on failure.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!events || events.length === 0) return null;

  return (
    <section className="points-history">
      <h2 className="game-articles__head">Recent activity</h2>
      <ul className="ledger-list">
        {events.map((e) => (
          <li key={e.id} className="ledger-row">
            {/* Same three lines as /profile's ledger, and deliberately the
                same shape: this is the same row on a second surface, and a fan
                who learned to read one should not have to learn the other. See
                the note there on why a note matching the label is dropped. */}
            <div className="ledger-row__main">
              <span className="ledger-row__action">{e.reason.label}</span>
              {e.reason.detail && (
                <span className="ledger-row__why">{e.reason.detail}</span>
              )}
              {e.note && e.note !== e.reason.label && (
                <span className="ledger-row__note">{e.note}</span>
              )}
            </div>
            <div className="ledger-row__side">
              <span
                className={`ledger-row__pts ledger-row__pts--${
                  e.points > 0 ? 'up' : e.points < 0 ? 'down' : 'flat'
                }`}
              >
                {signedPoints(e.points)}
              </span>
              <span className="ledger-row__when">{formatWhen(e.createdAt)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function MyPicksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const { applyBalance } = usePoints();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [report, setReport] = useState<MyPicksReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await getMyPicks(token);
        if (cancelled) return;
        setReport(data);
        // This read is the freshest wallet there is — push its balance into the
        // shared context so the ⚡ chip can't disagree with the hero right
        // beneath it. (lifetimeEarned only moves on a resolve, which happens
        // courtside, so a fan can land here with a stale chip.)
        applyBalance(data.balance);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load picks');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router, allowed, applyBalance]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const live = report?.picks.filter((p) => p.outcome === 'pending').length ?? 0;

  // Your own W-L-R, so this page answers the record question the fan cards ask
  // everywhere else. Derived from the picks already loaded rather than fetched
  // from /fans/:id/points-summary: that endpoint's record is counted off the
  // same server-derived `outcome` this list carries, so a second round-trip
  // would buy identical numbers at the cost of another request and a second
  // loading state. The shared helper keeps the two derivations one derivation.
  const record = report ? recordFromPicks(report.picks) : null;

  return (
    <main className="feed-home">
      <div className="masthead masthead--compact masthead-head">
        <div>
          <span className="masthead-kicker">Points</span>
          <h1 className="masthead-title">My picks</h1>
          {/* "Pick with points, climb the leaderboard" is gone — how-it-works
              for a fan who is reading their own pick history and has therefore
              worked it out. The no-cash-value line stays: see the note on
              /contests for why it is on five surfaces on purpose. */}
          <p className="masthead-standfirst">
            Points have no cash value — they can&apos;t be bought, redeemed, or
            cashed out.
          </p>
          {/* The same line, from the same numbers, that everyone else sees on
              your fan card. Only once something has resolved: a fan whose first
              pick is still live has a record of "nothing yet", and 0-0-0 at a
              "—" win rate says that worse than saying nothing. */}
          {record && record.totalResolved > 0 && (
            <FanRecordLine record={record} />
          )}
        </div>
        <div className="masthead-actions">
          <Link href="/leaderboard" className="link-btn">
            Leaderboard →
          </Link>
        </div>
      </div>

      {loading && <div className="card muted">Loading your picks…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && report && (
        <>
          {/* ---- The hero: balance leads, lifetime is the brag ---- */}
          <div className="points-hero">
            <div className="points-hero__stat">
              <span className="points-hero__label">Balance</span>
              <span className="points-hero__value">
                {points(report.balance)}
                <span className="points-hero__unit">pts</span>
              </span>
              {live > 0 && (
                <span className="points-hero__caption">
                  {live === 1 ? '1 pick' : `${live} picks`} still in play
                </span>
              )}
            </div>
            {/* The quieter treatment rides on the VALUE, not the stat wrapper —
                the label and caption are identical to the balance's. */}
            <div className="points-hero__stat">
              <span className="points-hero__label">Lifetime earned</span>
              <span className="points-hero__value points-hero__value--minor">
                {points(report.lifetimeEarned)}
                <span className="points-hero__unit">pts</span>
              </span>
              <span className="points-hero__caption">
                Everything you&apos;ve earned — losses don&apos;t subtract.
              </span>
            </div>
          </div>

          {/* My contests + the points ledger. Both self-fetch and self-hide
              (nothing entered / no ledger rows -> the section doesn't render),
              so a fan who only makes predictions sees the page unchanged. */}
          <MyContestsSection token={token} />
          {/* Ways to earn sits directly ABOVE Recent activity, which is the
              honest reading order: here's how points arrive, and here's the
              record of them arriving. Self-fetches and self-hides like its
              neighbours. */}
          <WaysToEarn token={token} roles={user?.roles ?? []} />
          <RecentActivitySection token={token} />

          <section className="points-history">
            <h2 className="game-articles__head">Pick history</h2>
            {report.picks.length > 0 ? (
              <ul className="points-list">
                {report.picks.map((p) => (
                  <PickRow key={p.pickId} pick={p} />
                ))}
              </ul>
            ) : (
              <div className="results-empty">
                <p className="results-empty__title">No picks yet</p>
                <p className="results-empty__hint">
                  Open a live game and call it — every fan starts with{' '}
                  {points(report.balance)} points. Browse what&apos;s on over on{' '}
                  <Link href="/games">Games</Link>.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
