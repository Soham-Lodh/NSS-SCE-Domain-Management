import { describe, expect, it } from "vitest";
import { sanitizeCsvCell, toCsv } from "@/lib/utils/csv";

describe("sanitizeCsvCell", () => {
  it("returns empty string for null/undefined", () => {
    expect(sanitizeCsvCell(null)).toBe("");
    expect(sanitizeCsvCell(undefined)).toBe("");
  });

  it("leaves normal values untouched", () => {
    expect(sanitizeCsvCell("hello world")).toBe("hello world");
    expect(sanitizeCsvCell(42)).toBe("42");
    expect(sanitizeCsvCell("2026-10-14T10:00:00Z")).toBe("2026-10-14T10:00:00Z");
  });

  it("neutralizes formula injection", () => {
    expect(sanitizeCsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(sanitizeCsvCell("+cmd")).toBe("'+cmd");
    expect(sanitizeCsvCell("-2")).toBe("'-2");
    expect(sanitizeCsvCell("@cmd")).toBe("'@cmd");
    expect(sanitizeCsvCell("\tTAB")).toBe("'\tTAB");
    expect(sanitizeCsvCell("\rCR")).toBe("'\rCR");
  });

  it("does not sanitize values for cells where danger char appears later", () => {
    expect(sanitizeCsvCell("total=10")).toBe("total=10");
    expect(sanitizeCsvCell("a-b")).toBe("a-b");
  });
});

describe("toCsv", () => {
  it("produces a header row and value rows", () => {
    const csv = toCsv(["Name", "Email"], [["A", "a@x.com"], ["B", "b@x.com"]]);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("Name,Email");
    expect(lines[1]).toBe("A,a@x.com");
    expect(lines[2]).toBe("B,b@x.com");
  });

  it("escapes embedded commas, quotes and newlines per RFC 4180", () => {
    const csv = toCsv(["Note"], [['a,b', 'say "hi"', "line1\nline2"]]);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines[1]).toBe('"a,b",\"say ""hi""\",\"line1\nline2\"');
  });

  it("ends with CRLF", () => {
    const csv = toCsv(["X"], [["1"]]);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("does not split quoted newlines on row reading", () => {
    const csv = toCsv(["A", "B"], [["multi\nline", "plain"]]);
    expect(csv).toContain('"multi\nline",plain\r\n');
  });
});
