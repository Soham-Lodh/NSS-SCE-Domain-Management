import "server-only";

import { prisma } from "@/lib/db/prisma";
import { memoized, invalidateMemo } from "@/lib/cache/memory";
import { validationError } from "@/lib/api/response";
import { ALLOWED_PROJECT_NAMES, normalizeProjectName } from "@/lib/projects";

export type ProjectDTO = { id: string; name: string };

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

export async function listActiveProjects(): Promise<ProjectDTO[]> {
  return memoized("projects:active", 5 * 60_000, async () => {
    await ensureCanonicalProjects();
    return prisma.project.findMany({
      where: { isActive: true, name: { in: [...ALLOWED_PROJECT_NAMES] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  });
}

export async function getProjectByName(name: string): Promise<ProjectDTO | null> {
  const normalized = normalizeProjectName(name);
  const projects = await listActiveProjects();
  return projects.find((p) => normalizeProjectName(p.name) === normalized) ?? null;
}

export async function assertValidProjectId(projectId: string | null | undefined): Promise<void> {
  if (!projectId) return;
  const project = await prisma.project.findFirst({
    where: { id: projectId, isActive: true, name: { in: [...ALLOWED_PROJECT_NAMES] } },
    select: { id: true },
  });
  if (!project) throw validationError({ projectId: "Select one of the approved projects." });
}
