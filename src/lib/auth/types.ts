export type AppRole = "VOLUNTEER" | "DOMAIN_LEAD" | "TECH_TEAM" | "COORDINATOR";

export type RoleGrantView = {
  role: AppRole;
  domainId: string | null;
  isActive: boolean;
};

/**
 * Server-derived authorization context. NEVER constructed from client input.
 * Identity comes from the verified Supabase session; grants come from current
 * PostgreSQL rows.
 */
export type AuthContext = {
  supabaseAuthUserId: string;
  appUserId: string;
  personId: string;
  email: string;
  fullName: string;
  roles: AppRole[];
  /** Highest-precedence role for UI/display purposes. */
  role: AppRole;
  /** The domain the user leads, if they hold an active DOMAIN_LEAD grant. */
  domainId: string | null;
  isActive: boolean;
  requestId?: string;
};

export const ROLE_PRECEDENCE: AppRole[] = [
  "COORDINATOR",
  "TECH_TEAM",
  "DOMAIN_LEAD",
  "VOLUNTEER",
];

export const ROLE_LABELS: Record<AppRole, string> = {
  VOLUNTEER: "Volunteer",
  DOMAIN_LEAD: "Domain Lead",
  TECH_TEAM: "Tech Team",
  COORDINATOR: "Coordinator",
};
