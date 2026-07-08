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

export const createUser = (token: string, input: CreateUserInput) =>
  authPost<User>('/users', token, input);

export const createFieldRep = (token: string, input: CreateFieldRepInput) =>
  authPost<FieldRep>('/field-reps', token, input);
