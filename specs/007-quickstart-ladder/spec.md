# Feature Specification: Quickstart Ladder (`examples/quickstart` + hosted demo cutover)

**Feature Branch**: `007-quickstart-ladder`

**Created**: 2026-07-12

**Status**: Draft

**Input**: Brainstorm 2026-07-12 (approved design, approach A) — transform the reference demo
([mcp-apps-shopping-demo](https://github.com/openmobilehub/mcp-apps-shopping-demo)) into a 5–10 minute
CredentAgent quickstart: one deployable example inside this repo, a three-rung adoption ladder, a hosted
demo deployment, and the demo repo archived (not deleted) after cutover.

## Overview

CredentAgent's packages are published (`@openmobilehub/credentagent-{gate,storefront}@0.2.x`) and the
README's ~10-line quickstart is real — but the "first five minutes" still route a developer through
cloning the monorepo, building workspaces, and reading a reference demo that predates the framework.
The reaction we want is *"oh, that's it? I can run this in 5–10 minutes"* — and today nothing delivers it.

This feature adds **`examples/quickstart/`** — a standalone, deployable example that consumes the
**published** packages exactly the way an adopter would (no workspace links, no monorepo build) — and
presents it as a **three-rung ladder** where each rung is independently satisfying:

1. **Try it (~1 min)** — paste the hosted MCP URL into Claude / ChatGPT / Goose and watch the gate fire.
2. **Run it (~5 min)** — clone, `npm i && npm start` inside `examples/quickstart`, connect locally.
3. **Own it (~3 min)** — a Deploy-to-Vercel button that stands up *your* gated storefront.

The hosted deployment becomes the demo of record; the alias in partners' hands
(`mcp-apps-nine.vercel.app`) is re-pointed to it, and the old demo repo is **archived with a banner** —
every external link (videos, the interoperability PDF, partner threads) keeps resolving. This completes
the story the README already tells: the packages were extracted *from* the demo; now the demo is a thin
consumer *of* the packages.

## User Scenarios & Testing *(mandatory)*

The "user" is a **developer evaluating CredentAgent** (and, for Story 4, an **existing partner** holding
old links).

### User Story 1 - Try it: zero-setup hosted demo (Priority: P1)

A developer pastes the hosted MCP URL into their agent host (Claude custom connector, ChatGPT, or
Goose), asks "what do you sell?", adds the whiskey, and checks out. The agent surfaces the age-21+
requirement (plus optional membership discount and payment) with a checkout link; completing the
ceremony confirms the order. Adding only the headphones produces **no** age requirement.

**Why this priority**: This is the "oh, that's it?" moment — the entire feature exists to produce it in
under a minute of setup.

**Independent Test**: Against the deployed URL: MCP initialize handshake succeeds; a whiskey checkout's
`requires` manifest contains an `age` entry; a headphones checkout's manifest has none.

**Acceptance Scenarios**:

1. **Given** the hosted URL added to an MCP host, **When** the user checks out a cart containing the
   whiskey, **Then** the checkout response carries a `requires` manifest with `age` (21+), optional
   `membership`, and `payment` — and a link where the ceremony completes end-to-end.
2. **Given** the same connection, **When** the user checks out only the headphones, **Then** the
   manifest contains no `age` entry and the order total reflects no unproven discount.

### User Story 2 - Run it: local in ≤ 3 commands (Priority: P1)

A developer clones the repo, runs `npm i && npm start` inside `examples/quickstart`, and gets
`http://localhost:3005/mcp` to add to Claude Code or Goose. The example installs the **published**
packages — proving the dependency surface is exactly what they'd ship with.

**Independent Test**: From a clean checkout with no prior `npm run build`: `cd examples/quickstart &&
npm i && npm start` boots; the smoke assertions of Story 1 pass against `localhost:3005`.

**Acceptance Scenarios**:

1. **Given** a fresh clone, **When** the developer runs install + start in the example directory only,
   **Then** the server boots without building the monorepo workspaces.
2. **Given** the running example, **When** the hero file is opened, **Then** the storefront + policy fit
   on one screen (≈30 lines) and match what the README promised.

### User Story 3 - Own it: one-click deployment (Priority: P1)

A developer clicks Deploy-to-Vercel, is prompted for `GATE_SECRET`, and receives their own public gated
storefront URL — sharable with their own agent host — without editing code.

**Independent Test**: A fresh Vercel deployment from the button's parameters passes the Story 1 smoke
assertions on its public URL, across cold starts (i.e., on instances that share no process memory).

**Acceptance Scenarios**:

1. **Given** a deployment with `GATE_SECRET` set, **When** a checkout ceremony spans multiple serverless
   instances, **Then** it completes — the signed cart mandate carries the order (`statelessOrders`), no
   server-side order memory required.
2. **Given** a deployed instance, **When** a request presents a tampered cart mandate (edited line
   price/quantity), **Then** completion is refused (fails closed).
3. **Given** a deployment attempt with no `GATE_SECRET`, **When** the server starts in deployed mode,
   **Then** it refuses to serve ceremonies with an actionable error (never silently falls back to an
   ephemeral per-instance key).

### User Story 4 - Existing partner links keep working (Priority: P2)

A partner opens `mcp-apps-nine.vercel.app/mcp` (from the interoperability report, videos, or email
threads) after cutover and reaches the live quickstart demo; the old GitHub repo remains readable with a
banner pointing here.

**Independent Test**: Post-cutover: the old alias serves the new deployment (Story 1 smoke passes on
it); the old repo is archived (read-only) with the banner as its final commit.

### Edge Cases

- **Serverless statelessness**: any completion path that assumes an in-memory order store breaks on
  Vercel — the deployed example must run `statelessOrders` on, and the smoke must exercise a completion
  against an instance with no prior state (the 004 pattern: an order store that was never written).
- **Local ≠ deployed key handling**: locally an ephemeral per-process key is fine (dev convenience);
  deployed it is a correctness bug (instances would mint mutually-unverifiable mandates). The mode split
  must be explicit, not accidental.
- **Optional Redis**: `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or Upstash equivalents) upgrade order/
  verification persistence for restart-survival; absence must not degrade the core demo.
- **Host variance**: ChatGPT and Goose require a plain public HTTP MCP endpoint (no auth); the hosted
  rung must not add an auth layer.
- **Stale docs**: `examples/README.md` instructs `npm run build:packages`, a script that no longer
  exists (`npm run build` is correct) — fix in passing (house norm: fix it or flag it).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repo MUST contain `examples/quickstart/` — a standalone example with its **own
  dependency manifest** pinning the **published** `@openmobilehub/credentagent-gate@^0.2` and
  `@openmobilehub/credentagent-storefront@^0.2` (no workspace links, no relative imports into
  `packages/`).
- **FR-002**: One hero server file MUST define the storefront + gate policy — `age.over(21)` gated on
  the cart containing an age-restricted line, `optional(membership.discount(10))`,
  `required(payment.in("usd"))` — and the same app MUST serve both locally (port 3005, `/mcp`) and on
  Vercel (thin API wrapper + rewrite config; no code fork between the two).
- **FR-003**: In deployed mode the example MUST enable `statelessOrders` and MUST require `GATE_SECRET`
  (fail fast with an actionable message when absent). In local mode it MAY fall back to an ephemeral
  per-process key.
- **FR-004**: Optional Redis persistence MUST activate solely via environment variables
  (`KV_REST_API_URL`/`KV_REST_API_TOKEN`, Upstash aliases accepted), reusing the storefront's published
  `redis` storage; without them the example runs in-memory.
- **FR-005**: Security invariants hold unchanged on every completion path: gates enforced server-side
  (an unverified `place-order` returns 403), amounts re-derived from the catalog (never trusted from
  order tokens), tampered cart mandates refused.
- **FR-006**: CI MUST run a quickstart smoke job that boots the example **against the published
  packages** and asserts: (a) MCP initialize handshake; (b) whiskey checkout → `requires` contains
  `age`; (c) headphones checkout → no `age` entry; (d) unverified `place-order` → 403; (e) tampered
  cart mandate → refused.
- **FR-007**: `examples/quickstart/README.md` MUST present the three-rung ladder with per-rung time
  budgets, host-specific connect instructions (Claude, Claude Code, ChatGPT, Goose), the
  whiskey-vs-headphones script, and a Deploy-to-Vercel button preconfigured with the repo URL, the
  example root directory, and a `GATE_SECRET` prompt.
- **FR-008**: The root `README.md` quickstart section MUST lead with the hosted URL (rung 1) and link to
  the ladder; `STATUS.md` MUST be updated per house rules; `examples/README.md`'s stale
  `build:packages` reference MUST be corrected to `build`.
- **FR-009 (rollout, operational)**: Cutover MUST follow this order — (1) create the `credentagent-demo`
  Vercel project rooted at the example with `GATE_SECRET` set; (2) pass the FR-006 smoke against the
  production URL; (3) re-point the `mcp-apps-nine.vercel.app` alias to it; (4) land a banner README in
  `mcp-apps-shopping-demo` ("this demo became CredentAgent → link") and **archive** (never delete) that
  repo. Steps 3–4 are maintainer-gated.

### Key Entities

- **Quickstart example** — the standalone consumer app: hero server file, API wrapper, deploy config,
  dependency manifest, ladder README.
- **Requires manifest** — the serializable statement of what a checkout demands (`age`, `membership`,
  `payment`); the agent-facing contract asserted by the smoke.
- **Cart mandate** — the signed order transport (spec 004) that makes serverless completion safe; its
  tamper-refusal is part of the acceptance surface.
- **Hosted demo** — the `credentagent-demo` deployment plus the legacy alias re-pointed to it.

## Success Criteria *(mandatory)*

- **SC-001**: A developer with an MCP host completes rung 1 — URL paste to a confirmed gated order — in
  under 3 minutes, with zero installs.
- **SC-002**: Rung 2 takes at most 3 commands after clone and ≤ 5 minutes on a clean machine with Node
  ≥ 20; no monorepo build is involved.
- **SC-003**: Rung 3 yields a working self-owned demo URL in ≤ 10 minutes without editing any file.
- **SC-004**: On every rung, the whiskey checkout demands an age-21+ proof and the headphones checkout
  demands none — observable in the agent conversation itself.
- **SC-005**: After cutover, every previously published URL (repo, hosted alias) still resolves to
  meaningful content; no partner-held link 404s.
- **SC-006**: The hero file reads in one screen (≈30 lines); a developer can restate what it does after
  one reading (the "oh, that's it?" test).

## Assumptions

- The hosted deployment is named `credentagent-demo` (URL `credentagent-demo.vercel.app`); the legacy
  alias re-point happens in the maintainer's Vercel account.
- Published `0.2.x` packages suffice — `statelessOrders` (004) and the `redis` storage subpath (005) are
  confirmed present in `0.2.0`; if a gap surfaces, a patch release precedes this feature's rollout
  rather than the example linking workspaces.
- The demo-repo archive is performed by a maintainer with admin rights, after cutover verification, and
  is reversible (GitHub un-archive) if needed.
- The checkout ceremony completing on the hosted rung uses the same rails `credentagent.mount()` wires
  today (passkey / demo paths); no new ceremony work is in scope.

## Out of Scope

- An `npx create-credentagent-demo` scaffolder (possible later polish on top of this example).
- The phone-wallet / cross-device (caBLE) tier — `examples/storefront-redis.mjs` + a tunnel already
  documents that path; the ladder may link to it as "going further."
- Catalog customization (spec 006's `firestoreCatalog` territory) beyond the seed catalog.
- Any authentication layer on the MCP endpoint.

## Dependencies

- Spec 004 (cart mandate / `statelessOrders`) — shipped, published in 0.2.0.
- Spec 005 storefront persistence (`redis` subpath) — shipped, published in 0.2.0.
- Maintainer actions at rollout: Vercel project creation + env, alias re-point, demo-repo banner merge +
  archive (FR-009 steps 3–4).
