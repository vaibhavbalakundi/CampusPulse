export function startOfLocalDay(value = new Date()) {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  return day;
}

export function endOfLocalDay(value = new Date()) {
  const day = new Date(value);
  day.setHours(23, 59, 59, 999);
  return day;
}

export function toDateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fromDateInputValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return startOfLocalDay(new Date(year, month - 1, day));
}

export function shiftLocalDay(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return startOfLocalDay(next);
}

export function isSameLocalDay(iso: string | null | undefined, day: Date) {
  if (!iso) return false;
  const time = new Date(iso);
  if (!Number.isFinite(time.getTime())) return false;
  return time.getFullYear() === day.getFullYear() && time.getMonth() === day.getMonth() && time.getDate() === day.getDate();
}

export function isToday(day: Date, now = new Date()) {
  return isSameLocalDay(now.toISOString(), day);
}

export function formatDayLabel(day: Date, now = new Date()) {
  if (isToday(day, now)) return "Today";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(day);
}

export function matchesQuery(haystack: string, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle);
}
