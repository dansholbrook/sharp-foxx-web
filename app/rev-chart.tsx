'use client';

// Revenue-by-month bar chart. No chart library: each month is a flex column
// holding stacked <div>s whose height is an inline percentage of the tallest
// month, so the chart self-scales and needs no axis. Shared by the executive
// dashboard (12 months, ads + NIL fees) and the territory dashboard (6 months,
// ads only, --mini) -- it's the same chart at two sizes.

export interface RevMonth {
  // 'YYYY-MM'. The backend zero-fills the series, so every month in the window
  // is present and a gap in the bars means zero revenue, not missing data.
  month: string;
  adRevenue: string;
  // Absent on the territory chart, which has no NIL stream.
  nilFees?: string;
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
  const totals = months.map(
    (m) => Number(m.adRevenue) + Number(m.nilFees ?? 0),
  );
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
        const nil = Number(m.nilFees ?? 0);
        // max === 0 (a brand-new territory, or a quiet window) would divide by
        // zero -- fall back to flat empty bars rather than NaN heights.
        const pct = (v: number) => (max > 0 ? (v / max) * 100 : 0);
        const empty = totals[i] === 0;

        const title = m.nilFees === undefined
          ? `${monthTitle(m.month)} — ${usd(ad)}`
          : `${monthTitle(m.month)} — Ad sales ${usd(ad)} · NIL fees ${usd(nil)}`;

        return (
          <div className="rev-chart__col" key={m.month} title={title}>
            <div className="rev-chart__stack">
              {empty ? (
                <div className="rev-chart__bar rev-chart__bar--empty" />
              ) : (
                <>
                  {nil > 0 && (
                    <div
                      className="rev-chart__bar rev-chart__bar--nil"
                      style={{ height: `${pct(nil)}%` }}
                    />
                  )}
                  {ad > 0 && (
                    <div
                      className="rev-chart__bar rev-chart__bar--ad"
                      style={{ height: `${pct(ad)}%` }}
                    />
                  )}
                </>
              )}
            </div>
            <span className="rev-chart__label">{monthLabel(m.month)}</span>
          </div>
        );
      })}
    </div>
  );
}

// Caption for the two stacked series. Only the exec chart is stacked, so the
// territory chart skips this.
export function RevChartLegend() {
  return (
    <div className="rev-chart-legend">
      <span className="rev-chart-legend__item">
        <span className="rev-chart-legend__swatch rev-chart-legend__swatch--ad" />
        Ad sales
      </span>
      <span className="rev-chart-legend__item">
        <span className="rev-chart-legend__swatch rev-chart-legend__swatch--nil" />
        NIL platform fees
      </span>
    </div>
  );
}
