# `open-games` sends `covering` and this client has never had the field

Found on 2026-08-12 during the `/games` picking recon
(`casual-picking-on-games.md`). Unrelated to that feature — filed separately
because it is live now, small, and self-contained.

---

## The drift

**The backend sends it.** `PredictionsService.openGames()` ends with:

```ts
// sharp-foxx-api/src/modules/predictions/predictions.service.ts:1454
return games.map((g) => ({ ...g, covering: covering.has(g.eventId) }));
```

and the controller says why, in as many words
(`predictions.controller.ts`, `@Get('open-games')`):

> Takes the caller for the covering gate's advisory half only — each card
> carries `covering`, so a correspondent's own game greys out on the strip
> instead of linking them to a board that will refuse the tap.

**The client type does not have it.** `OpenPickGame` (`app/api.ts:2835`) lists
`eventId`, `homeTeamName`, `awayTeamName`, `status`, `scheduledAt`,
`openCount`, `minStake`. No `covering`.

**The card does not use it.** `OpenGameCard` (`app/feed-picks.tsx:387`) renders
the matchup, the kickoff or LIVE badge, a "Scores" tag for feed games,
`openCount` and `minStake`. Nothing greys out. A correspondent covering the
game gets the same live, tappable card every other fan gets.

So the field has been on the wire for as long as the endpoint has existed, and
the greying-out its own comment describes has never happened on this side.

## Why this is the failure mode the `entryRefusal` guard exists to catch

This is one surface over from the case documented at length above
`entryRefusal` in `app/api.ts`:

> `PickSheet.entry` and `SurvivorPicks.entry` were declared **non-optional**,
> the server never sent either one, and this helper read absent as "nothing to
> say". Two `<EntryAdvisoryNotice>` render sites sat dead on the contest pick
> sheet and the survivor board with no error, no warning and nothing on screen.

Same class, mirrored: there the client declared a field the server never sent;
here the server sends a field the client never declared. Both produce **a
covering advisory that silently does not render**, and both are invisible
because nothing fails — no console error, no type error, no bad request. The
guard that was written to make this loud cannot help, because `covering` never
passes through it: it is a bare boolean on a different read, not an
`EntryAdvisory`.

## What it actually costs today

**Under-advising, not a broken pick.** Two layers still hold:

- `PredictionsSection` on the game page reads the board's `entry` through
  `entryRefusal(rows[0].entry, …)` and renders `EntryAdvisoryNotice` correctly,
  so the refusal *does* arrive — one tap later than intended.
- `pick()` still 403s `COVERING_THIS_GAME` regardless.

The cost is the one the controller comment names: a correspondent is invited to
a board that will refuse them, instead of being told on the strip. Note that
`/predictions/open-games` returns `[]` today (there are zero open questions
platform-wide), so **the band is currently invisible and nobody is hitting
this** — which is exactly why it should be fixed before question supply exists
rather than after.

## The fix, and the one thing to get right about it

Small:

1. Add `covering: boolean` to `OpenPickGame` in `app/api.ts`, with a comment
   pointing at the service line above.
2. In `OpenGameCard`, use it: dim the card, drop the pick-affordance framing
   (`openCount` / `minStake` read as an invitation), and mark it as not-for-you.

**Do not write a sentence for it here.** The covering doctrine in `app/api.ts`
is explicit — *"THE MESSAGE IS SERVER-OWNED. Render `message` verbatim; never
write a local sentence for this and never pattern-match on one."* — and
`open-games` deliberately sends **no message**, only the flag. The service says
why, in the block above that return:

> The per-card refusal the fan needs is already on the board this card links to
> (`listForEvent`'s `entry`), so this read carries the flag and not a sentence.

So the honest client fix is: **the flag changes the card's appearance, and the
board it links to still supplies the words.** A short neutral tag is the most
that should appear on the card itself. If a per-card sentence is wanted, that is
a backend ask for a `message` on this read — not a local string.

Also worth checking while in there: whether any other read carries a bare
`covering` flag this client silently ignores. `ParlaySlateGame.covering`
(`app/api.ts:4422`) does have the field declared; that one is wired.

---

## Status (2026-08-12)

**Open.** Frontend-only as described (option 2 needs no backend change).
Currently unobservable because the band is empty, and it stops being
unobservable the moment anything opens questions at volume — see
`casual-picking-on-games.md` §4.
