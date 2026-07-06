# Tasks: Storefront Dynamic Catalog Source (`firestoreCatalog`)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Status: ✅ = done. All tasks complete on `feat/storefront-catalog-source`.

## Phase 1 — Contract (pure model)

- ✅ **T001** Add `CatalogSource` interface + `staticCatalog()` + `isCatalogSource()` to `src/index.ts`. (FR-001)
- ✅ **T002** `src/catalog.test.ts` — `staticCatalog` round-trip, `isCatalogSource` array-vs-source. (FR-001)

## Phase 2 — Provider

- ✅ **T003** `src/firestore.ts` — `firestoreCatalog(options)`: lazy `firebase-admin` loader (`_load` seam + `client`), TTL cache, last-known-good, fail-closed cold/empty, `defaultMapDoc` validation. (FR-002..006, FR-008/009)
- ✅ **T004** `src/firestore.test.ts` — load+map, TTL hit/expiry, fail-closed cold/empty, malformed/negative/non-finite rejection, last-known-good refresh, lazy missing-dep error. (FR-003..006, FR-008)

## Phase 3 — Wiring

- ✅ **T005** `src/server.ts` — normalize `catalog` into `source`; request-priming middleware (fail-closed 503); replace synchronous catalog reads with `source.current()`; `await source.load()` in the async tool handlers; `store.catalog` getter. (FR-001, FR-004, FR-007)
- ✅ **T006** `src/server.test.ts` — dynamic catalog through tools; age gate re-derived from live docs; gated-order bypass 403; fail-closed 503. (FR-004, FR-007)

## Phase 4 — Package + docs

- ✅ **T007** `package.json` — `./firestore` export; `firebase-admin` optional peer dep. (FR-002, FR-008)
- ✅ **T008** `examples/storefront-firestore.mjs`; README "Live catalog" section; `STATUS.md` entry.

## Verification

- ✅ `npm run build` (both packages) green.
- ✅ Storefront suite green (+16 tests); gate suite unchanged (160).
