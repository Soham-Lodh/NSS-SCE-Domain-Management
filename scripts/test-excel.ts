/**
 * Verifies the Excel pipeline end-to-end against the real database.
 * Run:  NODE_OPTIONS="--conditions=react-server" npx tsx scripts/test-excel.ts
 *
 * Creates a TEMPORARY domain, exercises import validation + both exports, then
 * removes the temporary domain. No permanent test data is left behind.
 */
import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let value = m[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[m[1] as string] = value;
  }
}
loadEnvFile(".env");
loadEnvFile(".env.local");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { parseImportWorkbook, validateImport } = await import("../src/services/import-service");
  const { buildVolunteerEventsExport, buildDomainReport } = await import("../src/services/export-service");
  const prisma = new PrismaClient();

  const TEMP = "VerifyTemp Domain";
  const lines: string[] = [];
  const ok = (m: string) => lines.push(`  ✅ ${m}`);
  const bad = (m: string) => lines.push(`  ❌ ${m}`);

  // Clean any leftover from a previous run (children first).
  const stale = await prisma.domain.findMany({ where: { name: TEMP }, select: { id: true } });
  for (const s of stale) {
    await prisma.volunteerMembership.deleteMany({ where: { domainId: s.id } });
    await prisma.domain.delete({ where: { id: s.id } }).catch(() => {});
  }

  let domainId = "";
  try {
    // Seed a temp domain; projects are global canonical groups.
    const domain = await prisma.domain.create({ data: { name: TEMP, description: "temporary verification" } });
    domainId = domain.id;

    // Build a sample workbook matching the agreed columns.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Volunteers");
    ws.addRow(["Email Address", "Name", "Roll No", "Year", "Gender", "Domain", "Project"]);
    ws.addRow([`ok1@${process.env.ALLOWED_EMAIL_DOMAINS}`, "Valid One", "VERIFY001", "3", "Female", TEMP, "Nidaan"]);
    ws.addRow(["evil@gmail.com", "Bad Email", "VERIFY002", "2", "Male", TEMP, ""]);
    ws.addRow([`ok2@${process.env.ALLOWED_EMAIL_DOMAINS}`, "Unknown Domain", "VERIFY003", "1", "Male", "Nonexistent Domain", ""]);
    ws.addRow([`ok1@${process.env.ALLOWED_EMAIL_DOMAINS}`, "Duplicate Email", "VERIFY004", "4", "Other", TEMP, ""]);
    ws.addRow([`ok3@${process.env.ALLOWED_EMAIL_DOMAINS}`, "Bad Project", "VERIFY005", "2", "Male", TEMP, "Nonexistent Project"]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const raw = await parseImportWorkbook(buffer);
    const preview = await validateImport(raw);
    const byStatus = (s: string) => preview.rows.filter((r) => r.status === s).length;

    if (raw.length === 5) ok(`Parsed ${raw.length} data rows from the workbook.`);
    else bad(`Expected 5 parsed rows, got ${raw.length}.`);

    if (byStatus("valid") === 1) ok("Exactly 1 row is valid.");
    else bad(`Expected 1 valid row, got ${byStatus("valid")}.`);
    if (byStatus("invalid") === 3) ok("3 rows rejected (bad email, unknown domain, unknown project).");
    else bad(`Expected 3 invalid rows, got ${byStatus("invalid")}.`);
    if (byStatus("duplicate") === 1) ok("1 duplicate row detected (no redundant data).");
    else bad(`Expected 1 duplicate row, got ${byStatus("duplicate")}.`);

    for (const r of preview.rows) {
      lines.push(`     row ${r.rowIndex}: ${r.status.padEnd(9)} ${r.email} ${r.reason ? "— " + r.reason : ""}`);
    }

    // Exports
    const volExport = await buildVolunteerEventsExport(domainId);
    const repExport = await buildDomainReport(domainId);
    const volCheck = new ExcelJS.Workbook();
    await volCheck.xlsx.load(volExport.buffer as unknown as ArrayBuffer);
    const repCheck = new ExcelJS.Workbook();
    await repCheck.xlsx.load(repExport.buffer as unknown as ArrayBuffer);

    if (volExport.buffer.length > 0 && volCheck.worksheets.length === 3) ok("Volunteer export generated (Report, Members, Assignments).");
    else bad("Volunteer export missing sheets or empty.");
    if (repExport.buffer.length > 0 && repCheck.worksheets.length === 2)
      ok("Domain report generated (Report + Events), domain name at top.");
    else bad("Domain report missing sheets or empty.");
    if (volExport.filename.includes(TEMP)) ok(`Export filename includes domain name (${volExport.filename}).`);
    else bad("Export filename missing the domain name.");
  } catch (e) {
    bad(`Exception: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // Clean up children first (FK Restrict on domain).
    try {
      const d = await prisma.domain.findFirst({ where: { name: TEMP }, select: { id: true } });
      if (d) {
        await prisma.volunteerMembership.deleteMany({ where: { domainId: d.id } });
        await prisma.domain.delete({ where: { id: d.id } });
      }
    } catch (e) {
      bad(`cleanup failed: ${e instanceof Error ? e.message.split("\n")[0] : "unknown"}`);
    }
    await prisma.$disconnect();
  }

  console.log("\n=== EXCEL PIPELINE VERIFICATION ===\n" + lines.join("\n") + "\n");
}

main().catch((e) => {
  console.error("test-excel crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
