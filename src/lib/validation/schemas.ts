import { z } from "zod";

/** Shared runtime validation. Actor/role/domain IDs are NEVER accepted here. */

export const uuid = z.string().uuid();

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const createVolunteerSchema = z.object({
  fullName: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(320),
  rollNumber: z.string().trim().min(1).max(40).optional(),
  domainId: uuid,
  projectId: uuid,
});

export const updateVolunteerSchema = z.object({
  fullName: z.string().trim().min(2).max(150).optional(),
  rollNumber: z.string().trim().min(1).max(40).optional().nullable(),
  projectId: uuid.optional(),
  isActive: z.boolean().optional(),
});

export const createEventSchema = z
  .object({
    domainId: uuid,
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(4000).optional().nullable(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    location: z.string().trim().max(200).optional().nullable(),
  })
  .refine((v) => v.endAt.getTime() > v.startAt.getTime(), {
    message: "End time must be after start time.",
    path: ["endAt"],
  });

export const updateEventSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().max(4000).optional().nullable(),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
    location: z.string().trim().max(200).optional().nullable(),
    status: z.enum(["SCHEDULED", "CANCELLED", "ARCHIVED"]).optional(),
  })
  .refine(
    (v) => !v.startAt || !v.endAt || v.endAt.getTime() > v.startAt.getTime(),
    { message: "End time must be after start time.", path: ["endAt"] },
  );

export const bulkAssignSchema = z.object({
  membershipIds: z.array(uuid).min(1).max(500).transform((ids) => Array.from(new Set(ids))),
});

export const assignmentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("remove") }),
  z.object({ action: z.literal("reassign"), targetEventId: uuid }),
]);

export const roleChangeSchema = z
  .object({
    role: z.enum(["VOLUNTEER", "DOMAIN_LEAD", "TECH_TEAM", "COORDINATOR"]),
    domainId: uuid.optional().nullable(),
    projectId: uuid.optional().nullable(),
  })
  .refine((v) => (v.role !== "DOMAIN_LEAD" && v.role !== "VOLUNTEER") || !!v.domainId, {
    message: "A domain is required for a domain member.",
    path: ["domainId"],
  })
  .refine((v) => (v.role !== "DOMAIN_LEAD" && v.role !== "VOLUNTEER") || !!v.projectId, {
    message: "A project is required for a domain member.",
    path: ["projectId"],
  });

export const eventListQuery = z.object({
  domainId: uuid.optional(),
  category: z.enum(["UPCOMING", "ONGOING", "PAST", "COMPLETED", "CANCELLED", "ALL"]).default("ALL"),
  search: z.string().trim().max(200).optional(),
});

export const volunteerListQuery = z.object({
  domainId: uuid.optional(),
  search: z.string().trim().max(200).optional(),
  projectId: uuid.optional(),
  activeOnly: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  sort: z.enum(["workload", "completed", "name"]).default("completed"),
});

export const auditListQuery = z.object({
  domainId: uuid.optional(),
  actorAppUserId: uuid.optional(),
  action: z.string().trim().max(100).optional(),
  outcome: z.enum(["SUCCESS", "DENIED", "FAILURE"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const domainCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

/**
 * Add a person (coordinator / tech team / domain lead / volunteer) before they
 * sign in. If the role is domain-scoped, a domain is required.
 */
export const personUpsertSchema = z
  .object({
    fullName: z.string().trim().min(2).max(150),
    email: z.string().trim().email().max(320),
    role: z.enum(["VOLUNTEER", "DOMAIN_LEAD", "TECH_TEAM", "COORDINATOR"]),
    domainId: uuid.optional().nullable(),
    projectId: uuid.optional().nullable(),
  })
  .refine((v) => (v.role !== "DOMAIN_LEAD" && v.role !== "VOLUNTEER") || !!v.domainId, {
    message: "A domain is required for a domain member.",
    path: ["domainId"],
  })
  .refine((v) => (v.role !== "DOMAIN_LEAD" && v.role !== "VOLUNTEER") || !!v.projectId, {
    message: "A project is required for a domain member.",
    path: ["projectId"],
  });

// A row echoed back from the import preview and re-validated on commit.
export const importRowSchema = z.object({
  email: z.string().trim().min(1).max(320),
  fullName: z.string().trim().min(1).max(150),
  rollNumber: z.string().trim().max(40).optional().default(""),
  year: z.string().trim().max(20).optional().default(""),
  gender: z.string().trim().max(20).optional().default(""),
  domainName: z.string().trim().max(120),
  projectName: z.string().trim().max(120).optional().default(""),
});

export const importCommitSchema = z.object({
  domainIdFallback: uuid.optional(),
  rows: z.array(importRowSchema).min(1).max(2000),
});

export type CreateVolunteerInput = z.infer<typeof createVolunteerSchema>;
export type ImportRowInput = z.infer<typeof importRowSchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type RoleChangeInput = z.infer<typeof roleChangeSchema>;
