# Feature Specification: Storefront Dynamic Catalog Source (`firestoreCatalog`)

**Feature Branch**: `feat/storefront-catalog-source`

**Created**: 2026-07-06

**Status**: Draft

**Input**: GitHub issue [#28](https://github.com/openmobilehub/attestomcp/issues/28) (part of epic #29) — "createStorefront: first-class dynamic/Firestore catalog source so consumers don't hand-write the loader". Labels: `enhancement`, `dx`. Companion to [#27](https://github.com/openmobilehub/attestomcp/issues/27) (persistence, spec 005).

## Overview

`createStorefront({ catalog })` (from `@openmobilehub/attestomcp-storefront`) takes a **static in-memory `Product[]`**. That is correct for local dev and the quickstart, but a real merchant wants to edit products **without a redeploy** — a **dynamic catalog source** (Firestore/Firebase). Today the consumer hand-writes the loader: the reference demo hand-rolls three modules the library could own — a Firestore loader (TTL cache, fail-closed cold load, malformed/negative-price rejection), a lazy Firebase Admin init, and a `static|firestore` source selector.

This feature makes a **dynamic catalog source a first-class, one-option** concern: `catalog` accepts either a `Product[]` (unchanged, zero-config) **or** a `CatalogSource`, and the package ships `firestoreCatalog(...)` — the loader + cache + fail-closed loading — so no adopter hand-writes it again. It mirrors spec 005 (`storage` / `redisStorage`): the static array stays the default, `firebase-admin` is an optional peer dependency, and prices/age thresholds still re-derive server-side (Security invariant 2).

The design difference from 005: the storefront's stores were already async, but the **catalog is read synchronously** across `server.ts` — including the gate's synchronous `CeremonyCatalog.createOrder` on the completion path. So a `CatalogSource` exposes both an async `load()` (TTL-cached, fail-closed) and a synchronous last-known-good `current()`; the storefront awaits `load()` before every request so the synchronous re-price is always warm — **with no change to the gate package**.

## User Scenarios & Testing *(mandatory)*

The "user" of this feature is a **developer** consuming `@openmobilehub/attestomcp-storefront`.

### User Story 1 - One-option live catalog (Priority: P1)

A developer running the storefront for a real merchant wants products editable in Firestore (price, availability, new items) to appear **without a redeploy**, by passing **one option**, writing no loader code.

**Why this priority**: This is the entire point of the issue — it removes the hand-rolled Firestore loader/cache/selector that make "using AttestoMCP" look far heavier than the 28-line quickstart.

**Independent Test**: Construct `createStorefront({ catalog: firestoreCatalog({ client }) })` over a fake Firestore, drive the MCP tools + checkout, and confirm products, prices, and age thresholds come from the loaded docs.

**Acceptance Scenarios**:

1. **Given** a Firestore collection of product docs, **When** the storefront serves `browse-products` / `checkout`, **Then** the catalog, prices, and per-product `minimumAge` are those loaded from Firestore.
2. **Given** an edited product doc, **When** the TTL elapses, **Then** the next load reflects the edit — no redeploy.

### User Story 2 - Zero-config static default unchanged (Priority: P1)

A developer using the quickstart passes a plain `Product[]` (or nothing) and needs **no Firebase** and **no behavior change**.

**Independent Test**: `createStorefront()` and `createStorefront({ catalog: SEED })` behave exactly as before; `firebase-admin` is not required to build or run the static path.

### User Story 3 - Fail closed (Priority: P1)

An operator must never have an empty or unreachable catalog silently serve an empty store or drop an age gate.

**Acceptance Scenarios**:

1. **Given** an empty or unreachable **cold** load, **When** a request arrives, **Then** the server **refuses** (503) rather than serving an empty catalog.
2. **Given** a prior good load and a failed **refresh**, **When** a request arrives, **Then** the last-known-good catalog is served (for one TTL) instead of failing.
3. **Given** a malformed or negative-price doc, **When** the catalog loads, **Then** the load **fails** (the product is not silently dropped).

### Edge Cases

- The gate's ceremony re-price (`CeremonyCatalog.createOrder`) is synchronous — a dynamic (async) catalog must feed it without changing the gate. Resolved by the `load()` + `current()` split plus a request-priming middleware.
- A non-HTTP transport (`store.mcpServer()` over stdio) bypasses the priming middleware — the async tool handlers `await source.load()` themselves so `current()` is warm regardless of transport.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `catalog` accepts `Product[] | CatalogSource`; a `Product[]` (or omitted) is wrapped in a static source — the zero-config default is unchanged.
- **FR-002**: The package exports `firestoreCatalog(options)` (via subpath `./firestore`) returning a `CatalogSource` that loads products from a Firestore collection via the Firebase Admin SDK.
- **FR-003**: `firestoreCatalog` caches loads for a configurable TTL (default 5 min) and serves the cache while fresh.
- **FR-004**: A cold load that is **empty or unreachable** rejects; the storefront returns 503 (fail-closed) rather than serving an empty catalog.
- **FR-005**: A failed **refresh** (with a prior good load) serves the last-known-good catalog for one TTL.
- **FR-006**: Malformed / negative / non-finite-price docs cause the load to fail (no silent drop). Currency defaults to USD; a custom `mapDoc` can override validation/mapping.
- **FR-007**: Prices and age thresholds re-derive server-side from the loaded catalog on every completion path (Security invariant 2) — including the gate's synchronous ceremony re-price — with **no change to the gate package**.
- **FR-008**: `firebase-admin` is an **optional peer dependency**, loaded lazily only on the credentials path; the static path and the injected-`client` path need no dependency.
- **FR-009**: An injected `client` (Firestore-like) bypasses `firebase-admin` entirely (tests, custom setups, pre-built Admin Firestore).

### Key Entities

- **`CatalogSource`** — `{ load(): Promise<Product[]>; current(): Product[] }`. `load()` refreshes (TTL-cached, fail-closed); `current()` returns the last-known-good snapshot for synchronous re-price (throws if never loaded).
- **`FirestoreCatalogOptions`** — `{ client?, collection?, ttlMs?, credential?, projectId?, mapDoc?, _load? }`.

## Success Criteria *(mandatory)*

- **SC-001**: A live catalog works with one option; the demo's three catalog modules collapse into it (tracked in the demo repo).
- **SC-002**: The static quickstart is byte-for-byte unchanged and needs no Firebase.
- **SC-003**: Every fail-closed control (cold/empty refusal, malformed/negative rejection, last-known-good) has a test that fails when the control is removed.
