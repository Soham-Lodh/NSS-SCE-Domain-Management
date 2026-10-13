/**
 * LOCAL DEVELOPMENT SEED — fictional data only.
 *
 * Intentionally does NOT create privileged AppUser accounts: those require a
 * real Supabase Auth identity and are provisioned through the app's onboarding
 * flow. Never run this against production.
 */
import { PrismaClient } from "@prisma/client";
import { ALLOWED_PROJECT_NAMES } from "../src/lib/projects";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database.");
  }

  const [health, education] = await Promise.all([
    prisma.domain.upsert({
      where: { name: "Health" },
      update: {},
      create: { name: "Health", description: "Health & wellness domain (fictional)" },
    }),
    prisma.domain.upsert({
      where: { name: "Education" },
      update: {},
      create: { name: "Education", description: "Education & literacy domain (fictional)" },
    }),
  ]);

  const projects = await Promise.all(
    ALLOWED_PROJECT_NAMES.map((name) =>
      prisma.project.upsert({
        where: { name },
        update: { isActive: true },
        create: { name, isActive: true },
      }),
    ),
  );
  const defaultProject = projects.find((p) => p.name === "Nidaan") ?? projects[0];

  const people = [
    { fullName: "Asha Verma", emailNormalized: "asha.verma@example.test", rollNumberNormalized: "TEST001" },
    { fullName: "Rahul Nair", emailNormalized: "rahul.nair@example.test", rollNumberNormalized: "TEST002" },
    { fullName: "Meera Das", emailNormalized: "meera.das@example.test", rollNumberNormalized: "TEST003" },
    { fullName: "Vikram Rao", emailNormalized: "vikram.rao@example.test", rollNumberNormalized: "TEST004" },
  ];

  for (const p of people) {
    await prisma.person.upsert({
      where: { emailNormalized: p.emailNormalized },
      update: {},
      create: p,
    });
  }

  const membershipRows = [
    { email: "asha.verma@example.test", domainId: health.id, projectId: defaultProject.id },
    { email: "rahul.nair@example.test", domainId: health.id, projectId: defaultProject.id },
    { email: "meera.das@example.test", domainId: education.id, projectId: null },
    { email: "vikram.rao@example.test", domainId: education.id, projectId: null },
  ];

  for (const m of membershipRows) {
    const person = await prisma.person.findUniqueOrThrow({ where: { emailNormalized: m.email } });
    const existing = await prisma.volunteerMembership.findFirst({
      where: { personId: person.id, domainId: m.domainId },
    });
    if (!existing) {
      await prisma.volunteerMembership.create({
        data: { personId: person.id, domainId: m.domainId, projectId: m.projectId ?? null },
      });
    }
  }

  console.log("Seed complete: 2 domains, 9 projects, 4 fictional members (no privileged accounts).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
