# Correspondent's Call — staff tools: backend spec

Written from `sharp-foxx-web` while building the COMPOSE and GRADE tools. **No
backend code was changed.** Everything below is a request against
`sharp-foxx-api/src/modules/arena/call.service.ts` and `call-grading.service.ts`,
written so it can be picked up without re-deriving the reasoning.

The frontend ships **working against today's contract** in every case. Each item
says what the client does without the change, so nothing here is a blocker —
P1 is a real gap being routed around, P2 and P3 are papercuts.

---

## P1 — `GET /arena/call/events?scope=mine`, open to `field_rep`

### The gap

**A field rep cannot discover the id of their own draft Call.** The compose
tools address a Call by `call_events.id`, and there is no route that hands a
field rep that id before the card is published:

| Route | Gate | Drafts? |
|---|---|---|
| `GET /arena/call/events` | `CALL_READ_ROLES` = admin + regional_manager. The non-admin branch additionally requires an RM rep profile (`call.service.ts:617-622`), so a `field_rep` gets a 403 even past the guard. | yes |
| `GET /arena/call/current` | ungated | **no** — `status <> 'draft'` by design, so next week's half-written card stays invisible to fans |
| `GET /arena/call/events/:id/preview` | compose roles | needs the id you don't have |

So the named correspondent — the person the game is *named after*, and the one
`CALL_COMPOSE_ROLES` exists to let in — is the only role that cannot find the
card they were named to write.

### The ask

Add `mine` to `callScopeSchema` and let a `field_rep` through
`CALL_READ_ROLES`, narrowing `list()` to their own Calls:

```ts
// call.service.ts
export const callScopeSchema = z.object({
  scope: z.enum(['upcoming', 'past', 'mine']).default('upcoming'),
});

export const CALL_READ_ROLES = ['admin', 'regional_manager', 'field_rep'];
```

In `list()`, `scope === 'mine'` resolves the caller's own `field_reps` row and
filters `c.correspondent_rep_id = self.id` with no week bound and no roster
narrowing — a correspondent sees their own Calls in every status, and nothing
else. The two existing scopes keep their current gate: a `field_rep` asking for
`upcoming` or `past` should still be a 403, because the editorial schedule is
not theirs to read.

`ListRow` already carries everything the client needs (`status`,
`question_count`, `entry_count`, `event.id`, `locksAt`), so the projection is
unchanged.

### Until then

The desk's create flow mints a **handoff link** —
`/arena/call/compose/<callId>` — that editorial sends the correspondent. It
works and it survives a refresh through browser history. What it costs:

- a lost link is a stuck correspondent, with no in-product way back to a draft;
- the workspace tile at `/my-games/:eventId` can only appear once the card is
  **published** (it resolves the call id out of the ungated
  `GET /arena/call/current`), so a correspondent has no tile to tap on Thursday
  — only on grading night.

With `scope=mine` both fall away: the tile appears for drafts too, and the
compose tool gets a real front door.

---

## P2 — `saveQuestions` slot numbers are zero-based; every other slot-naming path is one-based

### The gap

Three call sites name a question by its slot in an error message, and they do
not agree:

```
call.service.ts:379   `Question ${q.index}: template '...' does not apply to ${ev.sport}`   // 0-based
call.service.ts:386   `Question ${q.index}: invalid params for template '...'`              // 0-based
call.service.ts:1160  `Question ${q.question_index + 1} has no answer -- ...`               // 1-based
call.service.ts:1183  `Question ${q.question_index + 1}: '...' is not one of its answers`   // 1-based
call-grading.service.ts:337+  `Question ${q.question_index + 1}: ...`                       // 1-based
```

`q.index` in `saveQuestions` is the DTO's `index`, bounded `0..4`. So composing
produces "Question 0" for the first slot while entering and grading produce
"Question 1" for the same slot. The client already has `callErrorSlot()`
(`app/api.ts:4968`), which subtracts 1 — correct for the fan and grade paths,
wrong by one for compose.

### The ask

`+ 1` at both compose sites, matching the other three:

```ts
`Question ${q.index + 1}: template '${q.templateId}' does not apply to ${ev.sport}`
`Question ${q.index + 1}: invalid params for template '${q.templateId}'`
```

The error text is not a contract anything parses on the backend side, and the
slot a correspondent is looking at on screen is slot 1, not slot 0.

### Until then

`callComposeErrorSlot()` in `app/api.ts` is a separate parser that does *not*
subtract 1, with a single `COMPOSE_SLOTS_ARE_ZERO_BASED` constant above it. When
this lands, flip the constant and delete the branch. Both compose errors are
also close to unreachable from this client: the template picker is built from
the server's own `availableTemplates` (so the sport 409 can't be provoked), and
params are validated client-side against the same bounds before the PUT.

---

## P3 — `preview` omits `params`, which forces a whole-card rewrite on reload

### The gap

`preview()` runs its questions through `fanQuestionView` (`call.service.ts:483`),
which is deliberately fan-exact: `{ id, index, templateId, prompt, options }`.
`saveQuestions` uses `questionView`, which echoes `params` back.

The consequence is specific to the fact that `PUT questions` is a **whole-card
replace**. A correspondent who saves three questions, closes the phone, and
comes back gets `templateId` and the rendered `prompt` for those three, but not
the `params` that produced them — and cannot re-send them. Editing slot 4 would
mean sending slots 1-3 with *guessed* params, silently rewriting three questions
that were already right.

`params` is the composer's own input. It is not the answer key, it leaks nothing
a fan could use, and the `resolution` / `correctKey` fields preview exists to
hide stay hidden either way.

### The ask

Either add `params` to `fanQuestionView` (harmless — the fan read already
carries `templateId`, and `params` is strictly less informative than the
rendered prompt beside it), or give `preview` a composer projection the way
`saveQuestions` has one:

```ts
questions: questions.map(composerQuestionView),  // fanQuestionView + params
```

The stated "exactly as fans will see it" principle is about `prompt` and
`options` being byte-identical, and that is untouched.

### Until then

The compose tool tracks which slots it holds params for **in this session**. A
card loaded from `preview` with saved questions renders **read-only**: the real
prompts, the publishable checklist, and Publish all work — a correspondent who
finished last night can still ship the card. Editing is offered as **"Rewrite
the card"**, which resets all five slots, because a whole-card replace is what
the write actually is. The primary Thursday flow (create → compose → publish in
one sitting) never reaches this state.

---

## Noted, not asked for

- **The grade sheet has no `templateId`** (`call-grading.service.ts:253-261`),
  so the client can't tell which questions can legally push. It fires
  `preview` in parallel and joins on question id, which is one extra read on a
  screen with a 2-minute budget and no round trips to spare after it. If
  `gradeSheet` picked up `templateId` (and ideally `pushPossible`), that read
  goes away. Filed low because the parallel fetch costs nothing measurable and
  degrades honestly: if preview fails, Push renders on all five and the server
  still accepts it.
- **`create` 409s unless the correspondent is already assigned to the event**
  (`call.service.ts:255-264`) — correct, and the desk's copy says so. But there
  is no assignments-by-event read, so the correspondent picker can't pre-filter
  to reps who qualify and the 409 is what teaches. A `GET /assignments?eventId=`
  would let the picker show only eligible reps.
- **`ForbiddenException` from `assertCanCompose`** is what a field rep gets on
  someone else's Call. That is the right design (a row-level fact can't be a
  guard) and the pages render it as a "this isn't your Call" state rather than a
  crash. No change wanted.
- **`toError` drops the body's `detail`** (`app/api.ts:603`) — that's a
  frontend limitation, not a backend one. The flattened Zod error naming the bad
  param field never reaches the screen. Mitigated by client-side validation
  rather than by widening the shared error parser.
