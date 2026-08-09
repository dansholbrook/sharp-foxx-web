# Notification deep links — the contract, and how to check it

Every notification the platform emits carries a `deepLink`: a path into the
one-tap action, built in ONE place —
`sharp-foxx-api/src/modules/notifications/deep-links.ts`. This client routes
that path **exactly as it arrives**. There is no resolver, no rewrite table, no
fallback.

This file exists because that contract was wrong once and nothing caught it.

## What happened

`deep-links.ts` built the correspondent's two Call paths by assuming the
`/arena/*` client routes mirrored the API's URL prefixes — its own header said
so, and flagged the assumption as unconfirmed. They don't mirror. The client
serves the **verb before the id**; the backend emitted the **id before the
verb**:

```
emitted   /arena/call/<callId>/grade      served   /arena/call/grade/[callId]
emitted   /arena/call/<callId>/compose    served   /arena/call/compose/[callId]
```

Both 404ed. The affected types were `call_needs_grading` — the backend's own
type registry calls it the highest-value correspondent message on the platform
— and `call_assigned`, whose entire stated purpose is to be the link a rep
cannot get any other way.

This client shipped `resolveDeepLink()` to rewrite the two paths in flight so
the tray could ship without waiting. That function is now deleted; the backend
emits the correct form. **Do not reintroduce anything like it.** A client-side
repair turns a wrong path from a visible 404 into an invisible correction, and
the next mismatch then has nothing to surface it.

Neither a type system nor a build catches this class of bug. Both sides of the
mismatch are `string`. The only thing that catches it is checking the emitted
path against a route file, which is what the table below is.

## The contract — all seven shapes

| Builder | Emitted path | Route file in this app |
| --- | --- | --- |
| `linkOracle()` | `/arena/oracle` | `app/arena/oracle/page.tsx` |
| `linkTrail()` | `/arena/trail` | `app/arena/trail/page.tsx` |
| `linkCall()` | `/arena/call` | `app/arena/call/page.tsx` |
| `linkCallGrade(id)` | `/arena/call/grade/<callId>` | `app/arena/call/grade/[callId]/page.tsx` |
| `linkCallCompose(id)` | `/arena/call/compose/<callId>` | `app/arena/call/compose/[callId]/page.tsx` |
| `linkMyGame(id)` | `/my-games/<eventId>` | `app/my-games/[eventId]/page.tsx` |
| `linkProfile()` | `/profile` | `app/profile/page.tsx` |

The `linkCallGrade` / `linkCallCompose` rows are the ones corrected in the
original audit; the four above them were checked at the same time and were
already right.

`linkProfile()` was added later, and for a different class of mistake than the
transposed paths this document was written about. **It resolved fine — it was
just pointed at the wrong screen.** `call_caller_of_week` deep-linked to
`linkCall()`, which serves the *current* card, so a fan who won the title could
tap the notification that week and see it, and tap the same notification the
following Monday and land on somebody else's card with no trace of their own.
The badge shelf on `/profile` reads `GET /me/items` and holds it permanently.

The rule that came out of it: **a notification about a permanent thing points at
the surface that keeps it; a notification about this week's result points at this
week's card.** `call_graded` correctly keeps `linkCall()` on that basis — the
score, the pot share and the answer key are all on the card and none of them
outlive the week.

The other two item-bearing notifications were checked against the same rule and
need no change: `oracle_result` → `/arena/oracle`, whose day read returns every
Oracle badge the fan owns regardless of the day, and `trail_result` (which also
announces leg and season trophies) → `/arena/trail`, which carries the pennant
book. The Call was uniquely broken because it is the one Arena game whose page
is scoped to a period and has no collection view of its own.

`callStaffRoute()` in `app/api.ts` builds the same two Call staff paths for the
desk's own row clicks. It was correct throughout — it is the local proof of what
the routes actually are, and it is worth checking any new Call link against.

## The ten cases

These are the checks written to verify the deleted normalizer, re-pointed at the
fixed arrangement. They were kept rather than deleted with it: they are the only
executable statement of this contract in either repo.

Cases 1–6 — **each builder's output is a route this app serves.** Take the path
from `deep-links.ts`, substitute a uuid for the id segment, and confirm the
matching route file in the table above exists and its dynamic segment name lines
up (`[callId]` gets a call id, `[eventId]` gets an event id — the two are not
interchangeable and both are uuids, so nothing but the route file tells you).

Case 7 — **`/arena/call/<uuid>/grade` is served by nothing.** The old transposed
form must 404 rather than resolve. If it resolves, a rewrite has come back.

Case 8 — **`/arena/call/<uuid>/compose` is served by nothing.** Same, for the
compose link, whose failure mode is worse: it was the only route to a draft.

Case 9 — **an unrecognised path routes unchanged.** A new backend emit site
should reach its destination without being registered anywhere in this app
first. Nothing here is allowed to be a gate on that.

Case 10 — **a path this app does not serve 404s.** A genuinely dead link must
surface as a dead link. This is the case the normalizer was structurally at odds
with, and the reason it is gone.

## Adding a notification type

Add the builder in `deep-links.ts`, then **open the route file**. Not the API
controller — the route file under `app/`. The API prefix is not evidence about a
client route; that inference is what produced the original bug. Then add a row
to the table above.
