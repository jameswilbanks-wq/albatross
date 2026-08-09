import { kalshiTakerFee, polymarketTakerFee, PolyCategory } from './fees';

export interface Quote {
  venue: 'kalshi' | 'polymarket';
  pairId: string;
  yesAsk: number; // 0-1
  yesBid: number;
  yesAskSize: number;
  noAsk: number;
  noBid: number;
  timestamp: number;
  category?: PolyCategory;
}

export interface ArbOpportunity {
  pairId: string;
  title: string;
  edgeGross: number;
  edgeNet: number;
  legA: { venue: string, side: 'YES'|'NO', price: number, fee: number };
  legB: { venue: string, side: 'YES'|'NO', price: number, fee: number };
  totalCost: number;
  capitalNeeded: number;
  maxSize: number;
}

export function findArb(qA: Quote, qB: Quote): ArbOpportunity | null {
  // Strategy 1: Buy YES on A + NO on B
  // NO price = 1 - YES price (but use actual NO ask if available)
  const strategies = [
    { aSide: 'YES' as const, bSide: 'NO' as const, cost: qA.yesAsk + qB.noAsk, priceA: qA.yesAsk, priceB: qB.noAsk },
    { aSide: 'NO' as const, bSide: 'YES' as const, cost: qA.noAsk + qB.yesAsk, priceA: qA.noAsk, priceB: qB.yesAsk },
  ];

  let best: ArbOpportunity | null = null;
  for (const s of strategies) {
    if (!s.cost || s.cost >= 1) continue;
    const feeA = qA.venue === 'kalshi' ? kalshiTakerFee(s.priceA) : polymarketTakerFee(s.priceA, qA.category);
    const feeB = qB.venue === 'kalshi' ? kalshiTakerFee(s.priceB) : polymarketTakerFee(s.priceB, qB.category);
    const totalCost = s.cost;
    const netEdge = 1 - totalCost - feeA - feeB;
    if (netEdge > 0) {
      const opp: ArbOpportunity = {
        pairId: qA.pairId,
        title: qA.pairId,
        edgeGross: 1 - totalCost,
        edgeNet: netEdge,
        legA: { venue: qA.venue, side: s.aSide, price: s.priceA, fee: feeA },
        legB: { venue: qB.venue, side: s.bSide, price: s.priceB, fee: feeB },
        totalCost,
        capitalNeeded: totalCost,
        maxSize: Math.min(qA.yesAskSize, qB.yesAskSize) || 100,
      };
      if (!best || opp.edgeNet > best.edgeNet) best = opp;
    }
  }
  return best;
}
