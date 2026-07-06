# Research: Dynamic Catalog Source

## Why a `load()` + `current()` split (not just async)

The storefront reads the catalog **synchronously** across `server.ts`, and the gate's
`CeremonyCatalog.createOrder` — called on the completion path in `attestomcp-gate`'s
`completion.ts` / `mount.ts` — is a **synchronous** interface returning `CeremonyOrder`.
A dynamic catalog loads asynchronously. Two options were weighed:

- **A. Make `CeremonyCatalog.createOrder` async** (`MaybePromise`) and `await` it in the gate.
  Explicit, but modifies the gate (the security surface) and its tests.
- **B. Storefront-only: `load()` + `current()` + a request-priming middleware.** The source
  exposes an async `load()` (TTL-cached, fail-closed) and a synchronous `current()`
  (last-known-good). The storefront `await`s `load()` before every route — including the
  later-mounted `/attestomcp/*` rails — so the synchronous re-price always reads a warm,
  server-side re-derived snapshot. **No gate change.**

**Chosen: B.** Smallest blast radius on the security surface; keeps the change inside the
storefront; still fail-closed (empty catalog → reconciliation refuses → the age gate can't
fail open). Defense-in-depth: `current()` throws when never loaded, so a mis-wired path
fails loud rather than under-enforcing.

## Mirroring spec 005 (`redisStorage`)

`firestoreCatalog` copies the established provider shape: optional peer dep loaded lazily
via an `_load` seam, an injectable `client` for tests (no live backend), fail-closed on
backend error. Consistency over novelty (CLAUDE.md: "a new rail mirrors the existing
layout").

## `firebase-admin` typecheck without installing it

The default loader holds the module specifiers in `: string` variables so `tsc` does not
statically resolve `firebase-admin/*` (an optional peer, not a devDependency). Local module
shapes type the loader; tests inject a fake `client`, so the suite never loads the dep.

## Malformed doc handling

A bad doc **fails the load** rather than being dropped: silently dropping a product could
drop an age-gated item, and a merchant should see the error. On a **refresh** (with a prior
good load) the last-known-good catalog is retained, so one bad edit does not take the store
down.
