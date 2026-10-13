import "server-only";

import { prisma } from "@/lib/db/prisma";
import { memoized, invalidateMemo } from "@/lib/cache/memory";
import { validationError } from "@/lib/api/response";
import { ALLOWED_PROJECT_NAMES, normalizeProjectName } from "@/lib/projects";

export type ProjectDTO = { id: string; name: string };

/**
 * Canonical project rows. Names are FIXED (src/lib/projects.ts), so we never
 * upsert on a cache miss — reads are a single indexed query, memoized for
 * 5 minutes process-locally and mirrored by the browser TanStack cache.
 *
 * Canonical rows themselves are reconciled by the explicit seed path
 * (`npm run db:seed`) so a fresh database gets the fixed row set once, not on
 * every request. If rows are missing at runtime the query returns what exists;
 * forms that need an ID will surface a clear setup error from the seed script.
 */
export async function listActiveProjects(): Promise<ProjectDTO[]> {
  return memoized("projects:active", 5 * 60_000, async () => {
    const rows = await prisma.project.findMany({
      where: { isActive: true, name: { in: [...ALLOWED_PROJECT_NAMES] } },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }],
    });
    return rows;
  });
}

export async function getProjectByName(name: string): Promise<ProjectDTO | null> {
  const normalized = normalizeProjectName(name);
  const projects = await listActiveProjects();
  return projects.find((p) => normalizeProjectName(p.name) === normalized) ?? null;
}

export async function assertValidProjectId(projectId: string | null | undefined): Promise<void> {
  if (!projectId) return;
  const projects = await listActiveProjects();
  if (!projects.some((p) => p.id === projectId)) {
    throw validationError({ projectId: "Select one of the approved projects." });
  }
}

/** One-time reconcile for the fixed project list. Seed/setup script only — NOT a request path. */
export async function ensureCanonicalProjects(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const name of ALLOWED_PROJECT_NAMES) {
      await tx.project.upsert({
        where: { name },
        update: { isActive: true },
        create: { name, isActive: true },
      });
    }
  });
  invalidateMemo("projects:");
}
