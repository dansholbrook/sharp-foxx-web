'use client';

// Shared presentational pieces for the referral dashboards — the admin exec
// section (/dashboard) and the territory-scoped block (/managers/[id]). Both
// render the same three primitives, so they live here once rather than being
// duplicated per page:
//   - RefTotalsStrip   the all-time / month / week counters
//   - RefBarChart      the 30-day referred-vs-organic bars (organic optional:
//                      the territory series is referred-only)
//   - RefLeaderboard   the per-rep table (exec: + manager; territory: + status)
//
// The chart is the same no-library, height-percentage bars the revenue chart
// uses (see rev-chart.tsx), in the referral palette. Everything is scoped to
// .refreport-* on the existing design tokens.

// field_reps.kind -> the human label the rest of the app uses (Correspondent /
// Manager, matching the /apply track cards).
export function refKindLabel(kind: 'field_rep' | 'regional_manager'): string {
  return kind === 'regional_manager' ? 'Manager' : 'Correspondent';
}

// ---- Totals strip: all-time / this month / this week ----
export function RefTotalsStrip({
  totals,
}: {
  totals: { allTime: number; thisMonth: number; thisWeek: number };
}) {
  return (
    <div className="rep-stats refreport-totals">
      <div className="rep-stat">
        <span className="rep-stat__label">Referred all-time</span>
        <span className="rep-stat__value">{totals.allTime.toLocaleString()}</span>
        <span className="rep-stat__sub">fans brought in</span>
      </div>
      <div className="rep-stat">
        <span className="rep-stat__label">This month</span>
        <span className="rep-stat__value">{totals.thisMonth.toLocaleString()}</span>
      </div>
      <div className="rep-stat">
        <span className="rep-stat__label">This week</span>
        <span className="rep-stat__value">{totals.thisWeek.toLocaleString()}</span>
      </div>
    </div>
  );
}

// 'YYYY-MM-DD' -> 'Jul 3'. Parsed as UTC to match the backend's generated key;
// a local parse would drift a day in negative-offset zones.
function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export interface RefTimePoint {
  date: string;
  referred: number;
  // Absent on the territory chart (organic signups aren't attributable to a
  // manager) -> a referred-only chart with no legend swatch for organic.
  organic?: number;
}

// The 30-day signup chart: one column per day, referred stacked under organic.
// Heights are an inline % of the busiest day, so it self-scales with no y-axis.
// Per-day labels would be unreadable at 30 columns, so only the first/last day
// are captioned and each column carries a title tooltip with its exact counts.
export function RefBarChart({
  points,
  ariaLabel,
}: {
  points: RefTimePoint[];
  ariaLabel?: string;
}) {
  if (points.length === 0) return null;

  const hasOrganic = points.some((p) => p.organic !== undefined);
  const totals = points.map((p) => p.referred + (p.organic ?? 0));
  const max = Math.max(...totals);
  const pct = (v: number) => (max > 0 ? (v / max) * 100 : 0);

  return (
    <>
      <div
        className="refreport-chart"
        role="img"
        aria-label={
          ariaLabel ??
          `Daily signups from ${dayLabel(points[0].date)} to ${dayLabel(
            points[points.length - 1].date,
          )}`
        }
      >
        {points.map((p, i) => {
          const organic = p.organic ?? 0;
          const empty = totals[i] === 0;
          const title = hasOrganic
            ? `${dayLabel(p.date)} — Referred ${p.referred} · Organic ${organic}`
            : `${dayLabel(p.date)} — Referred ${p.referred}`;
          return (
            <div className="refreport-chart__col" key={p.date} title={title}>
              <div className="refreport-chart__stack">
                {empty ? (
                  <div className="refreport-chart__bar refreport-chart__bar--empty" />
                ) : (
                  <>
                    {organic > 0 && (
                      <div
                        className="refreport-chart__bar refreport-chart__bar--organic"
                        style={{ height: `${pct(organic)}%` }}
                      />
                    )}
                    {p.referred > 0 && (
                      <div
                        className="refreport-chart__bar refreport-chart__bar--referred"
                        style={{ height: `${pct(p.referred)}%` }}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="refreport-chart-axis">
        <span>{dayLabel(points[0].date)}</span>
        <span>{dayLabel(points[points.length - 1].date)}</span>
      </div>
      <div className="refreport-legend">
        <span className="refreport-legend__item">
          <span className="refreport-legend__swatch refreport-legend__swatch--referred" />
          Referred
        </span>
        {hasOrganic && (
          <span className="refreport-legend__item">
            <span className="refreport-legend__swatch refreport-legend__swatch--organic" />
            Organic
          </span>
        )}
      </div>
    </>
  );
}

// A per-rep row, normalized so the exec byRep and the territory perRep shapes
// both slot in: managerName is exec-only, status/isManager territory-only.
export interface RefRepRow {
  repId: string;
  name: string;
  kind: 'field_rep' | 'regional_manager';
  code: string | null;
  totalReferred: number;
  last30: number;
  last7: number;
  managerName?: string | null;
  status?: string;
  isManager?: boolean;
}

// The per-rep leaderboard. variant 'exec' shows the rep's manager; 'territory'
// shows the rep's status and flags the manager's own player-coach row. Rows
// arrive pre-sorted by the backend (last30 desc), so this only renders them.
export function RefLeaderboard({
  rows,
  variant,
}: {
  rows: RefRepRow[];
  variant: 'exec' | 'territory';
}) {
  if (rows.length === 0) {
    return (
      <div className="results-empty">
        <p className="results-empty__title">No referring reps yet</p>
        <p className="results-empty__hint">
          When a rep shares their /join link and a fan signs up through it,
          they&apos;ll climb this board.
        </p>
      </div>
    );
  }

  return (
    <div className="refreport-table-wrap">
      <table className="report-table refreport-table">
        <thead>
          <tr>
            <th>Rep</th>
            <th>Kind</th>
            <th>{variant === 'exec' ? 'Manager' : 'Status'}</th>
            <th>Code</th>
            <th className="num">30d</th>
            <th className="num">7d</th>
            <th className="num total">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.repId}>
              <td>
                {r.name}
                {r.isManager && <span className="terr-self-badge">Manager</span>}
              </td>
              <td>
                <span className="pill">{refKindLabel(r.kind)}</span>
              </td>
              <td>
                {variant === 'exec' ? (
                  r.managerName ?? <span className="muted">—</span>
                ) : (
                  <span className="pill">{r.status ?? '—'}</span>
                )}
              </td>
              <td>
                {r.code ? (
                  <span className="mono refreport-code">{r.code}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="num">{r.last30}</td>
              <td className="num">{r.last7}</td>
              <td className="num total">{r.totalReferred}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
