import { describe, expect, it } from "vitest";
import { deriveEventCategory, isValidEventWindow } from "@/lib/utils/datetime";

const now = new Date("2026-01-15T12:00:00Z");

describe("event category derivation", () => {
  it("is UPCOMING before the start", () => {
    const start = new Date("2026-01-15T13:00:00Z");
    const end = new Date("2026-01-15T15:00:00Z");
    expect(deriveEventCategory(start, end, "SCHEDULED", now)).toBe("UPCOMING");
  });

  it("is ONGOING between start and end", () => {
    const start = new Date("2026-01-15T11:00:00Z");
    const end = new Date("2026-01-15T13:00:00Z");
    expect(deriveEventCategory(start, end, "SCHEDULED", now)).toBe("ONGOING");
  });

  it("is PAST after the end", () => {
    const start = new Date("2026-01-14T09:00:00Z");
    const end = new Date("2026-01-14T11:00:00Z");
    expect(deriveEventCategory(start, end, "SCHEDULED", now)).toBe("PAST");
  });

  it("is CANCELLED regardless of time when explicitly cancelled", () => {
    const start = new Date("2026-01-15T11:00:00Z");
    const end = new Date("2026-01-15T13:00:00Z");
    expect(deriveEventCategory(start, end, "CANCELLED", now)).toBe("CANCELLED");
  });

  it("is COMPLETED only when explicitly ended (never automatically)", () => {
    const pastStart = new Date("2025-12-01T11:00:00Z");
    const pastEnd = new Date("2025-12-01T13:00:00Z");
    // Deadline long passed but still SCHEDULED → it stays OPEN as PAST.
    expect(deriveEventCategory(pastStart, pastEnd, "SCHEDULED", now)).toBe("PAST");
    // Only an explicit COMPLETED status yields COMPLETED.
    expect(deriveEventCategory(pastStart, pastEnd, "COMPLETED", now)).toBe("COMPLETED");
  });

  it("treats the exact start boundary as ONGOING and end boundary as PAST", () => {
    expect(deriveEventCategory(now, new Date("2026-01-15T13:00:00Z"), "SCHEDULED", now)).toBe("ONGOING");
    expect(deriveEventCategory(new Date("2026-01-15T10:00:00Z"), now, "SCHEDULED", now)).toBe("PAST");
  });
});

describe("event window validation", () => {
  it("requires end strictly after start", () => {
    expect(isValidEventWindow(new Date("2026-01-15T10:00:00Z"), new Date("2026-01-15T11:00:00Z"))).toBe(true);
    expect(isValidEventWindow(new Date("2026-01-15T10:00:00Z"), new Date("2026-01-15T10:00:00Z"))).toBe(false);
    expect(isValidEventWindow(new Date("2026-01-15T11:00:00Z"), new Date("2026-01-15T10:00:00Z"))).toBe(false);
  });
});
