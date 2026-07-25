// Tiny typed client for the Sharp Foxx API. No axios, no react-query -- just
// fetch. Base URL comes from NEXT_PUBLIC_API_BASE (see .env.local) and already
// includes the /api/v1 prefix.

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000/api/v1';

// ---- Response shapes (mirrors reports.service.ts on the backend) ----

export interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: string;
  user: { id: string; displayName: string; roles: string[] };
  // True when the account is on a temporary password and must set a real one
  // before proceeding. Absent on the legacy dev (userId) login path -- callers
  // treat absent as false.
  mustChangePassword?: boolean;
}

export interface CommissionsReport {
  perRep: Array<{
    repId: string;
    // Resolved via field_reps -> users on the backend; null if unlinked.
    displayName: string | null;
    total: string;
    bySource: Record<string, string>;
  }>;
  grandTotal: string;
}

export interface RevenueReport {
  byStream: {
    adOrders: string;
    nilContributions: string;
    subscriptionPayments: string;
    retailOrders: string;
  };
  total: string;
}

// Mirrors reports.service.ts `executive()`. Admin only. EVERY money field is a
// dollar string, including the ones sourced from the NIL *_cents integer columns
// -- the backend normalizes both conventions at its output boundary, so nothing
// here needs to know which table a number came from.
//
// Note on streams: nil_fees is Sharp Foxx's PLATFORM FEE on NIL releases, not
// gross contributions (that money is the school's, not revenue). It is a
// different number from RevenueReport.byStream.nilContributions.
export interface ExecutiveReport {
  kpis: {
    // "Booked" == ad orders not in (draft, canceled) -- the same definition
    // RevenueReport uses, so the two reads reconcile to the penny.
    totalRevenue: string;
    revenueThisMonth: string;
    activeReps: number;
    // Distinct advertisers with >= 1 booked order (not the advertisers row count).
    activeAdvertisers: string | number;
    nilPoolTotalBalance: string;
    // Gross value released to athletes (fee + net), not our fee revenue.
    nilTotalReleased: string;
  };
  // Exactly 12 entries, oldest-first, zero-filled: a month with no revenue is a
  // present zero rather than a gap, so the bar chart can index it directly.
  revenueByMonth: Array<{ month: string; adRevenue: string; nilFees: string }>;
  // A list, not an object, so new streams are additive.
  revenueByStream: Array<{ stream: string; total: string; thisMonth: string }>;
  // state is null for orders whose advertiser has no institution -> "Unassigned".
  revenueByState: Array<{ state: string | null; total: string; orderCount: number }>;
  // managerId/managerName are null for the "Unassigned" bucket (reps with no
  // manager). Rows link to /managers/:managerId, which admins can already open.
  revenueByManager: Array<{
    managerId: string | null;
    managerName: string | null;
    repCount: number;
    totalRevenue: string;
    totalCommissions: string;
  }>;
  // pendingObligations > balance is the low-balance early warning.
  nilHealth: Array<{
    institutionId: string;
    name: string;
    balance: string;
    totalContributed: string;
    totalReleased: string;
    pendingObligations: string;
  }>;
}

// Mirrors reports.service.ts `territory()`. Admin sees any territory; a
// regional_manager only their own (else 403). :managerId is the manager's own
// field_reps id -- the same id /managers/:id uses.
export interface TerritoryReport {
  managerId: string;
  kpis: {
    repCount: number;
    activeRepCount: number;
    totalRevenue: string;
    totalCommissions: string;
    gamesCovered: number;
    articlesPublished: number;
  };
  // Includes the manager's own rep row (player-coach), flagged via isManager, so
  // these totals match the Overview strip from ManagerSummary on the same page.
  // Sorted by revenue desc -- stalled reps collect at the bottom.
  perRep: Array<{
    repId: string;
    name: string | null;
    status: string;
    isManager: boolean;
    ordersCount: number;
    revenue: string;
    commissionsEarned: string;
    gamesCovered: number;
    articlesPublished: number;
    thirtyDayRevenue: string;
    // Most recent of: booked order created, game claimed, article authored.
    // null when the rep has done none of the three.
    lastActivityAt: string | null;
  }>;
  // Exactly 6 entries, oldest-first, zero-filled.
  revenueByMonth: Array<{ month: string; adRevenue: string }>;
}

// Mirrors the users table row returned by POST /users (users.service.ts).
export interface User {
  id: string;
  email: string;
  displayName: string;
  status: string;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

// Mirrors a field_reps row (field-reps.service.ts). commissionRate is numeric
// in the DB, so it comes back as a string -- keep it a string here.
export interface FieldRep {
  id: string;
  userId: string;
  // From a leftJoin to users on the backend list(); null if the user is
  // unlinked (mirrors the ManagerRoster/CommissionsReport name fields).
  displayName: string | null;
  email: string | null;
  kind: 'field_rep' | 'regional_manager';
  status: string;
  managerId: string | null;
  homeMarketId: string | null;
  cohortLabel: string | null;
  commissionRate: string;
  onboardedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Mirrors reports.service.ts `managerReps()`. displayName/email come from a
// leftJoin so they can be null; totalCommissions is numeric money -> a string.
export interface ManagerRoster {
  managerId: string;
  reps: Array<{
    repId: string;
    displayName: string | null;
    email: string | null;
    totalCommissions: string;
    adOrdersCount: number;
  }>;
}

// Mirrors reports.service.ts `myEarnings()` -- the CALLER's own commission
// earnings, resolved from their field_reps row (reps AND managers have one). All
// money is numeric -> a string; rate is a 4dp decimal string (e.g. "0.1500").
// sourceType is the commission_source enum; status the commission_status enum
// (lifetime totals include 'reversed'). commissions come back newest-first
// (earnedAt desc) -- render in API order. paidAt is null until paid.
export interface MyEarningsReport {
  totals: { pending: string; approved: string; paid: string; lifetime: string };
  commissions: Array<{
    id: string;
    sourceType: 'ad_order' | 'nil_contribution' | 'subscription' | 'retail_order';
    baseAmount: string;
    rate: string;
    amount: string;
    status: 'pending' | 'approved' | 'paid' | 'reversed';
    earnedAt: string;
    paidAt: string | null;
  }>;
}

// Mirrors reports.service.ts `managerSummary()` -- a territory rollup keyed on
// the manager's OWN field_reps id (the roster route's :id). Admin sees any
// territory; a regional_manager only their own (else 403). Money is numeric -> a
// string; recentOrders is capped at 10, newest-first, and stays UNFILTERED so a
// 'canceled'/'draft' order can appear (unlike totalSales, which excludes them).
// businessName/repDisplayName come from left joins, so they can be null.
export interface ManagerSummary {
  repCount: number;
  totalSales: { count: number; amount: string };
  totalCommissions: { pending: string; approved: string; paid: string };
  recentOrders: Array<{
    id: string;
    amount: string;
    status: string;
    createdAt: string;
    businessName: string | null;
    repDisplayName: string | null;
  }>;
}

// Mirrors assignments.service.ts `listMine()` -- the caller's own assignments
// joined to their events. Teams come back as raw UUIDs (no name join) and are
// nullable; scheduledAt/assignedAt are ISO strings (timestamptz, mode 'string').
export interface MyAssignment {
  id: string;
  status: 'assigned' | 'accepted' | 'submitted';
  source: 'assigned' | 'self_claimed';
  notes: string | null;
  assignedBy: string | null;
  assignedAt: string;
  event: {
    id: string;
    sport: string;
    venue: string | null;
    status: 'scheduled' | 'live' | 'final' | 'postponed' | 'canceled';
    scheduledAt: string;
    homeTeamId: string | null;
    awayTeamId: string | null;
    homeTeam: string | null;
    awayTeam: string | null;
  };
}

// Mirrors the bare event_assignments row returned by PATCH /assignments/:id
// (assignments.service.ts `update()`). Note there is NO event join here, unlike
// MyAssignment -- only merge the changed status/notes back into an existing row.
export interface AssignmentRow {
  id: string;
  eventId: string;
  repId: string;
  status: 'assigned' | 'accepted' | 'submitted';
  assignedBy: string | null;
  source: 'assigned' | 'self_claimed';
  notes: string | null;
  assignedAt: string;
}

// Request bodies for the two create calls (mirror the Zod schemas on the API).
export interface CreateUserInput {
  email: string;
  displayName: string;
}

export interface CreateFieldRepInput {
  userId: string;
  kind?: 'field_rep' | 'regional_manager';
  commissionRate?: number;
  cohortLabel?: string;
  managerId?: string;
  homeMarketId?: string;
}

// PATCH body for updating one's own assignment. The backend requires at least
// one field (updateAssignmentSchema.refine), so send only what changed.
export interface UpdateAssignmentInput {
  status?: MyAssignment['status'];
  notes?: string;
}

// The joined event listing returned by GET /events (events.service.ts `list`).
// Keeps every event column but adds homeTeam/awayTeam resolved via two aliased
// joins to `teams`, so those names are nullable (LEFT join / unset FK). sport
// and status are the backend enums; scheduledAt is a timestamptz ISO string.
// Ordered soonest-first by the backend for the Upcoming Games carousel.
export interface EventListItem {
  id: string;
  externalRef: string | null;
  // WHO produced this event, straight off the events.source column. NULL for a
  // rep-created COVERED game (the full watch experience -- correspondent,
  // stream, photos); a non-null tag ('espn' | 'ncaa' | 'manual') for an ingested
  // FEED game (external scores, contest material for picks only). THE RULE:
  // watch surfaces render source IS NULL, play surfaces render feed rows. Use
  // isCoveredEvent/isFeedEvent below rather than testing the string. May be
  // absent (undefined) on an older deployment whose list projection predates
  // this field -- treated as covered, the same null-safe stance videoUrl takes.
  source: string | null;
  sport: 'basketball' | 'football' | 'baseball' | 'hockey' | 'soccer' | 'other';
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  marketId: string | null;
  venue: string | null;
  status: 'scheduled' | 'live' | 'final' | 'postponed' | 'canceled';
  scheduledAt: string;
  homeScore: number | null;
  awayScore: number | null;
  // Recap/replay link set via PATCH /events/:id/result. Nullable (or absent if a
  // deployment's list select hasn't surfaced it yet) -- the fan-side watch UI is
  // gated on its truthiness, so it simply stays hidden until a URL is present.
  videoUrl: string | null;
  isLocalStream: boolean;
  createdAt: string;
  updatedAt: string;
}

// THE WATCH/PLAY SPLIT, in one place. An event is COVERED -- a Sharp Foxx
// broadcast, with a correspondent, a stream, and photos -- exactly when its
// source is null (a rep-created game). Any non-null source ('espn' etc.) is a
// FEED game: ingested external scores that are contest material for picks, never
// a broadcast. Watch surfaces (the /games default, the feed's live/upcoming
// rows, the game page's video experience) render covered; play surfaces (the
// rail's pick bands, the lean feed game page) render feed. Undefined -- the
// field absent on an old payload -- counts as covered: the conservative default
// never hides a real Sharp Foxx game behind a missing column.
export function isFeedEvent(source: string | null | undefined): boolean {
  return source != null;
}
export function isCoveredEvent(source: string | null | undefined): boolean {
  return source == null;
}

// PATCH /events/:id/result body (mirrors updateResultSchema in events.service.ts).
// Every field is optional but the backend requires at least one (empty body ->
// 400); scores are non-negative ints and videoUrl must be an http(s) URL. Send
// only the fields the rep actually filled in.
export interface UpdateEventResultInput {
  homeScore?: number;
  awayScore?: number;
  videoUrl?: string;
  status?: EventListItem['status'];
}

// The bare events row returned by PATCH /events/:id/result (`.returning()`) --
// NOT the joined EventListItem, so it carries no homeTeam/awayTeam names. Only
// the result fields the UI reads back after a save are typed here.
export interface EventResult {
  id: string;
  status: EventListItem['status'];
  homeScore: number | null;
  awayScore: number | null;
  videoUrl: string | null;
}

// Mirrors a content_items row (content.service.ts / schema.ts). Returned by
// POST /content/generate, which AI-drafts a recap and stores it as a DRAFT
// attached to the event -- it never auto-publishes, so status comes back
// 'draft'. body is an HTML string (rendered at the display boundary).
export interface ContentItem {
  id: string;
  kind: 'blog' | 'podcast' | 'video' | 'athlete_profile';
  // The editorial flow adds 'submitted' between draft and published: an author
  // submits a draft for review; a manager publishes it or returns it to draft.
  status: 'draft' | 'submitted' | 'published' | 'archived';
  authorUserId: string | null;
  title: string;
  slug: string | null;
  body: string | null;
  mediaUrl: string | null;
  // Send-back feedback: a manager's optional note set when returning a submitted
  // item to draft, cleared on the next submit. Null on the happy path. Present on
  // the bare content_items row (GET /content/:id, submit/return/publish), but NOT
  // in the flattened list projection (getEventContent) -- see EventContentItem.
  reviewNote: string | null;
  institutionId: string | null;
  teamId: string | null;
  athleteId: string | null;
  eventId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// The published-content read model returned by GET /content?status=published
// (content.service.ts). Unlike the bare ContentItem row this flattens joins for
// display: author is a display-name string (not a UUID) and the event fields
// come from a left join, so they're nullable. body is a non-null HTML string
// here since only published items with a body are listed.
export interface FeedItem {
  id: string;
  kind: ContentItem['kind'];
  title: string;
  body: string;
  slug: string | null;
  publishedAt: string;
  author: string;
  eventSport: string | null;
  eventScheduledAt: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
}

// The joined listing row returned by GET /content (content.service.ts
// `listContent`), e.g. GET /content?eventId=<uuid>. NOT a bare content_items
// row: it flattens joins (author display name, event/team context) and drops
// the FK columns, so it is intentionally distinct from ContentItem. status can
// also be 'archived' here (the backend enum has it). Only the fields the editor
// needs (id/status/title/body/publishedAt) overlap with ContentItem, which is
// why the editable draft state below is typed as the union of the two.
export interface EventContentItem {
  id: string;
  kind: ContentItem['kind'];
  status: 'draft' | 'submitted' | 'published' | 'archived';
  title: string;
  slug: string | null;
  body: string | null;
  mediaUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  author: string | null;
  eventId: string | null;
  eventSport: string | null;
  eventScheduledAt: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  // NOT in the list projection (listContent omits it) -- optional so the editor
  // can read draft.reviewNote off either shape. Fetch the bare row via
  // getContentItem to actually populate it.
  reviewNote?: string | null;
}

// A row in the editorial review queue (content.service.ts `reviewQueue`),
// returned by GET /content/review-queue. Submitted items awaiting a decision,
// newest-created first. Like the reader feed it flattens joins (author display
// name, event/team context) so a card renders without follow-up lookups. status
// is always 'submitted' here; body is the HTML to preview, reviewNote is any
// prior send-back note (usually null on a fresh submission).
export interface ReviewQueueItem {
  id: string;
  kind: ContentItem['kind'];
  status: 'submitted';
  title: string;
  slug: string | null;
  body: string | null;
  mediaUrl: string | null;
  reviewNote: string | null;
  createdAt: string;
  author: string | null;
  eventId: string | null;
  eventSport: string | null;
  eventScheduledAt: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
}

// POST /content/:id/return body (mirrors returnContentSchema). The note is the
// optional send-back feedback stored on review_note and shown to the author.
export interface ReturnContentInput {
  note?: string;
}

// Request body for POST /content/generate (mirrors generateArticleSchema). The
// AI rewrites sourceText (the rep's notes) into a recap for the given event.
export interface GenerateArticleInput {
  eventId: string;
  authorId: string;
  sourceText: string;
}

// PATCH body for editing a draft's title/body (mirrors updateContentSchema).
// The backend requires at least one field, so send only what changed.
export interface UpdateContentInput {
  title?: string;
  body?: string;
}

// The bare teams row returned by POST /teams (the inline "new team" creator in
// the Add Game form). level is the backend enum ('pro' | 'college' |
// 'high_school'); league is nullable (optional on create). Reading a list of
// teams goes through searchTeams -> TeamSearchResult, which is richer.
export interface Team {
  id: string;
  name: string;
  sport: string;
  level: string;
  league: string | null;
}

// POST /teams body (mirrors createTeamSchema). A duplicate name within a sport
// comes back 409 -> surfaced as "409 <message>" by the client.
export interface CreateTeamInput {
  name: string;
  sport: string;
  level: 'pro' | 'college' | 'high_school';
  league?: string;
}

// POST /events body (mirrors createEventSchema). scheduledAt is an ISO datetime
// string; team ids/venue/isLocalStream/status are all optional. Send only the
// fields the Add Game form actually filled in.
export interface CreateEventInput {
  sport: string;
  scheduledAt: string;
  venue?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  isLocalStream?: boolean;
  status?: EventListItem['status'];
}

// The bare events row returned by POST /events (`.returning()`) -- NOT the
// joined EventListItem, so it carries no homeTeam/awayTeam names. Only the
// fields the Add Game flow reads back (id, to self-claim) are relied on.
export interface CreatedEvent {
  id: string;
  sport: EventListItem['sport'];
  scheduledAt: string;
  venue: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  status: EventListItem['status'];
  isLocalStream: boolean;
}

// POST /assignments body. A manager (regional_manager/admin) may pass repId to
// assign that rep to the game; omitting repId self-claims for the caller's own
// rep row (managers have rep rows, so an omitted repId is a manager self-claim).
// notes is optional. Returns the bare event_assignments row (no event join),
// same shape as PATCH.
export interface CreateAssignmentInput {
  eventId: string;
  repId?: string;
  notes?: string;
}

// An advertiser row as returned by GET /advertisers. marketId/managedByRep come
// from nullable columns (an advertiser need not be tied to a market or a
// managing rep), so keep them nullable. Only id/businessName are read by the UI
// (the businessName is joined client-side onto ad orders, which carry only the
// advertiserId).
export interface Advertiser {
  id: string;
  businessName: string;
  marketId: string | null;
  managedByRep: string | null;
}

// POST /advertisers body. marketId is optional; a duplicate businessName comes
// back 409 -> "409 <message>", shown inline by the Log a Sale form.
export interface CreateAdvertiserInput {
  businessName: string;
  marketId?: string;
}

// An ad_packages row as returned by GET /ad-packages (active only). price is
// numeric money -> a string; durationDays/impressions are ints. Selecting a
// package in the Log a Sale form pre-fills the (editable) order amount from price
// and, with a start date, computes endsOn from durationDays.
export interface AdPackage {
  id: string;
  name: string;
  price: string;
  durationDays: number;
  impressions: number;
  isActive: boolean;
}

// An ad_orders row as returned by GET /ad-orders/mine and GET /ad-orders?repId=,
// and by POST /ad-orders. amount is numeric money -> a string; startsOn/endsOn
// are nullable date strings. advertiserId is a bare UUID here (no name join), so
// the UI resolves the businessName from GET /advertisers and joins by id.
export interface AdOrder {
  id: string;
  advertiserId: string;
  packageId: string | null;
  amount: string;
  status: string;
  startsOn: string | null;
  endsOn: string | null;
  createdAt: string;
}

// POST /ad-orders body. The backend creates the order AND its commission
// atomically; a field_rep's sale is always credited to themselves (enforced
// server-side), so no repId is sent. Send status "active". amount is required and
// must be > 0; packageId/startsOn/endsOn are optional.
export interface CreateAdOrderInput {
  advertiserId: string;
  packageId?: string;
  amount: number;
  status: string;
  startsOn?: string;
  endsOn?: string;
}

// A game sponsorship as returned by GET /sponsorships?eventId= and POST
// /sponsorships. businessName/advertiserId are resolved server-side from the
// linked ad order's advertiser, so the "Presented by" strip needs no extra
// join. eventId + adOrderId are the two sides of the link. The eventId lookup
// returns this row or null (a game with no presenting sponsor).
export interface Sponsorship {
  id: string;
  eventId: string;
  adOrderId: string;
  advertiserId: string;
  businessName: string;
}

// POST /sponsorships body. Links an existing ad order to an event. A rep may
// only pass their own orders (enforced server-side); a game that already has a
// sponsor comes back 409 -> "409 This game already has a presenting sponsor".
export interface CreateSponsorshipInput {
  eventId: string;
  adOrderId: string;
}

// Pull a useful message out of a Nest error body ({ message, statusCode }).
async function toError(res: Response): Promise<Error> {
  let detail = res.statusText;
  try {
    const body = await res.json();
    if (body?.message) {
      detail = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    }
  } catch {
    /* non-JSON body -- fall back to statusText */
  }
  return new Error(`${res.status} ${detail}`);
}

// ---- Central 401 handling ----
//
// JWTs expire (1h). A token that's restored-but-expired, or simply invalidated
// mid-session, first shows up as a 401 on an authed call. Rather than have every
// caller re-check for that, the auth layer registers ONE handler here (see
// auth-context.tsx) that tears the session down (clear storage + state) and
// bounces to login. toAuthError() invokes it before surfacing the error, so the
// teardown happens in exactly one place.
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

// Like toError, but for AUTHED calls: a 401 here means an expired/invalid token,
// so fire the central teardown first. Deliberately NOT used by the public calls
// (login/apply) or by changePassword -- there a 401 is a bad credential / wrong
// current password, not an expired session, and must not sign the user out.
async function toAuthError(res: Response): Promise<Error> {
  if (res.status === 401) onUnauthorized?.();
  return toError(res);
}

// Real sign-in: email + password. The backend returns the usual token/user
// payload plus mustChangePassword (true when the account is still on a temp
// password). A bad credential comes back 401 -> "401 <message>", surfaced
// verbatim by the login form.
export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}

// Legacy dev sign-in: the same /auth/login endpoint still accepts a bare userId
// (a dev flag on the backend mints a token from it) for test users not yet
// migrated to a password. No mustChangePassword comes back on this path, so the
// caller treats it as false.
export async function devLogin(userId: string): Promise<LoginResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

// Set a new password (Bearer auth). currentPassword is required whenever the
// account has any password set (including a temp). The backend enforces
// newPassword >= 10; a wrong current password comes back 401 and a weak/invalid
// new one 400 -- both surface as "<status> <message>". The success body isn't
// read (may be 200+json or 204), so this resolves to void.
export async function changePassword(
  token: string,
  input: ChangePasswordInput,
): Promise<void> {
  const res = await fetch(`${BASE}/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await toError(res);
}

// ---- Public fan self-signup (the /join front door) ----

// POST /auth/signup body (mirrors signupSchema on the backend). password must be
// >= 8 chars and displayName 2..40; referralCode is the optional /join?ref=CODE
// attribution, best-effort server-side (a bad code never blocks the signup).
export interface SignupInput {
  email: string;
  password: string;
  displayName: string;
  referralCode?: string;
}

// The zod flatten() shape the signup route returns on a 400, same contract as
// ApplyValidationError -- signup() throws this so the /join form can render
// per-field messages against email/password/displayName inputs.
export class SignupValidationError extends Error {
  fieldErrors: Record<string, string[]>;
  formErrors: string[];
  constructor(fieldErrors: Record<string, string[]>, formErrors: string[]) {
    super(formErrors[0] ?? 'Please fix the highlighted fields.');
    this.name = 'SignupValidationError';
    this.fieldErrors = fieldErrors;
    this.formErrors = formErrors;
  }
}

// PUBLIC self-signup -- no token. Returns the SAME payload as login()
// (mustChangePassword is always false here), so the /join page auto-logs-in off
// the response with no second round-trip. A 400 (zod) throws
// SignupValidationError with per-field messages; a 409 (email already has an
// account) throws the shared "409 <message>" Error the form turns into a login
// nudge.
export async function signup(input: SignupInput): Promise<LoginResponse> {
  const res = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.ok) return res.json();
  if (res.status === 400) {
    const body = await res.json().catch(() => null);
    if (body && (body.fieldErrors || body.formErrors)) {
      throw new SignupValidationError(body.fieldErrors ?? {}, body.formErrors ?? []);
    }
  }
  throw await toError(res);
}

async function authGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await toAuthError(res);
  return res.json();
}

// Like authGet, but a 404 resolves to null instead of throwing. For reads where
// "no such record" is a real answer the UI renders as a STATE rather than an
// error -- see getFanPointsSummary, where a 404 means "this fan has never
// picked", which is a thing to say, not a failure to report. Every other status
// still throws, and 401 still fires the central teardown.
async function authGetOrNull<T>(path: string, token: string): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await toAuthError(res);
  return res.json();
}

async function authPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toAuthError(res);
  return res.json();
}

async function authPatch<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toAuthError(res);
  return res.json();
}

async function authPut<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toAuthError(res);
  return res.json();
}

// DELETE returns 204 (no body), so there's nothing to parse -- resolve to void.
async function authDelete(path: string, token: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await toAuthError(res);
}

// DELETE with NO body that parses a JSON response -- the parlay cancel endpoint
// (DELETE /contests/:id/tickets/:ticketId) names its target in the path and
// answers { refunded, balance }, which the board needs to move the ⚡ chip.
async function authDeleteJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await toAuthError(res);
  return res.json();
}

// DELETE that CARRIES a JSON body AND parses a JSON response -- the squares
// release endpoint (DELETE /contests/:id/squares/claim) takes { row, col } and
// returns { released, balance }. authDelete above stays the bodyless 204 variant.
async function authDeleteBody<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toAuthError(res);
  return res.json();
}

export const getCommissions = (token: string) =>
  authGet<CommissionsReport>('/reports/commissions', token);

export const getRevenue = (token: string) =>
  authGet<RevenueReport>('/reports/revenue', token);

// The whole executive dashboard in one call. Admin only (403 otherwise).
export const getExecutiveReport = (token: string) =>
  authGet<ExecutiveReport>('/reports/executive', token);

// Territory performance (id is the manager's field_reps row id). Admin any; a
// regional_manager only their own (else 403).
export const getTerritoryReport = (token: string, id: string) =>
  authGet<TerritoryReport>(`/reports/territory/${id}`, token);

export const getFieldReps = (token: string) =>
  authGet<FieldRep[]>('/field-reps', token);

// ---- Referrals ----

// Mirrors field-reps.service.ts `getMyReferral()` -- the CALLER's own referral
// hub: their code (minted on first view), a shareable /join?ref= link, live
// counts, and the last 10 fans they've brought in. RM + field_rep only; a caller
// with no field_reps row comes back 403 -> "403 No field rep profile for this
// user", which the share card treats as "nothing to show" and hides itself.
export interface RepReferral {
  referralCode: string;
  shareUrl: string;
  totalReferred: number;
  referredThisMonth: number;
  // joinedAt is users.referred_at (timestamptz ISO); newest-first, capped at 10.
  recentReferrals: Array<{ displayName: string; joinedAt: string }>;
}

export const getMyReferral = (token: string) =>
  authGet<RepReferral>('/field-reps/me/referral', token);

// Mirrors reports.service.ts `referralsExecutive()` -- the org-wide referral
// dashboard. Admin only (403 otherwise). Every count is a number (the backend
// Number()s the pg strings at its boundary). byRep is sorted last30 desc.
export interface ReferralsExecutiveReport {
  totals: { allTime: number; thisMonth: number; thisWeek: number };
  byRep: Array<{
    repId: string;
    name: string;
    kind: 'field_rep' | 'regional_manager';
    managerName: string | null;
    code: string;
    totalReferred: number;
    last30: number;
    last7: number;
  }>;
  byManager: Array<{
    managerId: string;
    name: string;
    ownReferrals: number;
    teamReferrals: number;
    combined: number;
  }>;
  // Exactly 30 entries, oldest-first, zero-filled: referred vs organic signups
  // per day, so the bar chart can index it directly (referred + organic = total).
  timeseries: Array<{
    date: string;
    total: number;
    referred: number;
    organic: number;
  }>;
}

export const getReferralsExecutive = (token: string) =>
  authGet<ReferralsExecutiveReport>('/reports/referrals', token);

// Mirrors reports.service.ts `referralsTerritory()` -- one manager's referral
// roster. Admin sees any territory; a regional_manager only their own (else
// 403). :managerId is the manager's own field_reps id (same id /managers/:id
// uses). perRep includes the manager's own row (isManager). The timeseries is
// referred-ONLY (organic signups aren't attributable to a manager). byManager is
// the single manager's own+team rollup, or null if the row didn't resolve.
export interface ReferralsTerritoryReport {
  managerId: string;
  managerName: string | null;
  totals: { allTime: number; thisMonth: number; thisWeek: number };
  byManager: {
    managerId: string;
    name: string;
    ownReferrals: number;
    teamReferrals: number;
    combined: number;
  } | null;
  perRep: Array<{
    repId: string;
    name: string;
    kind: 'field_rep' | 'regional_manager';
    status: string;
    isManager: boolean;
    code: string | null;
    totalReferred: number;
    last30: number;
    last7: number;
  }>;
  // Exactly 30 entries, oldest-first, zero-filled; referred-only.
  timeseries: Array<{ date: string; referred: number }>;
}

export const getReferralsTerritory = (token: string, managerId: string) =>
  authGet<ReferralsTerritoryReport>(
    `/reports/referrals/territory/${encodeURIComponent(managerId)}`,
    token,
  );

export const getManagerReps = (token: string, id: string) =>
  authGet<ManagerRoster>(`/reports/managers/${id}/reps`, token);

// The caller's own commission earnings (reps AND managers -- anyone with a
// field_reps row). A user with no rep profile comes back 403 -> "403 No field
// rep profile for this user"; the My Games section hides itself on that.
export const getMyEarnings = (token: string) =>
  authGet<MyEarningsReport>('/reports/my-earnings', token);

// A manager's territory rollup (id is the manager's field_reps row id -- the
// roster route's :id). Admin any; a regional_manager only their own (else 403).
export const getManagerSummary = (token: string, id: string) =>
  authGet<ManagerSummary>(`/reports/managers/${id}/summary`, token);

export const getMyAssignments = (token: string) =>
  authGet<MyAssignment[]>('/assignments/mine', token);

// Manager drill-down: one rep's assignments (repId is a field_reps id), the same
// event-joined shape as /assignments/mine. Admin may query any rep; a
// regional_manager only reps on their own roster -- a rep off their roster comes
// back 403 -> "403 <message>". Like /mine, the event carries NO scores/video;
// load those from GET /events (getEvents) and join by event id, as My Games does.
export const getRepAssignments = (token: string, repId: string) =>
  authGet<MyAssignment[]>(`/assignments?repId=${encodeURIComponent(repId)}`, token);

// Content authored by one user. NOTE authorId is a USER id (content_items
// .author_user_id), NOT a field_reps id -- the roster's repId won't match here.
// Staff callers (admin/manager/rep) get every status incl. drafts; returns the
// joined listing shape (EventContentItem), newest-created first.
export const getContentByAuthor = (token: string, authorId: string) =>
  authGet<EventContentItem[]>(`/content?authorId=${encodeURIComponent(authorId)}`, token);

// The public feed: published content only, newest-first (ordering is enforced by
// the backend). Read-only, so no author gating -- any authenticated user can read.
export const getPublishedContent = (token: string) =>
  authGet<FeedItem[]>('/content?status=published', token);

// Events for the browsable feed, e.g. GET /events?status=scheduled (Upcoming
// Games). Any authenticated user can list.
//
// GET /events returns { items, total } like the other paged reads; this wrapper
// unwraps to the bare array its callers have always taken, which is why adding
// paging to the endpoint didn't touch the feed, search, My Games, or the pickers.
// It deliberately sends NO limit -- the backend then returns every matching row,
// which those callers need (My Games joins /assignments/mine against the full
// set by event id; a page-capped list would silently lose games). A browse
// surface that wants a page and a count uses getGames() below.
export const getEvents = async (
  token: string,
  status?: string,
): Promise<EventListItem[]> => {
  const page = await authGet<Page<EventListItem>>(
    `/events${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    token,
  );
  return page.items;
};

// GET /events filters, as /games drives them. status is comma-separable
// ('scheduled,live' for Upcoming, 'final' for Results); state matches the HOME
// team's institution; dateFrom/dateTo are ISO and compare against scheduledAt;
// teamId matches either side of the matchup. Backend order is live first, then
// scheduled soonest-first, then finals most-recent-first.
export interface GameFilters {
  status?: string;
  sport?: string;
  state?: string;
  dateFrom?: string;
  dateTo?: string;
  teamId?: string;
  limit?: number;
  offset?: number;
}

// The paged schedule read behind /games -- same endpoint as getEvents, kept
// separate because this one wants the { items, total } envelope for "X of Y".
export const getGames = (token: string, params: GameFilters = {}) => {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.sport) qs.set('sport', params.sport);
  if (params.state) qs.set('state', params.state);
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);
  if (params.teamId) qs.set('teamId', params.teamId);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const s = qs.toString();
  return authGet<Page<EventListItem>>(`/events${s ? `?${s}` : ''}`, token);
};

// Any content already attached to a game. With no status filter (the default) a
// staff caller gets every status, so a rep can find/edit an existing draft on
// load (not just right after generating). Pass status: 'published' for the
// fan-facing game page -- that read is open to any authenticated role. Returns
// the joined listing shape, newest-created first.
export const getEventContent = (
  token: string,
  eventId: string,
  status?: 'draft' | 'published' | 'archived',
) =>
  authGet<EventContentItem[]>(
    `/content?eventId=${eventId}${status ? `&status=${status}` : ''}`,
    token,
  );

export const updateAssignment = (
  token: string,
  id: string,
  input: UpdateAssignmentInput,
) => authPatch<AssignmentRow>(`/assignments/${id}`, token, input);

// Report a game result. The assigned rep (or an admin) may call it; a non-owning
// rep gets 403 and an empty/invalid body gets 400 -- both surface as
// "<status> <message>". Returns the updated event row.
export const updateEventResult = (
  token: string,
  id: string,
  input: UpdateEventResultInput,
) => authPatch<EventResult>(`/events/${id}/result`, token, input);

export const createUser = (token: string, input: CreateUserInput) =>
  authPost<User>('/users', token, input);

export const createFieldRep = (token: string, input: CreateFieldRepInput) =>
  authPost<FieldRep>('/field-reps', token, input);

// AI-drafts a game recap from a rep's notes. Slow (a few seconds -- it's an AI
// call) and can fail with 502/503/504 on AI issues or 404 for a bad event/author
// id; the client surfaces those as "<status> <message>".
export const generateArticle = (token: string, input: GenerateArticleInput) =>
  authPost<ContentItem>('/content/generate', token, input);

// Edit a draft's title/body. Ownership (author-or-manager) is enforced on the
// backend; a bad id or foreign draft surfaces as "<status> <message>".
export const updateContent = (
  token: string,
  id: string,
  input: UpdateContentInput,
) => authPatch<ContentItem>(`/content/${id}`, token, input);

// The full bare content_items row by id (staff see any status). Unlike the
// flattened list projection this carries reviewNote, so the workspace fetches it
// to show a send-back "Editor's note" on a returned draft. A non-existent id is
// a 404 -> "404 <message>".
export const getContentItem = (token: string, id: string) =>
  authGet<ContentItem>(`/content/${id}`, token);

// The author submits their OWN draft for editorial review (draft -> submitted).
// A non-author gets 403 and a non-draft 409 -- both "<status> <message>".
// Clears any stale reviewNote from a previous send-back.
export const submitContent = (token: string, id: string) =>
  authPost<ContentItem>(`/content/${id}/submit`, token, {});

// Publishing is now staff-only (author-or-manager): a field_rep gets 403 with a
// message pointing at submit. Takes no body; returns the updated row.
export const publishContent = (token: string, id: string) =>
  authPost<ContentItem>(`/content/${id}/publish`, token, {});

// Unpublishing is staff-only too (roster-scoped for managers); returns the
// updated row now back in draft.
export const unpublishContent = (token: string, id: string) =>
  authPost<ContentItem>(`/content/${id}/unpublish`, token, {});

// Staff editorial review queue: submitted items awaiting a decision, newest
// first. Admin sees all; a regional_manager only submissions by roster reps. A
// caller without a manager profile (and not admin) gets 403.
export const getReviewQueue = (token: string) =>
  authGet<ReviewQueueItem[]>('/content/review-queue', token);

// A manager/admin returns a submitted item to its author as a draft, with an
// optional feedback note. Roster-scoped; a non-submitted item is a 409.
export const returnContent = (token: string, id: string, input: ReturnContentInput) =>
  authPost<ContentItem>(`/content/${id}/return`, token, input);

// GET /teams/:id -- a single team for the team hub page (/teams/[id]). Open to
// every authenticated role incl. viewer. institution resolves via a null-safe
// join server-side (pro teams have none). A bad id is a 404 -> "404 Team not
// found". Distinct from the lean Team picker row: it adds the institution.
// Social profile links, keyed by platform, value is the normalized public URL.
// Only present platforms appear (server drops empty keys). Shared by the athlete
// profile identity and the team hub; the edit form uses the same keys. Order here
// mirrors the backend (common/social-links.ts) and the icon row.
export const SOCIAL_PLATFORMS = [
  'instagram', 'tiktok', 'x', 'facebook', 'youtube', 'linkedin',
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type SocialLinks = Partial<Record<SocialPlatform, string>>;

export interface TeamDetail {
  id: string;
  name: string;
  sport: string;
  level: string;
  socialLinks: SocialLinks;
  institution: { id: string; name: string } | null;
  // Null for pro teams (no institution) and for imported college teams whose
  // EADA row carried no conference. The conference hangs off the TEAM, not the
  // school: a school sits in different conferences per sport.
  conference: { id: string; name: string } | null;
}

export const getTeam = (token: string, id: string) =>
  authGet<TeamDetail>(`/teams/${encodeURIComponent(id)}`, token);

// ---------------------------------------------------------------------------
// The team directory (GET /teams) — the Add Game type-ahead and /discover
// ---------------------------------------------------------------------------

// A directory row. Richer than the lean Team row: it carries isActive and the
// joined school so results can be disambiguated ("Tigers" — Clemson University
// (SC)). institution is null for pro teams; conference is null for pro teams
// and for the ~5.5k imported teams whose conference the import never resolved.
// gender is 'mens' | 'womens' | 'coed', null on hand-made rows; division is the
// per-team 'Division I' etc.
//
// institution.isActive is the SCHOOL's coverage, not the team's — the two are
// independent (a covered school fields sports we don't cover). Activating a team
// does drag its school active with it; /discover's admin mode reads this to show
// that.
export interface TeamSearchResult {
  id: string;
  name: string;
  sport: string;
  gender: string | null;
  division: string | null;
  level: string;
  league: string | null;
  isActive: boolean;
  institution: {
    id: string;
    name: string;
    stateCode: string | null;
    tier: InstitutionTier | null;
    isActive: boolean;
  } | null;
  conference: { id: string; name: string } | null;
}

// The bare teams row returned by PATCH /teams/:id (`.returning()`). Only what
// the admin surface reads back is typed here.
export interface UpdatedTeam {
  id: string;
  name: string;
  isActive: boolean;
  socialLinks: SocialLinks | null;
}

// Admin-only team edit. isActive is the activation switch; socialLinks merges
// ('' removes a platform). Sending isActive: true ALSO activates the team's
// school server-side — a covered team implies a covered school — so a caller
// showing school coverage should reflect that without needing a flag back.
export const updateTeam = (
  token: string,
  id: string,
  input: { isActive?: boolean; socialLinks?: SocialLinks },
) => authPatch<UpdatedTeam>(`/teams/${encodeURIComponent(id)}`, token, input);

// GET /teams filters. activeOnly defaults TRUE on the backend and every caller
// keeps it explicit: the college import left ~25.8k teams inactive, so the
// picker pins it true while /discover pins it false. A search under 2 chars is
// ignored server-side, so callers should avoid firing until 2. state/tier
// filter through the school join; conferenceId sits on the team itself.
export interface TeamSearchParams {
  search?: string;
  sport?: string;
  gender?: string;
  conferenceId?: string;
  state?: string;
  tier?: InstitutionTier;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

// Paged directory reads return the filtered `total` alongside the page, so a
// browse UI can render "Showing 25 of 3,412" without a second count call.
export interface Page<T> {
  items: T[];
  total: number;
}

export const searchTeams = (token: string, params: TeamSearchParams) => {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.sport) qs.set('sport', params.sport);
  if (params.gender) qs.set('gender', params.gender);
  if (params.conferenceId) qs.set('conferenceId', params.conferenceId);
  if (params.state) qs.set('state', params.state);
  if (params.tier) qs.set('tier', params.tier);
  if (params.activeOnly !== undefined) qs.set('activeOnly', String(params.activeOnly));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  return authGet<Page<TeamSearchResult>>(`/teams?${qs.toString()}`, token);
};

// ---------------------------------------------------------------------------
// The school / conference graph (/schools/[id], /conferences/[id])
// ---------------------------------------------------------------------------

// institution_tier, straight off the backend enum. 'unclassified' is what the
// college import assigns an NCAA school with a missing/odd division.
export type InstitutionTier =
  | 'ncaa_d1' | 'ncaa_d2' | 'ncaa_d3' | 'naia' | 'juco' | 'high_school'
  | 'unclassified';

// A directory row from GET /institutions. Ordered active-first then name: the
// handful of schools we actually cover float above the ~2k imported ones.
export interface InstitutionSummary {
  id: string;
  name: string;
  city: string | null;
  stateCode: string | null;
  tier: InstitutionTier;
  isActive: boolean;
  teamCount: number;
}

// One team on a school page. conference is null when the imported row carried
// none; division is the per-team 'Division I' etc. (the school's tier is the
// summary of those). gender is 'mens' | 'womens' | 'coed', null on hand-made rows.
export interface InstitutionTeam {
  id: string;
  name: string;
  sport: string;
  gender: string | null;
  division: string | null;
  isActive: boolean;
  conference: { id: string; name: string } | null;
}

// GET /institutions/:id -- identity + every team, ordered sport then gender.
// isActive is false for every imported school: the row exists so the graph
// resolves, but we don't cover it yet. mascot is null until an AD backfills it.
export interface InstitutionDetail {
  id: string;
  name: string;
  city: string | null;
  stateCode: string | null;
  website: string | null;
  mascot: string | null;
  tier: InstitutionTier;
  isActive: boolean;
  teams: InstitutionTeam[];
}

export const getInstitution = (token: string, id: string) =>
  authGet<InstitutionDetail>(`/institutions/${encodeURIComponent(id)}`, token);

// The bare institutions row returned by PATCH /institutions/:id (`.returning()`).
// Only the fields the admin surface reads back are typed here.
export interface UpdatedInstitution {
  id: string;
  name: string;
  city: string | null;
  stateCode: string | null;
  tier: InstitutionTier;
  mascot: string | null;
  website: string | null;
  isActive: boolean;
}

// Admin-only school edit. isActive is the activation switch — flipping it true
// is what puts the school into the covered map (the Add Game picker, "Covered
// only"). mascot/website are the backfill that rides along with activation: the
// EADA import carries neither. Send '' for either to clear it back to null; omit
// a field to leave it untouched. An empty body is a 400.
//
// Activation does not cascade in either direction: it never touches the school's
// teams (activate those one at a time), and deactivating only hides the school
// from activeOnly reads — in-flight games and assignments are untouched.
export const updateInstitution = (
  token: string,
  id: string,
  input: { isActive?: boolean; mascot?: string; website?: string },
) => authPatch<UpdatedInstitution>(
  `/institutions/${encodeURIComponent(id)}`,
  token,
  input,
);

// School directory. A search under 2 chars is ignored server-side; limit is
// capped at 100 (default 25) and offset pages through the rest. Returns
// { items, total } — total counts the whole filtered set, not the page.
// activeOnly defaults FALSE here (the opposite of GET /teams): nearly every
// imported school is inactive, so a school browse must show them by default.
export const getInstitutions = (
  token: string,
  params: {
    search?: string;
    state?: string;
    tier?: InstitutionTier;
    activeOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {},
) => {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.state) qs.set('state', params.state);
  if (params.tier) qs.set('tier', params.tier);
  if (params.activeOnly !== undefined) qs.set('activeOnly', String(params.activeOnly));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const q = qs.toString();
  return authGet<Page<InstitutionSummary>>(`/institutions${q ? `?${q}` : ''}`, token);
};

// A directory row from GET /conferences. tier is nullable and is in practice
// NULL for all 146 imported conferences -- the import hangs the conference off
// the team and never sets a conference tier. Callers must hide the badge when
// it's absent rather than render an empty pill.
export interface ConferenceSummary {
  id: string;
  name: string;
  tier: InstitutionTier | null;
  memberCount: number;
}

// A member row on a conference page: a TEAM, joined to its school. institution
// is null only if a team somehow carries a conference but no school (a data bug
// -- the join is null-safe so one bad row can't blank the page).
export interface ConferenceMember {
  teamId: string;
  teamName: string;
  sport: string;
  gender: string | null;
  division: string | null;
  isActive: boolean;
  institution: { id: string; name: string; stateCode: string | null } | null;
}

// GET /conferences/:id -- identity + members, ordered institution name then sport.
export interface ConferenceDetail {
  id: string;
  name: string;
  tier: InstitutionTier | null;
  members: ConferenceMember[];
}

export const getConference = (token: string, id: string) =>
  authGet<ConferenceDetail>(`/conferences/${encodeURIComponent(id)}`, token);

export const getConferences = (
  token: string,
  params: { search?: string; limit?: number } = {},
) => {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  const q = qs.toString();
  return authGet<ConferenceSummary[]>(`/conferences${q ? `?${q}` : ''}`, token);
};

// A roster row as returned by GET /athletes?teamId= (athletes.service.ts
// listByTeam). name is composed server-side (first + last); position/classYear/
// jerseyNumber/avatarUrl are all nullable (unset columns / no avatar). Ordered
// by last then first name. Open to every authenticated role incl. viewer.
export interface TeamRosterAthlete {
  id: string;
  name: string;
  position: string | null;
  classYear: string | null;
  jerseyNumber: string | null;
  avatarUrl: string | null;
}

// The team's roster, for the team hub's roster grid. Each card links to the
// athlete's public profile (/athletes/[id]).
export const getTeamRoster = (token: string, teamId: string) =>
  authGet<TeamRosterAthlete[]>(
    `/athletes?teamId=${encodeURIComponent(teamId)}`,
    token,
  );

// Create a team (admin/manager/field_rep). A duplicate name within the sport
// returns 409 -> "409 <message>", shown inline by the Add Game form.
export const createTeam = (token: string, input: CreateTeamInput) =>
  authPost<Team>('/teams', token, input);

// Create a game. Same roles as team create; returns the bare event row.
export const createEvent = (token: string, input: CreateEventInput) =>
  authPost<CreatedEvent>('/events', token, input);

// Create an assignment: a manager assigns a rep (input.repId) or self-claims a
// game (repId omitted). A self-claim lands in the caller's own My Games; a
// duplicate assignment comes back 409 -> "409 <message>", shown inline.
export const createAssignment = (token: string, input: CreateAssignmentInput) =>
  authPost<AssignmentRow>('/assignments', token, input);

// Advertisers to populate the Log a Sale dropdown (and to resolve businessName
// for ad-order listings, which carry only advertiserId).
export const getAdvertisers = (token: string) =>
  authGet<Advertiser[]>('/advertisers', token);

// Create an advertiser (name-only from the inline creator). A duplicate
// businessName returns 409 -> "409 <message>", shown inline.
export const createAdvertiser = (token: string, input: CreateAdvertiserInput) =>
  authPost<Advertiser>('/advertisers', token, input);

// Active ad packages to populate the (optional) package dropdown; selecting one
// pre-fills the order amount from its price.
export const getAdPackages = (token: string) =>
  authGet<AdPackage[]>('/ad-packages', token);

// The caller's own ad orders (a rep's logged sales), for the My Sales section.
export const getMyAdOrders = (token: string) =>
  authGet<AdOrder[]>('/ad-orders/mine', token);

// Manager/admin drill-down: one rep's ad orders (repId is a field_reps id). A
// manager is limited to their roster -- a rep off it comes back 403 ->
// "403 <message>"; the drill-down handles that without blanking the page.
export const getRepAdOrders = (token: string, repId: string) =>
  authGet<AdOrder[]>(`/ad-orders?repId=${encodeURIComponent(repId)}`, token);

// Log a sale: creates the ad order and its commission atomically. A field_rep's
// sale is always credited to themselves (backend-enforced). Send status "active".
export const createAdOrder = (token: string, input: CreateAdOrderInput) =>
  authPost<AdOrder>('/ad-orders', token, input);

// The presenting sponsor for a game (or null when none). Open to every role
// incl. viewer, so the fan-facing game page can render the "Presented by" strip.
export const getEventSponsorship = (token: string, eventId: string) =>
  authGet<Sponsorship | null>(
    `/sponsorships?eventId=${encodeURIComponent(eventId)}`,
    token,
  );

// Link an ad order to a game as its presenting sponsor. A rep may only use their
// own orders (enforced server-side); a game that already has a sponsor comes
// back 409 -> "409 This game already has a presenting sponsor", shown inline.
export const createSponsorship = (
  token: string,
  input: CreateSponsorshipInput,
) => authPost<Sponsorship>('/sponsorships', token, input);

// Remove a sponsorship. Permissions are enforced server-side (the rep who
// attached it, or staff); a foreign one surfaces as "<status> <message>".
export const deleteSponsorship = (token: string, id: string) =>
  authDelete(`/sponsorships/${id}`, token);

// ---- Live events: the courtside play-by-play stream on a game ----

// The live_event type enum on the backend. Each carries a small typed payload
// (see LiveEvent.payload) validated server-side. score_update ALSO syncs the
// events row scoreboard, so a fan poll sees the new score without a separate
// result save.
export type LiveEventType =
  | 'score_update'
  | 'period'
  | 'big_play'
  | 'timeout'
  | 'sponsor_spot'
  | 'status_note';

// A live_events row as returned by POST/GET /events/:id/live-events. payload is
// a per-type bag (the backend validates the shape for each type): score_update
// { homeScore, awayScore }, period { label }, big_play { text }, sponsor_spot
// { sponsorshipId }, timeout/status_note free-form. Typed loosely as optional
// fields so read sites can pull what a given type carries without a cast.
// createdAt is a timestamptz string WITH offset -- echo it back verbatim as the
// ?after= cursor (don't reformat it).
export interface LiveEvent {
  id: string;
  eventId: string;
  type: LiveEventType;
  payload: {
    homeScore?: number;
    awayScore?: number;
    label?: string;
    text?: string;
    sponsorshipId?: string;
    [key: string]: unknown;
  };
  createdAt: string;
}

// POST /events/:id/live-events body. payload rules per type are enforced on the
// backend; a bad shape comes back 400 -> "400 <message>". timeout/status_note
// take an optional free payload, so payload is optional here.
export interface CreateLiveEventInput {
  type: LiveEventType;
  payload?: Record<string, unknown>;
}

// The game's play-by-play, ascending, <=200 rows, open to all roles. Poll by
// passing the LAST seen event's createdAt as `after` (verbatim -- it includes
// the timezone offset); with no cursor this returns the full history so the fan
// feed can seed itself before it starts polling.
export const getLiveEvents = (token: string, eventId: string, after?: string) =>
  authGet<LiveEvent[]>(
    `/events/${eventId}/live-events${
      after ? `?after=${encodeURIComponent(after)}` : ''
    }`,
    token,
  );

// Emit one live event (admin or the assigned rep/manager). Returns the created
// row -- the console reconciles its optimistic score from the echoed payload.
export const createLiveEvent = (
  token: string,
  eventId: string,
  input: CreateLiveEventInput,
) => authPost<LiveEvent>(`/events/${eventId}/live-events`, token, input);

// Retract a live event (the emitter or an admin). 204, no body. NOTE the fan
// cursor poller can't see a deletion, so a retracted event lingers on already-
// loaded fan pages until reload -- an accepted v1 limitation.
export const deleteLiveEvent = (
  token: string,
  eventId: string,
  liveEventId: string,
) => authDelete(`/events/${eventId}/live-events/${liveEventId}`, token);

// ---- Applications: the public recruiting intake + the staff review queue ----

// The rep_status enum on the backend (field_reps.status). 'onboarding' gates a
// newly-approved rep behind training; 'active' unlocks their games portal.
export type RepStatus =
  | 'applicant'
  | 'onboarding'
  | 'active'
  | 'paused'
  | 'offboarded';

// A full applications row as returned by GET /applications (staff only). track
// maps 1:1 onto field_reps.kind and a role code. reviewedBy/reviewedAt/
// createdUserId are null until a staffer approves/rejects; createdUserId is the
// new sign-in id, present only after approval. Mirrors applications.service.ts.
export interface Application {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  city: string;
  state: string;
  track: 'field_rep' | 'regional_manager';
  hasSmartphone: boolean;
  pitch: string;
  resumeUrl: string | null;
  status: 'submitted' | 'approved' | 'rejected';
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdUserId: string | null;
  createdAt: string;
}

// POST /applications body (mirrors createApplicationSchema). The only
// unauthenticated write in the app. pitch must be >= 30 chars; resumeUrl, when
// present, must be an http(s) URL. phone/resumeUrl are optional.
export interface ApplyInput {
  fullName: string;
  email: string;
  phone?: string;
  city: string;
  state: string;
  track: 'field_rep' | 'regional_manager';
  hasSmartphone: boolean;
  pitch: string;
  resumeUrl?: string;
}

// POST /applications/:id/approve body (mirrors approveApplicationSchema).
// managerId (a regional_manager rep row) hangs the new rep under that manager;
// omit it and the approving manager auto-becomes the rep's manager.
export interface ApproveApplicationInput {
  managerId?: string;
  commissionRate?: number;
}

// The zod flatten() shape the API returns on a 400 from the create route
// (BadRequestException(error.flatten())). createApplication throws this so the
// apply form can render fieldErrors inline against each input.
export class ApplyValidationError extends Error {
  fieldErrors: Record<string, string[]>;
  formErrors: string[];
  constructor(fieldErrors: Record<string, string[]>, formErrors: string[]) {
    super(formErrors[0] ?? 'Please fix the highlighted fields.');
    this.name = 'ApplyValidationError';
    this.fieldErrors = fieldErrors;
    this.formErrors = formErrors;
  }
}

// PUBLIC create -- no token. A 400 (zod) throws ApplyValidationError with the
// per-field messages; a 409 (duplicate application OR an email that already has
// an account) throws the shared "409 <message>" Error the form turns into a
// "Sign in" nudge. Returns only { id, status } on success.
export async function createApplication(
  input: ApplyInput,
): Promise<{ id: string; status: string }> {
  const res = await fetch(`${BASE}/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.ok) return res.json();
  if (res.status === 400) {
    const body = await res.json().catch(() => null);
    if (body && (body.fieldErrors || body.formErrors)) {
      throw new ApplyValidationError(body.fieldErrors ?? {}, body.formErrors ?? []);
    }
  }
  throw await toError(res);
}

// Staff review queue: full rows, newest first. Defaults to status=submitted on
// the backend when no filter is given (admin, regional_manager).
export const getApplications = (token: string, status?: Application['status']) =>
  authGet<Application[]>(
    `/applications${status ? `?status=${status}` : ''}`,
    token,
  );

// Approve -> stands up the account (user + rep + role) and returns the updated
// application plus { userId, tempPassword } -- the sign-in credentials staff
// hand off to the applicant. tempPassword is shown once (never returned again).
export const approveApplication = (
  token: string,
  id: string,
  input: ApproveApplicationInput,
) =>
  authPost<Application & { userId: string; tempPassword: string }>(
    `/applications/${id}/approve`,
    token,
    input,
  );

// Reject -> stamps status + reviewer. No body; returns the updated application.
export const rejectApplication = (token: string, id: string) =>
  authPost<Application>(`/applications/${id}/reject`, token, {});

// Update a field_rep's status (admin, regional_manager). Used by the roster's
// "Activate" action to move an onboarding rep to 'active' (which also stamps
// onboardedAt server-side). Returns the updated field_reps row.
export const updateFieldRepStatus = (
  token: string,
  id: string,
  status: RepStatus,
) => authPatch<FieldRep>(`/field-reps/${id}/status`, token, { status });

// ---- LTI: one-time launch into the Academy (Moodle) ----

// GET /lti/launch/ticket (Bearer; caller needs a rep profile or admin) returns
// an absolute, one-time launch URL (60s expiry). Opening it in a browser tab
// runs the full LTI redirect chain and lands the user signed in inside Moodle.
export interface LtiLaunchTicket {
  url: string;
}

// Mint a launch ticket for the signed-in rep. A caller with no rep profile
// comes back 403 -> "403 <message>"; callers fall back to the plain Moodle URL.
export const getLtiLaunchTicket = (token: string) =>
  authGet<LtiLaunchTicket>('/lti/launch/ticket', token);

// ---- Game photos: correspondent upload + fan gallery (S3-style presigned PUT) ----

// A confirmed game photo as returned by GET /media?purpose=game_photo. publicUrl
// is the CDN/bucket URL used directly as the <img> src; uploaderUserId is a bare
// user id, matched against the signed-in user to decide who may delete a tile.
export interface GamePhoto {
  id: string;
  publicUrl: string;
  createdAt: string;
  uploaderUserId: string;
}

// POST /media/presign response. uploadUrl is a short-lived (10-min) presigned PUT
// bound to the exact contentType sent below; publicUrl is where the confirmed
// image will live; mediaId is the row to confirm/delete.
export interface PresignResponse {
  uploadUrl: string;
  publicUrl: string;
  mediaId: string;
}

// Ask the API for a presigned upload slot for a game photo. purpose is fixed to
// "game_photo"; the backend enforces jpeg/png/webp, <=10MB, and that the caller
// is assigned to the event (else 403/400 -> "<status> <message>").
export const presignGamePhoto = (
  token: string,
  input: { fileName: string; contentType: string; sizeBytes: number; eventId: string },
) =>
  authPost<PresignResponse>('/media/presign', token, {
    purpose: 'game_photo',
    ...input,
  });

// Raw PUT of the file bytes to the presigned uploadUrl. This does NOT go through
// the API base and carries NO Authorization header -- the URL itself is the
// credential. The Content-Type MUST match the one sent to presign or the signed
// URL rejects it. A non-2xx (expired/mismatched) surfaces as "<status> upload".
export async function uploadToPresignedUrl(
  uploadUrl: string,
  file: Blob,
  contentType: string,
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!res.ok) throw new Error(`${res.status} upload failed`);
}

// Confirm an uploaded photo (POST /media/:id/confirm) so it becomes visible in
// GET /media. The success body isn't relied on (may be 200+json or 204), so this
// resolves to void -- callers already hold publicUrl/mediaId from presign.
export async function confirmMedia(token: string, mediaId: string): Promise<void> {
  const res = await fetch(`${BASE}/media/${mediaId}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw await toAuthError(res);
}

// Confirmed photos for a game, viewer-allowed (any authenticated role). Used by
// the fan gallery and the workspace grid.
export const getGamePhotos = (token: string, eventId: string) =>
  authGet<GamePhoto[]>(
    `/media?eventId=${encodeURIComponent(eventId)}&purpose=game_photo`,
    token,
  );

// Delete a photo (uploader or admin, enforced server-side). 204, no body.
export const deleteMedia = (token: string, mediaId: string) =>
  authDelete(`/media/${mediaId}`, token);

// ---- NIL Phase 1: athlete deliverables + wallet, staff review queue + pools ----

// The money math stamped on a deliverable when it's approved: the gross (the
// deliverable's value), the platform fee taken from the school's pool, and the
// net credited to the athlete. All *_Cents are integer cents (divide by 100 at
// the render boundary); releasedAt is a timestamptz ISO string.
export interface NilRelease {
  grossCents: number;
  feeCents: number;
  netCents: number;
  releasedAt: string;
}

// A deliverable as returned by GET /nil/my-deliverables (the athlete's own).
// status walks assigned -> submitted -> approved. proofMediaId/proofPublicUrl are
// the confirmed proof upload attached at submit (null on an unstarted assigned
// card); reviewNote carries a staffer's send-back note on a returned (assigned)
// card. release is non-null only once approved.
export interface NilDeliverable {
  id: string;
  title: string;
  description: string | null;
  valueCents: number;
  status: 'assigned' | 'submitted' | 'approved';
  proofNote: string | null;
  reviewNote: string | null;
  submittedAt: string | null;
  createdAt: string;
  proofMediaId: string | null;
  proofPublicUrl: string | null;
  release: NilRelease | null;
  // Whether an approved/submitted deliverable is surfaced on the athlete's public
  // profile reel. Toggled at submit (showOnProfile on submit) or later via
  // setDeliverablePublicity. Only 'approved' + true items actually appear on the
  // profile, but the flag rides on every deliverable so the UI can reflect it.
  showOnProfile: boolean;
}

// One row in the athlete's wallet release history. Carries the same money math
// as a deliverable's release, plus the deliverable's title/id for the list (both
// optional -- the wallet is rendered defensively against the backend shape).
export interface NilWalletRelease extends NilRelease {
  id?: string;
  deliverableId?: string;
  title?: string | null;
}

// GET /nil/my-wallet (athlete). ledgerOnly is true in Phase 1 -- payouts are
// tracked here, not processed -- and the wallet caption is honest about that.
// totalNetCents is the sum of every release's net.
export interface NilWallet {
  totalNetCents: number;
  ledgerOnly: boolean;
  releases: NilWalletRelease[];
}

// A row in the staff NIL review queue (GET /nil/review-queue), one per submitted
// deliverable awaiting a decision. Carries the athlete's name, the value, and the
// proof (public URL + note) so a card renders without a follow-up lookup.
// institutionId, when present, is used to look up the pool's platform fee rate
// for the approve preview.
export interface NilReviewItem {
  id: string;
  title: string;
  description: string | null;
  // The submitting athlete: id (for a profile link) + first/last name, as the
  // review-queue query returns them (athletes is inner-joined, so athleteId is
  // always present; the names are non-null columns). Compose the display name at
  // the render boundary.
  athleteId: string;
  athleteFirstName: string | null;
  athleteLastName: string | null;
  valueCents: number;
  proofPublicUrl: string | null;
  proofNote: string | null;
  submittedAt: string | null;
  institutionId?: string | null;
}

// POST /nil/deliverables/:id/approve response: the updated deliverable plus the
// release math just stamped. A pool without enough balance comes back 409
// "Insufficient pool funds" -> surfaced as "409 <message>".
export interface NilApproveResponse {
  deliverable: NilDeliverable;
  release: NilRelease;
}

// GET /nil/pools/:institutionId (staff + that school's athletes). platformFeeRate
// is a fraction (0.15 = 15%); balanceCents is the pool's remaining balance. A
// school with no pool yet comes back with id null (zero-state). contributions/
// releases aren't rendered here (only the fee rate feeds the approve preview), so
// they're typed loosely.
export interface NilPool {
  id: string | null;
  balanceCents: number;
  platformFeeRate: number;
  contributions: Array<Record<string, unknown>>;
  releases: Array<Record<string, unknown>>;
}

// The athlete's own deliverables, any status, for the My NIL assignments board.
export const getMyDeliverables = (token: string) =>
  authGet<NilDeliverable[]>('/nil/my-deliverables', token);

// Submit a deliverable for review (assigned -> submitted). proofMediaId must be a
// CONFIRMED media_uploads row (purpose 'nil_proof'); a non-owner gets 403 and a
// non-assigned/unconfirmed proof a 409/400 -- all "<status> <message>". Returns
// the updated deliverable.
export const submitDeliverable = (
  token: string,
  id: string,
  input: { proofMediaId: string; proofNote?: string; showOnProfile?: boolean },
) => authPost<NilDeliverable>(`/nil/deliverables/${id}/submit`, token, input);

// Toggle whether a submitted/approved deliverable shows on the athlete's public
// profile reel (athlete owner only). Optimistic on the client; returns the
// updated deliverable. A non-owner gets 403 -> "403 <message>".
export const setDeliverablePublicity = (
  token: string,
  id: string,
  showOnProfile: boolean,
) =>
  authPatch<NilDeliverable>(`/nil/deliverables/${id}/publicity`, token, {
    showOnProfile,
  });

// The athlete's wallet: total net earned + the release ledger.
export const getMyWallet = (token: string) =>
  authGet<NilWallet>('/nil/my-wallet', token);

// Staff NIL review queue: submitted deliverables awaiting a decision (admin,
// regional_manager). A caller without that gate gets 403.
export const getNilReviewQueue = (token: string) =>
  authGet<NilReviewItem[]>('/nil/review-queue', token);

// Approve a submitted deliverable -> releases the funds and returns the deliverable
// + release math. 409 "Insufficient pool funds" when the pool can't cover it.
export const approveDeliverable = (token: string, id: string) =>
  authPost<NilApproveResponse>(`/nil/deliverables/${id}/approve`, token, {});

// Return a submitted deliverable to the athlete (submitted -> assigned) with an
// optional feedback note shown as an "editor's note" style callout on their card.
export const returnDeliverable = (
  token: string,
  id: string,
  input: { note?: string },
) => authPost<NilDeliverable>(`/nil/deliverables/${id}/return`, token, input);

// A school's NIL pool (staff + that school's athletes). Used by the review queue
// to read platformFeeRate for the approve preview.
export const getNilPool = (token: string, institutionId: string) =>
  authGet<NilPool>(`/nil/pools/${institutionId}`, token);

// Presign an upload slot for an NIL proof (image, video/mp4, or pdf, <=50MB --
// backend-enforced). Same presign -> PUT -> confirm chain as game photos, just a
// different purpose; reuse uploadToPresignedUrl(WithProgress) + confirmMedia.
export const presignNilProof = (
  token: string,
  input: { fileName: string; contentType: string; sizeBytes: number },
) =>
  authPost<PresignResponse>('/media/presign', token, {
    purpose: 'nil_proof',
    ...input,
  });

// Same raw presigned PUT as uploadToPresignedUrl, but over XMLHttpRequest so the
// caller can render a real upload progress bar (fetch can't report upload
// progress). onProgress is called with an integer 0-100. No Authorization header
// -- the URL is the credential -- and the Content-Type MUST match presign.
export function uploadToPresignedUrlWithProgress(
  uploadUrl: string,
  file: Blob,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`${xhr.status} upload failed`));
    };
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(file);
  });
}

// ---- Athlete public profile: the social-style profile aggregate + owner edits ----

// GET /athletes/:id/profile (any authenticated role incl. viewer). A read-only
// aggregate assembled server-side from a few focused queries. EVERY URL field is
// null-safe (leftJoins), and NOTHING private leaks here -- no user_id, email, or
// money (the reel is the opted-in public subset only). Mirrors
// athletes.service.ts getProfile(). team/institution are null when unset.
export interface AthleteProfile {
  identity: {
    id: string;
    firstName: string;
    lastName: string;
    bio: string | null;
    jerseyNumber: string | null;
    position: string | null;
    classYear: string | null;
    avatarUrl: string | null;
    coverUrl: string | null;
    // Normalized social profile URLs, present platforms only (see SocialLinks).
    socialLinks: SocialLinks;
    team: { id: string; name: string; sport: string } | null;
    institution: { id: string; name: string } | null;
  };
  stats: {
    deliverablesCompleted: number;
    articlesCount: number;
    teamGamesCount: number;
  };
  // The public content reel: approved deliverables the athlete opted to show.
  // proofContentType (e.g. 'image/jpeg', 'video/mp4', 'application/pdf') tells
  // the UI how to render the proof; proofPublicUrl is the media. NO money here.
  reel: Array<{
    id: string;
    title: string;
    releasedAt: string | null;
    proofPublicUrl: string | null;
    proofContentType: string | null;
  }>;
  // Published articles tagged to this athlete, for linking to /articles/[id].
  articles: Array<{ id: string; title: string; publishedAt: string | null }>;
  // The team's last 5 final games, both side names + scores, for /games/[id].
  recentGames: Array<{
    id: string;
    homeTeamName: string | null;
    awayTeamName: string | null;
    homeScore: number | null;
    awayScore: number | null;
    scheduledAt: string;
  }>;
}

// The public profile aggregate for one athlete. Open to every authenticated role
// (viewers/fans included). A bad id is a 404 -> "404 Athlete not found".
export const getAthleteProfile = (token: string, id: string) =>
  authGet<AthleteProfile>(`/athletes/${id}/profile`, token);

// GET /athletes/me (athlete-only) -> the caller's OWN athlete id. The one read
// that maps the signed-in user to their athlete row, so an athlete can link to
// and detect their own public profile (the profile read omits user_id by
// design). A caller with no athlete row (e.g. a bare admin) gets 404; callers
// treat that as "not an athlete" and simply hide the self-profile affordances.
export const getMyAthleteId = (token: string) =>
  authGet<{ athleteId: string }>('/athletes/me', token);

// PATCH /athletes/:id body (mirrors updateAthleteSchema). The athlete owner or an
// admin may send any subset; the backend requires at least one field. bio caps at
// 1000 chars ('' is a legit clear); jerseyNumber at 4; the media ids must be
// CONFIRMED uploads owned by the caller with purpose athlete_avatar/athlete_cover.
export interface UpdateAthleteInput {
  bio?: string;
  jerseyNumber?: string;
  avatarMediaId?: string;
  coverMediaId?: string;
  // Partial map of platform -> handle-or-URL. '' deletes a link; absent keys are
  // left untouched (backend merges). Values are validated/normalized server-side;
  // a bad value comes back 400 with per-field messages under fieldErrors.socialLinks.
  socialLinks?: SocialLinks;
}

// The zod flatten() body the athlete PATCH returns on a 400 (same shape as
// ApplyValidationError). socialLinks sub-errors collapse to fieldErrors.socialLinks
// as an array of messages, each prefixed with its platform label ("Instagram ...")
// so the edit form can map them back to the right input.
export class AthleteUpdateValidationError extends Error {
  fieldErrors: Record<string, string[]>;
  formErrors: string[];
  constructor(fieldErrors: Record<string, string[]>, formErrors: string[]) {
    super(formErrors[0] ?? 'Please fix the highlighted fields.');
    this.name = 'AthleteUpdateValidationError';
    this.fieldErrors = fieldErrors;
    this.formErrors = formErrors;
  }
}

// The bare athletes row returned by PATCH /athletes/:id (`.returning()`). Only
// the fields the edit surface reads back after a save are typed here; a foreign
// profile or bad media id surfaces as "<status> <message>".
export interface UpdatedAthlete {
  id: string;
  bio: string | null;
  jerseyNumber: string | null;
  avatarMediaId: string | null;
  coverMediaId: string | null;
  // The merged social map after the PATCH (normalized URLs, present keys only).
  socialLinks: SocialLinks;
}

// Edit one's own athlete profile (owner-or-admin, enforced server-side). Send
// only changed fields; an empty body is a 400. A zod 400 (e.g. a bad social link)
// throws AthleteUpdateValidationError with per-field messages so the edit form can
// render them inline; any other failure surfaces as the shared "<status> <message>".
export async function updateAthlete(
  token: string,
  id: string,
  input: UpdateAthleteInput,
): Promise<UpdatedAthlete> {
  const res = await fetch(`${BASE}/athletes/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (res.ok) return res.json();
  if (res.status === 400) {
    const body = await res.json().catch(() => null);
    if (body && (body.fieldErrors || body.formErrors)) {
      throw new AthleteUpdateValidationError(body.fieldErrors ?? {}, body.formErrors ?? []);
    }
  }
  throw await toAuthError(res);
}

// Presign an upload slot for a profile avatar (image, <=5MB) or cover (image,
// <=10MB) -- backend-enforced, athlete-only. Same presign -> PUT -> confirm chain
// as game photos / NIL proofs; reuse uploadToPresignedUrlWithProgress +
// confirmMedia, then PATCH the athlete with the returned mediaId.
export const presignAthleteImage = (
  token: string,
  purpose: 'athlete_avatar' | 'athlete_cover',
  input: { fileName: string; contentType: string; sizeBytes: number },
) => authPost<PresignResponse>('/media/presign', token, { purpose, ...input });

// ---- Follows: follow athletes/teams/correspondents; personalized feed + suggestions ----

// The three things a user can follow. correspondent is followable via the API but
// has no dedicated page in this app yet, so no hero Follow button hosts it here.
export type FollowTargetType = 'athlete' | 'team' | 'correspondent';

// GET /follows/mine — the caller's follows, enriched and discriminated on
// targetType. Every entry carries followId + createdAt; the per-type fields
// identify the target and label it in the UI. URL fields are null-safe.
export type FollowMineEntry =
  | {
      targetType: 'athlete';
      followId: string;
      createdAt: string;
      athleteId: string;
      name: string;
      avatarUrl: string | null;
      teamName: string | null;
    }
  | {
      targetType: 'team';
      followId: string;
      createdAt: string;
      teamId: string;
      name: string;
      sport: string;
      institutionName: string | null;
    }
  | {
      targetType: 'correspondent';
      followId: string;
      createdAt: string;
      repId: string;
      displayName: string;
    };

// GET /follows/suggestions — the same shape as /mine plus a human-readable reason
// ("On a team you follow", etc.). Assignable to FollowMineEntry, so the shared
// FollowButton / carousel helpers accept a suggestion directly.
export type FollowSuggestion = FollowMineEntry & { reason: string };

// GET /follows/feed — the personalized content stream, discriminated on kind,
// newest-first and capped at 50. source is the follow that surfaced the entry
// (e.g. { type: 'team', name: 'Lincoln Lions' }) for the "via …" tag.
export type FollowFeedEntry =
  | {
      kind: 'game';
      id: string;
      matchup: string;
      homeTeamId: string | null;
      awayTeamId: string | null;
      homeScore: number | null;
      awayScore: number | null;
      status: 'scheduled' | 'live' | 'final' | 'postponed' | 'canceled';
      scheduledAt: string;
      source: { type: FollowTargetType; name: string };
    }
  | {
      kind: 'article';
      id: string;
      title: string;
      publishedAt: string | null;
      eventId: string | null;
      source: { type: FollowTargetType; name: string };
    };

// The POST/DELETE body — the target to (un)follow.
export interface FollowTargetInput {
  targetType: FollowTargetType;
  targetId: string;
}

// The stable target id out of a discriminated mine/suggestion entry (the id the
// follow rows on, per type). Used to key the carousel and build follow bodies.
export function followTargetId(
  entry: FollowMineEntry | FollowSuggestion,
): string {
  switch (entry.targetType) {
    case 'athlete':
      return entry.athleteId;
    case 'team':
      return entry.teamId;
    case 'correspondent':
      return entry.repId;
  }
}

// The display label out of a discriminated mine/suggestion entry.
export function followTargetName(
  entry: FollowMineEntry | FollowSuggestion,
): string {
  return entry.targetType === 'correspondent' ? entry.displayName : entry.name;
}

// The caller's follows, enriched. Fetch ONCE per session and share (see
// follows-context.tsx) — never per Follow button.
export const getMyFollows = (token: string) =>
  authGet<FollowMineEntry[]>('/follows/mine', token);

// The personalized content stream from everything the caller follows.
export const getFollowFeed = (token: string) =>
  authGet<FollowFeedEntry[]>('/follows/feed', token);

// Who to follow next — /mine-shaped entries each with a reason string.
export const getFollowSuggestions = (token: string) =>
  authGet<FollowSuggestion[]>('/follows/suggestions', token);

// The follower count for one target, for the "N followers" line beside a button.
export const getFollowCount = (
  token: string,
  targetType: FollowTargetType,
  targetId: string,
) =>
  authGet<{ count: number }>(
    `/follows/count?targetType=${targetType}&targetId=${encodeURIComponent(
      targetId,
    )}`,
    token,
  );

// POST /follows — idempotent 200 (re-following is a no-op), so the body isn't
// read. Following yourself comes back 409 -> "409 <message>"; the optimistic
// toggle reverts on that.
export async function followTarget(
  token: string,
  input: FollowTargetInput,
): Promise<void> {
  const res = await fetch(`${BASE}/follows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await toAuthError(res);
}

// DELETE /follows — 204, no body back. Unlike the other DELETEs this one carries
// a JSON body (the target), so it can't use the shared bodyless authDelete.
export async function unfollowTarget(
  token: string,
  input: FollowTargetInput,
): Promise<void> {
  const res = await fetch(`${BASE}/follows`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await toAuthError(res);
}

// ============================================================================
// Prediction engine — POINTS ONLY. NO CASH. NO WAGERING.
//
// Mirrors predictions.service.ts. `fan_points` is a closed-loop score with no
// monetary value: never bought, never redeemed, never cashed out. The UI
// language follows the backend's — "points", "picks", "stake". Never "bet",
// "wager", or "odds".
//
// The client NEVER sends a stake or a payout; it sends a key. All points math is
// server-side and atomic.
// ============================================================================

export type PredictionKind = 'winner' | 'yes_no' | 'over_under';
export type PredictionStatus = 'open' | 'locked' | 'resolved' | 'voided';

// 'game' = hung off an event we cover, opened courtside by a rep. 'national' = a
// house question about the wider sport ("Who wins the NBA Finals?"), tied to no
// game and opened by admin/RM only.
export type PredictionScope = 'game' | 'national';

// A pick's outcome is DERIVED on the backend from its parent's status and its
// payout (outcomeOf) — it is not a stored column. 'refunded' is a voided
// question (payout stays null); 'lost' is a resolved one that paid 0.
export type PickOutcome = 'pending' | 'won' | 'lost' | 'refunded';

// An option as the fan-facing board returns it: the stored {key,label} plus the
// crowd's distribution. `share` is a 0–1 fraction (4dp), already divided by
// totalPicks server-side — 0 when nobody has picked yet.
export interface PredictionOption {
  key: string;
  label: string;
  count: number;
  share: number;
}

// Everything a board row carries REGARDLESS of scope — the exact shape of the
// backend's `withPickData()`, which is scope-blind on purpose so a question
// reads identically on the per-game board and the National Board. The two
// concrete boards below each add only the fields their own read layers on top.
//
// This is what the shared PickCard renders (see predictions.tsx): a card that
// took the game board's `Prediction` couldn't show a national question, whose
// row has no eventId at all.
export interface PredictionBase {
  id: string;
  question: string;
  kind: PredictionKind;
  // `numeric` at rest, so a STRING over the wire (over_under only, else null).
  // Display-only here — never do math on it, same rule as money.
  line: string | null;
  stake: number;
  status: PredictionStatus;
  opensAt: string;
  locksAt: string | null;
  resolvedAt: string | null;
  options: PredictionOption[];
  totalPicks: number;
  // Only ever set once resolved; null on open/locked/voided.
  winningKey: string | null;
  myPick: {
    pickKey: string;
    stake: number;
    // null until the question settles (and stays null on a void — that's what
    // separates 'refunded' from 'lost').
    payout: number | null;
    outcome: PickOutcome;
  } | null;
}

// GET /events/:id/predictions — one game's board, newest question first.
// eventId is the one field this board adds.
export interface Prediction extends PredictionBase {
  eventId: string;
}

// GET /predictions/national — the fan-facing National Board. Open+locked first,
// then recently resolved, capped at 20. Every authenticated role reads it.
//
// Note the absences: NO eventId (a national question is tied to no game) and no
// 'voided' row will ever appear — the backend excludes voided from this read on
// purpose (a question staff PULLED isn't advertised to fans who never picked
// it). Fans who did pick it still see it on /predictions/my-picks as 'refunded'.
export interface NationalPrediction extends PredictionBase {
  // Echoed by the backend so a feed can mix these with game questions and tell
  // them apart without inferring it from a missing eventId.
  scope: 'national';
  // What the question is ABOUT ("NBA Finals 2026"). Required by the create DTO
  // on national scope, but the column is nullable (game rows carry null), so the
  // wire type is honest about it and the UI renders defensively.
  context: string | null;
  // The promise-to-fans settle date. A DATE ('2026-07-15'), not a datetime —
  // it's a commitment fans read, not an instant anything fires on. Optional at
  // create, so null here means "no date promised".
  resolvesBy: string | null;
  // The real staff member who opened it, by display name — not a house brand.
  openedByName: string | null;
}

// GET /predictions/open-games — the feed's "Make your picks" carousel: games
// with at least one question a fan can pick RIGHT NOW. Live games first, then
// soonest to start; capped at 12.
//
// Team names are NULLABLE (the backend left-joins them, so a game whose team row
// went missing still reaches the carousel) and there are deliberately no team
// IDs on this read — anything matching these against follows must do it by name.
export interface OpenPickGame {
  eventId: string;
  homeTeamName: string | null;
  awayTeamName: string | null;
  // Only ever a game that hasn't finished — there's nothing to pick on a game
  // that's over, so the backend filters to these two.
  status: 'scheduled' | 'live';
  scheduledAt: string;
  openCount: number;
  // The cheapest way onto this game's board — what a fan needs to play.
  minStake: number;
}

// POST /predictions body. Labels are MOSTLY server-owned: the backend takes team
// names from the event for a game `winner`, and writes "Over <line>"/"Under
// <line>"/"Yes"/"No" itself. Sending keys only keeps the server authoritative.
//
// The ONE exception is a national `winner` — there's no event to take names
// from, so the caller must supply a label per option or the board renders raw
// keys ("okc") at fans. That's the only multi-way question v1 has: 2-6 options,
// caller-keyed. Every other (scope, kind) pair keeps the closed key set.
//
// The scope split, enforced by the backend's refinement and mirrored here:
//   game     — eventId REQUIRED; context/resolvesBy rejected (the event IS the
//              context, and it resolves when the game ends).
//   national — eventId REJECTED; context REQUIRED; resolvesBy optional.
export interface CreatePredictionInput {
  // Defaulted to 'game' server-side, so an existing courtside caller that has
  // never heard of this field keeps working untouched.
  scope?: PredictionScope;
  // Required on game scope, rejected on national.
  eventId?: string;
  // Required on national scope, rejected on game.
  context?: string;
  // National only. A DATE ('2026-07-15'), never a datetime.
  resolvesBy?: string;
  question: string;
  kind: PredictionKind;
  options: Array<{ key: string; label?: string }>;
  line?: number;
  // Capped server-side at the 1,000-point starting grant: a question staked
  // above what a new fan has is unplayable by every new fan.
  stake?: number;
  locksAt?: string;
}

// POST /predictions returns the RAW prediction row — no options distribution, no
// myPick. It is not the board shape, so a caller that needs the board re-reads
// GET /events/:id/predictions rather than splicing this in.
export interface CreatedPrediction {
  id: string;
  eventId: string;
  question: string;
  kind: PredictionKind;
  status: PredictionStatus;
  stake: number;
}

// POST /predictions/:id/pick → the created pick row + the fan's NEW balance
// (authoritative, straight out of the debit). 409s: already picked, insufficient
// points, picks closed.
export interface PredictionPickResult {
  id: string;
  predictionId: string;
  pickKey: string;
  stake: number;
  balance: number;
}

// POST /predictions/:id/resolve → the settled row + what it paid out.
export interface ResolvedPrediction {
  id: string;
  status: PredictionStatus;
  winningKey: string | null;
  tally: { picks: number; winners: number; pointsPaid: number };
}

// POST /predictions/:id/void → the voided row + what it refunded.
export interface VoidedPrediction {
  id: string;
  status: PredictionStatus;
  tally: { refunded: number; pointsRefunded: number };
}

// GET /predictions/my-picks — the caller's wallet + full pick history,
// newest-first. `net` is what the pick did to the balance: a refund nets 0, a
// still-pending pick reads as -stake (those points ARE debited right now).
//
// Carries BOTH scopes. A national pick reports eventId: null and is captioned by
// its `context` instead — there is no game to link it to. Anything rendering a
// pick must branch on that rather than assume a game.
export interface MyPick {
  pickId: string;
  predictionId: string;
  // NULL on a national pick. Never build a /games/ link without checking.
  eventId: string | null;
  scope: PredictionScope;
  // The national caption ("NBA Finals 2026"); null on a game pick, whose event
  // is its context.
  context: string | null;
  question: string;
  kind: PredictionKind;
  pickKey: string;
  pickLabel: string;
  stake: number;
  payout: number | null;
  status: PredictionStatus;
  winningKey: string | null;
  pickedAt: string;
  resolvedAt: string | null;
  outcome: PickOutcome;
  net: number;
}

// A fan who has never picked has no wallet row, which the backend reads as the
// untouched 1,000-point starting grant — "hasn't played", not "broke".
export interface MyPicksReport {
  balance: number;
  lifetimeEarned: number;
  picks: MyPick[];
}

// GET /leaderboards/points. `pending` is event-scope only ("N picks still live").
export interface LeaderboardEntry {
  userId: string;
  displayName: string | null;
  score: number;
  // null = not on this board at all yet (never picked / never picked on this
  // game). Deliberately NOT the same as ranking last.
  rank: number | null;
  pending?: number;
}

// `top` is the top 20 by row_number; `me` is the caller's own row, pulled
// alongside so a fan outside the cut still sees where they stand.
export interface PointsLeaderboard {
  scope: 'global' | 'event';
  eventId?: string;
  top: LeaderboardEntry[];
  me: LeaderboardEntry;
}

// GET /fans/:userId/points-summary — the PUBLIC card behind a leaderboard name.
// Mirrors predictions.service.ts `pointsSummary()`.
//
// Two deliberate absences, both load-bearing:
//   • No `balance`. The spendable wallet is the one number that feels private;
//     it stays on /predictions/my-picks (caller-only). `lifetimeEarned` is the
//     score and is already public on the board. `balanceHidden: true` is the
//     backend saying that omission is a decision — don't "fix" it by reaching
//     for getMyPicks() to fill a balance into this card.
//   • No pick log. This read is counts, never rows; the pick-by-pick history is
//     caller-only and lives on /picks.
export interface FanPointsSummary {
  userId: string;
  displayName: string;
  // Same basis as the global board (lifetime_earned), so the two never disagree.
  lifetimeEarned: number;
  balanceHidden: true;
  // rank(), so ties share a number — a fan can legitimately be one of three #2s.
  globalRank: number;
  // `refunded` is reported but excluded from totalResolved: a void has no
  // outcome, so a question staff pulled must not dent a fan's win rate.
  // totalResolved === won + lost.
  record: {
    won: number;
    lost: number;
    refunded: number;
    totalResolved: number;
  };
  // 0..1, or null when nothing has resolved yet — "unknown", not 0%.
  winRate: number | null;
  // Null only in the edge where a fan's picks were cascaded away with their
  // events but their wallet survived.
  firstPickAt: string | null;
  // Null = has never won one. Distinct from "won a long time ago".
  lastWonAt: string | null;
}

// Resolves to null on a 404, which means this fan has never picked (the wallet
// row is only ever created BY a pick). That's a state the card renders, not an
// error — hence authGetOrNull.
export const getFanPointsSummary = (token: string, userId: string) =>
  authGetOrNull<FanPointsSummary>(
    `/fans/${encodeURIComponent(userId)}/points-summary`,
    token,
  );

// The fan-facing board for one game. Any authenticated role reads it.
export const getEventPredictions = (token: string, eventId: string) =>
  authGet<Prediction[]>(`/events/${eventId}/predictions`, token);

// The National Board. Any authenticated role reads it — opening one is admin/RM,
// but PICKING one is everybody, same as any other question.
export const getNationalPredictions = (token: string) =>
  authGet<NationalPrediction[]>('/predictions/national', token);

// The feed carousel's games-with-open-questions strip. A fan-facing read, same
// as the boards it links to.
export const getOpenPickGames = (token: string) =>
  authGet<OpenPickGame[]>('/predictions/open-games', token);

// Make a pick. Sends a KEY and nothing else — stake and payout are server-owned.
export const makePick = (token: string, predictionId: string, pickKey: string) =>
  authPost<PredictionPickResult>(`/predictions/${predictionId}/pick`, token, {
    pickKey,
  });

// ---- Staff (admin / regional_manager / field_rep) — the courtside controls ----

export const createPrediction = (token: string, input: CreatePredictionInput) =>
  authPost<CreatedPrediction>('/predictions', token, input);

export const lockPrediction = (token: string, predictionId: string) =>
  authPost<CreatedPrediction>(`/predictions/${predictionId}/lock`, token, {});

// Pays out irreversibly — the console confirms before calling this.
export const resolvePrediction = (
  token: string,
  predictionId: string,
  winningKey: string,
) =>
  authPost<ResolvedPrediction>(`/predictions/${predictionId}/resolve`, token, {
    winningKey,
  });

// The mercy switch: refunds every stake and settles nothing.
export const voidPrediction = (token: string, predictionId: string) =>
  authPost<VoidedPrediction>(`/predictions/${predictionId}/void`, token, {});

// ---- Points identity ----

// The full pick history, every scope, newest-first — there is no server-side
// filter on this read.
//
// FUTURE ENRICHMENT: a `?pending=true` param. The feed's "Your picks" band wants
// only in-play picks plus the last 48h of settled ones, and today it fetches the
// whole history and filters client-side (see feed-picks.tsx). That's honest at a
// handful of picks and wrong at a thousand: this read grows without bound per
// fan, and the feed pays for all of it on every load. A `pending=` (or a date
// floor) on the backend would let the band ask for what it actually renders.
export const getMyPicks = (token: string) =>
  authGet<MyPicksReport>('/predictions/my-picks', token);

export const getPointsLeaderboard = (
  token: string,
  scope: 'global' | 'event' = 'global',
  eventId?: string,
) =>
  authGet<PointsLeaderboard>(
    `/leaderboards/points?scope=${scope}${
      eventId ? `&eventId=${encodeURIComponent(eventId)}` : ''
    }`,
    token,
  );

// A national question whose promised settle date has passed while it is STILL
// open or locked — i.e. fans are holding staked points on a question the house
// said it would have settled by now. The feed says so to the fan; the admin
// board pills it as a warning. One rule, so the two can't disagree about who's
// late.
//
// resolvesBy is a DATE, not an instant, so the deadline is the END of that day:
// a question resolving "by Jul 15" is not overdue at 9am on the 15th. Compared
// in UTC because that's the zone the date was stored in — reading it in the
// viewer's zone would make the same question late in Sydney and fine in LA.
export function isNationalOverdue(p: {
  resolvesBy: string | null;
  status: PredictionStatus;
}): boolean {
  if (!p.resolvesBy) return false;
  if (p.status !== 'open' && p.status !== 'locked') return false;
  const due = new Date(`${p.resolvesBy}T23:59:59Z`).getTime();
  return !Number.isNaN(due) && Date.now() > due;
}

// Points are a plain integer count, never money — so they format as a grouped
// count ("1,100"), never through usd(). The ⚡ chip and the picks hero append
// the unit themselves.
export function points(n: number): string {
  return n.toLocaleString('en-US');
}

// Signed net for a pick row ("+200" / "−100" / "0"). Uses a real minus sign to
// match the en-dash/typographic treatment used elsewhere in the app.
export function signedPoints(n: number): string {
  if (n === 0) return '0';
  return n > 0 ? `+${points(n)}` : `−${points(Math.abs(n))}`;
}

// ============================================================================
// CONTESTS — the generic contest chassis + pick'em gameplay. POINTS ONLY, the
// same closed loop as predictions: entry costs points, payouts pay points, and
// every move is an immutable point_events row. Mirrors contests.service.ts,
// pickem.service.ts, and points-ledger.service.ts on the backend.
//
// The one live gameplay type is 'pickem'; the other four enum values exist but
// their modules 501 at create, so a fan only ever sees pick'em contests here.
// ============================================================================

export type ContestType =
  | 'pickem'
  | 'survivor'
  | 'squares'
  | 'parlay_board'
  | 'bracket'
  | 'overunder';

// draft/open/locked/live/final/canceled, straight off the contests_status_check.
// Fans meet a contest at 'open' (enter + pick), then it lazy-locks at the first
// kickoff and rides locked -> live -> final; canceled is the mercy exit.
export type ContestStatus =
  | 'draft'
  | 'open'
  | 'locked'
  | 'live'
  | 'final'
  | 'canceled';

// The payout table the chassis owns: config.payouts = [{rank, points}, ...].
// Points paid to each finishing rank at finalize; a contest may have none (a
// pure leaderboard). See ContestsService.assertPayoutsValid.
export interface PayoutRow {
  rank: number;
  points: number;
}

// The contest's per-type config bag (jsonb). The chassis owns `payouts`; a
// pick'em adds `eventIds` (the slate) and optional `pointsPerCorrect` (the
// scoreboard weight, defaulting to 1). Left open-ended to mirror the backend's
// `Record<string, unknown>` — read the known keys, ignore the rest.
export interface ContestConfig {
  payouts?: PayoutRow[];
  eventIds?: string[];
  pointsPerCorrect?: number;
  // Squares config (config bag on a type='squares' contest — see squares.type.ts):
  // squareCost is the points a fan spends per claimed square (entry itself is
  // free), periodPayouts is the per-boundary prize table. Read to show
  // "25 pts/square" where a pick'em shows its entry cost.
  squareCost?: number;
  periodPayouts?: Array<{ period: 1 | 2 | 3 | 'final'; points: number }>;
  // Survivor config (config bag on a type='survivor' contest — see the round-based
  // elimination game). Each round carries the slate of eventIds a fan may pick
  // ONE team from; a team may be used only once across the whole contest. The
  // survivor picks read (getSurvivorPicks) carries only the CURRENT pick per
  // round, not this slate, so the board resolves these eventIds to team names via
  // the events API (getEvents) to render each round's available games.
  rounds?: Array<{ round: number; eventIds: string[] }>;
  // Parlay board config (config bag on a type='parlay_board' contest — see
  // parlay.type.ts). Entering is FREE; the TICKET is the buy, staked somewhere in
  // [minStake, maxStake], carrying [minLegs, maxLegs] legs priced by the
  // multipliers ladder (keys are leg counts as strings, because jsonb). The board
  // read (getParlayBoard) carries all of this as `rules`, so a card only needs the
  // stake bounds here — see parlayStakeRangeLabel.
  minLegs?: number;
  maxLegs?: number;
  multipliers?: Record<string, number>;
  minStake?: number;
  maxStake?: number;
  maxTicketsPerUser?: number;
  [key: string]: unknown;
}

// A bare contests row (GET /contests items, POST lifecycle returns). money-free:
// entryCost is a plain point count. opensAt/locksAt/resolvesBy are nullable
// timestamptz strings (a generated pick'em leaves them null and locks off the
// slate's earliest kickoff instead — see the pick sheet). description nullable.
export interface Contest {
  id: string;
  type: ContestType;
  title: string;
  description: string | null;
  status: ContestStatus;
  entryCost: number;
  maxEntries: number | null;
  config: ContestConfig;
  createdBy: string;
  opensAt: string | null;
  locksAt: string | null;
  resolvesBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// A contest_entries row (POST /contests/:id/enter `.returning()`, and detail's
// myEntry). score is `numeric` -> a STRING at rest (keep it a string until the
// render boundary, same discipline as money); rank is null until finalize.
export interface ContestEntry {
  id: string;
  contestId: string;
  userId: string;
  status: 'active' | 'eliminated' | 'withdrawn' | 'final';
  score: string;
  rank: number | null;
  enteredAt: string;
}

// GET /contests/:id — the contest row plus the three read-time extras the list
// deliberately doesn't carry: `playable` (is the type's gameplay module
// installed), `myEntry` (the caller's entry or null), and `entrants` (the live
// count). A detail read also lazy auto-locks the contest, so `status` here is
// honest even if the earliest game has kicked off since the row was written.
export interface ContestDetail extends Contest {
  playable: boolean;
  myEntry: ContestEntry | null;
  entrants: number;
}

// One leaderboard row. NOTE the snake_case: this read is raw SQL
// (ContestsService.leaderboard uses db.execute with explicit aliases), so unlike
// every other shape here the keys are user_id/display_name, not camelCase. score
// is `numeric` -> a string; rank() shares a number across ties; seq is the
// stable row_number used for the top-50 cut.
export interface ContestLeaderboardRow {
  user_id: string;
  display_name: string | null;
  score: string;
  status: string;
  rank: number;
  seq: number;
}

// GET /contests/:id/leaderboard — the top 50 by live rank plus the caller's own
// row (`me`), which is null only when the caller has no entry at all.
export interface ContestLeaderboard {
  contestId: string;
  items: ContestLeaderboardRow[];
  me: ContestLeaderboardRow | null;
}

// A fan's side on one game. A pick'em slate picks a TEAM (home/away); an
// over/under slate picks a DIRECTION on the combined total (over/under). Each is
// the closed key set its own sheet upserts — the contest type decides which.
export type PickSide = 'home' | 'away';
export type OuSide = 'over' | 'under';
export type PickValue = PickSide | OuSide;

// One row of the pick sheet: a slate game with team names + schedule + live/
// final scores, the caller's pick and its graded result, and — only once the
// contest has locked — the crowd's split. `status` here is the EVENT's status (a
// game can be final while the contest is still live); the sheet-level
// status/revealed below are the contest's.
//
// `line` is the over/under total, present ONLY on an 'overunder' slate (the
// snapshot frozen at open, so it can't drift). It's a numeric `numeric` column ->
// a STRING at rest, same money discipline: keep it a string, format at render.
//
// `distribution` is present ONLY when the sheet is revealed (locked/live/final);
// pre-lock the backend omits the key entirely (no herding onto the popular side),
// so it's optional here and the UI must guard on `revealed` rather than on it.
// Its shape mirrors the pick set: home/away for pick'em, over/under for O/U.
export interface PickSheetGame {
  eventId: string;
  homeTeam: string | null;
  awayTeam: string | null;
  scheduledAt: string;
  status: EventListItem['status'];
  homeScore: number | null;
  awayScore: number | null;
  line?: string | null;
  pick: PickValue | null;
  // null until graded; true/false as the game finalizes (a tie/push sets false).
  isCorrect: boolean | null;
  distribution?: { home: number; away: number } | { over: number; under: number };
}

// GET/PUT /contests/:id/picks — the whole sheet. `status` is the contest status
// and `revealed` is (status is locked/live/final): the flag the crowd
// distribution rides on. `summary` is the caller's own progress + running score.
export interface PickSheet {
  contestId: string;
  entryId: string;
  status: ContestStatus;
  revealed: boolean;
  pointsPerCorrect: number;
  games: PickSheetGame[];
  summary: { picksMade: number; correct: number };
}

// PUT /contests/:id/picks body. A PARTIAL sheet is fine — the backend upserts
// per-pick, so sending one game saves that one and leaves the rest. Duplicate
// eventIds in a single body are rejected (400); the tap-to-save UI never sends
// more than one anyway.
export interface SubmitPicksInput {
  picks: Array<{ eventId: string; pick: PickValue }>;
}

// An immutable point_events row (GET /points/ledger items). `points` is SIGNED:
// negative is a spend/debit (contest entry), positive an earn/credit (payout,
// engagement, refund). referenceType/referenceId tie it to what it was about
// (a contest); note is the human line ("Entry: Weekend Pick'em"). Append-only —
// nothing ever updates or deletes one.
export interface PointEvent {
  id: string;
  userId: string;
  actionType: string;
  points: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
}

// GET /contests filters (status/type/limit/offset), same server-paging shape as
// the other browse reads. The backend orders open + live first (the playable
// lobby), then newest — so the default (no status) is already lobby-ordered.
export interface ContestFilters {
  status?: ContestStatus;
  type?: ContestType;
  limit?: number;
  offset?: number;
}

export const getContests = (token: string, params: ContestFilters = {}) => {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.type) qs.set('type', params.type);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const s = qs.toString();
  return authGet<Page<Contest>>(`/contests${s ? `?${s}` : ''}`, token);
};

// The contest page's read — carries myEntry + entrants + playable, and lazy
// auto-locks on load so the status the page branches on is honest.
export const getContest = (token: string, id: string) =>
  authGet<ContestDetail>(`/contests/${id}`, token);

// Enter a contest. Spends entryCost through the ledger in the same tx as the
// insert, so a failed debit rolls back cleanly. 409s: already entered, contest
// full, contest not open, or "Insufficient points" (surfaced verbatim inline).
// Returns the created entry row — NOT a balance, so the caller refreshes the ⚡
// chip from its own wallet read (getMyPicks) after this resolves.
export const enterContest = (token: string, id: string) =>
  authPost<ContestEntry>(`/contests/${id}/enter`, token, {});

// Withdraw while still open: refunds the entry fee (a balance-only adjustment,
// not an earn) and deletes the entry, so the fan can re-enter. 409 once the
// contest has locked. The backend returns { withdrawn: id }, which the caller
// doesn't need — a resolved promise is the signal to refresh.
export const withdrawContest = (token: string, id: string) =>
  authDelete(`/contests/${id}/enter`, token);

export const getContestLeaderboard = (token: string, id: string) =>
  authGet<ContestLeaderboard>(`/contests/${id}/leaderboard`, token);

// The caller's pick sheet. Entered fans only (403 otherwise — the sheet is a
// participant's surface). Lazy auto-locks on read, so `revealed` is honest.
export const getPickSheet = (token: string, id: string) =>
  authGet<PickSheet>(`/contests/${id}/picks`, token);

// Upsert picks. Returns the rebuilt sheet, so the tap-to-save UI reconciles its
// optimistic state from the response rather than tracking it by hand. 409s: the
// contest locked, or a picked game already started (lazy per-event lock).
export const submitPicks = (token: string, id: string, input: SubmitPicksInput) =>
  authPut<PickSheet>(`/contests/${id}/picks`, token, input);

// The caller's own points statement, newest first — the immutable ledger made
// visible. Every authenticated caller has one (no @Roles on GET /points/ledger).
export const getPointsLedger = (
  token: string,
  params: { limit?: number; offset?: number } = {},
) => {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const s = qs.toString();
  return authGet<Page<PointEvent>>(`/points/ledger${s ? `?${s}` : ''}`, token);
};

// Display label for a contest type. Only 'pickem' is playable in v1; the rest
// are named for the rare admin/list case where a draft of another type exists.
export function contestTypeLabel(type: ContestType): string {
  switch (type) {
    case 'pickem':
      return "Pick'em";
    case 'survivor':
      return 'Survivor';
    case 'squares':
      return 'Squares';
    case 'parlay_board':
      // "Parlay" rather than "Parlay board": this label is a BADGE (lobby card,
      // feed rail, my-contests row) where the short word reads better, and the
      // board's own page says the rest.
      return 'Parlay';
    case 'bracket':
      return 'Bracket';
    case 'overunder':
      return 'Over/Under';
  }
}

// Entry cost as fans read it: "Free" at zero, else a grouped point count.
export function contestCost(entryCost: number): string {
  return entryCost > 0 ? `${points(entryCost)} pts` : 'Free';
}

// A squares contest is FREE to enter -- the SQUARE is the buy -- so where a
// pick'em card shows its entry cost, a squares card shows the per-square price
// off config.squareCost ("25 pts/square"). Falls back to "Squares" if the cost
// key is missing on an older/odd row.
export function squaresPerSquareLabel(config: ContestConfig): string {
  const c = config.squareCost;
  return typeof c === 'number' && c > 0 ? `${points(c)} pts/square` : 'Squares';
}

// A human line for one ledger row's action_type. Mirrors the backend's action
// vocabulary (contest_entry/contest_payout/adjustment + the engagement set);
// an unknown type degrades to its slug de-underscored rather than rendering raw.
//
// BOTH SPELLINGS of the engagement actions are here on purpose. The canonical
// keys (article_read, watch_live_game, …) are what the economy writes today; the
// engagement_* names are what the pre-economy ledger wrote, and point_events is
// APPEND-ONLY, so those historical rows are still in a fan's statement and still
// need a label. See LEGACY_ACTION_ALIASES in engagement-actions.ts.
export function ledgerActionLabel(actionType: string): string {
  switch (actionType) {
    case 'contest_entry':
      return 'Contest entry';
    case 'contest_payout':
      return 'Contest payout';
    case 'adjustment':
      return 'Adjustment';
    case 'daily_checkin':
      return 'Daily check-in';
    case 'team_follow':
      return 'Followed a team';
    case 'referral_bonus':
      return 'Referral bonus';
    case 'article_read':
    case 'engagement_article_read':
      return 'Read an article';
    case 'watch_live_game':
    case 'engagement_game_watch':
      return 'Watched a game';
    case 'national_pick':
    case 'engagement_national_pick':
      return 'National pick';
    default:
      return actionType.replace(/_/g, ' ');
  }
}

// ============================================================================
// SQUARES (v2 — MULTI-BOARD) — the 10x10 grid gameplay on a type='squares'
// contest. The contest chassis (enter/leaderboard) is shared with pick'em above;
// this is the boards on top. Mirrors squares.service.ts / squares.type.ts on the
// backend. POINTS ONLY: entering is FREE, each claimed square spends
// config.squareCost.
//
// THE MODEL: a contest runs UNLIMITED BOARDS that fill STRICTLY ONE AT A TIME.
// Board 2 accepts nothing until board 1's 100 squares are all claimed; filling
// square #100 spawns the next board in the same transaction. The client never
// names a board — it claims { row, col } and the server routes to the filling one.
// At game start EVERY board locks as-is: the partially-filled one plays with its
// holes and SHARP FOXX OWNS the unclaimed squares. If an SF-owned square wins a
// period, that prize is DEDICATED TO THE NEXT PROMOTION — recorded, paid to
// nobody, never kept as revenue.
//
// GEOMETRY, pinned once so the UI never guesses: row/col are 0..9 GRID INDICES,
// not digits. rowDigits are the HOME team's digits (indexed by row); colDigits
// the AWAY team's (indexed by col). Both are NULL until that BOARD locks at
// kickoff (the digit reveal) — pre-lock the headers show "?". EACH BOARD IS
// RANDOMIZED INDEPENDENTLY, so board 1's digits say nothing about board 2's. A
// winning square's row lands on the home digit, its col on the away digit.
// ============================================================================

// The 1|2|3|'final' boundary a squares prize pays at. 'final' is the whole-game
// boundary (includes OT); 1/2/3 are the per-period line scores.
export type SquaresPeriod = 1 | 2 | 3 | 'final';

// The event header the grid read carries for context: team names + live/final
// score + kickoff. Null only if the joined event row somehow went missing.
export interface SquaresEvent {
  id: string;
  status: EventListItem['status'];
  homeTeam: string | null;
  awayTeam: string | null;
  homeScore: number | null;
  awayScore: number | null;
  scheduledAt: string;
}

// One occupied square: its grid index (row/col), the owner's display name (null
// if unlinked), and whether it's the caller's. Open squares are simply absent
// from the array.
export interface SquaresClaim {
  row: number;
  col: number;
  displayName: string | null;
  mine: boolean;
}

// A prize-table row BEFORE its period is graded, on one board. v2 has no rollover
// carry, so the prospective pool is simply the configured points.
export interface SquaresPrizePending {
  period: SquaresPeriod;
  basePoints: number;
  status: 'pending';
  prospectivePool: number;
}

// A prize-table row AFTER grading, on one board. Carries the winning square + the
// two digits that hit.
//   'won'       — a fan owned the winning square; pointsPaid reached them.
//   'dedicated' — the winning square was SHARP FOXX's (the board locked partially
//                 filled). pointsPaid is 0 and dedicatedNote records where the
//                 prize went: it is DEDICATED TO THE NEXT PROMOTION — not paid to
//                 anyone, not rolled into the next period, never kept as revenue.
export interface SquaresPrizeGraded {
  period: SquaresPeriod;
  basePoints: number;
  status: 'won' | 'dedicated';
  winner: { userId: string; displayName: string | null } | null;
  winningSquare: { row: number; col: number };
  homeDigit: number;
  awayDigit: number;
  pointsPaid: number;
  dedicatedNote: string | null;
}

export type SquaresPrizeRow = SquaresPrizePending | SquaresPrizeGraded;

// A raw period_results row (a board's `periodResults`), as each boundary lands.
// The board's prizeTable is the display-ready projection of these; kept typed for
// completeness, the UI reads prizeTable.
export interface SquaresPeriodResult {
  period: string;
  homeDigit: number;
  awayDigit: number;
  winRow: number;
  winCol: number;
  winnerUserId: string | null;
  winnerName: string | null;
  basePoints: number;
  pointsPaid: number;
  sfOwned: boolean;
  dedicatedNote: string | null;
}

// A board's own lifecycle, distinct from the CONTEST's status:
//   'filling' — the ONE board taking claims right now (isCurrent).
//   'full'    — all 100 claimed; closed to claims AND releases; waiting for lock.
//   'locked'  — the game started; digits revealed; plays as-is (a partial board
//               keeps its holes, and Sharp Foxx owns them).
//   'settled' — every configured period boundary graded.
export type SquaresBoardStatus = 'filling' | 'full' | 'locked' | 'settled';

// ONE BOARD of a squares contest. A contest runs UNLIMITED boards that fill
// STRICTLY ONE AT A TIME — board 2 takes no claims until board 1's 100 squares are
// all gone. Each board has its OWN independent digit randomization, so the same
// game's score lands on a different winning square on every board, and each board
// pays the contest's prize ladder in parallel.
export interface SquaresBoard {
  boardNumber: number; // 1-based fill order
  status: SquaresBoardStatus;
  isCurrent: boolean; // true on the one 'filling' board — the only claimable one
  dimensions: { rows: number; cols: number };
  rowDigits: number[] | null; // THIS board's home-team digits, null until it locks
  colDigits: number[] | null; // THIS board's away-team digits, null until it locks
  lockedAt: string | null;
  claimedCount: number; // 0..100
  sfOwnedCount: number; // unclaimed squares on a LOCKED board — Sharp Foxx's; 0 before
  myClaimCount: number; // the caller's squares on THIS board
  claimed: SquaresClaim[];
  prizeTable: SquaresPrizeRow[];
  periodResults: SquaresPeriodResult[];
}

// GET /contests/:id/squares — every board of the contest plus the contest-level
// header they share. status is the CONTEST status (open → the filling board is
// claimable; locked/live/final → every board's digits revealed, no more claims).
//
// BREAKING CHANGE vs v1: the flat single grid (top-level rowDigits/claimed/
// prizeTable) is now `boards[]`. There is no compat shim — publishing board 1 as
// "the" grid would be actively wrong once a second board exists.
export interface SquaresGrid {
  contestId: string;
  status: ContestStatus;
  event: SquaresEvent | null;
  squareCost: number;
  dimensions: { rows: number; cols: number };
  // The board a claim would land on right now; null once the contest locks and no
  // board is 'filling' any more.
  currentBoardNumber: number | null;
  totalBoards: number;
  myClaimCount: number; // total across every board; each board carries its own
  // The board-INVARIANT configured prize ladder — what EVERY board pays at each
  // boundary. Each board's live table (winners / dedications) is on the board.
  prizeTable: { period: SquaresPeriod; points: number }[];
  boards: SquaresBoard[];
}

// POST /contests/:id/squares/claim response. The request carries NO board — the
// server routes the claim to the current filling board and tells you which one it
// landed on. balance is the caller's new wallet after the spend (null only when
// squareCost is 0); myClaimCount is their new owned total ON THAT BOARD.
// nextBoardNumber is non-null when this claim filled the board and spawned the
// next one — the UI slides the fan onto it. 409s: 'That square is already taken',
// 'Contest is not open for claims', the per-board max-squares cap, or
// 'Insufficient points'; 403 if not entered.
export interface SquareClaimResult {
  contestId: string;
  boardNumber: number;
  claimed: { row: number; col: number };
  squareCost: number;
  myClaimCount: number;
  boardClaimCount: number; // squares claimed on that board after this claim, 1..100
  nextBoardNumber: number | null;
  balance: number | null;
}

// DELETE /contests/:id/squares/claim response (release + refund while open).
// balance is the wallet after the refund (null when squareCost is 0). Releases are
// only allowed on the CURRENT FILLING board — releasing from a board that already
// filled would punch a hole behind the fill frontier, so those 409 with a message
// naming the board.
export interface SquareReleaseResult {
  contestId: string;
  boardNumber: number;
  released: { row: number; col: number };
  balance: number | null;
}

// The boards read — any authenticated fan (a lobby surface), entered or not. Lazy
// auto-locks + reveals EVERY board's digits on first post-kickoff read, so
// status/rowDigits here are honest.
export const getSquaresGrid = (token: string, id: string) =>
  authGet<SquaresGrid>(`/contests/${id}/squares`, token);

// Claim one square (entered fans only — 403 'Enter the contest before claiming
// squares' otherwise, which the board handles by entering first then retrying).
// NO board parameter by design: the server routes the claim to the contest's
// current filling board, which is what makes the fill-then-spawn sequence
// unforgeable. The response says which board it landed on.
export const claimSquare = (
  token: string,
  id: string,
  ref: { row: number; col: number },
) => authPost<SquareClaimResult>(`/contests/${id}/squares/claim`, token, ref);

// Release one of the caller's own squares while the contest is still open AND the
// square is on the board that's still filling; the cost is refunded to the wallet.
// A square on an already-full board is frozen (409).
export const releaseSquare = (
  token: string,
  id: string,
  ref: { row: number; col: number },
) => authDeleteBody<SquareReleaseResult>(`/contests/${id}/squares/claim`, token, ref);

// Display label for a squares period boundary: 1/2/3 → "Q1"/"Q2"/"Q3",
// 'final' → "Final". (Football-ish, matching the default 4-boundary table.)
export function squaresPeriodLabel(period: SquaresPeriod): string {
  return period === 'final' ? 'Final' : `Q${period}`;
}

// ============================================================================
// SURVIVOR — the round-based elimination game on a type='survivor' contest. The
// contest chassis (enter/leaderboard) is shared with pick'em above; this is the
// round timeline on top. Each round a fan picks ONE team to win from that round's
// slate; a wrong pick (or no pick by lock) eliminates them, and a team may be
// used only ONCE across the whole contest. Mirrors survivor.service.ts on the
// backend. POINTS ONLY: entry costs points like any contest, no money.
//
// GET/PUT /contests/:id/picks share the SAME path as the pick'em sheet but return
// a DIFFERENT shape (a round timeline, not a game sheet) — the backend keys off
// the contest type. So these are typed and named separately from getPickSheet.
// ============================================================================

// One round's CURRENT pick, as the survivor picks read carries it. teamId is the
// team the fan is riding this round (what a re-pick replaces / what the "used
// teams" set derives from); teamName + opponent render the matchup. gameStatus is
// the EVENT's status; scores post as it plays. isCorrect is null until graded,
// then true (survived) / false (eliminated). NOTE the read carries only this
// current pick per round, NOT the round's full slate — the board resolves the
// slate from config.rounds[].eventIds via getEvents.
export interface SurvivorPick {
  eventId: string;
  teamId: string;
  teamName: string;
  opponent: string;
  scheduledAt: string;
  gameStatus: EventListItem['status'];
  homeScore: number | null;
  awayScore: number | null;
  isCorrect: boolean | null;
}

// One round in the timeline. locked flips at that round's first kickoff (no more
// picking); pick is null until the fan picks (an unpicked + locked round is what
// eliminates them). Rounds come back in round order.
export interface SurvivorRound {
  round: number;
  locked: boolean;
  pick: SurvivorPick | null;
}

// GET /contests/:id/picks on a survivor contest. entryStatus is the CALLER's
// standing ('active' = still alive, 'eliminated' = out); contestStatus is the
// contest's lifecycle status; alive/eliminated are the field-wide survivor counts
// for the header ("14 alive · 3 out"). Entered fans only (403 otherwise — a
// participant surface, same as the pick'em sheet).
export interface SurvivorPicks {
  entryStatus: 'active' | 'eliminated';
  contestStatus: ContestStatus;
  alive: number;
  eliminated: number;
  rounds: SurvivorRound[];
}

// PUT /contests/:id/picks body on a survivor contest — pick teamId from eventId
// for the given round. The backend upserts (a pre-lock re-pick replaces), so the
// board sends one round at a time on tap. 409s: the round locked, or the team was
// already used ("You already used <team> in round <N>", surfaced verbatim inline).
export interface SurvivorPickInput {
  round: number;
  eventId: string;
  teamId: string;
}

// The caller's survivor timeline. Entered fans only (403 otherwise). Lazy
// auto-locks on read, so `locked` per round is honest.
export const getSurvivorPicks = (token: string, id: string) =>
  authGet<SurvivorPicks>(`/contests/${id}/picks`, token);

// Submit (or replace, pre-lock) one round's pick. Returns the rebuilt timeline,
// so the board reconciles its optimistic state from the response. 409s: the round
// locked, or the team was already used in an earlier round.
export const submitSurvivorPick = (
  token: string,
  id: string,
  input: SurvivorPickInput,
) => authPut<SurvivorPicks>(`/contests/${id}/picks`, token, input);

// ============================================================================
// PARLAY BOARD — the ticket builder on a type='parlay_board' contest. The contest
// chassis (enter/leaderboard) is shared with pick'em above; this is the TICKET
// BOOK on top. Mirrors parlay.service.ts / parlay.type.ts on the backend.
//
// TWO LAYERS, the same shape squares uses: ENTERING is FREE (the entry row is
// just leaderboard presence) and the TICKET is the buy — `stake` points per
// ticket, 2–4 legs. Payout = stake × the ladder's multiplier for that leg count (a
// house table, no odds feed). POINTS ONLY: stakes and payouts are points, never
// money.
//
// A LEG IS A PICK ON A LINED MARKET — a game's TOTAL (over/under) or its SPREAD
// (favorite/underdog against the number). NOT a "team to win": moneyline legs were
// deleted, because a fixed multiplier ladder is only fair over markets that are
// ~50/50 by construction, and a betting line is exactly the number that makes both
// sides even. Stacking four favorites on a fixed ladder was free points.
//
// ONE LEG PER GAME, ACROSS MARKETS: a ticket may not pair a game's total with its
// own spread (correlated outcomes sold as two independent legs). Tapping a sibling
// chip on an already-legged game SWAPS the pick rather than adding a second leg.
//
// TICKETS ARE NOT THE PICK SHEET. /contests/:id/picks serves one revisable sheet
// per entry (pick'em, survivor); a ticket is an IMMUTABLE PURCHASE a fan may hold
// many of, so it gets its own sub-resource: /contests/:id/tickets. You don't edit
// a placed ticket — you cancel it (refund, while the board is open) and build
// another.
//
// LOCKING — the one rule: the CONTEST lock governs everything. The board
// auto-locks at the slate's EARLIEST kickoff, and from that instant there are no
// new tickets and no cancels. So the builder is offered on `status === 'open'`
// only; after that a fan sees their tickets and nothing else.
// ============================================================================

// A ticket's lifecycle. 'voided' is the mercy exit: enough legs voided (tie,
// canceled, postponed) that the survivors fell below minLegs, so the stake was
// refunded. 'won'/'lost' are settled; 'pending' is live.
export type ParlayTicketStatus = 'pending' | 'won' | 'lost' | 'voided';

// One leg's derived grade. 'void' legs stay ON the ticket (a fan should see WHY
// their 3-leg ticket became a 2-leg ticket) and drop out of the effective count,
// which is what REPRICES the ticket to a lower rung of the ladder.
export type ParlayLegResult = 'pending' | 'won' | 'lost' | 'void';

// Which market a leg is on, and which side of it. 'total' pairs with over|under;
// 'spread' pairs with favorite|underdog. The backend enforces the pairing with a
// DB CHECK, so an impossible combination is unrepresentable rather than merely
// rejected.
export type ParlayMarket = 'total' | 'spread';
export type ParlayPick = 'over' | 'under' | 'favorite' | 'underdog';

// One game on the board's slate, as the builder renders it: both teams (ids, for
// the leg body; names, for the chips), kickoff, live/final status + score, and the
// CURRENT lines for both markets — which is what the four chips are built from.
// The team ids are NULLABLE (events.home_team_id / away_team_id are, same as
// EventListItem) — an unlinked side can't be named, so those rows render inert.
//
// THE LINES ARE STRINGS (`numeric` out of pg): keep them strings and format at the
// render boundary, so a half-point line never round-trips through a float.
//
// PER-MARKET AVAILABILITY is the point of these being independently nullable:
//   totalLine null      → no O/U chips on this game
//   spreadFavorite null → no spread chips on this game (the line and the favorite
//                         always arrive together or not at all, folded into one
//                         object so there's a single "is there a spread?" test)
//   both null           → the row renders with inert "No line yet" chips
// A game with only one lined market is still fully playable on that market.
export interface ParlaySlateGame {
  eventId: string;
  scheduledAt: string;
  status: EventListItem['status'];
  homeTeamId: string | null;
  homeTeam: string | null;
  awayTeamId: string | null;
  awayTeam: string | null;
  homeScore: number | null;
  awayScore: number | null;
  totalLine: string | null;
  spreadLine: string | null;
  spreadFavorite: { id: string; name: string | null } | null;
}

// One leg of one of the caller's tickets. `matchup` is the pre-joined
// "Away @ Home" line (null if either team is unlinked); `result` is the graded
// mark. The event fields are nullable because the read left-joins them.
//
// market / pick / line / favoriteTeam are THIS LEG'S FROZEN SNAPSHOT, taken when
// the ticket was placed — not the game's current line. That's why the slip can say
// "OVER 16.5" or "MIL -1.5" and stay truthful after the live line moves, or even
// after the live spread flips which team is favored. Render these, never the
// slate's; they are what the leg actually grades against.
//
// favoriteTeam / underdogTeam are populated for spread legs only (null on a total —
// nothing is favored in an over/under). Both sides are sent because a slip must
// name the team the pick is ON: "COL +1.5", not "MIL +1.5", which would read as
// Milwaukee being the underdog.
export interface ParlayLeg {
  legId: string;
  eventId: string;
  market: ParlayMarket;
  pick: ParlayPick;
  line: string;
  favoriteTeamId: string | null;
  favoriteTeam: string | null;
  underdogTeam: string | null;
  matchup: string | null;
  scheduledAt: string | null;
  eventStatus: EventListItem['status'] | null;
  homeScore: number | null;
  awayScore: number | null;
  result: ParlayLegResult;
}

// One of the caller's tickets. `multiplier` is `numeric` -> a STRING ("3.00"),
// same discipline as money: keep it a string, parse only at the render boundary
// (formatMultiplier). potentialPayout is stake × the CURRENT multiplier — what it
// pays if every leg still standing wins; on a settled ticket that number is
// history and payoutPoints is what actually paid. legCount/multiplier are
// REWRITTEN at settlement when a void drops a leg, so a repriced ticket shows its
// new rung here.
export interface ParlayTicket {
  id: string;
  contestId: string;
  stake: number;
  legCount: number;
  multiplier: string;
  potentialPayout: number;
  status: ParlayTicketStatus;
  payoutPoints: number | null;
  settledAt: string | null;
  createdAt: string;
  legs: ParlayLeg[];
}

// The board's rules, exactly as the backend will enforce them. `multipliers` is
// the ladder keyed by leg count AS A STRING (it lands in jsonb) — read it with
// String(legCount), and expect a rung for every count in [minLegs, maxLegs].
export interface ParlayRules {
  minLegs: number;
  maxLegs: number;
  minStake: number;
  maxStake: number;
  multipliers: Record<string, number>;
}

// GET /contests/:id/tickets — the whole builder context in one read: the rules,
// the caller's tickets (with legs), their ticket count against the cap, and the
// slate. `status` is the CONTEST status (lazy auto-locked on read, so it's
// honest): the builder is offered only while it's 'open'. Any authenticated fan
// may read it — it's a lobby surface — so a non-entrant sees the board with an
// empty ticket list.
export interface ParlayBoardRead {
  contestId: string;
  status: ContestStatus;
  rules: ParlayRules;
  myTicketCount: number;
  ticketCap: number;
  slate: ParlaySlateGame[];
  tickets: ParlayTicket[];
}

// POST /contests/:id/tickets body. Legs must name DISTINCT slate games (one leg per
// game even across markets) and each leg's market must be LINED on its game — both
// are 400s otherwise, the second naming the game ("No spread yet on Rockies @
// Brewers").
//
// NOTE WHAT IS NOT SENT: the line. The server snapshots the game's CURRENT line
// onto the leg at creation. A client that could name its own line could name a
// stale or invented one, so the client picks a SIDE and the house says the number.
// This is also why a placed ticket is never edited — you cancel and rebuild, which
// re-snapshots at the then-current lines.
export interface BuildParlayTicketInput {
  stake: number;
  legs: Array<{ eventId: string; market: ParlayMarket; pick: ParlayPick }>;
}

// POST /contests/:id/tickets response — the built ticket plus the caller's new
// balance (the stake was just spent), so the ⚡ chip moves without a wallet
// re-read. 403 if the caller hasn't entered ("Enter the contest before building a
// ticket" — the board chains enter → ticket, exactly like squares' claim); 409s:
// 'Insufficient points', the ticket cap, or the slate having started.
export interface BuildParlayTicketResult {
  ticket: ParlayTicket;
  balance: number;
}

// DELETE /contests/:id/tickets/:ticketId response. The stake comes back as a
// signed 'adjustment' (a REFUND, not an earn — it must not inflate lifetime
// earned), the ticket row is deleted and its cap slot freed. 409 once the board
// has locked.
export interface CancelParlayTicketResult {
  contestId: string;
  canceledTicketId: string;
  refunded: number;
  balance: number;
}

// The board read. Lazy auto-locks on load, so `status` is honest even if the
// slate's earliest game kicked off since the row was written.
export const getParlayBoard = (token: string, id: string) =>
  authGet<ParlayBoardRead>(`/contests/${id}/tickets`, token);

// Build and stake a ticket. 403s for a caller with no entry, so the board enters
// first then retries (same chain squares uses for a first claim).
export const buildParlayTicket = (
  token: string,
  id: string,
  input: BuildParlayTicketInput,
) => authPost<BuildParlayTicketResult>(`/contests/${id}/tickets`, token, input);

// Tear a ticket up while the board is open — refunds the stake.
export const cancelParlayTicket = (token: string, id: string, ticketId: string) =>
  authDeleteJson<CancelParlayTicketResult>(`/contests/${id}/tickets/${ticketId}`, token);

// A multiplier as fans read it: "3" not "3.00", "2.5" not "2.50". Takes either
// the `numeric` string off a ticket or a plain ladder number; a genuinely
// unparseable value passes through rather than rendering NaN.
export function formatMultiplier(multiplier: string | number): string {
  const n = typeof multiplier === 'number' ? multiplier : Number(multiplier);
  if (!Number.isFinite(n)) return String(multiplier);
  return String(Number(n.toFixed(2)));
}

// A line as fans read it: "16.5" not "16.50", "3" not "3.0". Lines arrive as
// `numeric` strings, so this is the one place they become display text — never a
// float on the way through (a .5 line must survive verbatim). An unparseable value
// passes through rather than rendering NaN, same posture as formatMultiplier.
export function formatLine(line: string | number): string {
  const n = typeof line === 'number' ? line : Number(line);
  if (!Number.isFinite(n)) return String(line);
  return String(Number(n.toFixed(2)));
}

// A leg's market pick as the SLIP shows it — the ticket's own frozen snapshot:
//   total  → "OVER 16.5" / "UNDER 16.5"
//   spread → "MIL -1.5" (took the favorite) / "COL +1.5" (took the underdog)
//
// The spread label names THE TEAM THE PICK IS ON, with the sign that team carries:
// the favorite gives points (−), the underdog gets them (+). Naming the favorite
// either way and just flipping the sign would produce "MIL +1.5", which every
// reader parses as Milwaukee being the underdog — the exact opposite of the pick.
// Falls back to a generic anchor when that side's team name didn't come through
// (an unlinked team row).
export function parlayLegLabel(leg: {
  market: ParlayMarket;
  pick: ParlayPick;
  line: string;
  favoriteTeam?: string | null;
  underdogTeam?: string | null;
}): string {
  const line = formatLine(leg.line);
  if (leg.market === 'total') {
    return `${leg.pick === 'over' ? 'OVER' : 'UNDER'} ${line}`;
  }
  return leg.pick === 'favorite'
    ? `${leg.favoriteTeam ?? 'Favorite'} -${line}`
    : `${leg.underdogTeam ?? 'Underdog'} +${line}`;
}

// The ladder as the board's visual hook: "2 legs ×3 · 3 legs ×6 · 4 legs ×12".
// Keys are leg counts as strings, so sort them NUMERICALLY (string order would
// put "10" before "2").
export function parlayLadderLabel(multipliers: Record<string, number>): string {
  return Object.entries(multipliers)
    .map(([legs, mult]) => [Number(legs), mult] as const)
    .filter(([legs]) => Number.isFinite(legs))
    .sort((a, b) => a[0] - b[0])
    .map(([legs, mult]) => `${legs} legs ×${formatMultiplier(mult)}`)
    .join(' · ');
}

// A parlay board is FREE to enter -- the TICKET is the buy -- so where a pick'em
// card shows its entry cost, a parlay card shows the stake range off
// config.minStake/maxStake ("25–500 pts/ticket"). Falls back to the documented
// backend defaults (25/500) when the keys are missing on an older/odd row, and
// collapses to a single figure when the bounds are equal.
export function parlayStakeRangeLabel(config: ContestConfig): string {
  const min = typeof config.minStake === 'number' && config.minStake > 0 ? config.minStake : 25;
  const rawMax = typeof config.maxStake === 'number' && config.maxStake > 0 ? config.maxStake : 500;
  const max = rawMax >= min ? rawMax : min;
  return min === max
    ? `${points(min)} pts/ticket`
    : `${points(min)}–${points(max)} pts/ticket`;
}

// ============================================================================
// THE ENGAGEMENT ECONOMY — what passive activity is worth, and the admin dials
// that set it. Mirrors economy.service.ts / points-ledger.service.ts.
//
// POINTS ONLY, same as everything else on this ledger: a closed-loop score with
// no cash value. An "earn" is a fan being paid for showing up, reading, and
// picking — never for spending money.
//
// TWO AUDIENCES, one table pair, and the split matters for the types below:
//   * FAN   — GET /points/earn-menu + POST /points/engagement. Point values come
//             back PRE-MULTIPLIED (a live 2x weekend turns a 25-point check-in
//             into 50) with the promotion named alongside, so the UI never does
//             the arithmetic. Multipliers here are NUMBERS: the backend's config
//             cache is the one place the numeric(3,1) crosses to Number().
//   * ADMIN — GET/PATCH /economy/actions, CRUD /economy/promotions. These return
//             raw table rows, so a promotion's multiplier arrives as the numeric
//             STRING pg hands over. Format it with formatMultiplier(), never
//             math on it — same rule money lives under (CLAUDE.md).
// ============================================================================

// Every action_type the economy knows. The set is CODE-DEFINED on the backend
// (engagement-actions.ts): each one needs a hook that can actually fire it, so
// admins tune the rows but never add or remove them. Mirrored here because the
// promotion editor's applies-to picker has to offer exactly this list.
export const ENGAGEMENT_ACTION_TYPES = [
  'daily_checkin',
  'watch_live_game',
  'article_read',
  'national_pick',
  'team_follow',
  'referral_bonus',
] as const;

export type EngagementActionType = (typeof ENGAGEMENT_ACTION_TYPES)[number];

// What a CLIENT may self-report. referral_bonus is server-fired only — it's
// worth 100 points and pays SOMEONE ELSE, so a self-reportable one would be a
// mint. The endpoint's zod enum enforces this; the type stops us sending it.
export type ClientEarnAction = Exclude<EngagementActionType, 'referral_bonus'>;

// POST /points/engagement's answer. THE IMPORTANT PART: an engagement earn
// never errors at the fan. Hitting today's cap comes back `capped`, a disabled
// or zero-valued action comes back `skipped`, and BOTH carry a null balance and
// null points — nothing was written. Only a real earn has numbers in it.
export interface EarnResult {
  balance: number | null;
  lifetimeEarned: number | null;
  // Today's limit swallowed it.
  capped: boolean;
  // The action is off, unknown, or priced at 0.
  skipped: boolean;
  eventId: string | null;
  // What actually landed, promotion already applied.
  points: number | null;
  // Set only when a promotion boosted this earn — what to tell the fan.
  promotion: { name: string; multiplier: number } | null;
}

// Report an engagement action. Fire-and-mostly-forget: see useEngagementEarn in
// earn-context.tsx, which is the only thing that should call this.
export const earnEngagement = (token: string, actionType: ClientEarnAction) =>
  authPost<EarnResult>('/points/engagement', token, { actionType });

// One live promotion, as the banner strip reads it. appliesTo null = every
// engagement earn, which the UI words differently ("on everything").
export interface EarnMenuPromotion {
  name: string;
  multiplier: number;
  endsAt: string;
  appliesTo: string[] | null;
}

// One row of the Ways-to-earn panel. `points` is what it pays RIGHT NOW;
// `basePoints` is the unpromoted value, which only differs when `promotion` is
// set — that pair is what lets the panel strike the old number through instead
// of showing a bigger one with no explanation. dailyCap 0 = uncapped, in which
// case remainingToday is null (render "unlimited", never "0 left").
export interface EarnMenuItem {
  actionType: string;
  label: string;
  description: string | null;
  points: number;
  basePoints: number;
  dailyCap: number;
  usedToday: number;
  remainingToday: number | null;
  promotion: { name: string; multiplier: number; endsAt: string } | null;
}

export interface EarnMenu {
  items: EarnMenuItem[];
  promotions: EarnMenuPromotion[];
}

// The whole panel in one call — enabled actions at today's price, the caller's
// usage against each cap, and the live promotion banners. Open to every
// authenticated role (everyone has a wallet).
export const getEarnMenu = (token: string) =>
  authGet<EarnMenu>('/points/earn-menu', token);

// ---- Admin: the actions table ----------------------------------------------

// A raw engagement_actions row. updatedAt/updatedBy are null until an admin has
// tuned it — "never touched since seed" is a real state the console shows.
export interface EngagementAction {
  id: string;
  actionType: string;
  label: string;
  description: string | null;
  points: number;
  dailyCap: number;
  enabled: boolean;
  sortOrder: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

// PATCH body. Every field optional, but an EMPTY patch is a 400 (it would stamp
// the audit trail for a non-event). `description: null` CLEARS it; omitting it
// leaves it alone — the one field where null and undefined differ.
export interface UpdateEngagementActionInput {
  points?: number;
  dailyCap?: number;
  enabled?: boolean;
  label?: string;
  description?: string | null;
  sortOrder?: number;
}

// The DB CHECK bounds, mirrored here so the console can refuse an out-of-range
// value before the round-trip. The backend's zod mirrors the same constraints —
// three copies of one truth, on purpose: the DB is the guarantee, zod turns a
// violation into a readable 400, and this turns it into an inline field error.
export const ACTION_POINTS_MAX = 500;
export const ACTION_DAILY_CAP_MAX = 20;

// Every row, DISABLED INCLUDED — a disabled action is what an admin came for.
// admin + regional_manager (RM is read-only; the PATCH below 403s for them).
export const getEngagementActions = (token: string) =>
  authGet<{ items: EngagementAction[] }>('/economy/actions', token);

// Tune one action. Admin only. There is deliberately no create/delete: the
// action SET ships with code (a hook must exist to fire it), so `enabled: false`
// is the delete equivalent — it stops paying, the row and its history survive.
export const updateEngagementAction = (
  token: string,
  id: string,
  input: UpdateEngagementActionInput,
) => authPatch<EngagementAction>(`/economy/actions/${id}`, token, input);

// ---- Admin: promotions ------------------------------------------------------

// Filters by WINDOW relative to now, not by `enabled`: a disabled promotion
// inside its window still lists as active (with enabled:false), because that's
// exactly what an admin asking "why isn't the 2x running?" needs to see.
export type PromotionScope = 'upcoming' | 'active' | 'past' | 'all';

// A raw point_promotions row. `multiplier` is the numeric STRING pg returns —
// formatMultiplier() to display, Number() only where arithmetic is unavoidable.
export interface PointPromotion {
  id: string;
  name: string;
  multiplier: string;
  startsAt: string;
  endsAt: string;
  // null = ALL engagement earns (the platform-wide case).
  appliesTo: string[] | null;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface CreatePromotionInput {
  name: string;
  // 1–5. Sent as a NUMBER (the API's zod takes a number and does the .toFixed(1)
  // itself before handing pg the decimal string).
  multiplier: number;
  startsAt: string;
  endsAt: string;
  appliesTo?: string[] | null;
  enabled?: boolean;
}

export interface UpdatePromotionInput {
  name?: string;
  multiplier?: number;
  startsAt?: string;
  endsAt?: string;
  // null WIDENS to all engagement earns; omitted leaves the targeting alone.
  appliesTo?: string[] | null;
  enabled?: boolean;
}

export const PROMOTION_MULTIPLIER_MIN = 1;
export const PROMOTION_MULTIPLIER_MAX = 5;

export const getPromotions = (token: string, scope: PromotionScope = 'all') =>
  authGet<{ items: PointPromotion[]; scope: PromotionScope }>(
    `/economy/promotions?scope=${scope}`,
    token,
  );

export const createPointPromotion = (token: string, input: CreatePromotionInput) =>
  authPost<PointPromotion>('/economy/promotions', token, input);

// Any field, including the enabled kill switch, on a RUNNING promotion — that's
// the point of having one (a 5x melting the economy gets turned down at 9pm).
export const updatePointPromotion = (
  token: string,
  id: string,
  input: UpdatePromotionInput,
) => authPatch<PointPromotion>(`/economy/promotions/${id}`, token, input);

// Hard delete ONLY while startsAt is still in the future. A promotion that has
// run is referenced by ledger notes and comes back 409 — the console shows
// Disable instead of Delete for those, so this should never see one.
export const deletePointPromotion = (token: string, id: string) =>
  authDeleteJson<{ deleted: boolean; id: string }>(
    `/economy/promotions/${id}`,
    token,
  );

// Where a promotion sits relative to now. Derived client-side for the row chips
// on the admin page (the list is fetched with scope=all so all three show at
// once); the server's own scope filter uses the same boundaries.
export function promotionWindowState(
  p: Pick<PointPromotion, 'startsAt' | 'endsAt'>,
  now: number = Date.now(),
): 'upcoming' | 'active' | 'past' {
  const starts = new Date(p.startsAt).getTime();
  const ends = new Date(p.endsAt).getTime();
  if (now < starts) return 'upcoming';
  if (now >= ends) return 'past';
  return 'active';
}
