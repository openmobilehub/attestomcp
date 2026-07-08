// FR-014 unit contract: the canonical tool-meta carries BOTH host surfaces, and
// crucially `openai/widgetAccessible: true` — the key the demo's inline UI_META
// omitted, leaving the ChatGPT widget rendered but interactively dead.

import { describe, it, expect } from "vitest";
import { appToolMeta } from "./tool-meta.js";

describe("appToolMeta — the ChatGPT widget contract (FR-014)", () => {
  it("emits both host surfaces, with widgetAccessible always on", () => {
    const m = appToolMeta({ resourceUri: "ui://shop/app.html", skybridgeUri: "ui://shop/app.skybridge.html" });
    // Claude (MCP-Apps)
    expect(m.ui.resourceUri).toBe("ui://shop/app.html");
    // ChatGPT (skybridge)
    expect(m["openai/outputTemplate"]).toBe("ui://shop/app.skybridge.html");
    // the load-bearing flag — without it, in-widget callTool is rejected
    expect(m["openai/widgetAccessible"]).toBe(true);
    expect(m["openai/toolInvocation"]).toEqual({ invoking: "Working…", invoked: "Done" });
  });

  it("falls back skybridge → resourceUri when one resource serves both", () => {
    const m = appToolMeta({ resourceUri: "ui://shop/app.html" });
    expect(m["openai/outputTemplate"]).toBe("ui://shop/app.html");
    expect(m["openai/widgetAccessible"]).toBe(true);
  });

  it("honors custom invocation status", () => {
    const m = appToolMeta({ resourceUri: "ui://x" }, { invoking: "Adding…", invoked: "Added" });
    expect(m["openai/toolInvocation"]).toEqual({ invoking: "Adding…", invoked: "Added" });
  });
});
