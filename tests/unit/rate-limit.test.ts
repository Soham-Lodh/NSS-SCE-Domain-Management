import { describe, expect, it } from "vitest";
import { rateLimitResponse, takeRateLimit } from "@/lib/security/rate-limit";

/** Unique client per test so the module-level windows never collide. */
let ipCounter = 0;
function client(): string {
  return `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
}

function req(method: string, ip: string, path = "/api/events"): Request {
  return new Request(`https://example.test${path}`, {
    method,
    headers: { "x-forwarded-for": ip },
  });
}

describe("per-route rate limit", () => {
  it("allows reads up to the read budget and then blocks", () => {
    const ip = client();
    let last = takeRateLimit(req("GET", ip));
    expect(last.allowed).toBe(true);
    expect(last.limit).toBe(120);

    for (let i = 1; i < 120; i += 1) last = takeRateLimit(req("GET", ip));
    expect(last.allowed).toBe(true);
    expect(last.remaining).toBe(0);

    last = takeRateLimit(req("GET", ip));
    expect(last.allowed).toBe(false);
    expect(last.remaining).toBe(0);
  });

  it("applies the smaller write budget to mutations", () => {
    const ip = client();
    let last = takeRateLimit(req("POST", ip, "/api/events"));
    expect(last.limit).toBe(30);

    for (let i = 1; i < 30; i += 1) last = takeRateLimit(req("POST", ip, "/api/events"));
    expect(last.allowed).toBe(true);

    expect(takeRateLimit(req("POST", ip, "/api/events")).allowed).toBe(false);
    // A different method/path from the same client keeps its own budget.
    expect(takeRateLimit(req("GET", ip, "/api/events")).allowed).toBe(true);
  });

  it("keys per path so one busy route cannot exhaust another", () => {
    const ip = client();
    for (let i = 0; i < 30; i += 1) takeRateLimit(req("POST", ip, "/api/events"));
    expect(takeRateLimit(req("POST", ip, "/api/events")).allowed).toBe(false);
    expect(takeRateLimit(req("POST", ip, "/api/volunteers")).allowed).toBe(true);
  });

  it("ignores query parameters in the key", () => {
    const ip = client();
    const first = new Request(`https://example.test/api/events?page=1`, {
      headers: { "x-forwarded-for": ip },
    });
    const second = new Request(`https://example.test/api/events?page=2`, {
      headers: { "x-forwarded-for": ip },
    });
    const a = takeRateLimit(first);
    const b = takeRateLimit(second);
    expect(b.remaining).toBe(a.remaining - 1);
  });
});

describe("global rate limit", () => {
  it("counts every API path against a single budget", () => {
    const ip = client();
    for (let i = 0; i < 599; i += 1) takeRateLimit(req("GET", ip, `/api/thing-${i}`), "global");
    expect(takeRateLimit(req("GET", ip, "/api/events"), "global").allowed).toBe(true);
    expect(takeRateLimit(req("GET", ip, "/api/events"), "global").allowed).toBe(false);
  });

  it("does not consume the per-route budget", () => {
    const ip = client();
    takeRateLimit(req("GET", ip, "/api/events"), "global");
    expect(takeRateLimit(req("GET", ip, "/api/events")).remaining).toBe(119);
  });

  it("isolates clients from each other", () => {
    const a = client();
    const b = client();
    for (let i = 0; i < 30; i += 1) takeRateLimit(req("POST", a, "/api/events"));
    expect(takeRateLimit(req("POST", b, "/api/events")).allowed).toBe(true);
  });
});

describe("rate limit response", () => {
  it("returns the RATE_LIMITED envelope with retry headers", async () => {
    const ip = client();
    let state = takeRateLimit(req("POST", ip, "/api/events"));
    for (let i = 1; i < 30 && state.allowed; i += 1) state = takeRateLimit(req("POST", ip, "/api/events"));
    state = takeRateLimit(req("POST", ip, "/api/events"));
    expect(state.allowed).toBe(false);

    const response = rateLimitResponse(req("POST", ip, "/api/events"), state);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(response.headers.get("RateLimit-Limit")).toBe("30");

    const body = await response.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });
});
