// CT7 — type-safety: builders are credential-specific. An age gate that sets a
// currency (or a payment that sets an age) must be a COMPILE error, so a typo
// can't silently produce a meaningless gate (Principle I). This file is checked
// by `tsc -p tsconfig.test.json` (wired into the package build): if any of the
// negative assertions below stops erroring, the suppression goes unused and the
// build fails. It is type-only; nothing runs at test time.

import { age, payment, membership } from "./credentials.js";

// age has only `.over()` (+ `.when()`), never `.in()`:
// @ts-expect-error — age.over(...) returns a Credential with no `.in`
age.over(21).in("usd");

// payment has only `.in()` (+ `.when()`), never `.over()`:
// @ts-expect-error — payment.in(...) returns a Credential with no `.over`
payment.in("usd").over(21);

// membership has only `.discount()` (+ `.when()`), never `.over()`:
// @ts-expect-error — membership.discount(...) returns a Credential with no `.over`
membership.discount(10).over(21);

// …but `.when()` IS available on every built-in (chainable), so these compile:
age.over(21).when((o) => o.lines.length > 0);
payment.in("usd").when(() => true);
membership.discount(10).when(() => true);
