// Depth-aware sizing - walks orderbook

export type Level = { price: number; size: number };

export function calcMaxCapital(asksA: Level[], asksB: Level[], minEdge: number, feeFn: (p:number)=>number) {
  let i=0,j=0;
  let capital=0;
  let size=0;
  let totalEdge=0;
  let levels = 0;

  let bookA = [...asksA].sort((a,b)=>a.price-b.price);
  let bookB = [...asksB].sort((a,b)=>a.price-b.price);

  while (i < bookA.length && j < bookB.length) {
    const a = bookA[i];
    const b = bookB[j];
    const marginalCost = a.price + b.price;
    const fees = feeFn(a.price) + feeFn(b.price);
    const edge = 1 - marginalCost - fees;
    if (edge < minEdge) break;

    const fill = Math.min(a.size, b.size);
    capital += fill * marginalCost;
    size += fill;
    totalEdge += edge * fill;
    levels++;

    // decrement
    a.size -= fill;
    b.size -= fill;
    if (a.size <= 0) i++;
    if (b.size <= 0) j++;
  }

  return { capital, size, avgEdge: levels ? totalEdge/size : 0, levels };
}
