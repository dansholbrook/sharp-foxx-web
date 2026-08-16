'use client';

// ============================================================================
// /arena/scout/[cardId] — THE PROSPECT CARD.
//
// THE ONE SCREEN THAT GETS ITS OWN ROUTE, for two reasons: it is linkable, and
// a CLOSED card must stay reachable from a fan's book after it has left the
// market. `GET /scout/cards/:id` returns retired and called-up cards on
// purpose — hiding a withdrawn athlete's card would make a fan's own history
// vanish and would make withdrawal read as erasure.
//
// TWO READS, AND THE HISTORY IS ALLOWED TO FAIL. The card is the page; the
// week-by-week history is context. A prospect with no scored weeks yet — which
// is every prospect today — simply has no bars, and that is a state, not a gap.
// ============================================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../../../auth-context';
import { AccessDenied } from '../../../nav';
import { canAccess } from '../../../roles';
import {
  ScoutCardDetail,
  ScoutHistory,
  getScoutCard,
  getScoutHistory,
  scoutBonusLabel,
  scoutPoints,
  scoutRetiredLine,
  scoutStatKindLabel,
  scoutTierLabel,
} from '../../../api';

// The four bonus events, in the order they appear on the ladder. Rendered
// WITHOUT point values — see scoutBonusLabel in api.ts: the numbers live in
// arena_rewards and no fan-facing read returns them, so a hardcoded "+500"
// would diverge the first time somebody tunes one.
const BONUS_LADDER = [
  'team_win',
  'feature',
  'conference_honor',
  'called_up',
] as const;

export default function ProspectCardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ cardId: string }>();
  const cardId = params?.cardId;
  const { token, user } = useAuth();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [card, setCard] = useState<ScoutCardDetail | null>(null);
  const [history, setHistory] = useState<ScoutHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed || !cardId) return;
    let cancelled = false;

    setLoading(true);
    getScoutCard(token, cardId)
      .then((next) => {
        if (!cancelled) setCard(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not read the card');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Context. Never rethrows — a dead history must not take the card with it.
    getScoutHistory(token, cardId)
      .then((next) => {
        if (!cancelled) setHistory(next);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [token, allowed, cardId, router]);

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  const closed = card?.status === 'retired';

  return (
    <>
      {/* The site header (wordmark + nav) is rendered once in app/layout.tsx
          now, so the bare <AppNav/> these two Scout pages used to render for
          themselves is gone -- it was a third header shape, without the
          wordmark, invented because the page did not want the header INSIDE its
          <main>. That is exactly what W1 made the rule. */}
      <main className="scout-page">
        <p className="scout-back">
          <Link href="/arena/scout">&larr; The Scout Book</Link>
        </p>

        {loading && <p className="scout-quiet">Reading the card…</p>}
        {error && !loading && <p className="scout-error">{error}</p>}

        {card && (
          <>
            <article
              className={`scout-detail${closed ? ' scout-detail--closed' : ''}`}
            >
              <h1 className="scout-detail__name">
                {card.firstName} {card.lastName}
              </h1>
              <p className="scout-detail__meta">
                {[
                  card.school,
                  scoutTierLabel(card.tier),
                  scoutStatKindLabel(card.statKind),
                  card.position,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>

              {/* ------------------------------------------------------------
                  HOW A CLOSED CARD READS. Retired, not failed.

                  NOT the --warn palette: that token is the app's alarm colour,
                  and painting a withdrawn athlete in it says something went
                  wrong WITH THEM. This is muted text on the standard panel with
                  the plain border — recessive, finished, unalarmed.

                  A DATED LINE, NOT A STAMP. "Card closed · 4 March" reads as a
                  record; a rotated red RETIRED stamp reads as a verdict. Same
                  discipline that stops the Call's paid-but-lost entry being
                  painted as a win.

                  THE REASON IS STATED IN THE ATHLETE'S FAVOUR — see
                  scoutRetiredLine(). "consent_revoked" never becomes "revoked"
                  or "withdrew"; both put an action on them and invite the
                  reader to wonder about it.
                  ------------------------------------------------------------ */}
              {closed && (
                <div className="scout-closed">
                  {/* NO DATE, because there isn't one. `retiredAt` exists on
                      prospect_cards but is NOT in the detail payload's select
                      — only `retiredReason` is. A plausible-looking date
                      assembled from createdAt would be a fabricated fact about
                      a real person's withdrawal, so the line carries the reason
                      alone until the column is exposed. */}
                  <p className="scout-closed__line">
                    Card closed &middot; {scoutRetiredLine(card.retiredReason)}
                  </p>
                  <p className="scout-closed__keep">
                    Everything this card earned stays earned. Points already paid
                    to holders are theirs.
                  </p>
                </div>
              )}

              {card.status === 'called_up' && (
                <p className="scout-calledup">
                  <span className="scout-tag scout-tag--gold">Called up</span>{' '}
                  Verified move to a higher division.
                </p>
              )}

              <blockquote className="scout-detail__note">
                &ldquo;{card.scoutingNote}&rdquo;
                {card.scoutedBy && (
                  <footer className="scout-detail__by">
                    &mdash; scouted by {card.scoutedBy}
                  </footer>
                )}
              </blockquote>

              {/* NO "N SCOUTS HOLD" CHIP. The spec's mockup puts one here. The
                  count is not on this payload at all (it is market-only), and
                  it stays off deliberately: a live count of strangers holding a
                  teenager is a pressure display with no upside to them. */}
            </article>

            <HistoryBars history={history} />

            {/* --------------------------------------------------------------
                THE LADDER, AND IT IS THE MOST IMPORTANT ELEMENT ON THE SCREEN.
                It is the proof, stated in the UI, that every listed way to move
                is upward — on a card about a real named nineteen-year-old. It
                renders in every state, including when the history is empty,
                because that is exactly when a fan most needs to know what the
                card can and cannot do to them.
                -------------------------------------------------------------- */}
            <section className="scout-ladder" aria-labelledby="scout-ladder-h">
              <h2 className="scout-band__title" id="scout-ladder-h">
                How this card scores
              </h2>
              <ul className="scout-ladder__list">
                {BONUS_LADDER.map((b) => (
                  <li key={b} className="scout-ladder__item">
                    {scoutBonusLabel(b)}
                  </li>
                ))}
              </ul>
              <p className="scout-foot">
                Every one of these adds. Nothing on this card subtracts &mdash;
                there are no deductions and no &ldquo;bust&rdquo; grades, and the
                worst week a prospect can have is 0. A week with no points is a
                week that hasn&rsquo;t been played or hasn&rsquo;t been filed,
                not a mark against anyone.
              </p>
            </section>
          </>
        )}
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------
// LAST WEEKS · PERFORMANCE POINTS. Base performance, unmultiplied — loyalty is
// per-holder, so a card-level history cannot carry it without picking one fan
// arbitrarily.
//
// A ZERO WEEK STILL DRAWS A BAR, at a floor height. A missing bar reads as
// missing data; a floor bar reads as a week that scored nothing, which is what
// it was — and it keeps the three zero-states legible in the label rather than
// erasing the week from the row.
// ---------------------------------------------------------------------------
function HistoryBars({ history }: { history: ScoutHistory | null }) {
  if (!history || history.weeks.length === 0) {
    return (
      <section className="scout-history">
        <h2 className="scout-band__title">Week by week</h2>
        <p className="scout-quiet">
          No scored weeks yet. The first Sunday of the season fills this in.
        </p>
      </section>
    );
  }

  const max = Math.max(...history.weeks.map((w) => w.perfCenti), 100);

  return (
    <section className="scout-history">
      <h2 className="scout-band__title">Week by week</h2>
      <ol className="scout-bars">
        {history.weeks.map((w) => {
          const pts = scoutPoints(w.perfCenti);
          // The three zero-states again, at week granularity. `missing` is ours
          // and is named as ours.
          const why =
            w.linesMissing > 0
              ? 'line still being filed'
              : w.linesCounted === 0 && w.linesDnp > 0
                ? 'did not play'
                : null;
          return (
            <li key={w.weekNo} className="scout-bar">
              <span
                className="scout-bar__fill"
                style={{ height: `${Math.max(3, (w.perfCenti / max) * 100)}%` }}
              />
              <span className="scout-bar__n">{pts}</span>
              <span className="scout-bar__wk">
                W{w.weekNo}
                {why && <span className="scout-bar__why">{why}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="scout-foot">
        Performance points before any holder&rsquo;s loyalty multiplier.
      </p>
    </section>
  );
}
