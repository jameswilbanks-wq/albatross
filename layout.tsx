import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Albatross — Kalshi × Polymarket Arbitrage',
  description: 'Real-time fee-aware arbitrage detection across Kalshi and Polymarket.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
