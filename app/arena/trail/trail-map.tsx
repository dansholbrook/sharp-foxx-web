'use client';

// ============================================================================
// THE ROUTE MAP — the Trail's centrepiece, and the screen the spec calls the
// marketing. This is the thing a fan screenshots in October: a gold road running
// down the page, the towns they've taken glowing along it, and the bus parked
// where they are.
//
// VERTICAL BY CONSTRUCTION, WHICH IS WHY IT IS NATIVELY MOBILE. A route is an
// ordered list and a phone is a tall scroll — so the map needs no layout tricks
// to work at 390px, and the desktop rule does nothing but stop the line getting
// silly-wide. Top is town 1. You scroll DOWN the road, which is the direction
// every fan already expects to travel.
//
// CSS-ONLY, NO ASSETS. The road is a gradient on a pseudo-element, a won stop is
// a box-shadow glow, and the bus is an emoji. No SVG path, no image to 404, and
// the whole thing scales with the type — which also means it survives a fan who
// zooms, and it costs nothing to load on the phone this is designed for.
//
// THE ORDINAL COMES FROM THE ARRAY, NOT FROM position_index. The schema only
// promises position_index >= 0, so an editor may legitimately have authored a
// route starting at 0 or at 1 — but the array is ORDER BY position_index, so
// index + 1 is "town N of M" with no assumption at all. This is the one surface
// on the site that may number a stop; everything else names it. (See the Trail
// card on /arena for the other half of that rule.)
//
// LEG HEADERS BREAK ON REGION CHANGE, not on the regions roll-up: a route that
// doubles back into Kansas gets a second KANSAS header, which is what the road
// actually does. The completion count in the header still comes from the
// roll-up, so it counts the WHOLE leg however many times the bus visits it.
// ============================================================================

import { TrailMapTown, TrailRegion } from '../../api';

// Where a stop sits relative to the fan: taken, standing in it, or ahead.
type StopState = 'won' | 'current' | 'ahead';

export function TrailMap({
  towns,
  regions,
  currentTownId,
  seasonTrophyHeld,
}: {
  towns: TrailMapTown[];
  regions: TrailRegion[];
  // Today's town, when a day is scheduled. The bus parks here.
  currentTownId: string | null;
  seasonTrophyHeld: boolean;
}) {
  if (towns.length === 0) {
    return (
      <section className="trail-map">
        <h2 className="trail-section__title">The route</h2>
        <div className="results-empty">
          <p className="results-empty__title">No route laid yet</p>
          <p className="results-empty__hint">
            The season&apos;s towns haven&apos;t been published. Check back when
            the bus has a schedule.
          </p>
        </div>
      </section>
    );
  }

  const byRegion = new Map(regions.map((r) => [r.region, r]));

  // THE BUS'S STOP. Today's town when there is one; otherwise the first town
  // the fan hasn't taken, which is where they are standing whether or not a
  // game is scheduled. A fan who holds every pennant gets no bus — the road is
  // finished, and parking it past the end would be nonsense.
  const fallback = towns.find((t) => !t.pennant);
  const busTownId =
    currentTownId ?? (fallback ? fallback.id : null);

  return (
    <section className="trail-map">
      <div className="trail-section__head">
        <h2 className="trail-section__title">The route</h2>
        <span className="trail-map__count">
          {towns.filter((t) => t.pennant).length} of {towns.length} taken
        </span>
      </div>

      <ol className="trail-road">
        {towns.map((town, i) => {
          const state: StopState = town.pennant
            ? 'won'
            : town.id === busTownId
              ? 'current'
              : 'ahead';
          // A leg header whenever the region changes from the stop above.
          const newLeg = i === 0 || towns[i - 1].region !== town.region;
          const leg = byRegion.get(town.region);

          return (
            <li key={town.id} className="trail-stopwrap">
              {newLeg && leg && (
                <div
                  className={`trail-leg${leg.complete ? ' trail-leg--done' : ''}`}
                >
                  <span className="trail-leg__name">{leg.region}</span>
                  <span className="trail-leg__count">
                    {leg.pennants} of {leg.towns}
                  </span>
                  {/* The trophy is the DURABLE record and the count is derived
                      — shown side by side deliberately, because a leg that
                      reads complete with no trophy is a grading bug that
                      should be visible rather than papered over. */}
                  {leg.trophyHeld && (
                    <span className="trail-leg__trophy" title="Leg trophy">
                      🏆
                    </span>
                  )}
                </div>
              )}

              <div className={`trail-stop trail-stop--${state}`}>
                <span className="trail-stop__marker" aria-hidden="true">
                  {state === 'current' ? '🚌' : state === 'won' ? '🏁' : ''}
                </span>
                <span className="trail-stop__body">
                  <span className="trail-stop__name">
                    {town.townName}
                    {state === 'current' && (
                      <span className="trail-stop__here">the bus is here</span>
                    )}
                  </span>
                  <span className="trail-stop__meta">
                    Town {i + 1} of {towns.length} · {town.region}
                    {/* "Coming Thursday" ahead of the bus — the road with a
                        date on it is a road worth waiting for. Suppressed on
                        stops already taken, where the date is history. */}
                    {state === 'ahead' && town.scheduledDate && (
                      <span className="trail-stop__when">
                        {' · '}
                        {shortDate(town.scheduledDate)}
                      </span>
                    )}
                  </span>
                </span>
                <span className="sr-only">
                  {state === 'won'
                    ? 'pennant claimed'
                    : state === 'current'
                      ? 'current stop'
                      : 'ahead'}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {/* THE END OF THE ROAD. Only once it's actually been driven — a finish
          line drawn under an unfinished route would be a promise the map keeps
          making and the fan keeps not reaching. */}
      {seasonTrophyHeld && (
        <div className="trail-road__end">
          <span aria-hidden="true">👑</span> The whole road. Season complete.
        </div>
      )}
    </section>
  );
}

// "Thu, Jul 30". Local noon, for the same reason every other date on this
// surface is — a bare YYYY-MM-DD through `new Date` is UTC midnight and renders
// as the day before for the entire ET audience.
function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
