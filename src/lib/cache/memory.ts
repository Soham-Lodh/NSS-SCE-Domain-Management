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

export async function memoized<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;
  const value = await loader();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

export function invalidateMemo(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function clearMemo(): void {
  store.clear();
}
