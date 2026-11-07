export type DayKind = "meeting" | "deadline" | "notice" | "event" | "hours";
export type DayItem = { id: string; kind: DayKind; title: string; at: string; detail: string };

const dayKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

export function sameLocalDay(value: string, day: Date) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && dayKey(parsed) === dayKey(day);
}

export function itemsOnDay(items: DayItem[], day: Date) {
  return items
    .filter(item => sameLocalDay(item.at, day))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.title.localeCompare(b.title));
}

export function upcomingDays(items: DayItem[], now: number, count = 14) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return { day, items: itemsOnDay(items, day) };
  }).filter(entry => entry.items.length > 0);
}
