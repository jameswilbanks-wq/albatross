// Exact port of kalshi-poly-arb fees.py
// Kalshi: ceil(0.07 * P*(1-P)*100)/100, max ~$0.02
// Polymarket: category-based taker fee

export type PolyCategory = 'sports' | 'politics' | 'crypto' | 'economics' | 'geopolitics' | 'general';

const POLY_FEES: Record<PolyCategory, number> = {
    sports: 0.0075,
    politics: 0.01,
    crypto: 0.018,
    economics: 0.015,
    geopolitics: 0,
    general: 0.01,
};

export function kalshiTakerFee(price: number): number {
    const raw = 0.07 * price * (1 - price);
    return Math.ceil(raw * 100) / 100;
}

export function polymarketTakerFee(price: number, category: PolyCategory = 'general'): number {
    const k = POLY_FEES[category] ?? POLY_FEES.general;
    return k * price * (1 - price);
}

export function totalFees(legA: {price: number, venue: string, category?: PolyCategory}, legB: {price: number, venue: string, category?: PolyCategory}) {
    const feeA = legA.venue === 'kalshi' ? kalshiTakerFee(legA.price) : polymarketTakerFee(legA.price, legA.category as any);
    const feeB = legB.venue === 'kalshi' ? kalshiTakerFee(legB.price) : polymarketTakerFee(legB.price, legB.category as any);
    return feeA + feeB;
}
