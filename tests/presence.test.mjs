import assert from "node:assert/strict";
import test from "node:test";
import { campusPresence, directoryFaculty, insideOfficeHours, nextOfficeSlots, shortFacultyList } from "../lib/availability.ts";

const wednesday = Date.parse("2026-11-04T10:30:00.000Z");
const hours = [{ weekday: 3, start_time: "10:00:00", end_time: "12:00:00", timezone: "UTC" }];

test("office hours make a faculty member available, and the rest of the week away", () => {
  assert.equal(insideOfficeHours(hours, wednesday), true);
  assert.equal(campusPresence(undefined, undefined, hours, wednesday).status, "available");
  assert.equal(campusPresence(undefined, undefined, hours, Date.parse("2026-11-04T13:00:00.000Z")).status, "away");
  assert.equal(campusPresence(undefined, undefined, [], wednesday).status, null);
});

test("a current override wins over the weekly hours", () => {
  const manual = { status: "busy", updated_at: "2026-11-04T10:00:00.000Z", expires_at: "2026-11-04T11:00:00.000Z" };
  const presence = campusPresence(manual, undefined, hours, wednesday);
  assert.equal(presence.status, "busy");
  assert.equal(presence.source, "override");
});

test("the next open hours are the next future starts", () => {
  const slots = nextOfficeSlots(hours, wednesday, 2);
  assert.equal(slots.length, 2);
  assert.equal(slots[0].at, "2026-11-11T10:00:00.000Z");
  assert.equal(slots[1].at, "2026-11-18T10:00:00.000Z");
});

test("the directory is recent or met, everyone, or available now", () => {
  const people = [{ id: "met" }, { id: "recent" }, { id: "free" }, { id: "other" }];
  const recent = new Set(["recent"]);
  const met = new Set(["met"]);
  const free = id => id === "free";
  assert.deepEqual(directoryFaculty(people, "recent", recent, met, free).map(person => person.id), ["met", "recent"]);
  assert.deepEqual(directoryFaculty(people, "all", recent, met, free).map(person => person.id), ["free", "met", "recent", "other"]);
  assert.deepEqual(directoryFaculty(people, "available", recent, met, free).map(person => person.id), ["free"]);
  assert.deepEqual(directoryFaculty(people, "all", recent, met, free, id => id === "met" ? 4 : 0).map(person => person.id), ["free", "recent", "other", "met"]);
});

test("the short list is free people in the same department, plus people already met", () => {
  const people = [
    { id: "free", department: "Computer Science" },
    { id: "busy", department: "Computer Science" },
    { id: "other", department: "Mechanical" },
    { id: "met", department: "Mechanical" },
  ];
  const status = { free: "available", busy: "busy", other: "available", met: "away" };
  const shown = shortFacultyList(people, "Computer Science", new Set(["met"]), id => ({ status: status[id], source: "hours", expiresAt: null }));
  assert.deepEqual(shown.map(person => person.id), ["free", "met"]);
});
