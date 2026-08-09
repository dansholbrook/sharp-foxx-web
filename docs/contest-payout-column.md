# `contest_entries.payout_points` — make the settled payout a read

Filed from `sharp-foxx-web` while building the settled verdict block on the
pick'em / over-under scorecard (`app/contests/[id]/page.tsx`, `SettledVerdict`).
**No backend code was changed.** The frontend ships working against today's
contract for pick'em and over/under; it does so by **re-deriving** a number the
backend already computed, and this ticket is about removing that derivation
before it costs someone.

Survivor is **not** shipped, and cannot be until this lands.

---

## The gap

Finalize pays through the ledger and never writes the amount back to the entry:

```ts
// contests.service.ts:402
await this.ledger.earn(
  e.userId, 'contest_payout', points, { type: 'contest', id },
  `Rank ${e.rank} payout`, tx,
);
```

`contest_entries` carries `score` and `rank`. There is no payout column. So
after settlement, the amount a fan was credited lives in exactly one place: a
`point_events` row.

**That row is not reachable from the contest screen.** `GET /points/ledger`
(`ledgerPageSchema`, `contests.service.ts:119`) accepts only `limit` (max 100)
and `offset` — no `referenceId`, no `referenceType`, no `actionType`. Reaching
one contest's payout means paging a fan's entire statement newest-first and
matching client-side, unbounded in the number of requests. That is the same scan
pattern already removed from `/picks`, and it is not worth reintroducing for one
integer.

## What the client does instead

`payoutForRank()` re-derives the amount from `config.payouts` + `myEntry.rank`,
both already on `GET /contests/:id`. For pick'em and over/under this is **exact,
not approximate** — it is the same map lookup finalize performed, in the DUPLICATE
tie arm at `contests.service.ts:378`:

```ts
for (const e of ranked) {
  const points = e.rank == null ? undefined : payoutByRank.get(e.rank);
  if (points && points > 0) amountByEntry.set(e.id, points);
}
```

## Why that is a liability rather than a solution

**The client is now reproducing finalize's tie logic.** That arm is taken only
when the contest type does not set `splitTies`. Pick'em and over/under don't
today, which is the derivation's entire licence.

**The day pick'em gains `splitTies`, the client silently overpays.** The other
arm divides a rank's pool evenly among everyone tied at it and hands the integer
remainder to the earliest entrants; the tie group's size is not on the detail
read at all. The client would keep printing the full rank prize to every tied
fan — a figure nobody was credited — and:

- nothing fails loudly; both versions typecheck
- no test catches it; the frontend has no fixture of a tied settlement
- the wrong number appears on the one screen whose entire job is to be believed

It would be found by a fan noticing their balance disagrees with the screen.

## The change

Add `payout_points integer not null default 0` to `contest_entries`, written in
finalize's existing pay loop from the `amountByEntry` map it already builds —
the same value, in the same transaction, alongside the `earn()` call. Surface it
on `ContestEntry` (so it rides `detail()`'s `myEntry`) and on the leaderboard
row.

Then delete `payoutForRank()` and read the column.

### What it unblocks

**Survivor.** Survivor sets `splitTies: true`, so its payout genuinely cannot be
derived client-side — the amount depends on the size of the rank-1 tie group and
on entry order for the remainder points. Today `SurvivorBoard`'s final state is
an `Alive`/`Eliminated` badge and nothing else: no rank, no leaderboard, no
payout. It was deliberately left alone rather than given a guessed number,
because a wrong number here is worse than no number. A stored column makes
survivor's verdict the same three-line block the pick'em scorecard now has.

**Squares and parlay are already fine** and unaffected — both carry their payout
on their own reads (`pointsPaid` per period, `ticket.payoutPoints`).

### Alternative, if the column is unwanted

A `referenceType` / `referenceId` filter on `GET /points/ledger` would also make
this a read, and would serve any surface wanting "what did this thing pay me".
It costs a second request per scorecard where the column costs none, and it
leaves the payout keyed by contest rather than by entry — worse for the
leaderboard, which would want every row's payout at once.

The column is the smaller change and the better shape. This is the fallback.

---

## Scope note

Nothing above blocks what shipped. Pick'em and over/under are correct today and
correct for as long as neither type sets `splitTies`. This ticket exists so that
condition is written down somewhere other than a comment in a React component.

---

# Unrelated, filed here rather than lost: the contest leaderboard says `pts`

**Not a backend ask, and nothing to do with the column above.** A frontend design
question found while fixing the same defect one element higher up the page.

## What

`app/contests/[id]/page.tsx:1014` — `LeaderboardRow` renders the contest
standings as:

```tsx
<span className="points-lb__score">
  {points(Math.round(Number(row.score)))}
  <span className="points-lb__unit">pts</span>
</span>
```

`row.score` is `contest_entries.score`, which for a pick'em is
`correct × pointsPerCorrect` — the RANKING score. Nothing ever credits it.
`pickem.type.ts:22` is explicit that `pointsPerCorrect` is "the per-correct-pick
payout in points on the scoreboard, NOT the ledger", and `scoreEntry` only ever
writes it to the `score` column.

So on a settled contest the screen now reads:

- the verdict block: `+250` — **real points, credited to the balance**
- the leaderboard below: `250 pts` next to a fan's name — **a ranking score,
  credited to nobody**

That is the same two-numbers-one-word confusion that the `2 pts each` line in
`Scorecard` was just fixed for. It moved rather than left.

## Why it wasn't fixed in that change

**The word is correct on the platform board and wrong only here.**
`app/leaderboard/page.tsx:115` renders the identical markup, and its `score` is
`lifetime_earned` (Most earned) or gross winnings (Most won) or `signedPoints`
net on a game — all three genuinely points, all three genuinely credited.

The two boards share the `points-lb__*` CSS but **not** a component: each renders
its own row markup. So the edit itself is local and cheap — three lines in
`LeaderboardRow`, no fork, no shared prop to thread.

What isn't cheap is the decision. Changing the word here makes the contest
standings *look* like they are measuring something different from the platform
standings, which they are. Whether that divergence is a clarification or an
inconsistency is a product call about how many kinds of number this app admits
to having, and it should not ride in on a settlement-copy fix.

## What it needs

A decision on one of:

1. **Diverge.** Contest standings drop the unit or say `score`; the platform
   board keeps `pts`. Truthful, and admits the two boards count different things.
2. **Converge on the honest name.** Both say `score` — but the platform board's
   number really is points, so this makes the more common surface vaguer to fix
   the rarer one.
3. **Leave it.** Accept that `pts` is doing double duty and rely on the verdict
   block's `+250` being visually dominant enough that the leaderboard reads as
   standings rather than as payouts.

(1) is the likely answer. It is written up here so whoever takes it has the
argument rather than re-deriving it from two files.
