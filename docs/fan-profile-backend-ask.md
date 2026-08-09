# Backend ask — reads the fan profile needs

Written from `sharp-foxx-web` after building `/profile` (the fan's own page:
standing on both boards, Arena streaks, badge shelf, points ledger, follows).

**The profile shipped without these.** Nothing here is blocking; each one is a
place where the frontend is currently either lying by omission or paying for the
absence with a fan-out. Paste the section you want to work on into the API repo.

---

## Ask 1 — a fan's collected items. `GET /me/items` (preferred) or a Call badge read

### The bug that surfaced it

The Correspondent's Call awards **Caller of the Week**, and the prize is a
`user_items` badge — that is stated in the API's own contract, which this client
mirrors in `CallCallerOfTheWeek`:

> the prize is a `user_items` badge, so it shows in the winner's inventory after
> this card is history.

**There is no inventory read, so it doesn't.**

The only endpoint carrying the title is `GET /arena/call/current`, which serves
*this week's* card and nothing else. There is no `/arena/call/history` and no
per-fan Call item read. So the sequence a winner actually gets is:

1. They win. `current.callerOfTheWeek.youWon` is `true`, the card says so, and
   the fan-side Call notification (`linkCall()` → `/arena/call`) points at it.
2. The week turns.
3. `/arena/call` now serves next week's card. `callerOfTheWeek` is somebody
   else's, or null.
4. **The title is gone from the product.** There is no surface anywhere — not
   the Call page, not the Arena hub, not the profile — that can show a fan a
   Caller of the Week they won last month.

We notify a fan about an honour and then take away every trace of it. That is
worse than never having awarded it: the badge row exists in `user_items`, so
the data is *there* and simply unreachable.

### Why the fix should be `GET /me/items`, not `GET /arena/call/badges`

A Call-specific read would fix Caller of the Week and leave the shape of the bug
completely intact.

The profile's badge shelf today assembles a fan's inventory from **three
game-specific reads**:

| Source | What it yields |
| --- | --- |
| `GET /arena/oracle/today` | `badges[]` — Oracle streak badges, Oracle Slayer |
| `GET /arena/trail/pennants` | `pennants[]`, `trophies[]` |
| *(nothing)* | Call badges |

Three requests to answer one question ("what has this fan collected?"), and the
answer is **wrong by construction**: it can only ever contain items from games
that were wired in by hand. The Call is not a special case — it is the first
game to prove the rule. Every future Arena game that mints a `user_items` row
ships as a silently missing section of this shelf, with no error, no 404, and
nothing on any screen to indicate an omission. The shelf just looks complete and
isn't.

Two further oddities that a unified read also cleans up:

- **Oracle badges ride on a day card.** `badges[]` comes down with
  `GET /arena/oracle/today` — a fan's permanent inventory attached to the
  read for "what is today's game", so a day with nothing scheduled is a
  request the profile makes purely for badges.
- **The pennant *count* has two sources** (`trail/today.progress.pennants` and
  `trail/pennants.totals.pennants`) and the profile has to prefer one.

### Suggested shape

```
GET /me/items            → { items: UserItem[], totals: { <type>: number } }
GET /me/items?game=call  → the same, narrowed
```

```ts
interface UserItem {
  key: string;          // 'oracle_slayer', 'caller_of_the_week', <townSlug>, ...
  type: string;         // 'badge' | 'pennant' | 'trophy' | ...
  game: string;         // 'oracle' | 'trail' | 'call'
  earnedAt: string;
  metadata: Record<string, unknown> | null;
}
```

Two properties of the existing item contract must be kept, because this client
depends on both:

1. **Ship no names and no art.** The API deliberately sends only `key` +
   `metadata`, and the display copy lives client-side (`oracleBadgeMeta`,
   `trailItemMeta`, `trailTrophyMeta`) precisely so that what a fan *earned*
   doesn't change under a redesign. Keep that.
2. **Keep `metadata` as the earn-time snapshot.** It is the only reason a
   pennant from an archived season still renders a town name.

`game` is the one field worth adding: it's what lets the shelf group by game
without a key-prefix convention, and what makes a new game appear on the shelf
the day it starts minting rather than the day someone remembers to wire it up.

**If a unified read is too big a change right now**, the minimum that stops the
active harm is any endpoint that returns a fan's Call badges — but please treat
it as an interim fix and not the answer, because the shelf stays silently
incomplete for game #4.

---

## Ask 2 — `GET /contests/mine`

### The problem

There is no way to ask which contests a fan has entered. `/contests` is
list + detail only, and `myEntry` lives on the **detail** read.

So `/picks` derives it, and the workaround is documented in the page because it
is not defensible as a permanent arrangement:

```
list a bounded page of contests (24), read EACH ONE's detail to see if
myEntry is set, then read the parlay board for each parlay entry
```

That is **1 + 24 + N requests** to render a section that is usually three rows.
It is capped, so a fan's older finals past the scan window simply don't appear —
the section is quietly incomplete for exactly the fans who've played most. And
the cap is the only thing keeping the cost bounded: without it, the fan-out
grows with the size of the contest lobby, which has nothing to do with how many
contests the fan entered.

### Why it matters now

The profile page deliberately **does not** show My Contests — it links to
`/picks` instead — specifically so this fan-out isn't paid for twice. That's the
right call today and a bad reason to leave a section off a page. A `mine`
endpoint would let the profile carry the fan's contest standing where it
belongs, alongside their Arena standing and their board ranks.

### Suggested shape

```
GET /contests/mine?status=&limit=&offset=
  → Page<ContestDetail-with-myEntry>   (or a slimmer row: id, title, type,
                                        status, entryCost, myEntry, entrants)
```

Ordering that matches the lobby's (open + live first, then newest) would let the
client drop its own sort. Including the parlay tally (`myTicketCount`, total
staked) on a parlay-board row would kill the second fan-out too — right now
that's a separate `GET /contests/:id/tickets` per board purely to say "3 tickets
· 150 staked".

---

## Not asked for, deliberately

Recording these so nobody adds them on the theory that the profile wants them:

- **A public fan read (`GET /fans/:id/*` beyond points-summary).** We are not
  building a public fan profile page. `points-summary` is the public fan record,
  `balanceHidden: true` is the right call, and `FanCard` renders it. Widening
  the public surface is a product decision nobody has made.
- **`PATCH /users/me`.** No fan avatars, bios, or display-name editing. The
  profile is standing and history, not an identity to decorate.
- **Predictions writing to `point_events`.** Known and understood: the ledger is
  "points economy activity" and the pick history is its own record on `/picks`.
  Both surfaces say so. Not a gap this page needs closed.
