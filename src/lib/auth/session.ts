import "server-only";

import { prisma } from "@/lib/db/prisma";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { allowedEmailDomains, serverEnv } from "@/lib/env";
import { isEmailAllowed, normalizeEmail } from "@/lib/authorization/email";
import { domainLeadDomainId, primaryRole } from "@/lib/authorization/roles";
import type { AuthContext, RoleGrantView, AppRole } from "@/lib/auth/types";
import { logger } from "@/lib/observability/logger";

/**
 * Resolves the trusted AuthContext for the current request, or null when the
 * caller is anonymous / disallowed / deactivated.
 *
 * Identity is verified with `getUser()` (a fresh Auth-server check) — a decoded
 * cookie or `getSession()` is never trusted. Authorization then comes from
 * CURRENT PostgreSQL rows, so JWT claims can never grant permissions.
 */
export async function getAuthContext(
  options: { requestId?: string; provision?: boolean } = {},
): Promise<AuthContext | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !user.email) return null;
  if (!user.email_confirmed_at && !user.confirmed_at) {
    // Only verified emails are allowed.
    return null;
  }

  const email = normalizeEmail(user.email);
  if (!isEmailAllowed(email, allowedEmailDomains())) {
    logger.warn("login_rejected_domain", { emailDomain: email.split("@")[1] });
    return null;
  }

  const appUser = await prisma.appUser.findUnique({
    where: { supabaseAuthUserId: user.id },
    include: { person: true, roleGrants: { where: { isActive: true } } },
  });

  if (!appUser) {
    if (!options.provision) return null;
    return provisionUser(user.id, email, user.user_metadata?.full_name as string | undefined, options.requestId);
  }

  if (!appUser.isActive) {
    logger.warn("login_rejected_inactive", { appUserId: appUser.id });
    return null;
  }

  const grants: RoleGrantView[] = appUser.roleGrants.map((g) => ({
    role: g.role,
    domainId: g.domainId,
    isActive: g.isActive,
  }));

  return {
    supabaseAuthUserId: user.id,
    appUserId: appUser.id,
    personId: appUser.personId,
    email: appUser.person.emailNormalized,
    fullName: appUser.person.fullName,
    roles: grants.map((g) => g.role),
    role: primaryRole(grants),
    domainId: domainLeadDomainId(grants),
    isActive: appUser.isActive,
    requestId: options.requestId,
  };
}

/**
 * Onboarding policy: a verified, allowlisted first-time user is provisioned as
 * a VOLUNTEER (least privilege). A bootstrap coordinator is created only when
 * BOOTSTRAP_COORDINATOR_EMAIL matches AND no active coordinator exists yet.
 */
async function provisionUser(
  supabaseAuthUserId: string,
  email: string,
  fullName: string | undefined,
  requestId?: string,
): Promise<AuthContext | null> {
  const env = serverEnv();
  const name = fullName?.trim() || email.split("@")[0] || "New User";

  const result = await prisma.$transaction(async (tx) => {
    const person = await tx.person.upsert({
      where: { emailNormalized: email },
      update: { fullName: name },
      create: { fullName: name, emailNormalized: email },
    });

    const created = await tx.appUser.upsert({
      where: { supabaseAuthUserId },
      update: { lastLoginAt: new Date() },
      create: { supabaseAuthUserId, personId: person.id, lastLoginAt: new Date() },
    });

    const existingGrants = await tx.roleGrant.count({
      where: { appUserId: created.id, isActive: true },
    });

    if (existingGrants === 0) {
      const activeCoordinators = await tx.roleGrant.count({
        where: { role: "COORDINATOR", isActive: true },
      });

      const isBootstrap =
        env.BOOTSTRAP_COORDINATOR_EMAIL.length > 0 &&
        email === normalizeEmail(env.BOOTSTRAP_COORDINATOR_EMAIL) &&
        activeCoordinators === 0;

      // A pending role assignment (set by an admin before first login) wins,
      // then the break-glass bootstrap coordinator, then least-privilege default.
      const pending = await tx.pendingRoleAssignment.findUnique({
        where: { emailNormalized: email },
      });

      let role: AppRole = "VOLUNTEER";
      let domainId: string | null = null;
      let source: "pending" | "bootstrap" | "default" = "default";

      if (pending && !pending.isConsumed) {
        role = pending.role;
        domainId = pending.role === "DOMAIN_LEAD" ? pending.domainId : null;
        source = "pending";
        await tx.pendingRoleAssignment.update({
          where: { id: pending.id },
          data: { isConsumed: true, consumedAt: new Date() },
        });
      } else if (isBootstrap) {
        role = "COORDINATOR";
        source = "bootstrap";
      }

      await tx.roleGrant.create({
        data: { appUserId: created.id, role, domainId, isActive: true },
      });

      await tx.auditLog.create({
        data: {
          actorAppUserId: created.id,
          action:
            source === "bootstrap"
              ? "BOOTSTRAP_COORDINATOR_GRANTED"
              : source === "pending"
                ? "PENDING_ROLE_APPLIED"
                : "USER_PROVISIONED",
          targetType: "AppUser",
          targetId: created.id,
          outcome: "SUCCESS",
          requestId: requestId ?? null,
          afterJson: { role, email },
        },
      });
    }

    const grants = await tx.roleGrant.findMany({
      where: { appUserId: created.id, isActive: true },
    });

    return { appUser: created, person, grants };
  });

  const grants: RoleGrantView[] = result.grants.map((g) => ({
    role: g.role,
    domainId: g.domainId,
    isActive: g.isActive,
  }));

  return {
    supabaseAuthUserId,
    appUserId: result.appUser.id,
    personId: result.person.id,
    email,
    fullName: result.person.fullName,
    roles: grants.map((g) => g.role),
    role: primaryRole(grants),
    domainId: domainLeadDomainId(grants),
    isActive: true,
    requestId,
  };
}

/** Best-effort last-login stamp; never blocks the request. */
export async function touchLastLogin(appUserId: string): Promise<void> {
  try {
    await prisma.appUser.update({
      where: { id: appUserId },
      data: { lastLoginAt: new Date() },
    });
  } catch (err) {
    logger.warn("touch_last_login_failed", {
      appUserId,
      message: err instanceof Error ? err.message : "unknown",
    });
  }
}
