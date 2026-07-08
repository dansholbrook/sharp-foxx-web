// Tiny typed client for the Sharp Foxx API. No axios, no react-query -- just
// fetch. Base URL comes from NEXT_PUBLIC_API_BASE (see .env.local) and already
// includes the /api/v1 prefix.

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000/api/v1';

// ---- Response shapes (mirrors reports.service.ts on the backend) ----

export interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: string;
  user: { id: string; roles: string[] };
}

export interface CommissionsReport {
  perRep: Array<{
    repId: string;
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

// Mirrors a content_items row (content.service.ts / schema.ts). Returned by
// POST /content/generate, which AI-drafts a recap and stores it as a DRAFT
// attached to the event -- it never auto-publishes, so status comes back
// 'draft'. body is an HTML string (rendered at the display boundary).
export interface ContentItem {
  id: string;
  kind: 'blog' | 'podcast' | 'video' | 'athlete_profile';
  status: 'draft' | 'published';
  authorUserId: string | null;
  title: string;
  slug: string | null;
  body: string | null;
  mediaUrl: string | null;
  institutionId: string | null;
  teamId: string | null;
  athleteId: string | null;
  eventId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
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

export async function login(userId: string): Promise<LoginResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}

async function authGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await toError(res);
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
  if (!res.ok) throw await toError(res);
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
  if (!res.ok) throw await toError(res);
  return res.json();
}

export const getCommissions = (token: string) =>
  authGet<CommissionsReport>('/reports/commissions', token);

export const getRevenue = (token: string) =>
  authGet<RevenueReport>('/reports/revenue', token);

export const getFieldReps = (token: string) =>
  authGet<FieldRep[]>('/field-reps', token);

export const getManagerReps = (token: string, id: string) =>
  authGet<ManagerRoster>(`/reports/managers/${id}/reps`, token);

export const getMyAssignments = (token: string) =>
  authGet<MyAssignment[]>('/assignments/mine', token);

export const updateAssignment = (
  token: string,
  id: string,
  input: UpdateAssignmentInput,
) => authPatch<AssignmentRow>(`/assignments/${id}`, token, input);

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

// Publishing/unpublishing are editorial actions (author-or-manager). Both take
// no body and return the updated row with its new status/publishedAt.
export const publishContent = (token: string, id: string) =>
  authPost<ContentItem>(`/content/${id}/publish`, token, {});

export const unpublishContent = (token: string, id: string) =>
  authPost<ContentItem>(`/content/${id}/unpublish`, token, {});
