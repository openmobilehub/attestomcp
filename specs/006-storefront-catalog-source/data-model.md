# Data Model: Dynamic Catalog Source

Reuses the existing `Product` (from `src/index.ts`) — no new stored shapes. The catalog
source is a **read model** over an external collection; it stores only an in-memory cache.

## `Product` (unchanged)

```ts
interface Product {
  id: string;
  name: string;
  price: number;      // finite, ≥ 0
  currency: string;   // default "USD"
  image: string;
  category: string;
  description: string;
  minimumAge?: number; // non-negative integer; drives the age gate
}
```

## Firestore doc → Product mapping (`defaultMapDoc`)

- `id` = Firestore doc id.
- `name` — required string (else the load fails).
- `price` — required finite number ≥ 0 (else the load fails).
- `minimumAge` — optional non-negative integer (else the load fails).
- `currency` defaults `"USD"`; `image` / `category` / `description` default `""`.

## In-memory cache (per `firestoreCatalog` instance)

| field | meaning |
| :-- | :-- |
| `lastGood: Product[] \| undefined` | last successful load; `current()` returns it, throws if undefined |
| `loadedAt: number` | timestamp of the last (successful, or fallback) load, for the TTL |
| `inflight?: Promise<Product[]>` | de-dups concurrent refreshes |

State transitions: cold → (fetch ok) fresh → (TTL elapsed) refreshing → fresh; refreshing → (fetch fails, has `lastGood`) serve last-known-good + back off one TTL; cold + fetch fails/empty → **reject** (fail-closed).
