import { PrismaClient } from "@prisma/client";

/**
 * One PrismaClient per runtime. In development we cache on globalThis to survive
 * HMR; in production a single instance is created per server process.
 *
 * Connection budget: runtime uses the pooled DATABASE_URL
 * (pgbouncer?connection_limit=1) so serverless bursts do not exhaust Supabase
 * connections. Migrations use DIRECT_URL via prisma.config/schema directUrl.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    // The Supabase pooler link can be high-latency, so multi-statement
    // interactive transactions (first-login provisioning, assignment history,
    // import commit, people add) can exceed Prisma's default 5s timeout and
    // fail with a misleading P2028. Raise both budget limits so any
    // legitimate transaction completes; individual queries still fail fast.
    transactionOptions: {
      maxWait: 30_000, // time to acquire a connection for the transaction
      timeout: 60_000, // time for the transaction body to run to completion
    },
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
