'use client';

// ============================================================================
// /arena/bingo — SPORTS BINGO. The fourth built Arena game, and the first whose
// outcome is DRAWN rather than earned.
//
// 5x5, numbers 1-75, free centre, columns ranged B 1-15 / I 16-30 / N 31-45 /
// G 46-60 / O 61-75. Fifty-six numbers a night, four at a time every twenty
// minutes from 7pm ET, each called off something real from tonight's slate.
//
// ----------------------------------------------------------------------------
// MOBILE IS THE CONSTRAINT, NOT THE FOLLOW-UP. A 5x5 grid plus a call board is
// the hardest layout on this platform to fit on a phone, and it is the one
// surface where retrofitting would have meant rebuilding. Every block here was
// designed at 390px and the desktop rules are the adaptation: the base CSS is
// the phone, and the single breakpoint stops the squares growing into slabs.
// ----------------------------------------------------------------------------
//
// FOUR STATES, AND THE MIDDLE ONE IS WHERE FANS LIVE:
//
//   VOIDED   The night could not be run at all. Checked FIRST, because a voided
//            night also has zero balls and would otherwise read as the lobby.
//   LOBBY    Before the first ball. Terms, empty cards, and the ONLY purchase
//            control in the build.
//   DRAWING  The balls in the air. The caller leads, cards daub, the near-miss
//            rail appears, the board fills, the poll runs.
//   SETTLED  The cards are souvenirs. Awards only — see the rail.
//
// THE LOBBY/DRAWING SPLIT IS `night.called === 0`, NOT `status === 'open'`, and
// that is deliberate — see the rule-2 block below.
//
// ============================================================================
// !!  THE TWO RULES. Read drizzle/arena_bingo.sql for the full argument.
//
//   1. PAID CARDS CLOSE WHEN THE FIRST BALL IS CALLED. Enforced on the backend
//      by bingo_nights.purchase_closes_at and surfaced as claim.canPurchase.
//      There is no purchase route on this page outside the lobby.
//
//   2. THE NEAR-MISS IS NEVER PLACED BESIDE A PURCHASE CONTROL. The whole
//      near-miss surface — patterns[].needed, the chips, the blackout ring — is
//      gated on `night.called > 0` and lives in <BingoCard showRail>. The buy
//      button is gated on `claim.canPurchase` and lives in <Lobby>, a different
//      file reached by a different branch.
//
//      THOSE ARE TWO DIFFERENT FIELDS ON PURPOSE. The backend already proves
//      they cannot both be true (today() derives them from one clock read, and
//      proof-bingo.ts section 7 asserts the pairing ball by ball), so gating the
//      rail on `!canPurchase` would have been correct today. It would also have
//      made this layout depend on rule 1 continuing to hold. `called > 0` is a
//      stricter, independent condition, so rule 2 survives anyone who later
//      reopens sales mid-night — a change the schema warns "will arrive looking
//      like a revenue improvement".
// ============================================================================
//
// ============================================================================
// THE POLL SCHEDULES AGAINST nextCallAt. IT DOES NOT USE LIVE_POLL_MS, AND THAT
// IS NOT AN OVERSIGHT — PLEASE DO NOT "FIX" IT INTO CONSISTENCY.
//
// Every other live surface on this site (the Oracle, the Trail, all four contest
// boards) polls a flat 30s while its data can move, because its data can move at
// ANY moment: a crowd picks continuously, a score changes when it changes.
//
// Bingo's data cannot. It moves on a twenty-minute boundary, and — uniquely on
// this platform — the payload PUBLISHES THAT BOUNDARY: night.nextCallAt is the
// draws_at of the next unfilled slot. A flat 30s here is ~40 reads per tick, 39
// of which return a byte-identical payload. That is not caution, it is noise.
//
// So: sleep until nextCallAt (plus a small skew), then poll at CATCH_UP_MS until
// the ball actually lands, then sleep again. Two or three reads a tick, and the
// fan sees the numbers within seconds of the cron.
//
// THE CATCH-UP WINDOW IS NOT PADDING. draws_at (intended) and drawn_at (actual)
// are separate columns precisely because the job can run late — max(drawn_at -
// draws_at) is the platform's own cron-health tell — so "due but not yet filled"
// is a NORMAL reading, not an error one.
//
// AND THE DEGRADED CASE IS THE PLATFORM DEFAULT, which is the property that
// makes this safe to own: if nextCallAt is null, or the ball is more than
// CATCH_UP_WINDOW_MS overdue (a dead draw job), the delay falls back to
// FALLBACK_POLL_MS — the same 30s every other surface uses. The deviation is an
// optimisation on the happy path, and the floor underneath it is what the rest
// of the site does anyway.
//
// The poll STOPS entirely on settled and voided. Neither can change again.
// ============================================================================
//
// NO EARN TOAST, and nothing here calls applyBalance. Awards are paid inside the
// DRAW transaction, which this client never observes; a purchase debits inside
// the claim transaction and returns no balance on the wire. The ⚡ chip repairs
// on the next wallet read. Same refusal the Oracle makes for the same reason:
// a toast would promise money at a moment the money was not decided.
//
// NO STREAK BLOCK, and none is drawn. The migration declines arena_streaks
// participation outright (there is no pick transaction to hang recordPlay off,
// and ticket N3 is unresolved) — BingoToday carries no streak field at all, so
// this is enforced by the type rather than by anyone remembering. Bingo
// contributes nothing to the Arena strip, exactly like the Call.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../../auth-context';
import { useAgeGate } from '../../age-gate';
import { AppNav, AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import { BingoCard } from './bingo-card';
import { CallBoard } from './call-board';
import { Caller } from './caller';
import { Lobby } from './lobby';
import {
  claimBingoCard,
  getBingoToday,
  points,
  BingoNight,
  BingoToday,
} from '../../api';

// The catch-up cadence, used only while a ball is due and has not landed.
const CATCH_UP_MS = 15_000;

// How long past due before we stop expecting this tick and back off. Roughly two
// and a half minutes: long enough to cover a cron that ran late, short enough
// that a dead draw job doesn't hold a 15s loop open all night.
const CATCH_UP_WINDOW_MS = 150_000;

// A beat after the scheduled instant, so the read lands after the transaction
// rather than racing it.
const CALL_SKEW_MS = 2_000;

// THE FLOOR, AND IT IS DELIBERATELY THE PLATFORM'S NUMBER — the same 30s
// LIVE_POLL_MS carries on the Oracle, the Trail and the four contest boards.
// Used when there is no boundary to schedule against, or when the boundary has
// come and gone. See the header.
const FALLBACK_POLL_MS = 30_000;

// Below this, the countdown ticks every second so "in 45s" is honest. Above it,
// a coarse tick — a per-second re-render for twenty minutes of "in 14m" is sixty
// renders per visible change, and this clock is an ARRIVAL rather than a
// deadline the fan is racing.
const FINE_TICK_UNDER_MS = 90_000;
const FINE_TICK_MS = 1_000;
const COARSE_TICK_MS = 15_000;

// The whole scheduling rule, as one pure function of the payload — which is what
// lets the effect below be a plain re-derivation on every render instead of a
// self-rescheduling timer nobody can reason about.
function pollDelay(night: BingoNight, now: number): number {
  if (!night.nextCallAt) return FALLBACK_POLL_MS;
  const due = new Date(night.nextCallAt).getTime();
  if (Number.isNaN(due)) return FALLBACK_POLL_MS;
  const until = due - now;
  if (until > 0) return until + CALL_SKEW_MS;
  // Due and not yet filled. Normal — see the header on draws_at vs drawn_at.
  if (now - due <= CATCH_UP_WINDOW_MS) return CATCH_UP_MS;
  // Long overdue: the job is in trouble. Back off to what the rest of the site
  // does, rather than hammering a boundary that has stopped meaning anything.
  return FALLBACK_POLL_MS;
}

// ---------------------------------------------------------------------------
// VOIDED — the night could not be run at all.
//
// THE REGISTER IS THE CALL'S WASH, and it is borrowed on purpose: a fan whose
// balance moved with no explanation on screen is exactly the failure the Call's
// void copy closed. Nothing here goes warn-coloured — a void is routine, not an
// alarm, and it is never the fan's fault.
//
// IT CANNOT NAME THE CAUSE, and it does not pretend to. bingo_nights.void_reason
// exists in the schema but GET /arena/bingo/today does not carry it (readNight
// selects neither status's evidence column), so the honest sentence is that the
// night could not be run — not an invented one about weather or a feed. If the
// reason is ever put on the wire, it belongs right here.
// ---------------------------------------------------------------------------
function Washed({ today }: { today: BingoToday }) {
  // What the fan actually spent tonight, off their own cards. The refund is the
  // backend's (adjust(), not earn() — refunding through earn would inflate
  // lifetime_earned for money the fan already had), and this is the sentence
  // that explains the movement they will see in the ⚡ chip.
  const spent = today.cards.reduce((sum, c) => sum + c.costPoints, 0);

  return (
    <section className="bingo-washed">
      <p className="bingo-washed__headline">Tonight was washed.</p>
      <p className="bingo-washed__sub">
        The night couldn&apos;t be run, so no numbers were called and every card
        is void.
      </p>
      {spent > 0 && (
        <p className="bingo-washed__paid">
          The <strong>{points(spent)}</strong> pts you spent on extra cards have
          been refunded.
        </p>
      )}
      <p className="bingo-washed__next">A fresh night opens tomorrow.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// THE PAGE
// ---------------------------------------------------------------------------
export default function BingoPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const { runGated } = useAgeGate();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [today, setToday] = useState<BingoToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<'free' | 'extra' | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Bumped after every completed read, success OR failure. It is what re-arms
  // the scheduling effect below: on a successful read `today` changes identity
  // anyway, but a FAILED read changes nothing, and without this the loop would
  // die on the first hiccup.
  const [pollNonce, setPollNonce] = useState(0);

  const loadToday = useCallback(async () => {
    if (!token) return;
    const next = await getBingoToday(token);
    setToday(next);
  }, [token]);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const next = await getBingoToday(token);
        if (!cancelled) {
          setToday(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load tonight’s game',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router, allowed]);

  const night = today?.night ?? null;
  // Open and drawing both schedule: a fan sitting in the lobby at 18:58 should
  // watch the night start without reloading, and nextCallAt is firstDrawAt then,
  // so one rule covers both. Settled and voided never poll — neither can move.
  const live =
    night !== null && (night.status === 'open' || night.status === 'drawing');

  useEffect(() => {
    if (!live || !token || !night) return;
    const timer = setTimeout(() => {
      void loadToday()
        .catch(() => {
          // A failed poll leaves what's on screen. The next one tries again, and
          // the 401 path inside the client tears the session down.
        })
        .finally(() => setPollNonce((n) => n + 1));
    }, pollDelay(night, Date.now()));
    return () => clearTimeout(timer);
  }, [live, token, night, pollNonce, loadToday]);

  // The countdown ticker, decoupled from the data poll — same two-layer shape
  // the Oracle card uses, at a cadence matched to what this clock is for.
  const nextCallAt = night?.nextCallAt ?? null;
  const fine =
    nextCallAt !== null &&
    new Date(nextCallAt).getTime() - now <= FINE_TICK_UNDER_MS;
  useEffect(() => {
    if (!live || !nextCallAt) return;
    const timer = setInterval(
      () => setNow(Date.now()),
      fine ? FINE_TICK_MS : COARSE_TICK_MS,
    );
    return () => clearInterval(timer);
  }, [live, nextCallAt, fine]);

  async function onClaim(purchase: boolean) {
    if (!token || claiming) return;
    setClaiming(purchase ? 'extra' : 'free');
    setClaimError(null);
    try {
      // Through the 18+ gate — AgeGateGuard sits on POST /arena/bingo/cards and
      // not on the read, so an un-attested fan sees the whole night and is
      // stopped only here. An affirming fan's call is retried, so the tap
      // completes.
      await runGated(() => claimBingoCard(token, purchase));
      // RE-READ RATHER THAN FOLD IN. The Oracle folds a pick into its card
      // without a round-trip because it knows the delta authoritatively — the
      // fan's own choice, and the split is one greater on that side by
      // definition. Nothing equivalent is true here: the issued card carries no
      // patterns, its marks and issuedAtSlot depend on the server's clock, and
      // the claim block itself has moved. One read is the whole truth and an
      // optimistic merge would be three guesses.
      await loadToday();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not take a card';
      setClaimError(message);
      // A 409 means the screen is STALE, not that the fan did something wrong:
      // they already hold this card (another tab), they are at three, or the
      // first ball landed between the render and the tap. Re-read so the screen
      // catches up instead of leaving a dead button over a closed window.
      if (message.startsWith('409') || message.startsWith('404')) {
        void loadToday().catch(() => {});
      }
    } finally {
      setClaiming(null);
    }
  }

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  // THE LOBBY GATE. `called === 0`, not `status === 'open'` — see the rule-2
  // block in the header. Voided is tested first: it also has zero balls, and
  // without the ordering a washed night would render as a lobby with a live
  // buy button on it.
  const washed = night?.status === 'voided';
  const lobby = night !== null && !washed && night.called === 0;

  return (
    <main className="feed-home bingo-page">
      <div className="header-row">
        <div>
          <span className="wordmark">Sharp Foxx</span>
          <span className="muted">
            Signed in as{' '}
            <span className="mono">{user?.displayName ?? user?.id}</span>
            {user?.roles?.length ? ` · ${user.roles.join(', ')}` : ''}
          </span>
        </div>
        <AppNav />
      </div>

      {/* ---- THE CONTENT COLUMN. The page itself now runs the full width and
          THIS carries the measure, which is the whole point: the header row
          above is outside it, so the global nav gets the window rather than
          whatever cap this page's content happens to want. That coupling is
          RESOLVER_TICKETS.md W1, and moving the cap off `main` retires it for
          these pages.

          The content geometry is unchanged -- these blocks are vertical stacks
          and a centred column is what they want. Nothing here makes the Arena
          stop looking like a column; that is W2. ---- */}
      <div className="arena-col arena-col--bingo">

      <div className="page-head">
        <div>
          <h1 className="row-title page-head__title">Sports Bingo</h1>
          {/* THE CADENCE ONLY. The fairness line that used to close this
              sentence ("your free card faces exactly the same numbers as
              anyone else's") is not gone — it's in the lobby terms further
              down, which is where a fan is actually taking a card and is
              therefore where the question occurs to them. Saying it twice on
              one page made it read as protesting. */}
          <p className="page-rules">
            Fifty-six numbers a night, four every twenty minutes, every one of
            them called off tonight&apos;s slate.
          </p>
        </div>
        <div className="masthead-actions">
          {/* ← The Arena on ALL FIVE game pages. This slot used to hold
              "My points →" here and on bingo, which left two of the five with no
              way back to the hub -- and the hub is the door to the other four
              games. The points link was the duplicate one: the ⚡ chip is in the
              nav on every page (it goes to /profile) and /picks is one tap away
              in the avatar menu, so nothing is unreachable. The hub link had no
              such second door. */}
          <Link href="/arena" className="link-btn">
            ← The Arena
          </Link>
        </div>
      </div>

      {loading && <div className="card muted">Opening tonight’s night…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && today && night && (
        <>
          {washed && <Washed today={today} />}

          {lobby && (
            <Lobby
              night={night}
              claim={today.claim}
              cards={today.cards}
              now={now}
              onClaim={onClaim}
              claiming={claiming}
              claimError={claimError}
            />
          )}

          {!washed && !lobby && (
            <>
              <Caller
                night={night}
                balls={today.balls}
                now={now}
                claim={
                  // THE FREE CLAIM, MID-NIGHT. Free stays claimable all night by
                  // design — "the free arm should have the widest door in the
                  // building" — and a free claim is not the regulated mechanic,
                  // there being no consideration in it. It still does not sit
                  // beside a near-miss: up here it is physically above every
                  // grid and every rail on the page.
                  today.claim.canClaimFree ? (
                    <div className="bingo-claim bingo-claim--inline">
                      <button
                        type="button"
                        className="bingo-btn bingo-btn--free"
                        onClick={() => onClaim(false)}
                        disabled={claiming !== null}
                      >
                        <span className="bingo-btn__verb">
                          {claiming === 'free'
                            ? 'Taking…'
                            : 'Take tonight’s free card'}
                        </span>
                        <span className="bingo-btn__sub">
                          Still free · it starts from the next call
                        </span>
                      </button>
                      {claimError && (
                        <p className="bingo-claim__error">{claimError}</p>
                      )}
                    </div>
                  ) : null
                }
              />

              {/* CARDS THEN BOARD, STACKED ON A PHONE and side by side once
                  there is room. The split class is applied ONLY when there are
                  cards to put in the other column — a two-column grid with one
                  child would leave the board at half width with a hole beside
                  it, which is worse than the stack it replaced. */}
              <div
                className={today.cards.length > 0 ? 'bingo-split' : undefined}
              >
                {today.cards.length > 0 && (
                  <div className="bingo-cards">
                    {today.cards.map((card) => (
                      <BingoCard
                        key={card.id}
                        card={card}
                        status={night.status}
                        // The rail's gate. See the header.
                        showRail={night.called > 0}
                      />
                    ))}
                  </div>
                )}

                <CallBoard balls={today.balls} />
              </div>
            </>
          )}

          {/* THE ODDS ARE NOT ON THIS PAGE. A jackpot printed beside its odds is
              a lottery ticket's front face, and 1 in 5,919 flatters either way
              you say it. The payouts are stated in the lobby; what the fineprint
              owes is the thing that is true of every Arena game. */}
          <p className="bingo-fineprint">
            Points only · no cash value · never redeemable. One free card every
            night, and the free card faces the same numbers as any other.
          </p>
        </>
      )}
      </div>
    </main>
  );
}
