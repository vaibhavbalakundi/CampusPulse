/** Device-local campus preferences (favorites, sticky reasons, status cache). */

const safeParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

export function favoriteFacultyKey(userId: string) {
  return `campuspulse.favorites.v1.${userId}`;
}

export function readFavoriteFaculty(userId: string): string[] {
  if (typeof window === "undefined") return [];
  const ids = safeParse<string[]>(localStorage.getItem(favoriteFacultyKey(userId)), []);
  return Array.isArray(ids) ? ids.filter(id => typeof id === "string").slice(0, 40) : [];
}

export function writeFavoriteFaculty(userId: string, ids: string[]) {
  try { localStorage.setItem(favoriteFacultyKey(userId), JSON.stringify(ids.slice(0, 40))); } catch { /* ignore */ }
}

export function toggleFavoriteFaculty(userId: string, facultyId: string): string[] {
  const current = readFavoriteFaculty(userId);
  const next = current.includes(facultyId)
    ? current.filter(id => id !== facultyId)
    : [facultyId, ...current.filter(id => id !== facultyId)].slice(0, 40);
  writeFavoriteFaculty(userId, next);
  return next;
}

export function reasonPrefsKey(userId: string) {
  return `campuspulse.reasons.v1.${userId}`;
}

export function readFacultyReasons(userId: string, facultyId: string): string[] {
  if (typeof window === "undefined") return [];
  const map = safeParse<Record<string, string[]>>(localStorage.getItem(reasonPrefsKey(userId)), {});
  const list = map[facultyId];
  return Array.isArray(list) ? list.filter(item => typeof item === "string" && item.trim()).slice(0, 4) : [];
}

export function rememberFacultyReason(userId: string, facultyId: string, reason: string) {
  const clean = reason.trim().slice(0, 120);
  if (!clean) return;
  const map = safeParse<Record<string, string[]>>(
    typeof window === "undefined" ? null : localStorage.getItem(reasonPrefsKey(userId)),
    {},
  );
  const previous = Array.isArray(map[facultyId]) ? map[facultyId] : [];
  map[facultyId] = [clean, ...previous.filter(item => item !== clean)].slice(0, 4);
  try { localStorage.setItem(reasonPrefsKey(userId), JSON.stringify(map)); } catch { /* ignore */ }
}

export type CachedPresence = {
  status: "available" | "busy" | "away" | null;
  updatedAt: string;
};

export type StatusCachePayload = {
  savedAt: string;
  byFaculty: Record<string, CachedPresence>;
};

export function statusCacheKey(userId: string) {
  return `campuspulse.status-cache.v1.${userId}`;
}

export function readStatusCache(userId: string): StatusCachePayload | null {
  if (typeof window === "undefined") return null;
  const raw = safeParse<StatusCachePayload | null>(localStorage.getItem(statusCacheKey(userId)), null);
  if (!raw || typeof raw !== "object" || !raw.byFaculty) return null;
  return raw;
}

export function writeStatusCache(userId: string, byFaculty: Record<string, CachedPresence>) {
  const payload: StatusCachePayload = { savedAt: new Date().toISOString(), byFaculty };
  try { localStorage.setItem(statusCacheKey(userId), JSON.stringify(payload)); } catch { /* ignore */ }
}

export function noticesDeptKey(userId: string) {
  return `campuspulse.notices-dept.v1.${userId}`;
}
