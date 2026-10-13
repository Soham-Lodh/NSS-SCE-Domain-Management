import { describe, expect, it } from "vitest";
import { monthKeyFor } from "@/lib/email/digest-policy";

describe("monthKeyFor", () => {
  it("returns YYYY-MM in the org timezone", () => {
    expect(monthKeyFor(new Date("2026-10-14T00:00:00Z"), "Asia/Kolkata")).toBe("2026-10");
  });

  it("handles year rollover", () => {
    expect(monthKeyFor(new Date("2026-12-31T18:30:00Z"), "Asia/Kolkata")).toBe("2027-01");
  });

  it("handles timezone day shifts (IST is UTC+5:30)", () => {
    // 2026-10-31T20:00:00Z = 2026-11-01T01:30:00 IST
    expect(monthKeyFor(new Date("2026-10-31T20:00:00Z"), "Asia/Kolkata")).toBe("2026-11");
    // 2026-10-01T18:00:00Z = 2026-10-01T23:30:00 IST — same month
    expect(monthKeyFor(new Date("2026-10-01T18:00:00Z"), "Asia/Kolkata")).toBe("2026-10");
  });

  it("leap years are fine", () => {
    expect(monthKeyFor(new Date("2028-02-29T10:00:00Z"), "Asia/Kolkata")).toBe("2028-02");
  });
});
