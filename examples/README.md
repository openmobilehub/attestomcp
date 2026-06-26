# Attesto examples

## `storefront.mjs` — a credential-gated storefront in ~8 lines

A minimal, runnable agentic storefront you add to **Goose** (or any MCP host) as an HTTP connector and
watch the gate fire. The storefront is a one-line black box — `createStorefront()` ships the catalog +
`browse-products` / `checkout` / `get-order-status` tools over HTTP — and **Attesto mounts onto it**:

```ts
import { createStorefront } from "@openmobilehub/attesto-storefront/server";
import { Attesto, age, membership, payment, required, optional } from "@openmobilehub/attesto-gate";

const store = createStorefront();                 // the whole storefront — nothing to configure
const attesto = new Attesto();
attesto.mount(store.app);                          // Attesto mounts onto it
store.gate((order) => attesto.requirements(order, [
  required(age.over(21).when((o) => o.lines.some((l) => l.minimumAge != null))),
  optional(membership.discount(10)),
  required(payment.in("usd")),
]));
const { url } = await store.listen(3005);          // → http://localhost:3005/mcp
```

### Run it

```bash
npm install
npm run build:packages          # build the two @openmobilehub/attesto-* packages
node examples/storefront.mjs     # → http://localhost:3005/mcp
```

### Add it to Goose

`goose configure` → **Add Extension** → **Remote Extension (Streamable HTTP)** → URL:

```
http://localhost:3005/mcp
```

Then ask Goose:

- *"What do you sell?"* → lists the catalog (whiskey is 21+, headphones aren't).
- *"Add the Oak Reserve Whiskey and check out"* → the agent surfaces the **age 21+** requirement (plus
  the optional membership discount and payment) and a checkout link.
- *"Add the Aurora headphones and check out"* → **no age gate** — `requires` has no `age` entry.

Open the checkout link to see the order + what's required. (Completing on that page is a **demo stub** — the
real fail-closed wallet ceremony is provided by `attesto.mount()` and the full reference demo at the repo
root.)

### What it proves

The two packages compose with **zero glue**: the storefront's priced `Order` feeds
`attesto.requirements()` directly (the line carries `minimumAge`, re-derived from the catalog), and the
checkout tool gains a serializable `requires` manifest — the agent-facing contract — without you wiring any
of it by hand.
