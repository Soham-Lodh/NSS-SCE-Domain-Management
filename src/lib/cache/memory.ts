import "server-only";

/**
 * Tiny process-local TTL memo — used ONLY for small, non-sensitive reference
 * data (the active domain list). This is NOT a shared/distributed cache: on a
 * multi-instance deployment each instance has its own copy, which is why we
 * keep TTLs short, always fall back to the database, and invalidate explicitly
 * on domain mutations.
 *
 * It is safe by construction: if anything goes wrong, or the entry is missing,
 * we call the loader and hit the database.
 */
type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();
const pending = new Map<string, Promise<unknown>>();

export async function memoized<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;
  const inFlight = pending.get(key) as Promise<T> | undefined;
  if (inFlight) return inFlight;

  const loading = loader()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, loading);
  return loading;
}

export function invalidateMemo(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function clearMemo(): void {
  store.clear();
  pending.clear();
}
