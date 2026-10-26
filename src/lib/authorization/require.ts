import "server-only";

import { forbidden, unauthenticated } from "@/lib/api/response";
import { getAuthContext } from "@/lib/auth/session";
import type { AuthContext, AppRole } from "@/lib/auth/types";
import {
  canAssignDomainLead,
  canManageRole,
  canManageVolunteerMaster,
  canOperateEvents,
  canViewAllDomains,
  canViewAuditLogs,
  hasPortalAccess,
  type RoleAction,
} from "@/lib/authorization/roles";
import { allowedOrigins, serverEnv } from "@/lib/env";
import { logger } from "@/lib/observability/logger";

export const PHOTOGRAPHY_DOMAIN_ID = "a04a8ae8-dfc0-4197-b707-e6c43f7cb3ad";

/**
 * Resolve the context for a portal API route or throw.
 * - 401 when there is no verified, provisioned session.
 * - 403 when the account has no portal role (volunteer / unprovisioned): they
 *   receive event updates by email and have no access to the site's data, so
 *   every API is denied here — the pages are only the UX layer of the same
 *   policy.
 */
export async function requireAuthContext(
  options: { requestId?: string; provision?: boolean } = {},
): Promise<AuthContext> {
  const ctx = await getAuthContext(options);
  if (!ctx) throw unauthenticated();
  if (!hasPortalAccess(ctx.roles)) {
    logger.warn("portal_access_denied", { appUserId: ctx.appUserId, requestId: options.requestId });
    throw forbidden("This account does not have portal access.");
  }
  return ctx;
}

export function assertRole(ctx: AuthContext, roles: AppRole[]): void {
  if (!roles.some((r) => ctx.roles.includes(r))) throw forbidden();
}

export function assertViewAllDomains(ctx: AuthContext): void {
  if (!canViewAllDomains(ctx.roles)) throw forbidden();
}

export function assertManageVolunteerMaster(ctx: AuthContext): void {
  if (!canManageVolunteerMaster(ctx.roles)) throw forbidden();
}

export function assertAssignDomainLead(ctx: AuthContext): void {
  if (!canAssignDomainLead(ctx.roles)) throw forbidden();
}

export function assertViewAuditLogs(ctx: AuthContext): void {
  if (!canViewAuditLogs(ctx.roles)) throw forbidden();
}

export function assertCanManageRole(
  ctx: AuthContext,
  targetRole: AppRole,
  action: RoleAction,
): void {
  if (!canManageRole(ctx.roles, targetRole, action)) throw forbidden();
}

/**
 * Resolves and authorizes the effective domain scope for a read/write.
 * - Oversight roles (tech/coordinator) may target any domain.
 * - A domain lead may target any domain they actively lead.
 * - Anyone else (volunteer) is denied.
 * Never trust a domainId from the client without this check.
 */
export function resolveDomainScope(ctx: AuthContext, requestedDomainId?: string): string {
  if (canViewAllDomains(ctx.roles)) {
    if (!requestedDomainId) throw forbidden("A domain must be specified.");
    return requestedDomainId;
  }
  if (canOperateEvents(ctx.roles) && ctx.domainIds.length > 0) {
    const domainId = requestedDomainId ?? ctx.domainIds[0];
    if (!ctx.domainIds.includes(domainId)) throw forbidden();
    return domainId;
  }
  throw forbidden();
}

/** Domain-lead-only event/assignment operation inside their own domain. */
export function assertCanOperateEvents(ctx: AuthContext, domainId: string): void {
  if (!canOperateEvents(ctx.roles)) throw forbidden();
  if (!ctx.domainIds.includes(domainId)) throw forbidden();
}

/** Event read access: domain leads may also view Photography events. */
export function assertCanViewEvents(ctx: AuthContext, domainId: string): void {
  if (canViewAllDomains(ctx.roles)) return;
  if (canOperateEvents(ctx.roles) && (ctx.domainIds.includes(domainId) || domainId === PHOTOGRAPHY_DOMAIN_ID)) return;
  throw forbidden();
}

/** Resolve an event-list domain while preserving normal domain scoping elsewhere. */
export function resolveEventDomainScope(ctx: AuthContext, requestedDomainId?: string): string {
  if (canViewAllDomains(ctx.roles)) {
    if (!requestedDomainId) throw forbidden("A domain must be specified.");
    return requestedDomainId;
  }
  if (canOperateEvents(ctx.roles) && ctx.domainIds.length > 0) {
    const domainId = requestedDomainId ?? ctx.domainIds[0];
    if (ctx.domainIds.includes(domainId) || domainId === PHOTOGRAPHY_DOMAIN_ID) return domainId;
  }
  throw forbidden();
}

/**
 * Origin/CSRF check for cookie-authenticated mutations. Same-origin requests
 * (APP_URL plus configured extras) are allowed; anything else is rejected.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  // Non-browser / server-to-server callers may omit Origin; only browser
  // requests that present a mismatched Origin are rejected.
  if (!origin) return;
  const allowed = new Set([serverEnv().APP_URL, new URL(req.url).origin, ...allowedOrigins()]);
  try {
    const originUrl = new URL(origin);
    const ok = Array.from(allowed).some((a) => {
      try {
        return new URL(a).origin === originUrl.origin;
      } catch {
        return false;
      }
    });
    if (!ok) {
      logger.warn("csrf_origin_rejected", { origin });
      throw forbidden("Request origin is not allowed.");
    }
  } catch (err) {
    if (err instanceof Error && err.name === "ApiControl") throw err;
    throw forbidden("Invalid request origin.");
  }
}
