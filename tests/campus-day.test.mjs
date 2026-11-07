import assert from "node:assert/strict";
import test from "node:test";
import { itemsOnDay, upcomingDays } from "../lib/campus-day.ts";

const wednesday = new Date(2026, 10, 4, 15, 0, 0);
const items = [
  { id: "m", kind: "meeting", title: "Faculty meeting", at: "2026-11-04T09:30:00", detail: "Accepted" },
  { id: "d", kind: "deadline", title: "Form", at: "2026-11-04T18:00:00", detail: "Personal" },
  { id: "e", kind: "event", title: "Club night", at: "2026-11-05T19:00:00", detail: "Hall" },
  { id: "n", kind: "notice", title: "Fee date", at: "2026-11-06T10:00:00", detail: "Notice" },
];

test("a day contains only its own meetings, deadlines, notices and events", () => {
  const today = itemsOnDay(items, wednesday);
  assert.deepEqual(today.map(item => item.id), ["m", "d"]);
});

test("the coming days skip empty dates and keep chronological order", () => {
  const days = upcomingDays(items, wednesday.getTime(), 7);
  assert.equal(days.length, 3);
  assert.equal(days[0].items[0].id, "m");
  assert.equal(days[1].items[0].id, "e");
  assert.equal(days[2].items[0].id, "n");
});
