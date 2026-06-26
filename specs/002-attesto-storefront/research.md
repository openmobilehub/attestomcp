# Phase 0 — Research & Decisions: Attesto Storefront (002)

The spec settles the scope. These are the extraction decisions the implementation rests on. No open
`NEEDS CLARIFICATION`. The guiding constraint everywhere: **brownfield — the demo consumes the package and
stays green** (build + 242 tests + the live deploy) at every step.

## 1. The widget build moves into the package

**Decision**: Move the React widget (`src/app.tsx` + `mcp-app.html`, ~574 LOC) into
`packages/attesto-storefront/src/ui/`, with its `vite` + `@vitejs/plugin-react` + `vite-plugin-singlefile`
config in the package. The package's `build` runs **vite (ui bundle) then tsc** (server/index); the
single-file `mcp-app.html` is emitted to the package's `dist/ui/` and shipped via `files`. The root build's
`build:packages` step thus produces the bundle before the app build.

**Rationale**: The widget IS the storefront's UI — it belongs with the storefront, and that's what lets
`createStorefront()` register it as the `ui://` resource. Single-file output keeps it self-contained and
host-portable (no asset URLs). Workspace order (`build:packages` → app) already exists, so Vercel's
`npm run build` stays the same command.

**Alternatives rejected**: keep the widget in the demo and have the package reference a built artifact
(splits the storefront across two trees, breaks "one line"); a separate `@openmobilehub/attesto-widget`
package (over-fragmentation for v0.1).

## 2. Demo consumes the package (the brownfield refactor)

**Decision**: The demo's `server.ts` storefront logic (the 9 tool registrations + the UI resource) moves
into the package's `createStorefront()`. The demo's `server.ts`/`app.ts` become thin: build the storefront
(`createStorefront({ catalog })`), `attesto.mount(store.app)`, inject the gate policy (`store.gate(...)`),
register the ceremony (`payment-gate/*` on `store.app`), and serve. No storefront code is duplicated.

**Rationale**: Same pattern that made the gate extraction safe — the demo is the integration harness; moving
logic into the package while the demo consumes it keeps the live deploy green and proves the package in situ.

**Alternatives rejected**: fork the storefront (two copies drift); delete the demo (loses the integration
harness + the live deploy + the caBLE reference).

## 3. The nine tools keep their UI-linked (`registerAppTool`) shape

**Decision**: Move the nine tools (`browse-products`, `add-to-cart`, `set-quantity`, `remove-from-cart`,
`get-cart`, `get-product-details`, `get-product-reviews`, `checkout`, `get-order-status`) into the package,
preserving their `@modelcontextprotocol/ext-apps` `registerAppTool` + `UI_META` wiring so a widget-capable
host renders the native UI. The `checkout` tool keeps the consolidated-Mode-A shape from 001 and calls the
injected `gate` resolver.

**Rationale**: Principle II (the tools are Context 1) + the widget needs the `ui://` resource link — keeping
`registerAppTool` is what makes the rich UI show. The checkout tool's gate hook is the seam where Attesto
mounts on.

**Alternatives rejected**: plain `registerTool` (loses the widget — that's exactly the v0.1 minimal
storefront's gap); reimplement the tools (they already work).

## 4. Catalog + reviews are injected; the demo passes its own

**Decision**: `createStorefront({ catalog })` takes the products; `SAMPLE_CATALOG` is the default. The
catalog model carries products **and** their reviews (so `get-product-reviews` is catalog-backed, not a
separate store). The demo injects its specific catalog (its products/images/reviews) — so the demo looks
identical, and an adopter swaps in their own with no package change.

**Rationale**: "Catalog-injected, own-the-code" (the storefront's promise) + no behavior change for the demo.

**Alternatives rejected**: bake the demo's catalog into the package (not reusable); a separate reviews store
(needless surface for v0.1).

## 5. State split: cart/order → package; verification → the gate's (via mount)

**Decision**: `cartStore` + `orderStore` move into the package (the storefront owns cart/order state, keyed
per session/order, in-memory default). **Verification state stays the gate's** — the checkout page reads it
through the mounted Attesto store (`app.locals.attesto.store`, set by `attesto.mount()`), not a storefront
store.

**Rationale**: Clean boundary — cart/order is shopping (storefront); "did this order prove age" is gating
(gate). Security invariant 4: state keyed per order/session, never process-global, on both sides.

**Alternatives rejected**: the storefront owns verification state (couples it to the gate, duplicates the
gate's store); a shared global store (cross-user bleed risk).

## 6. The checkout page is the storefront's; the ceremony routes are not

**Decision**: The checkout page shell (`checkout.ts` → `checkout-page.ts`) moves into the package and renders
the order + the required credentials, **linking** to ceremony routes (`/credential-gate/age`, passkey,
dc-payment). Those routes are served by whatever is mounted on `store.app` — today the demo's
`payment-gate/*`; in feature 003, `attesto.mount()`. The package does NOT implement the ceremony.

**Rationale**: Principle VII honesty — the page is real (it's the demo's page), the ceremony is honestly a
separate concern (003). Keeps `payment-gate/` (27 files, the real caBLE crypto) untouched and out of the
storefront.

**Alternatives rejected**: pull `payment-gate/` into the storefront (bloats it, wrong owner, blocks 003);
ship the stub page from the v0.1 minimal storefront (regresses the real page).

## 7. Build, exports, and publish-readiness (FR-013)

**Decision**: `package.json` `exports` = `.` (pricing model) + `./server` (`createStorefront`); `files`
ships `dist` (incl. the `ui/` bundle); `types` + `publishConfig: { access: public }` set. `build` =
`vite build` (ui) `&& tsc`. The quickstart leads with `npm install @openmobilehub/attesto-{gate,storefront}`
(adopter, from npm); clone + workspace install is the demo/contributor path. The actual `npm publish` +
`@openmobilehub` scope reservation is a **release action**, out of code scope.

**Rationale**: An adopter installs from npm into their own project (not a clone) — the real DX. The package
must be self-contained (ship the bundle) for that to work.

**Alternatives rejected**: hand-commit the widget bundle (drifts from source); require a clone to adopt
(defeats "install from npm").
