# Implementation Plan: Storefront Dynamic Catalog Source (`firestoreCatalog`)

**Branch**: `feat/storefront-catalog-source` · **Spec**: [spec.md](./spec.md) · **Issue**: [#28](https://github.com/openmobilehub/credentagent/issues/28)

## Approach

Mirror spec 005 (`storage` / `redisStorage`): a first-class option + a provider, static stays the default, the heavy dep is an optional lazy peer. The one new problem vs 005 is that the catalog is read **synchronously** across `server.ts` (and by the gate's synchronous `CeremonyCatalog.createOrder`), while a dynamic source loads **asynchronously**. Solved storefront-only — **no gate change**.

## Architecture

- **`CatalogSource` contract** (`src/index.ts`, pure model): `load(): Promise<Product[]>` (TTL-cached, fail-closed) + `current(): Product[]` (last-known-good snapshot for the synchronous re-price; throws if never loaded). Helpers `staticCatalog(products)` and `isCatalogSource(x)`.
- **`firestoreCatalog(options)`** (`src/firestore.ts`, exported via `./firestore`): mirrors `redis.ts`. Lazy `firebase-admin` loader (`_load` seam + injectable `client`), TTL cache, last-known-good on refresh error, fail-closed cold/empty, `defaultMapDoc` validation (rejects missing name / non-finite / negative price / bad `minimumAge`).
- **Wiring** (`src/server.ts`): normalize `opts.catalog` into a `source`; a request-priming middleware `await source.load()` before every route (incl. the later-mounted `/credentagent/*` rails) — fail-closed 503; every synchronous catalog read becomes `source.current()`; each async MCP tool handler also `await source.load()` so a non-HTTP transport is warm. `store.catalog` becomes a getter over `source.current()`.
- **Package**: add `./firestore` export; `firebase-admin` optional peer dep (`peerDependenciesMeta`).

## Security invariants touched

- **Inv 2 (re-derive server-side, never trust the token)**: the completion re-price reads `source.current()`, kept warm + fail-closed by the priming middleware. An empty catalog makes reconciliation refuse (unknown ids → total mismatch), so the age gate cannot fail open.
- No change to invariants 1/3/4/5/6 (the gate is untouched).

## Testing

- `src/firestore.test.ts` — load+map, TTL cache/expiry, fail-closed cold/empty, malformed/negative/non-finite rejection, last-known-good refresh, lazy missing-dep error. Injected fake Firestore (no `firebase-admin`).
- `src/catalog.test.ts` — `staticCatalog`, `isCatalogSource`.
- `src/server.test.ts` — dynamic catalog through the tools; age gate re-derived from live docs; gated-order bypass refused (403); **fail-closed 503** on unreachable cold load.

## Out of scope

- Deleting the demo's `catalog-store.ts` / `firebase-admin.ts` / `catalog-source.ts` — tracked in `mcp-apps-shopping-demo` (scope A).
- Issuer-verified trust; other catalog backends (the `CatalogSource` contract leaves them open).
