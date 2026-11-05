// 프로젝트 목록 쿼리 파라미터(A-02 GET). 커서는 불투명 문자열이며 내부적으로는 오프셋이다
// (프로젝트는 사용자당 최대 20개라 키셋 페이징이 필요 없고, 사용자 입력을 필터 문자열에 넣지 않아 안전하다).
export const PROJECT_STATUSES = ["active", "archived", "all"] as const;
export const PROJECT_SORTS = ["updated", "created", "name"] as const;

export type ProjectStatusFilter = (typeof PROJECT_STATUSES)[number];
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export interface ListParams {
  q: string;
  status: ProjectStatusFilter;
  sort: ProjectSort;
  limit: number;
  offset: number;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const MAX_QUERY_LENGTH = 100;

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): number | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const offset = (value as { o?: unknown } | null)?.o;
    return typeof offset === "number" && Number.isInteger(offset) && offset >= 0 && offset <= 100_000 ? offset : null;
  } catch {
    return null;
  }
}

type Source = URLSearchParams | Record<string, string | string[] | undefined>;

function pick(source: Source, key: string): string | undefined {
  if (source instanceof URLSearchParams) return source.get(key) ?? undefined;
  const v = source[key];
  return Array.isArray(v) ? v[0] : v;
}

/** 잘못된 값은 null(= 400). 화면은 기본값을 쓰고 싶으면 `lenient`를 켠다. */
export function parseListParams(source: Source, opts: { lenient?: boolean } = {}): ListParams | null {
  const bad = <T>(fallback: T): T | null => (opts.lenient ? fallback : null);

  let q = (pick(source, "q") ?? "").trim();
  if (q.length > MAX_QUERY_LENGTH) {
    if (!opts.lenient) return null;
    q = q.slice(0, MAX_QUERY_LENGTH);
  }

  const statusRaw = pick(source, "status");
  const status = statusRaw === undefined ? "active" : (PROJECT_STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as ProjectStatusFilter) : bad("active" as const);
  const sortRaw = pick(source, "sort");
  const sort = sortRaw === undefined ? "updated" : (PROJECT_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as ProjectSort) : bad("updated" as const);

  const limitRaw = pick(source, "limit");
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    const n = Number(limitRaw);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_LIMIT) limit = n;
    else if (!opts.lenient) return null;
  }

  const cursorRaw = pick(source, "cursor");
  let offset = 0;
  if (cursorRaw) {
    const decoded = decodeCursor(cursorRaw);
    if (decoded !== null) offset = decoded;
    else if (!opts.lenient) return null;
  }

  if (status === null || sort === null) return null;
  return { q, status, sort, limit, offset };
}
