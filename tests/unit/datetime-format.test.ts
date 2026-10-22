import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatInTimeZone,
  isValidEventWindow,
} from "@/lib/utils/datetime";

describe("central DD/MM/YYYY display formatters", () => {
  it("zero-pads 1–9 days and months", () => {
    // 2026-01-05T04:00Z = 09:30 IST on 05 Jan
    const d = new Date("2026-01-05T04:00:00Z");
    expect(formatDate(d)).toBe("05/01/2026");
    expect(formatDateTime(d)).toBe("05/01/2026 09:30");
  });

  it("uses 24-hour time in Asia/Kolkata", () => {
    // 2026-01-05T15:30Z = 21:00 IST
    expect(formatDateTime("2026-01-05T15:30:00Z")).toBe("05/01/2026 21:00");
    // 2026-01-05T18:00Z = 23:30 IST
    expect(formatDateTime("2026-01-05T18:00:00Z")).toBe("05/01/2026 23:30");
  });

  it("lands on the correct IST calendar day near midnight", () => {
    // 2026-01-05T19:30Z = 01:00 IST on 06 Jan
    expect(formatDate("2026-01-05T19:30:00Z")).toBe("06/01/2026");
    // 05 Jan 23:59:59 IST = 18:29:59Z
    expect(formatDate("2026-01-05T18:29:59Z")).toBe("05/01/2026");
  });

  it("renders invalid dates as an em dash", () => {
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatDateTime(new Date("not-a-date"))).toBe("—");
  });

  it("month/year boundaries format correctly", () => {
    expect(formatDate("2026-12-31T18:35:00Z")).toBe("01/01/2027");
    expect(formatDateTime("2026-02-28T12:00:00Z")).toBe("28/02/2026 17:30");
  });

  it("formatInTimeZone keeps the same contract by default", () => {
    expect(formatInTimeZone("2026-01-05T04:00:00Z", "Asia/Kolkata")).toBe("05/01/2026 09:30");
  });
});

describe("event window validation", () => {
  it("rejects windows where end is not after start", () => {
    const a = new Date("2026-01-10T02:00:00Z");
    const b = new Date("2026-01-10T09:00:00Z");
    expect(isValidEventWindow(a, b)).toBe(true);
    expect(isValidEventWindow(b, a)).toBe(false);
    expect(isValidEventWindow(b, b)).toBe(false);
  });
});
