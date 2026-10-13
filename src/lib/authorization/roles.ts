import type { AppRole, RoleGrantView } from "@/lib/auth/types";
import { ROLE_PRECEDENCE } from "@/lib/auth/types";

/**
 * Pure permission matrix. Central, deny-by-default, fully testable without a
 * database. Every service and route calls into here; UI visibility is a UX
 * concern only and is never the security boundary.
 */

export type RoleAction = "ADD" | "REMOVE";

export function activeRoles(grants: RoleGrantView[]): AppRole[] {
  return grants.filter((g) => g.isActive).map((g) => g.role);
}

export function primaryRole(grants: RoleGrantView[]): AppRole {
  const roles = new Set(activeRoles(grants));
  for (const role of ROLE_PRECEDENCE) {
    if (roles.has(role)) return role;
  }
  return "VOLUNTEER";
}

export function domainLeadDomainId(grants: RoleGrantView[]): string | null {
  const grant = grants.find((g) => g.isActive && g.role === "DOMAIN_LEAD");
  return grant?.domainId ?? null;
}

export function domainLeadDomainIds(grants: RoleGrantView[]): string[] {
  return Array.from(
    new Set(
      grants
        .filter((g) => g.isActive && g.role === "DOMAIN_LEAD" && !!g.domainId)
        .map((g) => g.domainId as string),
    ),
  );
}

/** Cross-domain read/oversight (not event operation). */
export function canViewAllDomains(roles: AppRole[]): boolean {
  return roles.includes("TECH_TEAM") || roles.includes("COORDINATOR");
}

/** Event CRUD / assignment / completion — only for an active Domain Lead. */
export function canOperateEvents(roles: AppRole[]): boolean {
  return roles.includes("DOMAIN_LEAD");
}

/** Volunteer master-data / domain membership maintenance. */
export function canManageVolunteerMaster(roles: AppRole[]): boolean {
  return roles.includes("TECH_TEAM") || roles.includes("COORDINATOR");
}

export function canAssignDomainLead(roles: AppRole[]): boolean {
  return roles.includes("TECH_TEAM") || roles.includes("COORDINATOR");
}

export function canViewAuditLogs(roles: AppRole[]): boolean {
  return roles.includes("TECH_TEAM") || roles.includes("COORDINATOR");
}

/** Only coordinators may inspect tech-team activity. */
export function canViewTechTeamActivity(roles: AppRole[]): boolean {
  return roles.includes("COORDINATOR");
}

export function canAddTechTeam(roles: AppRole[]): boolean {
  return roles.includes("TECH_TEAM") || roles.includes("COORDINATOR");
}

export function canRemoveTechTeam(roles: AppRole[]): boolean {
  return roles.includes("TECH_TEAM") || roles.includes("COORDINATOR");
}

export function canManageCoordinators(roles: AppRole[]): boolean {
  return roles.includes("COORDINATOR");
}

/**
 * Role-administration hierarchy. A tech-team member may add/remove tech-team
 * members but can never add/remove/demote a coordinator.
 */
export function canManageRole(
  actorRoles: AppRole[],
  targetRole: AppRole,
  action: RoleAction,
): boolean {
  if (targetRole === "COORDINATOR") {
    // Only a coordinator can add or remove a coordinator.
    return canManageCoordinators(actorRoles);
  }
  if (targetRole === "TECH_TEAM") {
    return action === "ADD" ? canAddTechTeam(actorRoles) : canRemoveTechTeam(actorRoles);
  }
  // VOLUNTEER / DOMAIN_LEAD
  return canManageVolunteerMaster(actorRoles);
}

/** A user may never change their own role or domain. */
export function isSelf(actorAppUserId: string, targetAppUserId: string): boolean {
  return actorAppUserId === targetAppUserId;
}

/** Count of active coordinators gate for last-coordinator protection. */
export function wouldRemoveLastCoordinator(
  activeCoordinatorCount: number,
  targetCurrentlyCoordinator: boolean,
): boolean {
  return targetCurrentlyCoordinator && activeCoordinatorCount <= 1;
}
