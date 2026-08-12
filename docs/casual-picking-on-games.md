# Casual picking on `/games` — recon, and the pricing finding that decides it

Written from `sharp-foxx-web` on 2026-08-12 after a read-only recon. The ask
was: put picking on `/games` — see a game, back a side, move on; no entry, no
slate, no ranking.

The recon says the feature is buildable and small on this side. It also says
two things have to be decided first, and one of them is not a consequence of
the build at all — it is a fact about what already shipped. That one leads.

> ## DECIDED — 2026-08-12
>
> **Casual picks cost points. The nightly contest stays free. The inversion in
> §1 is deliberate.**
>
> §1 is kept in full below because it is the argument someone will want when
> they notice the pricing looks backwards — but it is **settled, not open**.
> Do not re-open it on the strength of the reasoning in §1; that reasoning was
> read and the call was made with it in hand. The nightly is a 12-game contest
> with prizes and a leaderboard and it is free; a single casual tap costs
> points; that is the intended shape.
>
> Consequences of the decision:
>
> * **§6 (zero-stake) is closed.** No schema change is being asked for. The
>   `predictions_stake_check` (`stake > 0`) stands, and casual picking prices
>   in single or low double digits rather than at 0.
> * **The stake is config, not a constant** — `arena_rewards`
>   (`game='predictions_nightly'`, `reward_key='predictions_nightly_stake'`),
>   seeded at **25**. Tunable through the existing
>   `PATCH /economy/arena-rewards` console without a deploy.
> * **Supply (§2/§4) is now the only blocker**, and the auto-opener is being
>   built against this ticket.
> * §5 (coverage default) still needs a product call — see the Status block.

---

## 1. THE ORIGINAL FINDING — the competitive product is free and the casual one charges

> **Settled on 2026-08-12: deliberate.** See the DECIDED block above. Kept for
> the argument, not as an open question.

This is backwards, it is live today, and it decides what casual picking should
even be before anyone designs a control.

| | Nightly pick'em | Casual pick on `/games` (proposed) |
|---|---|---|
| **Cost to play** | **Free** | **100 points per pick** |
| Unit | 12 games, one entry, all or nothing | one game, one tap |
| Games | feed games only | the same feed games |
| Stakes | leaderboard + prize payouts | even money on your own points |
| Deadline | first kickoff | that game's kickoff |

**The nightly is free by construction, not by accident.** Both currently-open
`pickem` contests carry `entry_cost = 0`, and the nightly opener *refuses to
open at all* with a non-zero cost while `ENTRY_FEES_ENABLED` is false
(`nightly-pickem.service.ts`, `REWARD_NIGHTLY_ENTRY_COST` → the
"a non-zero entry cost REFUSES THE OPEN" branch). It is a 12-game contest with
a leaderboard and a payout table, and it costs nothing.

**A prediction pick is not free.** `PredictionsService.pick()` copies
`pred.stake` onto the pick row and spends it through the ledger. The
`predictions.stake` column defaults to **100**, and all five prediction rows in
the database are staked at 100. Against the 1,000-point signup grant that is
**ten casual picks and a fan is broke**, with the refill path living on other
surfaces.

So a fan can enter a 12-game contest with prizes for nothing, and pay 100
points to tap one game on the schedule.

### `stake: 5` narrows this. It does not fix it.

The obvious mitigation — have whatever opens these questions pass a low stake —
is expressible today with **no module change**: the stake is per-question at
create time, capped at the 1,000-point grant, and the client never sends one.
Five points a pick is a fair casual price.

It still leaves the shape wrong: **the cheap thing costs money and the
expensive thing is free.** A fan reading both surfaces sees a single-game tap
priced and a 12-game prize contest not priced. Nothing on either screen
explains that, and no copy can, because it isn't sensible.

### The two honest exits

1. **Casual picking is genuinely free** — zero stake, nothing debited, nothing
   paid. See §6: this needs a schema change (`positive()` refuses 0) and a
   decision about whether a free pick settles through the ledger at all.
2. **Casual picking is cheap and the nightly is priced** — flip the inversion
   from the other end, once `ENTRY_FEES_ENABLED` is a thing that can be true.
   Note that today the nightly opener treats a priced nightly as a
   contradiction and cancels rather than opens, so this is not a config change.

Anything else ships the inversion on purpose. **This is a product call, not an
implementation detail, and it should be made before the control is designed —
the answer changes whether the control says "5 pts to play" at all.**

> **Outcome (2026-08-12): neither exit was taken, on purpose.** The inversion
> ships. Exit 1 is closed (no schema change), exit 2 is not pursued. The stake
> is 25, from config, and the control says so.

---

## 2. The supply problem, with the numbers

A prediction exists because a human opened it. That is the whole mechanism, and
it is worth stating in counts rather than in principle.

**There is exactly one writer.** `POST /predictions`, gated
`@Roles('admin', 'regional_manager', 'field_rep')`. There is precisely **one**
`insert(predictions)` in the entire API — inside `PredictionsService.create()`
(`predictions.service.ts:724`). No cron, no ingest hook, no scheduler writes
that table; the nightly pick'em scheduler creates *contests*, not predictions.
Two UIs call it: the rep's courtside console
(`app/my-games/[eventId]/page.tsx:357`) and `app/national-admin/page.tsx:162`.

**What that writer has produced, as of 2026-08-12:**

```
predictions                     5 rows total   (2 game-scope, 3 national)
  game-scope                    on 1 event, both 'resolved', both locks_at NULL
  status = 'open'               0
prediction_picks               14 picks by 9 fans
```

**What it would have to cover:**

```
events, scheduled or live
  covered (source IS NULL)      7   — of which 4 have both team FKs
  feed   (source = 'espn')    146   — of which 146 have both team FKs
                             ---
  pickable rows                153
```

**Five questions ever, zero open, against 153 pickable rows, from one human
writer that has produced two game questions in the lifetime of the product.**

The consequence is already visible one surface over: `GET
/predictions/open-games` returns `[]` right now, so the feed's "Make your
picks" band renders nothing and has been invisible for as long as the data has
looked like this. A pick control on `/games` fed by "wherever a question
happens to exist" would render on **0 of 153 rows**. That is not "most rows
lack a control" — it is all of them, and the feature would read as broken
because it would be.

---

## 3. The batch read gap — a `/games` row cannot be fed by anything that exists

Per row, a pick control needs three things: **a `predictionId`** (the POST
target), **option keys and labels**, and **`myPick`** (so a picked row shows
"Locked in" instead of offering the tap again).

| Read | Carries | Batch? |
|---|---|---|
| `GET /events/:id/predictions` | all three, plus `entry` advisory, `options[].count/share`, `totalPicks` | **no — one game per call** |
| `GET /predictions/open-games` | `eventId`, team **names**, status, `scheduledAt`, `openCount`, `minStake`, `covering` | yes, **capped at 12** |

`open-games` carries **none of the three**. No prediction id, no options, no
`myPick` — and `OPEN_GAMES_SIZE = 12` against `/games`' `PAGE_SIZE = 20`, with
"Show more" appending 20 more.

So the only way to render a real control today is a fan-out of 20
`GET /events/:id/predictions` per page, and another 20 per "Show more". That
was explicitly ruled out, and it should stay ruled out.

**The ask, either shape:**

- extend `open-games` — add `predictionId`, `options`, `myPick`; accept
  `eventIds`; drop or raise the 12 cap; **or**
- add `GET /predictions?eventIds=…`, a batch board read over the same
  `withPickData()` the two existing boards already share (it is scope-blind on
  purpose, and its own comment says a third board goes through it).

Either is backend work. Without it there is nothing for the control to read.

---

## 4. The auto-opener — and why `locksAt` at kickoff is not optional

If casual picking is real, questions have to be opened by a job, not by a
person. **One `winner` question per feed game, nightly, low stake,
`locksAt = scheduledAt`.**

**The query already exists in outline.** `NightlySlateService.slateFor(dateEt)`
(`nightly-pickem.service.ts:221`) is exactly this candidate set — tonight's
feed games, not started, league-tagged. It returns 146 candidates today, all
146 with both team FKs.

**Labels are free.** A game `winner` uses the closed key set
`KIND_KEYS.winner = ['home', 'away']` and the backend writes the labels itself
from the event's team rows (`labelledOptions`). The caller sends keys only. The
one failure mode: an event with missing team rows 409s at create — which is 3
of the 7 covered scheduled games, and 0 of 146 feed games.

### `locksAt` at kickoff, and the F2 reasoning

Both existing game questions carry **`locks_at NULL`**. Per the API's own open
ticket F2 (`RESOLVER_TICKETS.md`, "Correspondent position-holding"), a question
with no `locks_at` **never auto-closes** — there is no cron, and the lazy-lock
sweeps all key on `locks_at IS NOT NULL AND locks_at <= now()`, including the
global sweep at the top of `openGames()` that exists precisely so the carousel
cannot advertise a dead board.

An auto-opener that omits `locksAt` therefore manufactures **146 questions a
night that stay open past the final whistle**, each one advertised as pickable
on a schedule page, each one accepting stakes on a game whose result is already
known. F2 also notes that the "entry closes at kickoff" reasoning that makes
seven other surfaces safe is *false* for predictions for exactly this reason.

`locksAt = scheduledAt` is the fix and it is one field at create. It is called
out here because it is the kind of omission that looks like a default and isn't.

### Rejected supply options, for the record

- **Open lazily on the fan's first pick.** Fails on the role gate before
  anything else: opening is `admin | regional_manager | field_rep` and a fan is
  `viewer`, so the first tap 403s. It also inverts the covering gate (the fan
  becomes the opener the gate exists to exclude) and races — two fans tapping
  the same game create two questions.
- **Ask reps to open more questions.** Not a build; a staffing assumption. It
  has produced two questions.

---

## 5. The coverage-default problem

The auto-opener is a **feed-game** feature — feed games are where the volume is
(146 vs 7), and they're what the nightly slate already draws from.

`/games` defaults to `coverage=covered`. **The default view shows 7 games, and
the control would appear on none of them:** there are zero open questions on
covered games, and only 4 of those 7 could even carry a `winner` question.

Three exits, all product calls:

1. **Ship it under "All games."** Correct by construction, and most fans never
   switch the toggle, so most fans never see the feature.
2. **Change `/games`' default scope.** Cheap in code, and it changes what
   `/games` *is* — the covered default is the watch/play split holding the line
   (see THE RULE in `app/api.ts`, `isCoveredEvent`/`isFeedEvent`).
3. **Auto-open on the 4 eligible covered games too.** Doesn't fix the ratio; it
   makes the default view show a control on 4 of 7 rows instead of 0 of 7.

There is no version where the current default and a feed-shaped feature agree
without someone deciding this.

---

## 6. The zero-stake schema question — CLOSED

> **Closed 2026-08-12 by the decision in the DECIDED block.** Casual picks cost
> points, so no zero-stake path is needed and **no schema change is being
> asked for.** Kept because it records what a future "make it free" ask would
> actually cost, and because the `stake > 0` CHECK below is the reason a config
> value of 0 must be refused loudly by the opener rather than written through.

If §1 resolves toward "casual picking is free", the module cannot express it
today:

- `createPredictionSchema` declares
  `stake: z.number().int().positive().max(STARTING_BALANCE)`. **`positive()`
  rejects 0.** The floor is 1. And it is not only the DTO — the table carries
  `predictions_stake_check: stake > 0`, so a free question is refused by the
  database too. That CHECK is why the opener must refuse a configured stake of
  0 loudly instead of writing it through.
- The DB column defaults to 100 when the field is omitted, so omitting it is
  the expensive path, not the free one.
- `pick()` calls `ledger.spend()` unconditionally, and `resolve()` pays
  `stake × WIN_MULTIPLIER` while crediting `payout − stake` to
  `lifetime_earned`. A zero-stake question would move zero points through both,
  which is arithmetically fine but means a free pick earns nothing and appears
  on `/picks` as a 0-point row — worth deciding deliberately rather than
  discovering.

So: **stake 1–10 needs nothing; stake 0 needs a schema change and a decision
about whether a free pick settles through the ledger at all.** Note the
docstring on the cap — the ceiling exists because "a question staked above what
a new fan has is unplayable by every new fan." The same reasoning applied to a
casual surface argues for single digits, not 100.

---

## 7. Where the control would go (for whenever this is unblocked)

Recorded so the layout constraint isn't rediscovered.

**The whole `/games` card is one anchor.** `<article className="tcard">`
contains exactly one child, `<Link className="tcard-open">`, which wraps the
`.thumb` and `.tcard-body`. A button cannot go inside it — nested interactive
content in an `<a>` is invalid and breaks tap targets on iOS. The only legal
home is **a new sibling of the `<Link>`, inside `.tcard`, below `.tcard-body`**.
It displaces nothing; the card grows by roughly 70px.

At 390px: `main` is `padding: 24px 16px` on phones → a **358px** column, and
`.results-grid` is `minmax(240px, 1fr)` → single column, card at full 358px
(the 220px carousel width is overridden to `width: auto` inside the grid).

```
┌ .tcard ──────────────────────────── 358px ┐
│ ┌ <Link.tcard-open> ────────────────────┐ │
│ │  .thumb  16:9 gradient                │ │
│ │    [basketball]              ● Live   │ │
│ │    Lincoln          vs        Central │ │
│ │  .tcard-body                          │ │
│ │    Foxx Arena · Aug 12, 7:00 PM ET    │ │
│ └───────────────────────────────────────┘ │
│ ┌ NEW: pick strip (sibling of the Link) ┐ │
│ │  ┌ Lincoln ────┐ ┌ Central ────┐      │ │  two .predict-opt buttons,
│ │  │ 62%     8 ▏ │ │ 38%     5 ▏ │      │ │  ~171px each, existing
│ │  └─────────────┘ └─────────────┘      │ │  crowd-fill treatment
│ │  5 pts to play                        │ │  .predict-note--muted
│ └───────────────────────────────────────┘ │
└───────────────────────────────────────────┘
```

Existing tokens throughout: `.predict-opt` with `--live` / `--mine` / `--dim`,
the crowd fill behind the label, the `:active` scale, `.predict-note--muted`,
`.error.predict-error`.

**Not a `PickCard`.** That card leads with a question heading and a stake
block, which is right on a board and wrong stacked 20 deep on a schedule. The
right shape is a third, compact consumer of `usePickBoard` — which already owns
optimistic taps, the read-ordering guard, per-card 409s, the age gate and the
balance push.

### Both gates are already handled by that hook

- **Age gate.** `AgeGateGuard` sits on `POST /predictions/:id/pick` only, with
  no role exemption. `AgeGateProvider` is global in `app/layout.tsx`, and
  `usePickBoard` already routes `makePick` through `runGated` — affirm and
  retry once, decline throws a sentence the card renders inline. **Free.**
- **Covering gate.** Enforced in `pick()` via `assertNotCovering(…,
  'prediction_pick', [pred.eventId])` → 403 `COVERING_THIS_GAME`. Advised
  **per card, never per page** — which is the right precedent here: a list
  commits the fan to nothing, so one covered game closes that card and leaves
  the other 152 live. Not resolvable by the fan; render the server's message,
  grey the options, no modal, no retry. Costs fans nothing —
  `coveringVerdict` has a staff-role fast path that never touches the database.
  See also the separate drift ticket: `open-games-covering-drift.md`.

---

## 8. What should not be built, whatever §1 decides

- **A fan-out.** 20 board reads per page, 20 more per "Show more".
- **A `PickCard` per games row.** Question heading + stake block + option list,
  20 deep, on a page whose job is "what's on tonight".
- **A control that renders on 0 of 153 rows** while the feature is called
  shipped.
- **Client-side question creation.** The role gate refuses it and it makes the
  fan the opener the covering gate exists to exclude.
- **A poll on `/games`.** The game board polls at 5s because it is one live
  game. A 20-row schedule gets no heartbeat — load once, re-read the single row
  after its own pick.
- **Multiple questions per row**, an expand-the-card affordance, or a
  fan-chosen stake.
- **A second copy of the pick state machine.** A new surface consumes
  `usePickBoard` or the race conditions get re-litigated.
- **A local sentence for either gate.** Both messages are server-owned.
- **An `openCount` / `minStake` badge dressed up as picking.** A badge that
  links to the game page is honest and is *not this feature*; shipping it as
  this feature is the decorative outcome the ask ruled out.

---

## Status (2026-08-12, second pass — the backend half is built)

- **§1 (the inversion): SETTLED.** Deliberate. See the DECIDED block at the top.
- **§6 (zero stake): CLOSED.** No schema change asked for.
- **§3 (batch read): BUILT.** `GET /predictions/for-events?eventIds=a,b,c`, a new
  route rather than more fields on `open-games` — the argument is in
  `PredictionsService.forEvents`'s header, and the short version is that
  `open-games` answers *discovery* ("which 12 games can I pick on") while this
  answers *enrichment* ("for these 20 rows, what is pickable"), and its 12-cap is
  the carousel's length rather than a page size. Mirrored in the web client as
  `getQuestionsForEvents` / `EventQuestion`.
- **§4 (auto-opener): BUILT, and gated off.** `NightlyQuestionsService` +
  `NightlyQuestionsScheduler` (the platform's fifth cron family), noon ET, one
  `winner` question per eligible feed game, `locksAt = scheduledAt`, stake from
  config. Operator surface at `POST|GET /predictions/nightly/{open,preview,cron-status}`.
  Nothing runs until `NIGHTLY_QUESTIONS_CRON_ENABLED=true` and
  `NIGHTLY_QUESTIONS_OWNER_USER_ID` are set on the deployed host.
- **§5 (coverage default): STILL A PRODUCT CALL.** Reported, not decided. Under
  the opener's feed-only rule the `/games` default (`coverage=covered`) shows 7
  rows with a control on **none** of them.

### Status (2026-08-12, third pass — all of it is built)

- **§5 (coverage default): DECIDED — options 1 + 3.** The `/games` default stays
  `coverage=covered`; the opener was extended to covered games with both teams.
  The deciding argument was settlement, not volume: a covered game is closed by
  its correspondent and swept by phase K if nobody closes it, which is a
  guarantee the feed arm does not have. The opener's predicate is now a
  disjunction with a different requirement per arm — feed needs an
  `external_ref` (the provider is asked by ref), covered needs nothing further.
  House questions on games reps attend are fine: the covering gate refuses the
  assigned correspondent per row, with the server's own sentence.
- **The index: APPLIED as a migration file**, `drizzle/predictions_one_open_per_game.sql`
  — partial unique on `(event_id) WHERE scope='game' AND status='open'`. Partial
  on purpose: a full one would forbid a rep's second courtside question and
  would forbid a fresh question after a void (the covered sweep's documented
  "open a fresh one" path). Not yet run against local/cloud.
- **The stranded stakes: BUILT as resolver phase N**, and it grew in scope while
  being proved — see below.
- **The frontend: BUILT.** `app/game-pick-strip.tsx` (`useGamePicks` +
  `GamePickStrip`) over the existing `usePickBoard`, wired into both card
  variants on `/games` as a **sibling of the card's `<Link>`** (the whole card is
  one anchor; a nested button is invalid markup and breaks the iOS tap target).
  One batch request per rendered page, no poll, renders nothing on a row with no
  question.

### What the proofs changed about the code

Two things, and both are the reason to write proofs at all:

1. **Phase N was feed-only, and that was wrong.** A COVERED game abandoned as
   postponed/canceled is stranded by all three paths that look like they should
   catch it: `reportResult`'s prediction hook is `if (status === 'final')`, phase
   K's candidates are `status IN ('scheduled','live')` (it catches the game
   *nobody closed*, not the game someone closed as abandoned), and phase N gated
   on `external_ref`. So the "covered games have a settlement guarantee" argument
   that decided §5 was true of the never-closed case and **false of the
   explicitly-abandoned one**. Phase N now covers both coverages, which makes it
   true of both — and it is not a breach of the resolver's ownership invariant,
   which is about *taking results from the provider*; this phase takes none.
2. **`locksAt` was landing up to 999ms before kickoff.** The opener built its ISO
   string with `HH24:MI:SS`, truncating the microseconds off `scheduled_at`. Real
   feed kickoffs are whole minutes, so it would never have shown up in
   production. Now `.US`, exact round-trip.

### The ledger verb, answered

**`'adjustment'` — the shared literal, not a new string, and phase N writes no
ledger row of its own.** It calls `voidPrediction()`, which refunds with
`adjust()` under `PREDICTION_ADJUSTMENT`, whose value *is* `'adjustment'`. The
comment above that constant is the argument: `action_type <> 'adjustment'` is the
only thing separating a lifetime-raising earn from a balance-only credit, because
`point_events` has no column for it — so a bespoke `'prediction_refund'` would
silently break that predicate everywhere it is used (the tier basis, the economy
console, the fan's own history). `reference_type` and the note carry the detail
instead. Asserted in `scripts/proof-abandoned-refunds.ts` proof 2 so nobody
"clarifies" it later.

### Proofs

Both throwaway-DB, booting the real Nest context and driving the shipped
services, per the existing `scripts/proof-*.ts` convention:

- `scripts/proof-abandoned-refunds.ts` — **33/33.** The money: exact balances,
  one refund row per pick, `lifetime_earned` untouched, idempotent across runs,
  four concurrent resolves paying each pick exactly once, covered-abandoned
  refunded, final games resolved (not refunded), national questions never in
  scope.
- `scripts/proof-nightly-questions.ts` — **41/41.** Eligibility per settlement
  arm, `locksAt` exactly equal to kickoff on every row, a disabled price row
  refusing the night, double-run opening nothing, a rep's question suppressing
  the auto one, the index refusing a second open question while still allowing a
  fresh one after a void, and the batch read's shape.

### Two follow-ups the build opened, neither applied

1. ~~No unique index makes one-question-per-game a guarantee.~~ **CLOSED** —
   `drizzle/predictions_one_open_per_game.sql`, proved by
   `proof-nightly-questions.ts` §6. Still needs applying to local and cloud.
2. ~~Nothing voids a prediction on a POSTPONED or CANCELED feed game.~~ **CLOSED
   by phase N**, and it turned out to be wider than reported: covered games were
   stranded too. Proved by `proof-abandoned-refunds.ts`.

### What is left before the cron can be enabled

1. Apply both migrations to local **and** cloud:
   `drizzle/predictions_nightly_stake.sql` and
   `drizzle/predictions_one_open_per_game.sql`, then
   `./scripts/rebuild-schema.sh && ./scripts/verify-schema.sh`. The opener
   refuses the night without the first; the second is the uniqueness guarantee.
2. Set `NIGHTLY_QUESTIONS_OWNER_USER_ID` on the deployed host, then
   `NIGHTLY_QUESTIONS_CRON_ENABLED=true`. Check
   `GET /predictions/nightly/cron-status` reports a future `nextRunAt`.
3. Dry-run first: `GET /predictions/nightly/preview` shows the candidate list,
   the coverage split and the stake, and writes nothing.
4. The frontend strip is typechecked but **not visually verified** — nothing has
   been rendered in a browser, because the data it needs does not exist until the
   opener runs. Worth a look at 390px once step 3 shows candidates.
