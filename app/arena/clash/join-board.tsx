'use client';

// ============================================================================
// THE JOIN BOARD — six cities, one season, one change.
//
// THIS IS THE SCREEN MOST FANS SEE FIRST. 38 of 45 accounts have no bureau
// today, so `unaffiliated` is not an edge case being handled, it is the front
// door of the game. The service is built for it — the tug's unaffiliated branch
// ships the whole bureau list in the same response, so this screen needs no
// second read and paints in one round trip.
//
// NO MODAL, ANYWHERE. A dialog over the page would ask the fan to make the one
// irreversible choice in this game while the six things they are choosing
// between are hidden behind the scrim. So: one tap SELECTS a city and expands it
// in place, a second tap COMMITS. The cities stay on screen the whole time.
//
// ----------------------------------------------------------------------------
// !! THE COMMITMENT SENTENCE SHOWS BEFORE THE *FIRST* JOIN, NOT ONLY THE SWITCH.
// ----------------------------------------------------------------------------
// The tempting build tells a fan about the once-a-season rule at the moment they
// try to spend it. That is an ambush: someone picks Dallas casually on Tuesday
// because a friend is there, and on Friday — when they have a reason to move —
// they learn Tuesday's shrug was their whole allowance. They will not feel they
// made a choice; they will feel tricked, and they will be right.
//
// It costs one line to prevent, so the line is on the first join too, and the
// confirm button NAMES WHAT IT SPENDS rather than saying "Confirm". A button
// whose label states the irreversible thing is worth more than a dialog asking
// whether you are sure.
// ----------------------------------------------------------------------------
//
// CREST COLOUR IS BOUNDED TO THE DISC here exactly as it is on the board — see
// the long note at the top of board.tsx. Six cities on one screen is precisely
// the place where letting six arbitrary hexes onto cards, borders or buttons
// would stop reading as team identity and start reading as no design at all.
// ============================================================================

import { useState } from 'react';
import { ClashBureau, ClashMembership, joinBureau } from '../../api';

// The sentence itself, in one place because it is said in two — on the first
// join and on the switch — and the two must never drift apart.
const SEASON_RULE =
  'Your bureau is your home for the whole season. You can change it once.';

export function JoinBoard({
  token,
  bureaus,
  current,
  onJoined,
}: {
  token: string;
  bureaus: ClashBureau[];
  // The fan's existing membership when this board is being used to SWITCH.
  // Null on a first join.
  current: ClashMembership | null;
  onJoined: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchSpent = current?.switch_used ?? false;

  async function commit(code: string) {
    setBusy(true);
    setError(null);
    try {
      await joinBureau(token, code);
      onJoined();
    } catch (err) {
      // The 409 for an already-spent switch carries a complete, well-written
      // sentence from the server. Rendered as-is per CLAUDE.md — paraphrasing it
      // would lose the "yours changes again next season" half, which is the only
      // part that tells the fan when they get their move back.
      setError(err instanceof Error ? err.message : 'Could not join');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="clash-join">
      <h2 className="clash-join__title">
        {current ? 'Change your bureau' : 'Pick your city'}
      </h2>
      <p className="clash-join__lede">
        {current ? (
          <>
            You&apos;re with <strong>{current.name}</strong>.{' '}
            {switchSpent
              ? "You've already used this season's one change."
              : 'You have one change left this season — this is it.'}
          </>
        ) : (
          <>
            Every credit you earn anywhere in the Arena pulls for your city.{' '}
            <strong>{SEASON_RULE}</strong>
          </>
        )}
      </p>

      {error && <div className="error">{error}</div>}

      <ul className="clash-join__grid">
        {bureaus.map((b) => {
          const isHome = current?.bureau_id === b.id;
          // A spent switch leaves the other five VISIBLE but inert — a fan
          // should be able to see the city they can't move to, and be told when
          // they get the move back, rather than find it missing.
          const inert = switchSpent && !isHome;
          const open = selected === b.id;

          return (
            <li key={b.id}>
              <div
                className={`clash-city${isHome ? ' clash-city--home' : ''}${
                  inert ? ' clash-city--inert' : ''
                }${open ? ' clash-city--open' : ''}`}
              >
                <button
                  type="button"
                  className="clash-city__pick"
                  disabled={inert || isHome || busy}
                  aria-expanded={open}
                  onClick={() => setSelected(open ? null : b.id)}
                >
                  <span
                    className="clash-crest clash-crest--lg"
                    style={{
                      ['--crest' as string]: b.crest_primary ?? 'var(--accent)',
                    }}
                    aria-hidden="true"
                  >
                    {b.code}
                  </span>
                  <span className="clash-city__id">
                    <span className="clash-city__name">{b.name}</span>
                    <span className="clash-city__where">{b.city}</span>
                  </span>
                  <span className="clash-city__members">
                    {b.members}
                    <small>{b.members === 1 ? 'member' : 'members'}</small>
                  </span>
                </button>

                {isHome && (
                  <p className="clash-city__badge">Your bureau</p>
                )}

                {inert && (
                  <p className="clash-city__badge clash-city__badge--inert">
                    Locked until next season
                  </p>
                )}

                {/* ---- THE COMMITMENT, IN PLACE. Expanded under the card that
                    was tapped, with the cities above and below it still on
                    screen. ---- */}
                {open && !inert && !isHome && (
                  <div className="clash-city__commit">
                    <p className="clash-city__rule">
                      {current ? (
                        <>
                          Moving to {b.name} spends your one change for the
                          season. Your bureau changes again next season.
                        </>
                      ) : (
                        SEASON_RULE
                      )}
                    </p>
                    <button
                      type="button"
                      className="clash-city__go"
                      disabled={busy}
                      onClick={() => commit(b.code)}
                    >
                      {busy
                        ? 'Joining…'
                        : current
                          ? `Spend my change on ${b.name}`
                          : `Make ${b.name} my bureau`}
                    </button>
                    <button
                      type="button"
                      className="link-btn clash-city__cancel"
                      disabled={busy}
                      onClick={() => setSelected(null)}
                    >
                      Not yet
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
