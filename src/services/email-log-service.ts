import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { Paginated } from "@/lib/utils/pagination";

export type EmailDeliveryStatusFilter = "QUEUED" | "SENT" | "FAILED" | "DEAD" | "SUPPRESSED";

export type EmailDeliveryLogRow = {
  id: string;
  outboxId: string | null;
  recipient: string;
  templateKey: string;
  eventType: string;
  subject: string | null;
  status: EmailDeliveryStatusFilter;
  attemptNumber: number;
  eventId: string | null;
  eventTitle: string | null;
  domainId: string | null;
  domainName: string | null;
  assignmentId: string | null;
  monthKey: string | null;
  providerMessageId: string | null;
  reason: string | null;
  createdAt: Date;
};

export type EmailDeliveryLogFilters = {
  recipient?: string;
  templateKey?: string;
  status?: EmailDeliveryStatusFilter;
  domainId?: string;
  eventId?: string;
  from?: Date;
  to?: Date;
};

/**
 * Bounded, filterable email-delivery log listing — TECH_TEAM / COORDINATOR
 * only (enforced by the route; never exposed to domain leads or volunteers).
 *
 * EFFECTIVE-STATUS PROJECTION: EmailDeliveryLog is append-only (queue,
 * attempt, send, suppression evidence must never be erased), but a logical
 * email can therefore accumulate several rows — a `QUEUED` row, then `SENT`.
 * Non-technical readers should see ONE current row per logical email, so the
 * query groups rows by their outbox row (`outbox_id`; unlinked legacy rows
 * collapse nowhere) and returns only the "effective" row:
 *
 *   SENT > SUPPRESSED > DEAD > FAILED(retrying) > QUEUED
 *
 * The underlying history remains fully queryable in storage; only the view is
 * aggregated, so auditability is preserved. Status filters apply to the
 * effective state, counts are per logical email, and retries surface as a
 * "retrying" state instead of ambiguous duplicates.
 */
export async function listEmailDeliveryLogs(args: {
  filters: EmailDeliveryLogFilters;
  page: number;
  limit: number;
}): Promise<Paginated<EmailDeliveryLogRow>> {
  const { filters, page, limit } = args;
  const offset = (page - 1) * limit;

  // Parameter-safe per-row filters.
  const conditions: Prisma.Sql[] = [];
  if (filters.recipient) {
    conditions.push(Prisma.sql`l.recipient ILIKE ${`%${filters.recipient}%`}`);
  }
  if (filters.templateKey) {
    conditions.push(Prisma.sql`l.template_key = ${filters.templateKey}`);
  }
  if (filters.domainId) conditions.push(Prisma.sql`l.domain_id = ${filters.domainId}::uuid`);
  if (filters.eventId) conditions.push(Prisma.sql`l.event_id = ${filters.eventId}::uuid`);
  if (filters.from) conditions.push(Prisma.sql`l.created_at >= ${filters.from}`);
  if (filters.to) conditions.push(Prisma.sql`l.created_at <= ${filters.to}`);
  const whereRow = conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
    : Prisma.empty;

  // Which effective status a row represents (lower = more "current").
  const effectiveWhere = filters.status
    ? Prisma.sql`WHERE eff.status = ${filters.status}::"EmailDeliveryStatus"`
    : Prisma.empty;

  const effective = Prisma.sql`
    WITH matching AS (
      SELECT l.*
      FROM email_delivery_log l
      ${whereRow}
    ),
    ranked AS (
      SELECT
        m.*,
        COALESCE(m.outbox_id::text, 'row:' || m.id::text) AS logical_key,
        CASE m.status
          WHEN 'SENT' THEN 1
          WHEN 'SUPPRESSED' THEN 2
          WHEN 'DEAD' THEN 3
          WHEN 'FAILED' THEN 4
          ELSE 5
        END AS effective_rank
      FROM matching m
    ),
    effective AS (
      SELECT DISTINCT ON (logical_key) *
      FROM ranked
      ORDER BY logical_key, effective_rank ASC, created_at DESC, id DESC
    )
  `;

  const [countRows, rows] = await prisma.$transaction([
    prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      ${effective}
      SELECT COUNT(*) AS total
      FROM effective eff
      ${effectiveWhere}
    `),
    prisma.$queryRaw<RawRow[]>(Prisma.sql`
      ${effective}
      SELECT
        eff.id,
        eff.outbox_id AS "outboxId",
        eff.recipient,
        eff.template_key AS "templateKey",
        eff.event_type AS "eventType",
        eff.subject,
        eff.status,
        eff.attempt_number AS "attemptNumber",
        eff.event_id AS "eventId",
        e.title AS "eventTitle",
        eff.domain_id AS "domainId",
        d.name AS "domainName",
        eff.assignment_id AS "assignmentId",
        eff.month_key AS "monthKey",
        eff.provider_message_id AS "providerMessageId",
        eff.reason,
        eff.created_at AS "createdAt"
      FROM effective eff
      ${effectiveWhere}
      LEFT JOIN "event" e ON e.id = eff.event_id
      LEFT JOIN "domain" d ON d.id = eff.domain_id
      ORDER BY eff.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
  ]);

  const total = countRows.length > 0 ? Number(countRows[0].total) : 0;
  const items: EmailDeliveryLogRow[] = rows.map((r) => ({
    id: r.id,
    outboxId: r.outboxId,
    recipient: r.recipient,
    templateKey: r.templateKey,
    eventType: r.eventType,
    subject: r.subject,
    status: r.status,
    attemptNumber: r.attemptNumber,
    eventId: r.eventId,
    eventTitle: r.eventTitle ?? null,
    domainId: r.domainId,
    domainName: r.domainName ?? null,
    assignmentId: r.assignmentId,
    monthKey: r.monthKey,
    providerMessageId: r.providerMessageId,
    reason: r.reason,
    createdAt: r.createdAt,
  }));

  return { items, page, limit, total, hasMore: page * limit < total };
}

type RawRow = {
  id: string;
  outboxId: string | null;
  recipient: string;
  templateKey: string;
  eventType: string;
  subject: string | null;
  status: EmailDeliveryStatusFilter;
  attemptNumber: number;
  eventId: string | null;
  eventTitle: string | null;
  domainId: string | null;
  domainName: string | null;
  assignmentId: string | null;
  monthKey: string | null;
  providerMessageId: string | null;
  reason: string | null;
  createdAt: Date;
};
