export type MeetingStatus = "available" | "busy" | "away";
export type ManualStatus = { status: MeetingStatus; updated_at: string; expires_at: string };
export type ScheduledStatus = { faculty_id: string; status: MeetingStatus; starts_at: string; expires_at: string };

// The most recent started change wins. An expired change stays unknown;
// older availability must never silently reappear after a newer change expires.
export function effectiveStatus(manual: ManualStatus | undefined, scheduled: ScheduledStatus | undefined, now: number) {
  const manualTime = manual ? Date.parse(manual.updated_at) : -Infinity;
  const scheduledTime = scheduled ? Date.parse(scheduled.starts_at) : Infinity;
  const useScheduled = !!scheduled && scheduledTime <= now && scheduledTime > manualTime;
  const status = useScheduled ? scheduled : manual;
  if (!status) return null;
  const changedAt = useScheduled ? scheduled!.starts_at : manual!.updated_at;
  return { status: status.status, changedAt, expiresAt: status.expires_at, current: Date.parse(status.expires_at) > now, scheduled: useScheduled };
}

export type OfficeHourWindow = { weekday: number; start_time: string; end_time: string; timezone: string };
export type Presence = { status: MeetingStatus | null; source: "override" | "scheduled" | "hours" | "none"; expiresAt: string | null };

const weekdayIndex: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function clockMinutes(value: string) {
  const [hours, minutes] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function zonedParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const read = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  const hour = read("hour") === "24" ? 0 : Number(read("hour"));
  return { weekday: weekdayIndex[read("weekday")] ?? 0, year: Number(read("year")), month: Number(read("month")), day: Number(read("day")), minutes: hour * 60 + Number(read("minute")) };
}

function zoneOffset(instant: number, timeZone: string) {
  const parts = zonedParts(instant, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, Math.floor(parts.minutes / 60), parts.minutes % 60) - instant;
}

export function zonedTime(year: number, month: number, day: number, minutes: number, timeZone: string) {
  const guess = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  return guess - zoneOffset(guess - zoneOffset(guess, timeZone), timeZone);
}

export function insideOfficeHours(hours: OfficeHourWindow[], now: number) {
  return hours.some(hour => {
    const parts = zonedParts(now, hour.timezone || "UTC");
    return parts.weekday === hour.weekday && parts.minutes >= clockMinutes(hour.start_time) && parts.minutes < clockMinutes(hour.end_time);
  });
}

export function campusPresence(
  manual: ManualStatus | undefined,
  scheduled: ScheduledStatus | undefined,
  hours: OfficeHourWindow[],
  now: number,
  autoBusyOutsideHours?: boolean,
): Presence {
  const current = effectiveStatus(manual, scheduled, now);
  if (current?.current) return { status: current.status, source: current.scheduled ? "scheduled" : "override", expiresAt: current.expiresAt };
  if (!hours.length) return { status: null, source: "none", expiresAt: null };
  if (insideOfficeHours(hours, now)) return { status: "available", source: "hours", expiresAt: null };
  if (autoBusyOutsideHours) return { status: "busy", source: "hours", expiresAt: null };
  return { status: "away", source: "hours", expiresAt: null };
}

export function suggestFacultyForTopic<T extends { id: string; name: string; department: string; expertise?: string; portfolio?: string }>(
  people: T[],
  topic: string,
  limit = 3,
) {
  const tokens = topic.toLowerCase().split(/[^a-z]+/i).filter(token => token.length >= 3);
  if (!tokens.length) return [] as Array<T & { score: number }>;
  const scored = people.map(person => {
    const fields = [
      person.expertise || "",
      person.portfolio || "",
      person.department,
      person.name,
    ].join(" ").toLowerCase();
    let score = 0;
    for (const token of tokens) if (fields.includes(token)) score += 1;
    return { ...person, score };
  });
  return scored.filter(person => person.score > 0).sort((left, right) => right.score - left.score).slice(0, limit);
}

export function nextOfficeSlots(hours: OfficeHourWindow[], now: number, count = 3) {
  const found: { at: number }[] = [];
  for (const hour of hours) {
    const zone = hour.timezone || "UTC";
    const start = clockMinutes(hour.start_time);
    let cursor = now;
    for (let step = 0; step < 21; step += 1) {
      const parts = zonedParts(cursor, zone);
      if (parts.weekday === hour.weekday) {
        const instant = zonedTime(parts.year, parts.month, parts.day, start, zone);
        if (instant > now) found.push({ at: instant });
      }
      cursor += 86_400_000;
    }
  }
  return found.sort((a, b) => a.at - b.at).slice(0, count).map(slot => ({
    at: new Date(slot.at).toISOString(),
    label: new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(slot.at),
  }));
}

export function shortFacultyList<T extends { id: string; department: string }>(people: T[], mine: string, met: Set<string>, statusOf: (id: string) => Presence) {
  return people.filter(person => met.has(person.id) || (person.department === mine && mine !== "" && statusOf(person.id).status === "available"));
}

export function directoryFaculty<T extends { id: string }>(
  people: T[],
  mode: "recent" | "all" | "available",
  recent: Set<string>,
  met: Set<string>,
  isAvailable: (id: string) => boolean,
  waitingOf: (id: string) => number = () => 0,
) {
  const filtered = mode === "all"
    ? people
    : mode === "available"
      ? people.filter(person => isAvailable(person.id))
      : people.filter(person => recent.has(person.id) || met.has(person.id));
  return [...filtered].sort((left, right) => {
    const free = Number(isAvailable(right.id)) - Number(isAvailable(left.id));
    if (free) return free;
    const wait = waitingOf(left.id) - waitingOf(right.id);
    if (wait) return wait;
    return Number(recent.has(right.id) || met.has(right.id)) - Number(recent.has(left.id) || met.has(left.id));
  });
}
