# Quickstart — Validate Attesto SDK v0.1

Runnable checks that prove the feature works end to end. Implementation details live in `tasks.md`; this is
the validation/run guide. See [`contracts/attesto-gate.api.md`](./contracts/attesto-gate.api.md) and
[`data-model.md`](./data-model.md) for the shapes referenced below.

## Prerequisites

```bash
npm install          # workspaces: links @openmobilehub/attesto-gate
```

## 1. Build stays green (brownfield constraint)

```bash
npm run build        # build:packages → typecheck → vite (ui) → tsc (server)
```

**Expected**: exits 0. `build:packages` builds `@openmobilehub/attesto-gate` before the app. (Vercel runs
the same `npm run build`, so green here ⇒ deploy-safe.)

## 2. Package unit + contract tests

```bash
npx vitest run packages/attesto-gate --exclude '**/.worktrees/**'
```

**Expected**: green, covering the 7 contract tests in `contracts/attesto-gate.api.md` — notably
serialization round-trip (no functions on the wire), conditional drop, payment-last ordering, and the
prescription `appliesTo` example.

## 3. MCP-layer bypass test (the security gate)

```bash
npx vitest run checkout-gate.test.ts --exclude '**/.worktrees/**'
```

**Expected** (in-memory MCP transport, deterministic):
- **Age-restricted cart** (`oak-whiskey`) → `checkout` returns `structuredContent` whose `requires`
  includes `{ credential: "age", effect: "gate", minAge: 21, approveUrl: …<this order id> }` and **no
  completable checkout link**.
- **Non-alcohol cart** (`drift-mouse`) → `requires` has **no** `age` entry; a normal `checkoutUrl` is
  returned.
- The age entry's `approveUrl` decodes to the **same order id** in `structuredContent.order`.

This test MUST fail if the gate is removed (Constitution: a test that passes without the control is useless).

## 4. Full suite (no regressions)

```bash
npm test             # vitest, scoped to the main tree (vite.config.ts excludes .worktrees)
```

**Expected**: green. (One pre-existing `app.test.ts` `/mcp`-over-HTTP concurrency flake is known and
tracked separately; the Attesto tests use the in-memory transport and are deterministic.)

## 5. End-to-end against the live demo (manual, optional)

```bash
PORT=3001 node dist/main.js          # or: add https://mcp-apps-nine.vercel.app/mcp as a connector
```

In an MCP host: *"Add the Oak Reserve Whiskey and check out."* → the agent relays the `requires` manifest
("verify age 21+ … on your phone"), the checkout page shows the **age + (membership discount) + pay** cards
in one session (Context 2), and `get-order-status` reports completion (Context 3). A headphones-only cart
checks out with **no age card**.

## Done when

- [ ] `npm run build` green (deploy-safe)
- [ ] package contract tests green (serialization / conditional / ordering / extensibility)
- [ ] `checkout-gate.test.ts` green and fails-closed without the gate
- [ ] full `npm test` green (no regressions)
- [ ] demo: alcohol → age card appears; non-alcohol → no age card
