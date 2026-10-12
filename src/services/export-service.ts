import "server-only";

import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/api/response";
import { deriveEventCategory, type DerivedEventCategory } from "@/lib/utils/datetime";

export type ExportFile = { filename: string; buffer: Buffer };

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const data = await wb.xlsx.writeBuffer();
  return Buffer.from(data);
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FF2F3976" } };
}

function safeSheetName(name: string): string {
  // Excel sheet names: max 31 chars, no []:*?/\
  return name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";
}

function categoryOf(
  startAt: Date,
  endAt: Date,
  status: string,
  now: Date,
): DerivedEventCategory {
  const s = status === "CANCELLED" || status === "COMPLETED" ? status : "SCHEDULED";
  return deriveEventCategory(startAt, endAt, s as "SCHEDULED" | "COMPLETED" | "CANCELLED", now);
}

/**
 * Volunteer + event details for one domain, with the domain name and totals at
 * the top of the report. Sheets: Report, Members, Assignments.
 */
export async function buildVolunteerEventsExport(domainId: string): Promise<ExportFile> {
  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { name: true },
  });
  if (!domain) throw notFound("Domain not found.");

  const memberships = await prisma.volunteerMembership.findMany({
    where: { domainId },
    select: {
      id: true,
      isActive: true,
      person: { select: { fullName: true, emailNormalized: true, rollNumberNormalized: true, year: true, gender: true } },
      project: { select: { name: true } },
      assignments: {
        select: {
          status: true,
          assignedAt: true,
          completedAt: true,
          event: { select: { title: true, startAt: true, endAt: true, status: true, location: true } },
        },
      },
    },
    orderBy: { person: { fullName: "asc" } },
  });

  const now = new Date();
  const wb = new ExcelJS.Workbook();
  wb.creator = "NSS SCE KIIT Domain Management";
  wb.created = now;

  // --- Report sheet (domain name at the very top) ---
  const report = wb.addWorksheet(safeSheetName("Report"));
  report.columns = [
    { header: "Metric", key: "metric", width: 28 },
    { header: "Value", key: "value", width: 40 },
  ];
  styleHeader(report.getRow(1));
  report.addRow({ metric: "Domain", value: domain.name });
  report.addRow({ metric: "Generated", value: now.toISOString() });
  const allAssignments = memberships.flatMap((m) => m.assignments);
  report.addRow({ metric: "Total volunteers", value: memberships.length });
  report.addRow({ metric: "Active volunteers", value: memberships.filter((m) => m.isActive).length });
  report.addRow({ metric: "Total assignments", value: allAssignments.length });
  report.addRow({ metric: "Completed assignments", value: allAssignments.filter((a) => a.status === "COMPLETED").length });

  // --- Members summary sheet ---
  const membersSheet = wb.addWorksheet(safeSheetName("Members"));
  membersSheet.columns = [
    { header: "Name", key: "name", width: 28 },
    { header: "Email", key: "email", width: 34 },
    { header: "Roll No", key: "roll", width: 14 },
    { header: "Year", key: "year", width: 10 },
    { header: "Gender", key: "gender", width: 10 },
    { header: "Domain", key: "domain", width: 22 },
    { header: "Project", key: "project", width: 24 },
    { header: "Status", key: "status", width: 10 },
    { header: "Completed", key: "completed", width: 12 },
    { header: "Assigned", key: "assigned", width: 12 },
    { header: "Upcoming", key: "upcoming", width: 12 },
  ];
  styleHeader(membersSheet.getRow(1));
  for (const m of memberships) {
    const completed = m.assignments.filter((a) => a.status === "COMPLETED").length;
    const upcoming = m.assignments.filter(
      (a) => a.status === "ASSIGNED" && a.event.status === "SCHEDULED" && a.event.endAt > now,
    ).length;
    membersSheet.addRow({
      name: m.person.fullName,
      email: m.person.emailNormalized,
      roll: m.person.rollNumberNormalized ?? "",
      year: m.person.year ?? "",
      gender: m.person.gender ?? "",
      domain: domain.name,
      project: m.project?.name ?? "",
      status: m.isActive ? "Active" : "Inactive",
      completed,
      assigned: m.assignments.length,
      upcoming,
    });
  }

  // --- Assignments sheet (volunteer × event details) ---
  const assignSheet = wb.addWorksheet(safeSheetName("Assignments"));
  assignSheet.columns = [
    { header: "Volunteer", key: "volunteer", width: 26 },
    { header: "Roll No", key: "roll", width: 14 },
    { header: "Email", key: "email", width: 32 },
    { header: "Domain", key: "domain", width: 20 },
    { header: "Project", key: "project", width: 20 },
    { header: "Event", key: "event", width: 34 },
    { header: "Location", key: "location", width: 20 },
    { header: "Start", key: "start", width: 20 },
    { header: "End", key: "end", width: 20 },
    { header: "Category", key: "category", width: 12 },
    { header: "Assignment", key: "assignment", width: 12 },
    { header: "Completed At", key: "completedAt", width: 20 },
  ];
  styleHeader(assignSheet.getRow(1));
  for (const m of memberships) {
    for (const a of m.assignments) {
      assignSheet.addRow({
        volunteer: m.person.fullName,
        roll: m.person.rollNumberNormalized ?? "",
        email: m.person.emailNormalized,
        domain: domain.name,
        project: m.project?.name ?? "",
        event: a.event.title,
        location: a.event.location ?? "",
        start: a.event.startAt.toISOString(),
        end: a.event.endAt.toISOString(),
        category: categoryOf(a.event.startAt, a.event.endAt, a.event.status, now),
        assignment: a.status,
        completedAt: a.completedAt?.toISOString() ?? "",
      });
    }
  }

  return { filename: `volunteers-${domain.name}.xlsx`, buffer: await toBuffer(wb) };
}

/**
 * Domain report: domain name + all event counts and member totals at the top,
 * then the event list and a member summary.
 */
export async function buildDomainReport(domainId: string): Promise<ExportFile> {
  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { id: true, name: true },
  });
  if (!domain) throw notFound("Domain not found.");
  const now = new Date();

  const [events, memberships] = await Promise.all([
    prisma.event.findMany({
      where: { domainId },
      select: {
        title: true,
        location: true,
        startAt: true,
        endAt: true,
        status: true,
        endedAt: true,
        assignments: { where: { removedAt: null }, select: { status: true } },
      },
      orderBy: { startAt: "desc" },
    }),
    prisma.volunteerMembership.findMany({
      where: { domainId },
      select: { isActive: true, person: { select: { fullName: true, emailNormalized: true, rollNumberNormalized: true } } },
      orderBy: { person: { fullName: "asc" } },
    }),
  ]);

  const counts = { upcoming: 0, ongoing: 0, past: 0, completed: 0, cancelled: 0 };
  const eventRows = events.map((e) => {
    const category = categoryOf(e.startAt, e.endAt, e.status, now);
    if (category === "UPCOMING") counts.upcoming += 1;
    else if (category === "ONGOING") counts.ongoing += 1;
    else if (category === "PAST") counts.past += 1;
    else if (category === "COMPLETED") counts.completed += 1;
    else if (category === "CANCELLED") counts.cancelled += 1;
    return {
      title: e.title,
      location: e.location ?? "",
      start: e.startAt.toISOString(),
      end: e.endAt.toISOString(),
      category,
      status: e.status,
      assigned: e.assignments.length,
      completed: e.assignments.filter((a) => a.status === "COMPLETED").length,
    };
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "NSS SCE KIIT Domain Management";
  wb.created = now;

  const report = wb.addWorksheet(safeSheetName("Report"));
  report.columns = [
    { header: "Metric", key: "metric", width: 30 },
    { header: "Value", key: "value", width: 40 },
  ];
  styleHeader(report.getRow(1));
  report.addRow({ metric: "Domain", value: domain.name });
  report.addRow({ metric: "Generated", value: now.toISOString() });
  report.addRow({ metric: "Total events", value: events.length });
  report.addRow({ metric: "Upcoming events", value: counts.upcoming });
  report.addRow({ metric: "Ongoing events", value: counts.ongoing });
  report.addRow({ metric: "Past (still open) events", value: counts.past });
  report.addRow({ metric: "Completed events", value: counts.completed });
  report.addRow({ metric: "Cancelled events", value: counts.cancelled });
  report.addRow({ metric: "Total volunteers", value: memberships.length });
  report.addRow({ metric: "Active volunteers", value: memberships.filter((m) => m.isActive).length });

  const eventsSheet = wb.addWorksheet(safeSheetName("Events"));
  eventsSheet.columns = [
    { header: "Event", key: "title", width: 36 },
    { header: "Location", key: "location", width: 20 },
    { header: "Start", key: "start", width: 20 },
    { header: "End (deadline)", key: "end", width: 20 },
    { header: "Category", key: "category", width: 12 },
    { header: "Status", key: "status", width: 12 },
    { header: "Assigned", key: "assigned", width: 10 },
    { header: "Completed", key: "completed", width: 10 },
  ];
  styleHeader(eventsSheet.getRow(1));
  eventRows.forEach((r) => eventsSheet.addRow(r));

  return { filename: `domain-report-${domain.name}.xlsx`, buffer: await toBuffer(wb) };
}
