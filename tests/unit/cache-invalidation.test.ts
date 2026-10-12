import { describe, expect, it } from "vitest";
import { TTL, invalidationKeys, qk } from "@/lib/cache/query-keys";

describe("query cache keys are scope-aware", () => {
  it("scopes volunteer keys by domain + filters", () => {
    const a = qk.volunteers({ domainId: "d1" });
    const b = qk.volunteers({ domainId: "d2" });
    expect(a).not.toEqual(b);
    expect(JSON.stringify(a)).toContain("d1");
  });

  it("scopes event keys by domain and category", () => {
    expect(qk.events({ domainId: "d1", category: "PAST" })).not.toEqual(
      qk.events({ domainId: "d1", category: "UPCOMING" }),
    );
  });

  it("scopes audit keys properly", () => {
    expect(qk.auditLogs({ domainId: "d1" })).not.toEqual(qk.auditLogs({ domainId: "d2" }));
  });
});

describe("cache TTLs", () => {
  it("are positive, short and bounded", () => {
    for (const value of Object.values(TTL)) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(5 * 60_000);
    }
  });
});

describe("mutation invalidation map", () => {
  it("invalidates dependent views for each mutation kind", () => {
    expect(flatten(invalidationKeys("volunteer"))).toContain("volunteers");
    expect(flatten(invalidationKeys("assignment"))).toContain("events");
    expect(flatten(invalidationKeys("assignment"))).toContain("volunteers");
    expect(flatten(invalidationKeys("completion"))).toContain("analytics");
    expect(flatten(invalidationKeys("role"))).toContain("users");
    expect(flatten(invalidationKeys("role"))).toContain("me");
  });

  it("never returns an empty invalidation set", () => {
    for (const kind of ["volunteer", "event", "assignment", "completion", "role", "domain"] as const) {
      expect(invalidationKeys(kind).length).toBeGreaterThan(0);
    }
  });
});

function flatten(keys: readonly (readonly unknown[])[]): string[] {
  return keys.map((k) => String(k[0]));
}
