'use client';

// ============================================================================
// THE CLASH BOARD — the tug, the contribution meter, the engine room and the
// season table. Everything on this file renders a NUMBER SOMEONE ELSE EARNED
// FOR YOU, which is the whole feeling the game is trying to produce.
//
// ----------------------------------------------------------------------------
// !! THE PALETTE. READ THIS BEFORE YOU PAINT THE TUG IN CREST COLOURS. !!
// ----------------------------------------------------------------------------
//
// The API ships every bureau a `crest_primary` — Dallas #00B9E3, Philly #F83C20
// — and the reviewer's spec draws the tug cyan-versus-blaze out of exactly those
// two. It is the obvious build and it is the wrong one here.
//
// This app's :root is ONE warm gold (--accent / --accent-hover / --accent-dim)
// plus a deliberately non-gold --warn. There is no cyan and no blaze, and six
// arbitrary hexes let onto the bar would not read as "two cities" — they would
// read as the page having no palette, differently on every matchup. Dallas vs
// Philly is cyan/red; Grambling vs Odessa is gold/orange and the "your side"
// colour would silently become the opponent's.
//
// SO THE TUG IS GOLD FOR YOUR SIDE AND NEUTRAL FOR THEIRS, always, whoever you
// are playing. That is not a compromise, it is the more honest drawing: the fan
// HAS a side, and the one thing the bar must never make ambiguous is which half
// is theirs. Gold already means "this is yours" everywhere else in the app.
//
// This is also an established shape here, not a new one. `.oracle-split__bar`
// gets ride-versus-fade out of one accent by painting the fill over a
// gold track, and `.trail-split__bar` does away-versus-home with a gradient hard
// stop. The tug is the third instance of that idiom, not a fourth colour system.
//
// CREST HEXES ARE ALLOWED IN EXACTLY ONE PLACE: inside the crest disc — its
// border, its glyph, its faint glow. Bounded to a 56px circle they read as team
// identity, which is what they are. On the bar, on text, on a page accent, or as
// a chip background, they read as chaos. The discs pass the colour through an
// inline custom property for that reason: it is a per-bureau datum entering at
// one bounded point, not a token.
// ----------------------------------------------------------------------------

import Link from 'next/link';
import {
  ClashContribution,
  ClashContributor,
  ClashSide,
  ClashStanding,
  ClashTug,
  clashResolveCountdown,
  clashSplitPct,
  myClashSide,
  otherClashSides,
  points,
} from '../../api';

// ---------------------------------------------------------------------------
// THE CREST — the one bounded home of a bureau's own colour.
// ---------------------------------------------------------------------------
function Crest({
  code,
  color,
  size = 'lg',
}: {
  code: string;
  color: string | null;
  size?: 'lg' | 'sm';
}) {
  // Falls back to the gold accent when a bureau carries no crest colour —
  // crest_primary is nullable on the API and a bureau with none must still draw.
  return (
    <span
      className={`clash-crest clash-crest--${size}`}
      style={{ ['--crest' as string]: color ?? 'var(--accent)' }}
      aria-hidden="true"
    >
      {code}
    </span>
  );
}

// ---------------------------------------------------------------------------
// THE TUG — two sides, one bar.
//
// THE BIG NUMBER IS THE WEEK'S SCORE, AND SINCE 2026-08-14 THAT IS THE TOTAL.
//
// `score` was clashPoints ÷ actives, and this comment used to argue at length
// that the raw total was the most misreadable number on the screen — a fan on
// the smaller side seeing their total below the opponent's and concluding they
// were losing while in fact ahead. That argument died with the divisor: the
// score IS the total now, so the two numbers cannot disagree and there is
// nothing left to misread.
//
// WHAT CHANGED ON SCREEN, and why the sub-line lost its "pts": the totals row
// used to name the denominator ("1,400 pts · 7 active") because the big number
// was a ratio and needed its inputs shown. With score == clashPoints that row
// would print the same number twice, so it now carries only the half the score
// does NOT say — how many people turned out. Turnout is still the story; it is
// just no longer the divisor.
// ---------------------------------------------------------------------------
function Tug({ mine, theirs }: { mine: ClashSide; theirs: ClashSide }) {
  const pct = clashSplitPct(mine, theirs);
  const dead = Number(mine.score) + Number(theirs.score) <= 0;

  return (
    <>
      <div
        className={`clash-tug${dead ? ' clash-tug--dead' : ''}`}
        style={{ ['--mine-pct' as string]: `${pct}%` }}
        role="img"
        aria-label={
          dead
            ? 'Neither bureau has scored yet this week'
            : `${mine.name} ${mine.score} Clash Points, ` +
              `${theirs.name} ${theirs.score}`
        }
      >
        <i className="clash-tug__mine" />
        <span className="clash-tug__knot" />
      </div>

      <div className="clash-tug__scores">
        <span className="clash-tug__score clash-tug__score--mine">
          <b>{mine.score}</b>
          <small>Clash Points</small>
        </span>
        <span className="clash-tug__score clash-tug__score--theirs">
          <b>{theirs.score}</b>
          <small>Clash Points</small>
        </span>
      </div>

      {/* Turnout, which is the one thing the score does not say. See above. */}
      <div className="clash-tug__totals">
        <span>
          {mine.actives} active {mine.actives === 1 ? 'member' : 'members'}
        </span>
        <span>
          {theirs.actives} active {theirs.actives === 1 ? 'member' : 'members'}
        </span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// THE BOARD CARD — crests, the week marker, the tug, the countdown.
// ---------------------------------------------------------------------------
function BoardCard({
  tug,
  now,
}: {
  tug: Extract<ClashTug, { state: 'paired' | 'free_for_all' }>;
  now: number;
}) {
  const mine = myClashSide(tug.sides);
  const others = otherClashSides(tug.sides);

  // FREE-FOR-ALL: an under-populated tier plays one N-way board instead of a
  // pairing, so there is no tug to draw. Same data, ranked, with the fan's own
  // bureau marked — rather than a two-sided bar that would have to pick an
  // arbitrary opponent out of five.
  const ffa = tug.state === 'free_for_all' || others.length !== 1;

  return (
    <section className="card clash-board">
      <div className="clash-board__chips">
        <span className="chip">
          {ffa ? 'Free-for-all' : 'Swiss pairing'} · Tier {tug.tier}
        </span>
        {tug.isRivalry && <span className="chip chip--gold">Rivalry week</span>}
        {tug.isBye && <span className="chip">Bye week</span>}
      </div>

      {!ffa && mine ? (
        <>
          <div className="clash-board__head">
            <div className="clash-board__side">
              <Crest code={mine.code} color={mine.crestPrimary} />
              <span className="clash-board__name">{mine.name}</span>
              <span className="clash-board__you">your bureau</span>
            </div>
            <span className="clash-board__wk">WK {tug.week.weekNo}</span>
            <div className="clash-board__side">
              <Crest code={others[0].code} color={others[0].crestPrimary} />
              <span className="clash-board__name">{others[0].name}</span>
              <span className="clash-board__you clash-board__you--empty" />
            </div>
          </div>
          <Tug mine={mine} theirs={others[0]} />
        </>
      ) : (
        <FreeForAll sides={tug.sides} weekNo={tug.week.weekNo} />
      )}

      <div className="clash-board__foot">
        <span>Resolves Sunday 23:59</span>
        <span className="clash-board__clock">
          {clashResolveCountdown(tug.week.endsAt, now)}
        </span>
      </div>
    </section>
  );
}

// The N-way board. Ranked by score descending — the same number the tug is drawn
// from, for the same reason.
function FreeForAll({ sides, weekNo }: { sides: ClashSide[]; weekNo: number }) {
  const ranked = [...sides].sort((a, b) => Number(b.score) - Number(a.score));
  return (
    <>
      <p className="clash-ffa__lede">
        Week {weekNo} is a free-for-all — not enough bureaus at this tier for a
        pairing, so everyone plays the same board.
      </p>
      <ol className="clash-ffa">
        {ranked.map((s, i) => (
          <li
            key={s.bureauId}
            className={`clash-ffa__row${s.isMine ? ' clash-ffa__row--mine' : ''}`}
          >
            <span className="clash-ffa__rank">{i + 1}</span>
            <Crest code={s.code} color={s.crestPrimary} size="sm" />
            <span className="clash-ffa__name">
              {s.name}
              {s.isMine && <small>your bureau</small>}
            </span>
            <span className="clash-ffa__score">
              {s.score}
              <small>Clash Points</small>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

// ---------------------------------------------------------------------------
// THE CONTRIBUTION METER — the thesis of the whole game, second on the page.
//
// The line under it is the one that has to land: a fan who has never opened this
// page has ALREADY been scoring here all week, and the cap is not a punishment.
// When the cap binds, credits keep banking for the fan — only the Clash
// contribution stops — and the copy says so, because a meter reading "200 / 200"
// with no explanation reads as "stop playing".
// ---------------------------------------------------------------------------
// EXPORTED AND RENDERED BY THE PAGE, into the rail beside the tug. Named
// ...Card rather than ClashContribution because that name is already the API
// TYPE it takes, and a component sharing a name with its own prop type is a
// collision under isolatedModules, not just a readability problem. "Your
// contribution" is the fan's own standing, which is what you check WHILE
// looking at the week's board rather than something to scroll past it to reach.
// It used to render inside two of ClashBoard's state branches; the page now
// carries that condition. See the note at the rail in page.tsx.
export function ClashContributionCard({ contribution }: { contribution: ClashContribution }) {
  const { points: got, cap, capped } = contribution;
  const pct = cap > 0 ? Math.min(100, Math.round((got / cap) * 100)) : 0;

  return (
    <section className="card clash-contrib">
      <div className="clash-contrib__head">
        <span className="clash-contrib__label">Your contribution</span>
        <span className="clash-contrib__figure">
          {points(got)}
          <small> / {points(cap)} today</small>
        </span>
      </div>

      <div className="arena-progress">
        <div className="arena-progress__track">
          <div
            className="arena-progress__fill"
            style={{ ['--pct' as string]: `${pct}%` }}
          />
        </div>
      </div>

      <p className="clash-contrib__note">
        {capped ? (
          <>
            <strong>Today&apos;s cap is in.</strong> Your credits still bank as
            normal — only what you add to {' '}
            the city stops until tomorrow.
          </>
        ) : (
          <>
            One Clash Point per credit you earn, in any Arena game. Capped at{' '}
            {points(cap)} a day. Accounts under seven days old contribute
            nothing yet.
          </>
        )}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// THE ENGINE ROOM.
//
// HEADED "WHO SHOWED UP THIS WEEK" rather than the spec's "This week's engine
// room", and the caption is rendered VERBATIM off the server. Both are the same
// decision: with a 200/day cap that binds on nearly every engaged member, a
// bureau's score collapses toward 200 × (members who turned up). This board
// ranks TURNOUT, not skill. A fan who plays brilliantly and a fan who checks in
// daily land in the same place, and the one who played brilliantly will notice a
// header that promised otherwise. See docs/design/clash-copy-note.md — the
// caption ships from the API precisely so a client that only wanted the numbers
// cannot quietly drop the honest framing.
// ---------------------------------------------------------------------------
function EngineRoom({
  room,
  caption,
  meId,
}: {
  room: ClashContributor[];
  caption: string;
  meId: string | undefined;
}) {
  return (
    <section className="card clash-engine">
      <h2 className="clash-engine__title">Who showed up this week</h2>

      {room.length === 0 ? (
        <p className="clash-engine__empty">
          Nobody has scored for your bureau yet this week. First credit you earn
          anywhere in the Arena puts you top of this board.
        </p>
      ) : (
        <ol className="clash-engine__list">
          {room.map((c, i) => (
            <li
              key={c.userId}
              className={`clash-engine__row${
                c.userId === meId ? ' clash-engine__row--mine' : ''
              }`}
            >
              <span className="clash-engine__rank">{i + 1}</span>
              <span className="clash-engine__who">
                {c.userId === meId ? 'You' : c.displayName}
              </span>
              <span className="clash-engine__pts">
                {points(Number(c.points))}
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="clash-engine__caption">{caption}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// THE SEASON TABLE. Six rows — it does not need a screen of its own, and the
// spec's tier selector is not drawn because /standings takes no tier: it would
// be four buttons where three do nothing.
// ---------------------------------------------------------------------------
function Standings({
  items,
  mineId,
  season,
}: {
  items: ClashStanding[];
  mineId: string | null;
  season: string;
}) {
  if (items.length === 0) {
    return (
      <section className="card clash-standings">
        <h2 className="clash-standings__title">Season {season}</h2>
        <p className="clash-standings__empty">
          No weeks have resolved yet. The table fills in on the first Sunday.
        </p>
      </section>
    );
  }

  return (
    <section className="card clash-standings">
      <h2 className="clash-standings__title">Season {season}</h2>
      <ol className="clash-standings__list">
        {items.map((s, i) => (
          <li
            key={s.bureau_id}
            className={`clash-standings__row${
              s.bureau_id === mineId ? ' clash-standings__row--mine' : ''
            }`}
          >
            <span className="clash-standings__rank">{i + 1}</span>
            <span className="clash-standings__name">
              {s.name}
              <small>
                {s.wins}–{s.losses}
                {s.bureau_id === mineId ? ' · your bureau' : ''}
              </small>
            </span>
            <span className="clash-standings__avg">
              {s.avg_score ?? '—'}
              <small>avg / wk</small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ownBureauId(tug: ClashTug): string | null {
  switch (tug.state) {
    case 'paired':
    case 'free_for_all':
      return myClashSide(tug.sides)?.bureauId ?? null;
    case 'no_week':
    case 'unpaired':
      return tug.bureau.bureau_id;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// THE ASSEMBLED BOARD, one state at a time.
// ---------------------------------------------------------------------------
// THE WEEK'S BOARD -- the tug and the states it can be in. It no longer renders
// the season table or the fineprint: the page puts the standings full width
// below and the fineprint below that, which is where every other Arena page
// keeps its footnote.
export function ClashBoard({
  tug,
  meId,
  now,
}: {
  tug: ClashTug;
  meId: string | undefined;
  now: number;
}) {
  return (
    <>
      {/* ---- NO LIVE WEEK. A real state, not a broken one: the board is dark
          between weeks and the page has to look deliberate. The contribution
          card is deliberately NOT shown — there is no week for it to count
          toward, and a meter with nothing behind it invents a number. ---- */}
      {tug.state === 'no_week' && (
        <section className="card clash-quiet">
          <Crest code={tug.bureau.code} color={tug.bureau.crest_primary} />
          <h2 className="clash-quiet__title">
            {tug.bureau.name} is between weeks
          </h2>
          <p className="clash-quiet__body">
            No board is live right now. The next one opens Monday — and
            everything you earn in the Arena from the moment it does counts for
            your city.
          </p>
        </section>
      )}

      {/* ---- PAIRED / FREE-FOR-ALL. ---- */}
      {(tug.state === 'paired' || tug.state === 'free_for_all') && (
        <>
          <BoardCard tug={tug} now={now} />
          
          <EngineRoom
            room={tug.engineRoom}
            caption={tug.engineRoomCaption}
            meId={meId}
          />
        </>
      )}

      {/* ---- UNPAIRED. Your bureau isn't on this week's board. The payload
          carries NO sides and NO engine room, so those cards simply do not
          render — but the contribution does, because it is still counting and
          telling a fan otherwise would be false. ---- */}
      {tug.state === 'unpaired' && (
        <>
          <section className="card clash-quiet">
            <Crest code={tug.bureau.code} color={tug.bureau.crest_primary} />
            <h2 className="clash-quiet__title">
              {tug.bureau.name} sits out week {tug.week.weekNo}
            </h2>
            <p className="clash-quiet__body">
              No opponent drawn this week. What you earn still counts toward your
              city&apos;s season — it just isn&apos;t being pulled against
              anyone.
            </p>
            <span className="clash-quiet__clock">
              {clashResolveCountdown(tug.week.endsAt, now)}
            </span>
          </section>
          
        </>
      )}

    </>
  );
}

// ---------------------------------------------------------------------------
// THE SEASON TABLE, exported for the page to render full width BELOW the board.
//
// IT TAKES `tug`, NOT `mineId`, AND THAT IS THE POINT OF THE SPLIT. Marking the
// fan's own row needs a bureau id that arrives from two different places
// depending on state -- off `sides[]` on a live board, off the `bureau` row
// otherwise -- which is what ownBureauId's switch is for (a chain of ternaries
// will not narrow, because the paired branch's discriminant is itself a union).
// Passing `mineId` in would put that derivation at the page and teach it what a
// bureau id is; passing `tug` keeps the helper private and its only consumer
// right beside it.
// ---------------------------------------------------------------------------
export function ClashStandings({
  standings,
  tug,
  season,
}: {
  standings: ClashStanding[];
  tug: ClashTug;
  season: string;
}) {
  return <Standings items={standings} mineId={ownBureauId(tug)} season={season} />;
}
