export type Status = "AVAILABLE" | "BUSY" | "AWAY";
export type Faculty = {
  id: string; name: string; title: string; department: string; room: string;
  status: Status; updatedAt: number; lastSeenAt: number; color: string;
};
export const statuses: Status[] = ["AVAILABLE", "BUSY", "AWAY"];
export const statusLabel = { AVAILABLE: "Available", BUSY: "Busy", AWAY: "Away" };
export const STALE_MS = 30 * 60 * 1000;
export const OFFLINE_MS = 2 * 60 * 1000;
// Fictional presentation data, never a directory of real faculty.
export function createDemo(now: number): Faculty[] {
  return [
    ["demo-01", "Dr. Aanya Sharma", "Associate Professor", "Computer Science", "CS Block · Room 204", "AVAILABLE", 3, 0, "lilac"],
    ["demo-02", "Dr. Arjun Mehta", "Assistant Professor", "Electronics", "EC Block · Room 108", "BUSY", 8, 0, "peach"],
    ["demo-03", "Dr. Meera Iyer", "Professor", "Mathematics", "Academic Block · Room 302", "AVAILABLE", 5, 0, "sage"],
    ["demo-04", "Prof. Rohan Das", "Assistant Professor", "Computer Science", "CS Block · Room 210", "AWAY", 12, 0, "blue"],
    ["demo-05", "Dr. Kavya Nair", "Associate Professor", "Electronics", "EC Block · Room 112", "AVAILABLE", 1, 0, "rose"],
    ["demo-06", "Prof. Dev Patel", "Assistant Professor", "Mechanical", "ME Block · Room 105", "BUSY", 18, 0, "sand"],
    ["demo-07", "Dr. Ishaan Rao", "Professor", "Mathematics", "Academic Block · Room 305", "AVAILABLE", 65, 7, "blue"],
    ["demo-08", "Dr. Tara Sen", "Associate Professor", "Mechanical", "ME Block · Room 201", "AWAY", 42, 0, "lilac"]
  ].map(([id, name, title, department, room, status, age, seen, color]) => ({
    id: String(id), name: String(name), title: String(title), department: String(department), room: String(room),
    status: status as Status, updatedAt: now - Number(age) * 60000, lastSeenAt: now - Number(seen) * 60000, color: String(color)
  }));
}
export function deviceState(faculty: Faculty, now: number) {
  const offline = now - faculty.lastSeenAt >= OFFLINE_MS;
  const stale = now - faculty.updatedAt >= STALE_MS;
  return { offline, stale, current: !offline && !stale };
}
export function relativeTime(timestamp: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes === 0) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60 ? `${minutes % 60} min ` : ""}ago`;
}
export function selectStatus(faculty: Faculty, status: Status, now: number): Faculty {
  return { ...faculty, status, updatedAt: now, lastSeenAt: now };
}
export function heartbeat(faculty: Faculty, now: number): Faculty {
  return { ...faculty, lastSeenAt: now };
}
