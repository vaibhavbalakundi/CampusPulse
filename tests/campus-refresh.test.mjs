import { test } from "node:test";
import assert from "node:assert/strict";
import { campusRefreshPlan } from "../lib/campus-refresh.ts";

const student = { id: "student", role: "student", active: true };
const faculty = { id: "faculty", role: "faculty", active: true };
const view = { role: "student", profileIds: ["student", "faculty"] };

test("an unchanged campus keeps its last private snapshot when a core query fails", () => {
  assert.equal(campusRefreshPlan(view, [faculty, student], "student", false, true), "keep");
});

test("a changed directory or role replaces cached private records instead of mixing them", () => {
  assert.equal(campusRefreshPlan(view, [student, { ...faculty, id: "other-faculty" }], "student", false, true), "replace");
  assert.equal(campusRefreshPlan(view, [{ ...student, role: "faculty" }, faculty], "student", false, true), "replace");
  assert.equal(campusRefreshPlan(null, [student, faculty], "student", false, true), "replace");
});

test("lost or unverified access revokes the workspace, and a healthy refresh commits", () => {
  assert.equal(campusRefreshPlan(view, [{ ...student, active: false }, faculty], "student", false, false), "revoke");
  assert.equal(campusRefreshPlan(view, [], "student", false, true), "revoke");
  assert.equal(campusRefreshPlan(view, [student, faculty], "student", true, false), "revoke");
  assert.equal(campusRefreshPlan(view, [student, faculty], "student", false, false), "commit");
});
