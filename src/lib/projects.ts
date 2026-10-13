export const ALLOWED_PROJECT_NAMES = [
  "Bandhutva",
  "Dhara",
  "Nidaan",
  "Riddhi",
  "Sanyukt",
  "Sparsh",
  "Swet",
  "Udaan",
  "Urja",
] as const;

export type AllowedProjectName = (typeof ALLOWED_PROJECT_NAMES)[number];

export function normalizeProjectName(value: string): string {
  return value.trim().toLowerCase();
}

export function isAllowedProjectName(value: string): boolean {
  const normalized = normalizeProjectName(value);
  return ALLOWED_PROJECT_NAMES.some((name) => normalizeProjectName(name) === normalized);
}
