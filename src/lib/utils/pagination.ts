/** Bounded pagination helpers (offset-based, deterministic & capped). */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function parsePagination(params: URLSearchParams): {
  page: number;
  limit: number;
  skip: number;
} {
  const rawPage = Number.parseInt(params.get("page") ?? "1", 10);
  const rawLimit = Number.parseInt(
    params.get("limit") ?? String(DEFAULT_PAGE_SIZE),
    10,
  );
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Math.min(
    Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  );
  return { page, limit, skip: (page - 1) * limit };
}

export type Paginated<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export function paginated<T>(
  items: T[],
  page: number,
  limit: number,
  total: number,
): Paginated<T> {
  return { items, page, limit, total, hasMore: page * limit < total };
}
