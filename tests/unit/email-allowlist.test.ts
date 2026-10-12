import { describe, expect, it } from "vitest";
import { emailDomain, isEmailAllowed, normalizeEmail } from "@/lib/authorization/email";

const ALLOWED = ["kiit.ac.in"];

describe("email allowlist (exact suffix matching)", () => {
  it("allows the exact domain and subdomains", () => {
    expect(isEmailAllowed("student@kiit.ac.in", ALLOWED)).toBe(true);
    expect(isEmailAllowed("Student@KIIT.AC.IN", ALLOWED)).toBe(true);
    expect(isEmailAllowed("x@ece.kiit.ac.in", ALLOWED)).toBe(true);
  });

  it("rejects lookalike / attacker domains", () => {
    expect(isEmailAllowed("x@kiit.ac.in.attacker.test", ALLOWED)).toBe(false);
    expect(isEmailAllowed("x@notkiit.ac.in", ALLOWED)).toBe(false);
    expect(isEmailAllowed("x@kiit.ac.inevil.test", ALLOWED)).toBe(false);
    expect(isEmailAllowed("x@gmail.com", ALLOWED)).toBe(false);
  });

  it("rejects malformed addresses", () => {
    expect(isEmailAllowed("no-at-sign", ALLOWED)).toBe(false);
    expect(isEmailAllowed("@kiit.ac.in", ALLOWED)).toBe(false);
    expect(isEmailAllowed("", ALLOWED)).toBe(false);
  });

  it("does not match a substring of a domain label", () => {
    expect(isEmailAllowed("x@kiit.ac", ALLOWED)).toBe(false);
    expect(isEmailAllowed("x@ac.in", ALLOWED)).toBe(false);
  });

  it("normalizes and extracts the domain", () => {
    expect(normalizeEmail("  User@KIIT.ac.in ")).toBe("user@kiit.ac.in");
    expect(emailDomain("a@b.kiit.ac.in")).toBe("b.kiit.ac.in");
  });
});
