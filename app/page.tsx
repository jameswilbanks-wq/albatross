'use client';
import { useEffect, useRef, useState } from 'react';

type Leg = { venue: string; side: 'YES' | 'NO'; price: number; fee: number };

type Arb = {
  pairId: string;
  title: string;
  edgeNet: number;
  edgeGross: number;
  legA: Leg;
  legB: Leg;
  totalCost: number;
  capitalNeeded: number;
  maxSize: number;
};

type Level = { price: number; size: number };
type Orderbook = {
  pairId: string;
  title: string;
  generatedAt: number;
  kalshi: { yesAsks: Level[]; noAsks: Level[] };
  polymarket: { yesAsks: Level[]; noAsks: Level[] };
};

export default function Dashboard() {
  const [arbs, setArbs] = useState<Map<string, Arb>>(new Map());
  const [connected, setConnected] = useState(false);
  const [mock, setMock] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedPairId, setExpandedPairId] = useState<string | null>(null);
  const [orderbook, setOrderbook] = useState<Orderbook | null>(null);
  const [orderbookLoading, setOrderbookLoading] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/opportunities/stream');
    esRef.current = es;

    es.addEventListener('connected', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setMock(Boolean(data.mock));
      setConnected(true);
      setError(null);
    });

    es.addEventListener('arb_new', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as Arb & { pairId: string };
      setArbs((prev) => {
        const next = new Map(prev);
        next.set(data.pairId, data);
        return next;
      });
    });

    es.addEventListener('arb_closed', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { pairId: string };
      setArbs((prev) => {
        if (!prev.has(data.pairId)) return prev;
        const next = new Map(prev);
        next.delete(data.pairId);
        return next;
      });
    });

    es.onerror = () => {
      setConnected(false);
      setError('Lost connection to /api/opportunities/stream — retrying…');
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  async function toggleLadder(pairId: string) {
    if (expandedPairId === pairId) {
      setExpandedPairId(null);
      setOrderbook(null);
      return;
    }
    setExpandedPairId(pairId);
    setOrderbook(null);
    setOrderbookLoading(true);
    try {
      const res = await fetch(`/api/orderbook?pairId=${encodeURIComponent(pairId)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`orderbook fetch failed: ${res.status}`);
      const data: Orderbook = await res.json();
      setOrderbook(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orderbook');
    } finally {
      setOrderbookLoading(false);
    }
  }

  const sorted = Array.from(arbs.values()).sort((a, b) => b.edgeNet - a.edgeNet);

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <h1 className="text-3xl font-bold mb-2">Albatross — Kalshi × Polymarket</h1>
      <p className="text-zinc-400 mb-6">
        Real-time fee-aware arbitrage.{' '}
        <span className={connected ? 'text-green-400' : 'text-yellow-500'}>
          {connected ? '● live' : '○ connecting'}
        </span>{' '}
        · {sorted.length} open
        {mock ? ' · mock quotes (MOCK_MODE=true)' : mock === false ? ' · live venue feed' : ''}
      </p>

      {error && (
        <div className="mb-6 rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-3">
        {sorted.map((a) => (
          <div key={a.pairId} className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <button
              onClick={() => toggleLadder(a.pairId)}
              className="w-full p-4 flex justify-between items-center text-left hover:bg-zinc-900 transition-colors"
            >
              <div>
                <div className="font-semibold">{a.title}</div>
                <div className="text-sm text-zinc-400">
                  {a.legA.venue} {a.legA.side} ${a.legA.price.toFixed(3)} + {a.legB.venue} {a.legB.side} $
                  {a.legB.price.toFixed(3)}
                </div>
              </div>
              <div className="text-right">
                <div className="inline-block rounded-full bg-green-500/10 px-3 py-1 text-2xl font-mono text-green-400">
                  +{(a.edgeNet * 100).toFixed(2)}%
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  gross {(a.edgeGross * 100).toFixed(2)}% | size ${a.maxSize} | click for ladder
                </div>
              </div>
            </button>

            {expandedPairId === a.pairId && (
              <div className="border-t border-zinc-800 bg-black/40 p-4">
                {orderbookLoading && <div className="text-sm text-zinc-500">Loading orderbook…</div>}
                {orderbook && orderbook.pairId === a.pairId && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Ladder venueLabel="Kalshi" yesAsks={orderbook.kalshi.yesAsks} noAsks={orderbook.kalshi.noAsks} />
                    <Ladder
                      venueLabel="Polymarket"
                      yesAsks={orderbook.polymarket.yesAsks}
                      noAsks={orderbook.polymarket.noAsks}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {sorted.length === 0 && !error && (
          <div className="text-zinc-600 py-20 text-center">
            {connected ? 'Watching the books… no arb right now.' : 'Connecting to live stream…'}
          </div>
        )}
      </div>
    </div>
  );
}

function Ladder({ venueLabel, yesAsks, noAsks }: { venueLabel: string; yesAsks: Level[]; noAsks: Level[] }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">{venueLabel} orderbook</div>
      <div className="grid grid-cols-2 gap-3">
        <LadderColumn label="YES asks" levels={yesAsks} />
        <LadderColumn label="NO asks" levels={noAsks} />
      </div>
    </div>
  );
}

function LadderColumn({ label, levels }: { label: string; levels: Level[] }) {
  const maxSize = Math.max(...levels.map((l) => l.size), 1);
  return (
    <div>
      <div className="text-[11px] text-zinc-500 mb-1">{label}</div>
      <div className="space-y-0.5 font-mono text-xs">
        {levels.map((l, i) => (
          <div key={i} className="relative flex justify-between px-1.5 py-0.5 rounded overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-red-500/10"
              style={{ width: `${(l.size / maxSize) * 100}%` }}
            />
            <span className="relative z-10 text-zinc-300">${l.price.toFixed(3)}</span>
            <span className="relative z-10 text-zinc-500">{l.size}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
