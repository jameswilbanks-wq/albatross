import asyncio, websockets, json, requests

class KalshiClient:
    REST = "https://api.elections.kalshi.com/trade-api/v2"
    WS = "wss://api.elections.kalshi.com/trade-api/ws/v2"

    def get_markets(self, limit=1000):
        r = requests.get(f"{self.REST}/markets", params={"limit": limit, "status": "open"})
        r.raise_for_status()
        return r.json().get("markets", [])

    def get_orderbook(self, ticker):
        r = requests.get(f"{self.REST}/markets/{ticker}/orderbook")
        r.raise_for_status()
        return r.json()

    async def subscribe(self, tickers, callback):
        async with websockets.connect(self.WS) as ws:
            await ws.send(json.dumps({"id": 1, "cmd": "subscribe", "params": {"channels": ["orderbook_delta"], "market_tickers": tickers}}))
            while True:
                msg = await ws.recv()
                data = json.loads(msg)
                await callback(data)
