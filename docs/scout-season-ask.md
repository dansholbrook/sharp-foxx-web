# Backend ask — the Scout Book client cannot discover the season

Paste into the `sharp-foxx-api` repo.

---

## The problem

The Scout Book web client is being built against `/scout`. Two of its reads
require a `season` and there is no way for the client to learn what it is.

```
GET /scout/cards?season=…        season REQUIRED (400 without)
GET /scout/leaderboard?season=…  season REQUIRED (400 without)
```

`season` is `z.string().trim().min(1).max(16)` — a free string. Verified on the
wire just now:

```
GET /scout/cards?season=2026          → 200 {"cards":[],"poolCap":100}
GET /scout/cards?season=2025-26       → 200 {"cards":[],"poolCap":100}
GET /scout/cards?season=lacrosse-era  → 200 {"cards":[],"poolCap":100}
```

Every string is accepted and every one returns the same empty list. The client
has no endpoint that names the season and no way to tell a correct season from
a typo, because both answer `200` with `cards: []`.

The only endpoint that would name it is `GET /scout/book`, and its no-season
branch nulls it out:

```
GET /scout/book → {"season":null,"week":null,"swapWindowOpen":false,
                   "slots":[],"slotsTotal":5,
                   "message":"No Scout Book season is running."}
```

**Please do not tell me to hardcode it client-side.** The server already derives
the season from `events.scheduled_at`; a constant in the web repo is a second
source of truth that drifts silently, and an env var is the same problem with a
deploy attached. This needs to come off the wire.

## Why this matters more than a missing field

The Scout Book's launch state is an **empty market** — `prospect_cards` has 0
rows, `scout_weeks` has 0 rows, and every athlete on the platform is D-I and
therefore excluded by design. The client's job today is to render that emptiness
*honestly*, and that means distinguishing two states the fan experiences very
differently:

1. **No season is running** — the game has not started.
2. **A season is running and nobody is eligible yet** — the eligibility rule is
   working.

Right now a wrong or guessed `season` string produces a response byte-identical
to state 2. So a client typo renders as "the eligibility rule is working," which
is a false statement about a compliance rule, on the one screen where that
statement is the entire content. That is why this is worth a backend change
rather than a client workaround.

## What I think the change is — please push back if you disagree

**Smallest correct change: `GET /scout/book` reports the current season on the
no-season branch.**

```jsonc
// no live week, but the season is still a fact the server knows
{ "season": "2026", "week": null, "swapWindowOpen": false,
  "slots": [], "slotsTotal": 5,
  "message": "No Scout Book season is running." }
```

The client then reads `/scout/book` first and passes `book.season` to
`/scout/cards`. One new value, no new route, no changed signatures.

**But I am not confident it is sufficient, and here is my hesitation.** It fixes
*discovery* while leaving the client able to be *wrong* — it still constructs a
query string from a value it carries between two calls, and the endpoints still
answer `200 {"cards":[]}` to anything at all. It also makes the market read
depend on the book read, which couples two endpoints that are otherwise
independent, for no reason other than that one of them happens to know a string.

**The alternative I'd rather have: make `season` optional and default it
server-side, then echo back what was resolved.**

```jsonc
GET /scout/cards                 // no season → server resolves the current one
→ { "season": "2026", "cards": [], "poolCap": 100 }

GET /scout/leaderboard
→ { "season": "2026", "standings": [], "leader": null }
```

`/scout/leaderboard` already echoes `season`; this makes `/scout/cards` match it
and makes the parameter what it should have been — an override for reading a
past season, not a required incantation the client has to source from somewhere.
The client stops being able to get it wrong, because it stops being asked.

Three questions I actually want answered rather than assumed:

1. **Is there one current season, server-side, without a live `scout_weeks`
   row?** The whole ask rests on this. `getBook()` reads
   `scout_weeks WHERE status='live'` and finds nothing today, so if "the current
   season" is *only* derivable from a live week, then the honest answer is that
   there is no season and `season: null` is correct — in which case tell me, and
   the client will render "the game has not started" off the null and stop
   asking. That is a fine outcome; I just need to know which it is.
2. **Should an unknown season 404 instead of returning `200 {"cards":[]}`?** I
   lean yes, and it is separable from the rest of this. A season with no
   `scout_weeks` rows is a different fact from a season with no eligible
   prospects, and only one of them is the compliance story. But you own whether
   an empty season is a legitimate read.
3. **If `season` becomes optional, does anything already call these with a
   season that is not the current one?** If so, optional-with-default is
   backwards-compatible and the change is safe; if something depends on the
   400, say so.

Whatever you land on, **please reply with the exact final response shape** for
`/scout/book` and `/scout/cards` — the client types are written against the wire
and I want to type them against yours, not against my guess.

---

## Appendix — a second, smaller gap. Not blocking; ignore if you're busy.

The prospect detail screen renders the four bonus events as a ladder, because
that ladder is the screen's proof that **every listed way to move is upward** —
it is the compliance story stated in the UI, on a card about a real named
19-year-old.

The four types are in `prospect_events.type`
(`team_win`, `feature`, `conference_honor`, `called_up`), but their point values
live in `arena_rewards` and `BONUS_REWARD_KEY` maps to them admin-side only.
There is no fan-readable route that returns those values.

So the client will render the ladder **without numbers** — the four events named,
with "every one of these adds; nothing on this card subtracts." That is arguably
the better copy anyway, and it is certainly better than hardcoding the spec's
+10/+25/+50/+500 into the web repo, where they would silently diverge the first
time someone tunes `arena_rewards`.

If a fan-readable read of the four scout reward values is cheap, the ladder can
carry real numbers. If not, the wordless version ships and nothing is blocked.
