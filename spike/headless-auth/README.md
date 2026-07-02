# headless-auth spike — can a Claude routine stay authenticated for 3 days?

**Answers**: §12.2 of [`specs/005-human-not-present/connector-architecture-design.md`](../../specs/005-human-not-present/connector-architecture-design.md)
— the single biggest swing factor for the "while you slept" demo leg.

**Live** (deployed 2026-07-02): `https://headless-auth-coral.vercel.app/mcp`
(Vercel project `dfzuluagas-projects/headless-auth`; full surface verified by scripted
PKCE client on deploy day — discovery, DCR, consent, exchange, MCP, refresh rotation gen 1→2.)

## How it tests the question

Access tokens live **10 minutes**; the routine runs **daily**. So every scheduled run MUST
redeem the rotating refresh token headlessly — exactly the undocumented behavior we need to
know about. The `heartbeat` tool returns `tokenGeneration`, which increments on every
rotation. Three mornings of rising numbers with zero re-auth prompts = **PASS**.

## Manual steps (Diego, ~5 minutes once)

1. **Add the connector**: claude.ai → Settings → Connectors → *Add custom connector* →
   URL `https://headless-auth-coral.vercel.app/mcp` → complete the one-button consent page.
2. **Sanity check** in a normal chat: *"Call the heartbeat tool on headless-auth-spike."*
   Expect a JSON blob with `tokenGeneration`.
3. **Create the scheduled task**: *"Every day at 9am for the next 4 days, call the
   heartbeat tool on the headless-auth-spike connector and report the tokenGeneration,
   serverTime, and whether the call succeeded."* (Make sure the connector is enabled for
   the task.)

## Reading the result

| Observation | Verdict |
| :-- | :-- |
| gen rises daily (e.g. 3 → 7 → 11), no prompts | **PASS** — scheduled runs refresh headlessly; the wallet connector can rely on routines |
| Day-1 works, later runs fail with auth errors / "reconnect" prompts | **FAIL** — refresh grants don't survive headless; demo falls back to Claude Code/cron for the unattended leg (design doc §12.2 fallback) |
| Tool calls absent from runs entirely | **INCONCLUSIVE** — routine didn't invoke the connector; check task config, retry |

Server-side confirmation: Vercel runtime logs (`[spike] token refreshed gen=N -> N+1`,
`[spike] heartbeat gen=N`) — retrievable via the Vercel MCP connector
(`get_runtime_logs`, project `headless-auth`).

## What this is NOT

Spike-grade throwaway: HMAC secret committed in the source, no token revocation, one-button
consent with no accounts. It protects a timestamp. Delete the Vercel project when the
experiment ends.
