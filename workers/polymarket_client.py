import requests, asyncio, websockets, json

class PolymarketClient:
    GAMMA = "https://gamma-api.polymarket.com"
    CLOB = "https://clob.polymarket.com"
    WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market"

    def get_events(self, limit=100):
        r = requests.get(f"{self.GAMMA}/events", params={"active": True, "closed": False, "limit": limit})
        r.raise_for_status()
        return r.json()

    def get_book(self, token_id):
        r = requests.get(f"{self.CLOB}/book", params={"token_id": token_id})
        r.raise_for_status()
        return r.json()

    async def subscribe(self, token_ids, callback):
        async with websockets.connect(self.WS) as ws:
            await ws.send(json.dumps({"assets_ids": token_ids, "type": "market"}))
            while True:
                msg = await ws.recv()
                await callback(json.loads(msg))
