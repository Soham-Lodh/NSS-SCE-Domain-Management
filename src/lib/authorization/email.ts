/**
 * Exact institutional email allowlist matching.
 *
 * Substring matching is a security bug: "x@kiit.ac.in.attacker.test" must NOT
 * pass when "kiit.ac.in" is allowlisted. We match the full domain after the
 * last "@" and only allow either an exact match or a proper sub-domain of an
 * allowed suffix.
 */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase();
}

export function isEmailAllowed(email: string, allowedDomains: string[]): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  const at = normalizedEmail.indexOf("@");
  // Require a non-empty local part, a non-empty domain, exactly one "@", and
  // no whitespace anywhere.
  if (at <= 0) return false;
  const local = normalizedEmail.slice(0, at);
  const domain = normalizedEmail.slice(at + 1);
  if (!local || !domain || domain.includes("@") || /\s/.test(normalizedEmail)) return false;
  return allowedDomains.some((allowed) => {
    const a = allowed.trim().toLowerCase().replace(/^\./, "");
    if (!a) return false;
    return domain === a || domain.endsWith(`.${a}`);
  });
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
