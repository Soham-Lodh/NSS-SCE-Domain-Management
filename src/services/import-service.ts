import "server-only";

import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/prisma";
import { allowedEmailDomains } from "@/lib/env";
import { isEmailAllowed, normalizeEmail } from "@/lib/authorization/email";
import { writeAudit } from "@/lib/audit/write-audit";
import type { ImportRowInput } from "@/lib/validation/schemas";

export type ImportRowStatus = "valid" | "invalid" | "duplicate";

export type ImportPreviewRow = {
  rowIndex: number;
  email: string;
  fullName: string;
  rollNumber: string;
  year: string;
  gender: string;
  domainName: string;
  projectName: string;
  status: ImportRowStatus;
  reason?: string;
};

export type ImportPreview = {
  rows: ImportPreviewRow[];
  summary: { total: number; valid: number; invalid: number; duplicate: number };
};

/** Header aliases → canonical field. */
const HEADER_MAP: Record<string, keyof RawRow> = {
  "email address": "email",
  email: "email",
  "name": "fullName",
  "full name": "fullName",
  "roll no": "rollNumber",
  "roll no.": "rollNumber",
  "roll number": "rollNumber",
  rollno: "rollNumber",
  year: "year",
  gender: "gender",
  domain: "domainName",
  project: "projectName",
};

type RawRow = {
  email: string;
  fullName: string;
  rollNumber: string;
  year: string;
  gender: string;
  domainName: string;
  projectName: string;
};

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as { text?: string; richText?: { text: string }[]; result?: unknown };
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("").trim();
    if (typeof v.text === "string") return v.text.trim();
    if (v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
  }
  return String(value).trim();
}

/** Parses the first worksheet using header names (order-independent). */
export async function parseImportWorkbook(buffer: Buffer): Promise<RawRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const columnFor: Partial<Record<keyof RawRow, number>> = {};
  headerRow.eachCell((cell, col) => {
    const key = HEADER_MAP[cellText(cell.value).toLowerCase()];
    if (key && columnFor[key] === undefined) columnFor[key] = col;
  });

  if (columnFor.email === undefined) {
    throw new Error(
      "Could not find an 'Email Address' column. Expected headers: Email Address, Name, Roll No, Year, Gender, Domain, Project.",
    );
  }

  const rows: RawRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (key: keyof RawRow) => {
      const col = columnFor[key];
      return col ? cellText(row.getCell(col).value) : "";
    };
    const email = get("email");
    const fullName = get("fullName");
    if (!email && !fullName) return; // skip fully blank rows
    rows.push({
      email,
      fullName,
      rollNumber: get("rollNumber"),
      year: get("year"),
      gender: get("gender"),
      domainName: get("domainName"),
      projectName: get("projectName"),
    });
  });
  return rows;
}

/**
 * Validates parsed rows against: allowed email domain, existing domains and
 * projects, and duplication (within the file AND against the database). Returns
 * a preview with per-row status + reason. NOTHING is written here.
 */
export async function validateImport(rawRows: RawRow[]): Promise<ImportPreview> {
  const domainsAllowed = allowedEmailDomains();
  const domains = await prisma.domain.findMany({
    where: { isActive: true },
    select: { id: true, name: true, projects: { select: { name: true } } },
  });
  const domainByName = new Map(domains.map((d) => [d.name.trim().toLowerCase(), d]));

  const previewRows: ImportPreviewRow[] = [];
  const seenEmails = new Set<string>();
  const seenRolls = new Set<string>();

  // Batch-load existing people for duplicate detection.
  const emails = rawRows.map((r) => normalizeEmail(r.email)).filter(Boolean);
  const rolls = rawRows
    .map((r) => (r.rollNumber ? r.rollNumber.trim().toUpperCase() : ""))
    .filter(Boolean);
  const existingPeople = emails.length
    ? await prisma.person.findMany({
        where: { OR: [{ emailNormalized: { in: emails } }, { rollNumberNormalized: { in: rolls } }] },
        select: { emailNormalized: true, rollNumberNormalized: true },
      })
    : [];
  const existingEmails = new Set(existingPeople.map((p) => p.emailNormalized));
  const existingRolls = new Set(existingPeople.map((p) => p.rollNumberNormalized).filter(Boolean) as string[]);

  rawRows.forEach((raw, i) => {
    const rowIndex = i + 2; // spreadsheet row (1-based, header on row 1)
    const email = normalizeEmail(raw.email);
    const fullName = raw.fullName.trim();
    const rollNumber = raw.rollNumber.trim().toUpperCase();
    const domainName = raw.domainName.trim();
    const projectName = raw.projectName.trim();

    const base: ImportPreviewRow = {
      rowIndex,
      email,
      fullName,
      rollNumber,
      year: raw.year.trim(),
      gender: raw.gender.trim(),
      domainName,
      projectName,
      status: "valid",
    };

    const reject = (reason: string, status: ImportRowStatus = "invalid") => {
      previewRows.push({ ...base, status, reason });
    };

    if (!email || !fullName) return reject("Missing email or name.");
    if (!isEmailAllowed(email, domainsAllowed)) {
      return reject(`Email must end with ${domainsAllowed.map((d) => `@${d}`).join(" or ")}.`);
    }

    const domain = domainByName.get(domainName.toLowerCase());
    if (!domain) {
      return reject(`Unknown domain "${domainName || "(blank)"}" — must match an existing domain.`);
    }
    if (projectName) {
      const projectOk = domain.projects.some((p) => p.name.trim().toLowerCase() === projectName.toLowerCase());
      if (!projectOk) return reject(`Unknown project "${projectName}" for domain "${domain.name}".`);
    }

    const emailKey = email;
    const rollKey = rollNumber;
    if (
      seenEmails.has(emailKey) ||
      (rollKey && seenRolls.has(rollKey)) ||
      existingEmails.has(emailKey) ||
      (rollKey && existingRolls.has(rollKey))
    ) {
      return reject("Already exists (duplicate email or roll number).", "duplicate");
    }

    seenEmails.add(emailKey);
    if (rollKey) seenRolls.add(rollKey);
    previewRows.push(base);
  });

  const summary = {
    total: previewRows.length,
    valid: previewRows.filter((r) => r.status === "valid").length,
    invalid: previewRows.filter((r) => r.status === "invalid").length,
    duplicate: previewRows.filter((r) => r.status === "duplicate").length,
  };
  return { rows: previewRows, summary };
}

export function parseAndPreview(buffer: Buffer): Promise<ImportPreview> {
  return parseImportWorkbook(buffer).then(validateImport);
}

export type CommitResult = {
  created: number;
  skipped: number;
  skippedRows: { rowIndex: number; email: string; reason: string }[];
};

/**
 * Re-validates the submitted rows on the server (never trusts the client) and
 * inserts each valid row as a Person + VolunteerMembership in one transaction.
 * Duplicates are skipped — never duplicated in the database.
 */
export async function commitImport(args: {
  rows: ImportRowInput[];
  actorAppUserId: string;
  requestId: string;
}): Promise<CommitResult> {
  const { rows, actorAppUserId, requestId } = args;

  const domains = await prisma.domain.findMany({
    where: { isActive: true },
    select: { id: true, name: true, projects: { select: { id: true, name: true } } },
  });
  const domainByName = new Map(domains.map((d) => [d.name.trim().toLowerCase(), d]));
  const allowed = allowedEmailDomains();

  const skippedRows: CommitResult["skippedRows"] = [];
  let created = 0;

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    const fullName = row.fullName.trim();
    const rollNumber = row.rollNumber?.trim().toUpperCase() || null;
    const domainName = row.domainName.trim();

    // Re-validate every rule server-side.
    if (!email || !fullName || !isEmailAllowed(email, allowed)) {
      skippedRows.push({ rowIndex: 0, email, reason: "Invalid email or name." });
      continue;
    }
    const domain = domainByName.get(domainName.toLowerCase());
    if (!domain) {
      skippedRows.push({ rowIndex: 0, email, reason: `Unknown domain "${domainName}".` });
      continue;
    }
    const project = row.projectName
      ? domain.projects.find((p) => p.name.trim().toLowerCase() === row.projectName.trim().toLowerCase())
      : undefined;
    if (row.projectName && !project) {
      skippedRows.push({ rowIndex: 0, email, reason: `Unknown project "${row.projectName}".` });
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const existingPerson = await tx.person.findUnique({ where: { emailNormalized: email } });
        if (existingPerson) {
          // Already a member of this domain? skip (no dup). Else attach.
          const membership = await tx.volunteerMembership.findFirst({
            where: { personId: existingPerson.id, domainId: domain.id },
          });
          if (membership) {
            skippedRows.push({ rowIndex: 0, email, reason: "Already a member of this domain." });
            return;
          }
          const m = await tx.volunteerMembership.create({
            data: { personId: existingPerson.id, domainId: domain.id, projectId: project?.id ?? null },
          });
          await writeAudit(tx, {
            actorAppUserId,
            action: "VOLUNTEER_IMPORTED",
            targetType: "VolunteerMembership",
            targetId: m.id,
            domainId: domain.id,
            requestId,
            after: { email, domain: domain.name, project: project?.name ?? null },
          });
          created += 1;
          return;
        }

        if (rollNumber) {
          const rollOwner = await tx.person.findUnique({ where: { rollNumberNormalized: rollNumber } });
          if (rollOwner) {
            skippedRows.push({ rowIndex: 0, email, reason: "Roll number already in use." });
            return;
          }
        }

        const person = await tx.person.create({
          data: {
            fullName,
            emailNormalized: email,
            rollNumberNormalized: rollNumber,
            year: row.year?.trim() || null,
            gender: row.gender?.trim() || null,
          },
        });
        const m = await tx.volunteerMembership.create({
          data: { personId: person.id, domainId: domain.id, projectId: project?.id ?? null },
        });
        await writeAudit(tx, {
          actorAppUserId,
          action: "VOLUNTEER_IMPORTED",
          targetType: "VolunteerMembership",
          targetId: m.id,
          domainId: domain.id,
          requestId,
          after: { email, domain: domain.name, project: project?.name ?? null, rollNumber },
        });
        created += 1;
      });
    } catch {
      skippedRows.push({ rowIndex: 0, email, reason: "Could not insert (constraint conflict)." });
    }
  }

  return { created, skipped: skippedRows.length, skippedRows };
}
