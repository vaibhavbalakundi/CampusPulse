import { GB } from "chrono-node/en";

export type MeetingTimeDraft = { text: string; iso: string | null; preview: string; error: string; dateOnly?: boolean };
export type ParseTimeOptions = { allowDateOnly?: boolean };
export const EMPTY_MEETING_TIME: MeetingTimeDraft = { text: "", iso: null, preview: "", error: "", dateOnly: false };
const display = (date: Date, includeTime = true) => new Intl.DateTimeFormat("en-IN", {
  weekday: "short", day: "numeric", month: "short", year: "numeric",
  ...(includeTime ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" } as const : {}),
}).format(date);

function endOfLocalDay(date: Date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function parseMeetingTime(text: string, reference = new Date(), options: ParseTimeOptions = {}): MeetingTimeDraft {
  const allowDateOnly = options.allowDateOnly === true;
  const result = { text, iso: null, preview: "", error: "", dateOnly: false } as MeetingTimeDraft;
  if (!text.trim()) return result;
  if (text.length > 150) return { ...result, error: "Keep the proposed time under 150 characters." };
  if (/^\s*(right\s+)?now\s*$/i.test(text)) {
    const soon = new Date(reference.getTime() + 2 * 60_000);
    return { ...result, iso: soon.toISOString(), preview: `${display(soon)} · in about 2 minutes` };
  }
  const matches = GB.parse(text, reference, { forwardDate: true, timezones: { IST: 330 } });
  if (matches.length !== 1 || matches[0].end) {
    return { ...result, error: allowDateOnly
      ? "Enter one date, or a date and time, for example tomorrow or tomorrow at 5 pm."
      : "Enter one date and time, for example tomorrow at 10 pm." };
  }
  const match = matches[0]; const parts = match.start; const date = parts.date();
  const outside = text.slice(0, match.index) + text.slice(match.index + match.text.length);
  if (/\d/.test(outside) || /\b(not|except|instead|or)\b/i.test(text)) {
    return { ...result, error: allowDateOnly
      ? "I couldn’t resolve one clear date. Try tomorrow, tomorrow at 5 pm, or 15 November."
      : "I couldn’t resolve one clear time. Try tomorrow at 10 pm, or 15 November at 14:00." };
  }
  const dateOnly = !parts.isCertain("hour") && !/\b(noon|midnight)\b/i.test(match.text);
  if (dateOnly) {
    if (!allowDateOnly) {
      return { ...result, preview: display(date, false), error: "Add a clock time, for example tomorrow at 10 pm." };
    }
    if (/\b(morning|afternoon|evening|night|tonight)\b/i.test(text)) {
      return { ...result, preview: display(date, false), error: "That’s too vague. Use the date alone, or add a clock time such as tomorrow at 3 pm." };
    }
    const end = endOfLocalDay(date);
    if (!Number.isFinite(end.getTime()) || end.getTime() <= reference.getTime()) return { ...result, preview: display(date, false), error: "That day has passed. Choose a future date." };
    if (end.getTime() > reference.getTime() + 180 * 86400000) return { ...result, error: "Choose a date within the next 180 days." };
    return { ...result, iso: end.toISOString(), preview: `${display(date, false)} · by end of day`, dateOnly: true };
  }
  if (!parts.isCertain("meridiem") && parts.get("hour")! <= 12 && !/\b\d{1,2}:\d{2}\b|\b(noon|midnight)\b|\bin\s+\w+\s+(minutes?|hours?)\b/i.test(match.text)) {
    return { ...result, preview: display(date, false), error: "Please add am or pm, or use a 24-hour time such as 14:00." };
  }
  if (!Number.isFinite(date.getTime()) || date.getTime() <= reference.getTime()) return { ...result, error: "That time has passed. Please propose a future time." };
  if (date.getTime() > reference.getTime() + 180 * 86400000) return { ...result, error: "Choose a meeting time within the next 180 days." };
  return { ...result, iso: date.toISOString(), preview: display(date) };
}
