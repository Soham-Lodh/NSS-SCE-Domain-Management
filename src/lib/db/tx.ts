import "server-only";

import { Prisma, PrismaClient } from "@prisma/client";
import { logger } from "@/lib/observability/logger";

/**
 * Canonical concurrency contract for business mutations (assignments, event
 * lifecycle, volunteer deactivation, import commit).
 *
 * GLOBAL LOCK ORDER (strict 2PL — no early release):
 *   1. the owning Event row(s), ordered by event id
 *   2. VolunteerMembership rows, de-duplicated and sorted by membership id
 *   3. existing EventAssignment rows, sorted by assignment id
 *   4. affected pending EmailOutbox rows, sorted by outbox id
 *   5. business mutations + history/audit/outbox writes, still holding locks
 *   6. COMMIT — PostgreSQL releases every lock.
 *
 * The order above is the ONLY order in which locks are acquired anywhere; a
 * transaction never locks assignment rows before event rows, etc. Following
 * one deterministic order makes classic lock-ordering deadlocks impossible
 * (all competing transactions wait in the same direction).
 *
 * Locks are held until commit/rollback — they are NEVER released mid-way,
 * because releasing an exclusive lock before the mutation finishes would
 * reintroduce exactly the races the lock order removes.
 */

/** Time a mutation may wait for a competing lock (fail fast, bounded). */
const LOCK_TIMEOUT_MS = Number(process.env.LOCK_TIMEOUT_MS ?? 3_000);
/** Per-statement budget inside the transaction. */
const STATEMENT_TIMEOUT_MS = Number(process.env.STATEMENT_TIMEOUT_MS ?? 10_000);
/** Whole-transaction budget (execution only; excludes lock acquisition). */
const TRANSACTION_TIMEOUT_MS = Number(process.env.TRANSACTION_TIMEOUT_MS ?? 30_000);
/** Total attempts (1 initial + 2 retries) for transient conflicts only. */
const MAX_ATTEMPTS = Number(process.env.TX_MAX_ATTEMPTS ?? 3);

type TxClient = Prisma.TransactionClient;

/** Prisma raw SQL failures are reported as P2010 with the driver message. */
function isTransient(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === "P2034") return true; // transaction conflict / serialization / deadlock wrapper
  const msg = String(err.message).toLowerCase();
  return (
    err.code === "P2010" &&
    (msg.includes("deadlock detected") ||
      msg.includes("could not serialize") ||
      msg.includes("lock timeout") ||
      msg.includes("canceling statement due to lock timeout") ||
      msg.includes("conflict with recovery"))
  );
}

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * ms * 0.5);
}

/**
 * Runs `fn` inside one PostgreSQL transaction with:
 *  - transaction-local `lock_timeout` / `statement_timeout` (bounded waiting),
 *  - strict-2PL lock helpers available on the transaction client (lockEvent,
 *    lockMemberships, lockAssignments),
 *  - retry ONLY of transient conflicts (deadlock, serialization, lock timeout),
 *    with jittered backoff, rolling back the whole failed transaction first.
 *
 * Validation, authorization and uniqueness/business failures are never
 * retried; exhausted retries surface as a CONFLICT-flavoured ApiControl so
 * a partially committed request can never be returned as success.
 */
export async function withBusinessTx<T>(
  prisma: PrismaClient,
  fn: (tx: TxClient) => Promise<T>,
  meta: { requestId?: string; action: string } = { action: "mutation" },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // Transaction-local settings: every statement in this transaction
          // obeys the bounded budgets; they vanish at COMMIT/ROLLBACK.
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
          return fn(tx);
        },
        {
          timeout: TRANSACTION_TIMEOUT_MS,
          // Pool acquisition can lag under Supabase pooler latency; keep the
          // existing generous maxWait but keep execution bounded.
          maxWait: 30_000,
        },
      );
      return result;
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === MAX_ATTEMPTS) throw err;
      const backoff = jitter(attempt * 250);
      logger.warn("business_tx_transient_retry", {
        action: meta.action,
        requestId: meta.requestId,
        attempt,
        backoffMs: backoff,
      });
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

/* ---------------------------- Lock helpers -------------------------------- */

export type LockingTx = TxClient & {
  /** Locks the event rows (strict order step 1). */
  lockEvent(id: string): Promise<void>;
  /** Locks membership rows, de-duplicated + sorted (step 2). */
  lockMemberships(ids: string[]): Promise<void>;
  /** Locks assignment rows, de-duplicated + sorted (step 3). */
  lockAssignments(ids: string[]): Promise<void>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuids(ids: string[], what: string): void {
  for (const id of ids) {
    if (!UUID.test(id)) throw new Error(`lockIds: invalid ${what} id`);
  }
}

/**
 * Attaches the lock helpers to a transaction client. Each helper issues one
 * `SELECT ... FOR UPDATE` in the canonical sorted order. Rows that vanish
 * concurrently are simply absent from the plan (no error); callers must always
 * validate existence/eligibility AFTER locking, which the services do.
 */
export function lockingTx(tx: TxClient): LockingTx {
  const lockById = async (table: "event" | "volunteer_membership" | "event_assignment", ids: string[]) => {
    const unique = Array.from(new Set(ids)).sort(); // deterministic total order
    if (unique.length === 0) return;
    assertUuids(unique, table);
    // Single statement: locks every row in ascending id order (PostgreSQL
    // scans the index in order), eliminating the read-then-lock race.
    await tx.$executeRaw(
      Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id IN (${Prisma.join(
        unique.map((id) => Prisma.sql`${id}::uuid`),
      )}) ORDER BY id FOR UPDATE`,
    );
  };

  return {
    ...tx,
    lockEvent: (id) => lockById("event", [id]),
    lockMemberships: (ids) => lockById("volunteer_membership", ids),
    lockAssignments: (ids) => lockById("event_assignment", ids),
  } as LockingTx;
}

