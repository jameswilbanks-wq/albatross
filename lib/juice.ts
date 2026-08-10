// "Juice" tab logic — modeled on the Juice betting-research app's whole
// premise: surface high-conviction, high-probability picks that still carry
// positive edge, rather than every technically-profitable arb (including
// near-coinflip ones nobody would call a "safe" bet).
//
// A leg's price IS the market's implied probability of that specific side
// occurring (that's what a prediction-market price means) — buying NO at
// $0.04 is a 4%-confidence long-shot; buying YES at $0.89 is an
// 89%-confidence high-conviction pick. So "high probability" for an arb
// just means: does either leg sit at or above the threshold, regardless of
// which side (YES/NO) it is.

export const HIGH_PROBABILITY_THRESHOLD = 0.85;

interface LegPrices {
  legA: { price: number };
  legB: { price: number };
}

/** The higher of the two leg prices — the confidence level of whichever side of this arb is the "safe" pick. */
export function impliedProbability(opp: LegPrices): number {
  return Math.max(opp.legA.price, opp.legB.price);
}

export function isHighProbabilityBet(opp: LegPrices, threshold: number = HIGH_PROBABILITY_THRESHOLD): boolean {
  return impliedProbability(opp) >= threshold;
}

/** YYYY-MM-DD (UTC) for comparing against an event's date — "today only" per the request. */
export function todayISODate(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function isEventToday(eventDateISO: string | undefined | null, now: number = Date.now()): boolean {
  if (!eventDateISO) return false;
  return eventDateISO === todayISODate(now);
}

/** Combines both filters — what the "Juice" tab actually shows. */
export function isJuicePick(
  opp: LegPrices & { eventDate?: string | null },
  threshold: number = HIGH_PROBABILITY_THRESHOLD,
  now: number = Date.now()
): boolean {
  return isEventToday(opp.eventDate, now) && isHighProbabilityBet(opp, threshold);
}
