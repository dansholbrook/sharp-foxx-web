'use client';

// Revenue-by-month bar chart. No chart library: each month is a flex column
// holding stacked <div>s whose height is an inline percentage of the tallest
// month, so the chart self-scales and needs no axis. Shared by the executive
// dashboard (12 months) and the territory dashboard (6 months, --mini) -- the
// same chart at two sizes.
//
// IT USED TO STACK A SECOND SERIES: NIL platform fees, the 15% taken off a
// deliverable release. That fee is gone -- it was a deduction from the school's
// money on its way to the athlete rather than a margin on a transaction, so
// Sharp Foxx no longer takes it (see approveDeliverable in the API). The series
// was removed rather than left to plot zero forever: a stacked bar with one
// series permanently at 0 reads as a business doing badly instead of one we are
// deliberately not in, and it invites someone to "fix" the flat line.

export interface RevMonth {
  // 'YYYY-MM'. The backend zero-fills the series, so every month in the window
  // is present and a gap in the bars means zero revenue, not missing data.
  month: string;
  adRevenue: string;
}

const usd = (v: number) =>
  v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

// 'YYYY-MM' -> 'Jan'. Parsed as UTC to match the key the backend generated;
// a local-time parse would roll a month back across the date line.
function monthLabel(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? month
    : d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

function monthTitle(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? month
    : d.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

export function RevChart({
  months,
  mini = false,
  ariaLabel,
}: {
  months: RevMonth[];
  mini?: boolean;
  ariaLabel?: string;
}) {
  if (months.length === 0) return null;

  // Scale every bar against the tallest month. Money arrives as decimal strings;
  // Number() here is the render boundary, which is the only place it's allowed.
  const totals = months.map((m) => Number(m.adRevenue));
  const max = Math.max(...totals);

  return (
    <div
      className={mini ? 'rev-chart rev-chart--mini' : 'rev-chart'}
      role="img"
      aria-label={
        ariaLabel ??
        `Revenue by month, ${monthTitle(months[0].month)} to ${monthTitle(
          months[months.length - 1].month,
        )}`
      }
    >
      {months.map((m, i) => {
        const ad = Number(m.adRevenue);
        // max === 0 (a brand-new territory, or a quiet window) would divide by
        // zero -- fall back to flat empty bars rather than NaN heights.
        const pct = (v: number) => (max > 0 ? (v / max) * 100 : 0);
        const empty = totals[i] === 0;

        const title = `${monthTitle(m.month)} — ${usd(ad)}`;

        return (
          <div className="rev-chart__col" key={m.month} title={title}>
            <div className="rev-chart__stack">
              {empty ? (
                <div className="rev-chart__bar rev-chart__bar--empty" />
              ) : (
                ad > 0 && (
                  <div
                    className="rev-chart__bar rev-chart__bar--ad"
                    style={{ height: `${pct(ad)}%` }}
                  />
                )
              )}
            </div>
            <span className="rev-chart__label">{monthLabel(m.month)}</span>
          </div>
        );
      })}
    </div>
  );
}

// THE LEGEND IS GONE WITH THE SECOND SERIES. One series needs no key, and a
// legend naming a stream that no longer exists is worse than none. Kept as a
// deliberate deletion rather than an empty component so the call sites had to
// be updated too, which is how you find out a caption is load-bearing.
