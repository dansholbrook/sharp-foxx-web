'use client';

// ============================================================================
// /arena/scout — THE SCOUT BOOK. Season-long, five slots, real people.
//
// ONE PAGE, THREE BANDS, NOT FOUR ROUTES. The spec has four separate screens
// (market, book, detail, recap); at 390px, with an empty market and an empty
// book, three of those four are four ways to land on nothing. Book, market and
// recap are one scroll; only the prospect detail gets a route, because it is
// linkable and because a CLOSED card has to stay reachable from a book after it
// leaves the market.
//
// THE BOOK READ GATES THE MARKET READ, AND THAT IS A WORKAROUND, NOT A DESIGN.
// `GET /scout/cards` requires a `season` the client has no way to discover: the
// parameter is required, unvalidated (any string answers 200 with an empty
// list), and no endpoint names the current season while no week is live. So
// `book.season` is the only honest source, and when it is null this page does
// not call the market at all — it renders "the season hasn't opened yet", which
// is the true statement, rather than guessing a season string and rendering the
// eligibility copy over what might have been a typo. A backend ask is out to
// return the season on the no-season branch; when it lands, the market read
// turns on here with no other change.
//
// NO POLLING. Nothing on this screen moves inside a session: the market changes
// when a correspondent files a card, the book when the fan acts, and the recap
// once a week on a Sunday night. A poll would be a request per fan per interval
// to re-fetch four unchanged rows.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../../auth-context';
import { useAgeGate, AgeGateDeclinedError } from '../../age-gate';
import { AccessDenied } from '../../nav';
import { canAccess } from '../../roles';
import {
  ScoutBook,
  ScoutMarketCard,
  ScoutRecap,
  draftProspect,
  dropProspect,
  getScoutBook,
  getScoutMarket,
  getScoutRecap,
} from '../../api';
import { BookBand } from './book';
import { ProspectMarket, MarketState } from './market';
import { RecapBand } from './recap';

export default function ScoutPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user } = useAuth();
  const { runGated } = useAgeGate();
  const allowed = canAccess(user?.roles ?? [], pathname);

  const [book, setBook] = useState<ScoutBook | null>(null);
  const [bookLoading, setBookLoading] = useState(true);
  const [bookFailed, setBookFailed] = useState(false);

  const [cards, setCards] = useState<ScoutMarketCard[]>([]);
  const [marketLoaded, setMarketLoaded] = useState(false);
  const [marketFailed, setMarketFailed] = useState(false);
  const [statKind, setStatKind] = useState<string | null>(null);

  const [recap, setRecap] = useState<ScoutRecap | null>(null);
  const [recapLoading, setRecapLoading] = useState(true);
  const [recapFailed, setRecapFailed] = useState(false);

  const [drafting, setDrafting] = useState<string | null>(null);
  const [dropping, setDropping] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const season = book && book.season !== null ? book.season : null;

  const loadBook = useCallback(async () => {
    if (!token) return;
    const next = await getScoutBook(token);
    setBook(next);
  }, [token]);

  // ---- The book and the recap, in parallel, each failing alone. Neither gates
  // the page: a dead recap must not take the book's render with it.
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    if (!allowed) return;
    let cancelled = false;

    setBookLoading(true);
    getScoutBook(token)
      .then((next) => {
        if (!cancelled) setBook(next);
      })
      .catch(() => {
        if (!cancelled) setBookFailed(true);
      })
      .finally(() => {
        if (!cancelled) setBookLoading(false);
      });

    setRecapLoading(true);
    getScoutRecap(token)
      .then((next) => {
        if (!cancelled) setRecap(next);
      })
      .catch(() => {
        if (!cancelled) setRecapFailed(true);
      })
      .finally(() => {
        if (!cancelled) setRecapLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, allowed, router]);

  // ---- The market, ONLY once a season is known. See the header: with no
  // season there is nothing safe to ask for, so nothing is asked.
  useEffect(() => {
    if (!token || !season) return;
    let cancelled = false;

    setMarketFailed(false);
    getScoutMarket(token, season, statKind ?? undefined)
      .then((res) => {
        if (cancelled) return;
        setCards(res.cards);
        setMarketLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setMarketFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [token, season, statKind]);

  const inBook = useMemo(() => {
    const held = book && book.season !== null ? book.slots : [];
    return new Set(held.map((s) => s.prospectCardId));
  }, [book]);

  const slotsUsed = book && book.season !== null ? book.slots.length : 0;
  const slotsTotal = book?.slotsTotal ?? 5;
  const bookFull = slotsUsed >= slotsTotal;

  const marketState: MarketState = marketFailed
    ? 'failed'
    : !season
      ? 'not_started'
      : !marketLoaded
        ? 'loading'
        : cards.length === 0 && statKind === null
          ? 'empty'
          : 'ok';

  // ---- Writes. Both are age-gated on the backend; runGated catches the 403,
  // prompts, and retries — the same path the other four games take.
  const onDraft = useCallback(
    async (cardId: string) => {
      if (!token) return;
      setActionError(null);
      setDrafting(cardId);
      try {
        await runGated(() => draftProspect(token, cardId));
        await loadBook();
      } catch (err) {
        // Closing the age prompt is a decision, not a failure. Saying nothing
        // is the correct response to someone who declined to answer.
        if (err instanceof AgeGateDeclinedError) return;
        setActionError(err instanceof Error ? err.message : 'Could not draft');
      } finally {
        setDrafting(null);
      }
    },
    [token, runGated, loadBook],
  );

  const onDrop = useCallback(
    async (cardId: string) => {
      if (!token) return;
      setActionError(null);
      setDropping(cardId);
      try {
        await runGated(() => dropProspect(token, cardId));
        await loadBook();
      } catch (err) {
        if (err instanceof AgeGateDeclinedError) return;
        setActionError(err instanceof Error ? err.message : 'Could not swap');
      } finally {
        setDropping(null);
      }
    },
    [token, runGated, loadBook],
  );

  if (!token) return null;
  if (!allowed) return <AccessDenied />;

  return (
    <>
      {/* The site header (wordmark + nav) is rendered once in app/layout.tsx
          now, so the bare <AppNav/> these two Scout pages used to render for
          themselves is gone -- it was a third header shape, without the
          wordmark, invented because the page did not want the header INSIDE its
          <main>. That is exactly what W1 made the rule. */}
      <main className="scout-page">
        <header className="scout-hero">
          <p className="scout-hero__kicker">Season-long · The Scout Book</p>
          <h1 className="scout-hero__title">Find them first.</h1>
          <p className="scout-hero__standfirst">
            Real rising athletes, scouted by our correspondents on the ground.
            Draft five and hold them.
          </p>
        </header>

        <BookBand
          book={book}
          loading={bookLoading}
          failed={bookFailed}
          marketHasCards={marketState === 'ok' && cards.length > 0}
          onDrop={onDrop}
          dropping={dropping}
        />

        <ProspectMarket
          state={marketState}
          cards={cards}
          statKind={statKind}
          onStatKind={setStatKind}
          inBook={inBook}
          onDraft={onDraft}
          drafting={drafting}
          bookFull={bookFull}
          actionError={actionError}
        />

        <RecapBand recap={recap} loading={recapLoading} failed={recapFailed} />
      </main>
    </>
  );
}
