# "No odds, no lines, no props" — where numbers in the UI sit against that rule

The Arena spec bans **"odds", "lines" and "props"** from UI copy. This platform's
entire position is that it is not a sportsbook, so the exposure here is legal
rather than product: a number that *reads* as a price is a problem even when
nothing about it is one, and a screenshot does not come with a legend.

This file exists so the reasoning below is written down rather than
re-litigated. It was written when the pick'em crowd split was fixed, and it
deliberately records the numbers that were **left alone** and why — those are
the ones a future sweep will ask about.

---

## The test

A number in the UI is a problem when **all three** are true:

1. It is a **percentage or a price-shaped figure** (not a count, not a score).
2. It renders **next to a matchup or a final score**, where the surrounding
   furniture supplies a betting frame for free.
3. **Its subject is not named in the same breath.** A legend elsewhere on the
   page does not count — the row is what gets cropped into a screenshot, and the
   crop is what travels.

Counts are materially safer than percentages and should be preferred where
either would do. "412 riding" cannot be a price; "83%" beside a team name can.

---

## Fixed

### The pick'em / over-under crowd split — `app/contests/[id]/page.tsx`

**Was:** a bare two-column legend under a proportional bar — `Away 67%` /
`Home 33%`. All three conditions met. The block is gated on `revealed`, which
the backend only sets at locked/live/final, so it was *structurally guaranteed*
to render beside a score; there was no state in which the innocent reading came
for free. The only place the word "crowd" appeared was an `aria-label`, which is
invisible in a screenshot.

**Now:** one sentence, both halves naming the subject.

```
67% of fans picked Washington · 33% of fans picked Portland
38% of fans picked Under · 62% of fans picked Over
67% of fans picked the away side · 33% of fans picked the home side   (unnamed teams)
```

Three decisions in `DistributionBars`, all commented at the call site because
each looks like something a later tidy-up would undo:

- **"of fans" appears on both halves.** At `0.7rem` the line wraps on a phone
  and wraps *at the separator*, so each half must survive being cropped alone.
  Shortening the second to `· 33% Portland` reintroduces exactly the artifact
  this fixed. The repetition is the guarantee.
- **"picked", not "took".** *Took* is bettor's register (you take a side, you
  take the points). *Picked* is the product's own verb and is already in the
  same row two lines above: "Your pick: Washington".
- **Unnamed sides fall back to "the away side"**, not the matchup's `TBD` —
  "33% of fans picked TBD" is not a sentence.

---

## Left alone, deliberately

### The over/under line itself — same file, same row

An O/U row prints its total twice: in the score slot before scores post
(`O/U 145.5`) and in the row's foot. That is literally a **line**, and it is
closer to the banned word than anything above.

**It stays, and the distinction is real:** an over/under contest *cannot exist
without its number*. The total is the question being asked — remove it and there
is nothing to pick. **No juice attaches to it**: it is not priced, both sides pay
identically out of the contest's own points pot, and no payout varies with it.
It is a game mechanic, not a price.

The crowd split had no such justification — the contest worked perfectly without
it, which is exactly why it was the one to fix and this is the one to keep. If
the two are ever treated as the same issue, that is the error to correct.

### The prediction option percentage — `app/predictions.tsx`

The game page renders `67%` on each option button. It stays, because condition
(3) already fails: `412 picks` renders immediately beside it **in the same
element** (`predict-opt__share`), binding the number to a human verb in the same
breath. That is the same guarantee the fix above buys, arrived at a different
way.

### Everything else that renders a `%`

Checked and cleared — none is beside a matchup:

| Where | What | Why it's fine |
| --- | --- | --- |
| `arena/oracle/today-card.tsx`, `arena/trail/town-card.tsx` | ride/fade and home/away splits | Print **counts**, never percentages — "88 riding · 12 fading", "412 on Washington". The percentage only drives a CSS bar width and is never shown. This is the in-house precedent the fix above follows. |
| Oracle confidence (`today-card`, `game-cards`, `arena-teaser`) | "78% confident" | Names its subject — it is the Oracle character's stated confidence in its own call, and the word "confident" travels with the number. |
| `fan-card.tsx` | win rate | A fan's own record. |
| `athletes/[id]`, `nil` | NIL funding progress | Not sport outcomes. |
| `my-sales`, `applicants`, `field-reps` | commission rates | Staff surfaces, actual rates. |
| `arena/call/answer-sheet.tsx` | pot band shares | A payout table inside a labelled pot block. |

---

## If you add one

Run the three-part test above. If a percentage has to sit next to a matchup,
either print the count instead or put its subject in the same string — and if
the string can wrap, put the subject in **both halves**.
